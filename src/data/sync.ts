
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';

import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  MANAGER_FIRST_PULL_DAYS,
  PINGS_BATCH_SIZE,
  PUSH_BATCH_SIZE,
  SYNC_OVERLAP,
  WAYBILL_REFILL_THRESHOLD,
  WAYBILL_RESERVE_COUNT,
} from '../lib/config';

import { supabase } from '../lib/supabase';

import {
  applyLocalCommand,
  type CommandEnvelope,
  type CommandType,
  type UserContext,
} from './applyLocal';

import { getDb } from './db';
import { getDeviceId } from './device';
import {
  areMediaFilesUploaded,
  uploadPendingMedia,
} from './media';
import { getPendingOutboxItems } from './outbox';

// -----------------------------------------------------------------------------
// STATE
// -----------------------------------------------------------------------------

let currentBackoffMs = BACKOFF_INITIAL_MS;

let isOnline = false;
let syncRequestedWhileRunning = false;

let activeSyncPromise: Promise<void> | null = null;
let activeSyncCleanup: (() => void) | null = null;

const FALLBACK_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const REALTIME_DEBOUNCE_MS = 750;
const PULL_BATCH_SIZE = 500;

const LOG_PREFIX = '[Sync]';

// -----------------------------------------------------------------------------
// LOGGING
// -----------------------------------------------------------------------------

function logInfo(
  message: string,
  details?: Record<string, unknown>
): void {
  console.info(LOG_PREFIX, message, details ?? '');
}

function logWarn(
  message: string,
  details?: Record<string, unknown>
): void {
  console.warn(LOG_PREFIX, message, details ?? '');
}

export function logError(
  message: string,
  error?: unknown,
  details?: Record<string, unknown>
): void {
  const errorMessage =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : error
          ? String(error)
          : 'Unknown error';

  console.error(LOG_PREFIX, message, {
    ...details,
    error: errorMessage,
  });
}

export function getIsOnline(): boolean {
  return isOnline;
}

// -----------------------------------------------------------------------------
// TABLES
// -----------------------------------------------------------------------------

const SYNC_TABLES = [
  'locations',
  'vehicles',
  'profiles',
  'settings',
  'trips',
  'shipments',
  'packages',
  'custody_events',
  'collections',
  'contact_attempts',
  'pickup_codes',
  'commands_log',
] as const;

type SyncTable = (typeof SYNC_TABLES)[number];

// -----------------------------------------------------------------------------
// MEDIA PATHS
// -----------------------------------------------------------------------------

function extractMediaPaths(
  type: CommandType,
  payload: Record<string, unknown>
): string[] {
  const paths: string[] = [];

  if (type === 'create_shipment' && Array.isArray(payload.packages)) {
    for (const pkg of payload.packages) {
      if (
        pkg &&
        typeof pkg === 'object' &&
        'photo_path' in pkg &&
        typeof pkg.photo_path === 'string'
      ) {
        paths.push(pkg.photo_path);
      }
    }
  }

  if (
    type === 'receive_item' &&
    typeof payload.arrival_photo_path === 'string'
  ) {
    paths.push(payload.arrival_photo_path);
  }

  if (type === 'collect_shipment') {
    if (typeof payload.photo_path === 'string') {
      paths.push(payload.photo_path);
    }

    if (typeof payload.signature_path === 'string') {
      paths.push(payload.signature_path);
    }
  }

  return paths;
}

// -----------------------------------------------------------------------------
// LOCAL LOCATION PINGS
// -----------------------------------------------------------------------------

export async function flushLocalPings(): Promise<void> {
  const db = await getDb();

  const pings = await db.getAllAsync<{
    id: number;
    trip_id: string;
    lat: number;
    lng: number;
    speed_mps: number | null;
    accuracy_m: number | null;
    recorded_at: string;
  }>(
    `SELECT *
     FROM pings_local
     ORDER BY id ASC
     LIMIT ?`,
    [PINGS_BATCH_SIZE]
  );

  if (!pings.length) {
    return;
  }

  // Do not mix pings from different trips in one command.
  const tripId = pings[0].trip_id;

  const tripPings = pings.filter(
    (ping) => ping.trip_id === tripId
  );

  const ids = tripPings.map((ping) => ping.id);

  logInfo('Flushing locally stored location pings', {
    tripId,
    count: tripPings.length,
  });

  try {
    const deviceId = await getDeviceId();
    const Crypto = await import('expo-crypto');

    const { data, error } = await supabase.rpc('apply_commands', {
      p_device_id: deviceId,
      p_commands: [
        {
          id: Crypto.randomUUID(),
          type: 'push_pings',
          trip_id: tripId,
          recorded_at: new Date().toISOString(),
          pings: tripPings.map((ping) => ({
            lat: ping.lat,
            lng: ping.lng,
            speed_mps: ping.speed_mps,
            accuracy_m: ping.accuracy_m,
            recorded_at: ping.recorded_at,
          })),
        },
      ],
    });

    if (error) {
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : null;

    // Do not delete local pings when the server rejected the command.
    if (result?.status !== 'applied') {
      logWarn('Server did not apply location pings', {
        tripId,
        reason: result?.reason ?? 'missing_response',
      });

      return;
    }

    const placeholders = ids.map(() => '?').join(',');

    await db.runAsync(
      `DELETE FROM pings_local
       WHERE id IN (${placeholders})`,
      ids
    );

    logInfo('Location pings uploaded and removed locally', {
      tripId,
      count: tripPings.length,
    });
  } catch (error) {
    logError(
      'Location ping upload failed; pings will be retried',
      error,
      { tripId }
    );
  }
}

// -----------------------------------------------------------------------------
// PUSH OUTBOX COMMANDS
// -----------------------------------------------------------------------------

export async function pushPendingCommands(): Promise<void> {
  const netState = await NetInfo.fetch();

  if (netState.isConnected !== true) {
    logInfo('Skipping command push: device offline');
    return;
  }

  const db = await getDb();

  try {
    // Upload media before sending commands that reference those files.
    await uploadPendingMedia();

    // Upload locally queued GPS pings.
    await flushLocalPings();

    const pending = await getPendingOutboxItems(PUSH_BATCH_SIZE);

    logInfo('Outbox inspection', {
      pendingCount: pending.length,
    });

    if (!pending.length) {
      currentBackoffMs = BACKOFF_INITIAL_MS;
      return;
    }

    const deviceId = await getDeviceId();

    const batchToSend: Array<{
      id: string;
      type: string;
      payloadObj: Record<string, unknown>;
    }> = [];

    for (const item of pending) {
      let payloadObj: Record<string, unknown>;

      try {
        const parsed: unknown = JSON.parse(item.payload);

        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed)
        ) {
          throw new Error('Outbox payload must be a JSON object');
        }

        payloadObj = parsed as Record<string, unknown>;
      } catch (error) {
        logError('Invalid outbox JSON', error, {
          commandId: item.id,
          commandType: item.type,
        });

        // Keep the invalid record for investigation.
        continue;
      }

      const mediaPaths = extractMediaPaths(
        item.type as CommandType,
        payloadObj
      );

      if (mediaPaths.length > 0) {
        const uploaded = await areMediaFilesUploaded(mediaPaths);

        if (!uploaded) {
          logWarn('Command waiting for media upload', {
            commandId: item.id,
            commandType: item.type,
          });

          // Preserve command ordering.
          break;
        }
      }

      batchToSend.push({
        id: item.id,
        type: item.type,
        payloadObj,
      });
    }

    if (!batchToSend.length) {
      logInfo('No commands ready for upload');
      return;
    }

    // The outbox ID and type must always take precedence.
    const formattedPayloads = batchToSend.map((item) => ({
      ...item.payloadObj,
      id: item.id,
      type: item.type,
    }));

    logInfo('Sending commands to Supabase', {
      count: formattedPayloads.length,
      commands: formattedPayloads.map((item) => ({
        id: item.id,
        type: item.type,
      })),
    });

    const { data, error } = await supabase.rpc('apply_commands', {
      p_device_id: deviceId,
      p_commands: formattedPayloads,
    });

    if (error) {
      throw error;
    }

    if (!Array.isArray(data)) {
      throw new Error('apply_commands returned an invalid response');
    }

    currentBackoffMs = BACKOFF_INITIAL_MS;

    const results = new Map<
      string,
      {
        id: string;
        status: string;
        reason?: string;
      }
    >(
      data.map((result: any) => [result.id, result])
    );

    logInfo('Supabase command response', {
      sent: batchToSend.length,
      returned: data.length,
      applied: data.filter((r: any) => r.status === 'applied').length,
      rejected: data.filter((r: any) => r.status === 'rejected').length,
    });

    for (const command of batchToSend) {
      const result = results.get(command.id);

      if (!result) {
        logWarn('Missing command response; keeping outbox record', {
          commandId: command.id,
        });

        continue;
      }

      if (result.status === 'applied') {
        await db.runAsync(
          'DELETE FROM outbox WHERE id = ?',
          [command.id]
        );

        logInfo('Command successfully synced', {
          commandId: command.id,
          commandType: command.type,
        });

      } else if (result.status === 'rejected') {
        await db.runAsync(
          `UPDATE outbox
           SET status = ?, reason = ?
           WHERE id = ?`,
          [
            'rejected',
            result.reason || 'invalid_state',
            command.id,
          ]
        );

        logWarn('Command rejected by server', {
          commandId: command.id,
          commandType: command.type,
          reason: result.reason,
        });

      } else {
        logWarn('Unknown command response status', {
          commandId: command.id,
          status: result.status,
        });
      }
    }
  } catch (error) {
    currentBackoffMs = Math.min(
      currentBackoffMs * 2,
      BACKOFF_MAX_MS
    );

    logError('Command push failed; outbox records retained', error, {
      nextBackoffMs: currentBackoffMs,
    });

    throw error;
  }
}

// -----------------------------------------------------------------------------
// LOCAL SQLITE UPSERT
// -----------------------------------------------------------------------------

async function upsertRow(
  db: import('expo-sqlite').SQLiteDatabase,
  table: SyncTable,
  row: Record<string, unknown>
): Promise<void> {
  const keys = Object.keys(row).filter(
    (key) => key !== 'search_vector'
  );

  if (!keys.length) {
    return;
  }

  const values = keys.map((key) => {
    const value = row[key];

    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }

    if (value !== null && typeof value === 'object') {
      return JSON.stringify(value);
    }

    return value;
  });

  const placeholders = keys.map(() => '?').join(',');

  const updates = keys
    .filter((key) => key !== getPrimaryKey(table))
    .map((key) => `${key} = excluded.${key}`)
    .join(',');

  const primaryKey = getPrimaryKey(table);

  const conflictAction = updates
    ? `DO UPDATE SET ${updates}`
    : 'DO NOTHING';

  await db.runAsync(
    `INSERT INTO ${table} (${keys.join(',')})
     VALUES (${placeholders})
     ON CONFLICT(${primaryKey}) ${conflictAction}`,
    values as import('expo-sqlite').SQLiteVariadicBindParams
  );
}

function getPrimaryKey(table: SyncTable): string {
  if (table === 'collections' || table === 'pickup_codes') {
    return 'shipment_id';
  }

  if (table === 'settings') {
    return 'key';
  }

  return 'id';
}

// -----------------------------------------------------------------------------
// PULL SERVER CHANGES
// -----------------------------------------------------------------------------

export async function pullChanges(user: UserContext): Promise<void> {
  const netState = await NetInfo.fetch();

  if (netState.isConnected !== true) {
    logInfo('Skipping server pull because device is offline');
    return;
  }

  logInfo('Starting server pull', {
    role: user.role,
    tableCount: SYNC_TABLES.length,
  });

  const db = await getDb();

  const ninetyDaysAgo = new Date(
    Date.now() - MANAGER_FIRST_PULL_DAYS * 86400000
  ).toISOString();

  for (const table of SYNC_TABLES) {
    const cursorRow = await db.getFirstAsync<{ sv: number }>(
      `SELECT sv
       FROM sync_cursor
       WHERE table_name = ?`,
      [table]
    );

    const currentCursor = cursorRow?.sv ?? 0;

    let startSv = Math.max(0, currentCursor - SYNC_OVERLAP);
    let maxSvSeen = currentCursor;
    let hasMore = true;

    logInfo('Pulling table changes', {
      table,
      cursor: currentCursor,
      startSv,
    });

    while (hasMore) {
      let query = supabase
        .from(table)
        .select('*')
        .gt('sv', startSv)
        .order('sv', { ascending: true })
        .limit(PULL_BATCH_SIZE);

      // Restrict a manager's initial historical pull.
      if (user.role === 'manager' && currentCursor === 0) {
        if (
          [
            'shipments',
            'packages',
            'collections',
            'contact_attempts',
          ].includes(table)
        ) {
          query = query.gte('updated_at', ninetyDaysAgo);
        } else if (table === 'custody_events') {
          query = query.gte('recorded_at', ninetyDaysAgo);
        }
      }

      const { data, error } = await query;

      if (error) {
        logError('Failed to pull table changes', error, {
          table,
          startSv,
          cursor: currentCursor,
        });

        // Do not advance the cursor if a pull fails.
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      logInfo('Received server rows', {
        table,
        count: data.length,
      });

      for (const row of data) {
        await upsertRow(
          db,
          table,
          row as Record<string, unknown>
        );

        if (
          typeof row.sv === 'number' &&
          row.sv > maxSvSeen
        ) {
          maxSvSeen = row.sv;
        }
      }

      if (data.length < PULL_BATCH_SIZE) {
        hasMore = false;
      } else {
        const lastRow = data[data.length - 1];

        if (
          typeof lastRow.sv !== 'number' ||
          lastRow.sv <= startSv
        ) {
          throw new Error(
            `Invalid sync cursor progression for ${table}`
          );
        }

        startSv = lastRow.sv;
      }
    }

    // Only advance after every page for this table has been saved locally.
    await db.runAsync(
      `INSERT INTO sync_cursor (table_name, sv)
       VALUES (?, ?)
       ON CONFLICT(table_name)
       DO UPDATE SET sv = excluded.sv`,
      [table, maxSvSeen]
    );

    logInfo('Finished table pull', {
      table,
      latestVersion: maxSvSeen,
    });
  }

  // Re-apply pending local changes over the server snapshot.
  await reapplyPendingOutbox(user);

  logInfo('Server pull cycle completed');
}

// -----------------------------------------------------------------------------
// REAPPLY LOCAL OUTBOX AFTER PULL
// -----------------------------------------------------------------------------

async function reapplyPendingOutbox(
  user: UserContext
): Promise<void> {
  const db = await getDb();

  const pending = await db.getAllAsync<{
    id: string;
    type: CommandType;
    payload: string;
    created_at: string;
  }>(
    `SELECT id, type, payload, created_at
     FROM outbox
     WHERE status = 'pending'
     ORDER BY created_at ASC`
  );

  logInfo('Re-applying pending local commands', {
    count: pending.length,
  });

  for (const item of pending) {
    try {
      const payload: unknown = JSON.parse(item.payload);

      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload)
      ) {
        throw new Error('Invalid local command payload');
      }

      const envelope: CommandEnvelope = {
        id: item.id,
        type: item.type,
        payload: payload as Record<string, unknown>,
        recorded_at: item.created_at,
      };

      await applyLocalCommand(envelope, user, {
        saveToOutbox: false,
      });

    } catch (error) {
      logError('Could not re-apply pending local command', error, {
        commandId: item.id,
        commandType: item.type,
      });
    }
  }
}

// -----------------------------------------------------------------------------
// WAYBILL RESERVATION
// -----------------------------------------------------------------------------

export async function checkRefillWaybills(): Promise<void> {
  const netState = await NetInfo.fetch();

  if (netState.isConnected !== true) {
    logInfo('Skipping waybill refill because device is offline');
    return;
  }

  const db = await getDb();

  const block = await db.getFirstAsync<{
    from_no: number;
    to_no: number;
    next_no: number;
  }>(
    `SELECT from_no, to_no, next_no
     FROM waybill_block
     WHERE id = 1`
  );

  const remaining = block
    ? Math.max(0, block.to_no - block.next_no + 1)
    : 0;

  logInfo('Checking local waybill reserve', {
    remaining,
    refillThreshold: WAYBILL_REFILL_THRESHOLD,
  });

  if (block && remaining >= WAYBILL_REFILL_THRESHOLD) {
    return;
  }

  try {
    logInfo('Requesting waybill reserve', {
      requestedCount: WAYBILL_RESERVE_COUNT,
    });

    const deviceId = await getDeviceId();

    const { data, error } = await supabase.rpc(
      'reserve_waybills',
      {
        p_device_id: deviceId,
        p_count: WAYBILL_RESERVE_COUNT,
      }
    );

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Waybill reservation returned no data');
    }

    const fromNo = Number(data.from_no);
    const toNo = Number(data.to_no);

    if (
      !Number.isFinite(fromNo) ||
      !Number.isFinite(toNo) ||
      fromNo <= 0 ||
      toNo < fromNo
    ) {
      throw new Error('Invalid waybill reservation response');
    }

    if (!block) {
      await db.runAsync(
        `INSERT INTO waybill_block
         (id, from_no, to_no, next_no)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           from_no = excluded.from_no,
           to_no = excluded.to_no,
           next_no = excluded.next_no`,
        [fromNo, toNo, fromNo]
      );
    } else {
      await db.runAsync(
        `UPDATE waybill_block
         SET to_no = ?
         WHERE id = 1`,
        [toNo]
      );
    }

    logInfo('Waybill reserve received', {
      fromNo,
      toNo,
    });

  } catch (error) {
    logError(
      'Waybill reserve request failed; existing reserve retained',
      error
    );
  }
}

// -----------------------------------------------------------------------------
// MAIN SYNC CYCLE
// -----------------------------------------------------------------------------

export async function runSyncCycle(
  user: UserContext
): Promise<void> {
  if (activeSyncPromise) {
    syncRequestedWhileRunning = true;

    logInfo('Sync trigger queued because another cycle is running');

    await activeSyncPromise;
    return;
  }

  const startedAt = Date.now();

  const syncPromise = (async () => {
    try {
      do {
        syncRequestedWhileRunning = false;

        const cycleStartedAt = Date.now();

        logInfo('Sync cycle started', {
          role: user.role,
          online: isOnline,
        });

        // 1. Push local commands.
        await pushPendingCommands();

        // 2. Pull server changes.
        await pullChanges(user);

        // 3. Refill waybills when appropriate.
        if (user.role === 'manager') {
          //await checkRefillWaybills();
        }

        logInfo('Sync cycle completed', {
          durationMs: Date.now() - cycleStartedAt,
        });

      } while (syncRequestedWhileRunning && isOnline);

    } catch (error) {
      logError('Sync cycle failed', error, {
        totalDurationMs: Date.now() - startedAt,
      });
    }
  })();

  activeSyncPromise = syncPromise;

  try {
    await syncPromise;
  } finally {
    if (activeSyncPromise === syncPromise) {
      activeSyncPromise = null;
    }
  }
}

// -----------------------------------------------------------------------------
// SYNC LISTENERS
// -----------------------------------------------------------------------------

export function setupSyncListeners(
  user: UserContext
): () => void {
  if (activeSyncCleanup) {
    logInfo('Sync listeners already active');
    return activeSyncCleanup;
  }

  let appState: AppStateStatus = AppState.currentState;

  let pollTimer:
    | ReturnType<typeof setInterval>
    | undefined;

  let realtimeDebounceTimer:
    | ReturnType<typeof setTimeout>
    | undefined;

  let disposed = false;

  const appIsActive = () => appState === 'active';

  const stopFallbackPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;

      logInfo('Stopped fallback polling');
    }
  };

  const startFallbackPolling = () => {
    if (pollTimer || !appIsActive()) {
      return;
    }

    logInfo('Starting fallback polling', {
      intervalMinutes: FALLBACK_SYNC_INTERVAL_MS / 60000,
    });

    pollTimer = setInterval(() => {
      if (isOnline && appIsActive()) {
        logInfo('Fallback sync interval reached');
        void runSyncCycle(user);
      }
    }, FALLBACK_SYNC_INTERVAL_MS);
  };

  const triggerRealtimeSync = (table: string) => {
    logInfo('Realtime change received', { table });

    if (realtimeDebounceTimer) {
      clearTimeout(realtimeDebounceTimer);
    }

    realtimeDebounceTimer = setTimeout(() => {
      realtimeDebounceTimer = undefined;

      if (isOnline && appIsActive() && !disposed) {
        logInfo('Running sync after realtime change');
        void runSyncCycle(user);
      }
    }, REALTIME_DEBOUNCE_MS);
  };

  // Network changes.
  const unsubNet = NetInfo.addEventListener((state) => {
    const wasOnline = isOnline;

    isOnline = state.isConnected === true;

    logInfo('Network state changed', {
      isConnected: isOnline,
      connectionType: state.type,
    });

    if (isOnline && !wasOnline && appIsActive() && !disposed) {
      logInfo('Network restored; starting sync');
      void runSyncCycle(user);
    }
  });

  // Foreground/background changes.
  const appStateSubscription = AppState.addEventListener(
    'change',
    (nextState) => {
      const previousState = appState;
      appState = nextState;

      logInfo('App state changed', {
        previousState,
        nextState,
      });

      if (appIsActive()) {
        startFallbackPolling();

        void NetInfo.fetch()
          .then((state) => {
            if (disposed) {
              return;
            }

            isOnline = state.isConnected === true;

            logInfo('Refreshed network state on foreground', {
              isConnected: isOnline,
              connectionType: state.type,
            });

            if (isOnline) {
              void runSyncCycle(user);
            }
          })
          .catch((error) => {
            logError(
              'Could not refresh network state',
              error
            );
          });

      } else {
        stopFallbackPolling();
      }
    }
  );

  startFallbackPolling();

  // Realtime subscriptions.
  
// Realtime provides fast updates; cursor-based pulls remain the recovery
  // mechanism for changes missed while disconnected or suspended.
  const channel = supabase
    .channel('db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trips' }, () => {
      triggerRealtimeSync('trips');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shipments' }, () => {
      triggerRealtimeSync('shipments');
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'packages' }, () => {
      triggerRealtimeSync('packages');
    })
    .subscribe((status, error) => {
      logInfo('Realtime subscription status', {
        status,
        ...(error ? { error: error.message } : {}),
      });

      if (status === 'SUBSCRIBED' && isOnline && appIsActive()) {
        logInfo('Realtime connected; performing catch-up sync');
        void runSyncCycle(user);
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        logWarn('Realtime connection is unhealthy; fallback polling remains enabled', {
          status,
          ...(error ? { error: error.message } : {}),
        });
      }
    });

  // Initial network state.
  void NetInfo.fetch()
    .then((state) => {
      if (disposed) {
        return;
      }

      isOnline = state.isConnected === true;

      logInfo('Initial network state', {
        isConnected: isOnline,
        connectionType: state.type,
      });

      if (isOnline && appIsActive()) {
        void runSyncCycle(user);
      }
    })
    .catch((error) => {
      logError('Could not read initial network state', error);
    });

  // Cleanup.
  const cleanup = () => {
    if (disposed) {
      return;
    }

    disposed = true;

    logInfo('Removing sync listeners');

    unsubNet();
    appStateSubscription.remove();

    stopFallbackPolling();

    if (realtimeDebounceTimer) {
      clearTimeout(realtimeDebounceTimer);
      realtimeDebounceTimer = undefined;
    }

    if (activeSyncCleanup === cleanup) {
      activeSyncCleanup = null;
    }

    void supabase.removeChannel(channel);
  };

  activeSyncCleanup = cleanup;

  return cleanup;
}

// -----------------------------------------------------------------------------
// STOP SYNC LISTENERS
// -----------------------------------------------------------------------------

export async function stopSyncListeners(): Promise<void> {
  logInfo('Stopping sync listeners');

  // Do not schedule another cycle after the current one.
  syncRequestedWhileRunning = false;
  isOnline = false;

  // Remove network, app-state and realtime listeners.
  if (activeSyncCleanup) {
    activeSyncCleanup();
  }

  // Wait for an existing cycle to finish before signing out.
  if (activeSyncPromise) {
    logInfo('Waiting for active sync cycle to finish');

    try {
      await activeSyncPromise;
    } catch (error) {
      logError('Error while waiting for sync shutdown', error);
    }
  }

  logInfo('Sync listeners stopped');
}
