
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../lib/supabase';
import { getDb } from './db';

// Decode Base64 into bytes for Supabase Storage.
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return bytes;
}

// Safely add new columns to existing databases.
// Existing media records are preserved.
async function ensureMediaQueueColumns(): Promise<void> {
  const db = await getDb();

  const columns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(media_queue)'
  );

  const existing = new Set(columns.map(column => column.name));

  if (!existing.has('next_retry_at')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN next_retry_at TEXT'
    );
  }

  if (!existing.has('last_error')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN last_error TEXT'
    );
  }

  if (!existing.has('retryable')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN retryable INTEGER NOT NULL DEFAULT 1'
    );
  }
}

// Retry delays based on the number of failed attempts.
function getRetryDelay(attempts: number): number {
  const delays = [
    30 * 1000,          // 30 seconds
    2 * 60 * 1000,      // 2 minutes
    10 * 60 * 1000,     // 10 minutes
    60 * 60 * 1000,     // 1 hour
    6 * 60 * 60 * 1000, // 6 hours
  ];

  return delays[Math.min(attempts - 1, delays.length - 1)];
}

// Save an image locally and add it to the upload queue.
export async function saveAndQueueMedia(
  uri: string,
  userId: string,
  extension: 'jpg' | 'png' = 'jpg'
): Promise<string> {
  await ensureMediaQueueColumns();

  const db = await getDb();

  const mediaId = Crypto.randomUUID();
  const storagePath = `${userId}/${mediaId}.${extension}`;

  let finalUri = uri;

  try {
    const ctx = ImageManipulator.manipulate(uri);

    ctx.resize({ width: 1280 });

    const rendered = await ctx.renderAsync();

    const format =
      extension === 'png' ? SaveFormat.PNG : SaveFormat.JPEG;

    const saved = await rendered.saveAsync({
      compress: 0.7,
      format,
    });

    finalUri = saved.uri;
  } catch (error) {
    console.warn(
      '[Media] Image compression failed; using original:',
      error
    );

    finalUri = uri;
  }

  // Copy into permanent app storage.
  const documentDirectory = FileSystem.documentDirectory;

  if (documentDirectory) {
    const permanentUri =
      `${documentDirectory}media_${mediaId}.${extension}`;

    try {
      await FileSystem.copyAsync({
        from: finalUri,
        to: permanentUri,
      });

      finalUri = permanentUri;
    } catch (error) {
      console.warn(
        '[Media] Could not copy image to permanent storage:',
        error
      );
    }
  }

  // Confirm the image exists before queueing it.
  const fileInfo = await FileSystem.getInfoAsync(finalUri);

  if (!fileInfo.exists) {
    throw new Error('Image could not be saved locally.');
  }

  await db.runAsync(
    `INSERT INTO media_queue (
      id,
      local_uri,
      storage_path,
      status,
      attempts,
      next_retry_at,
      last_error,
      retryable
    )
    VALUES (?, ?, ?, 'pending', 0, NULL, NULL, 1)`,
    [mediaId, finalUri, storagePath]
  );

  console.log('[Media] Image saved and queued:', storagePath);

  return storagePath;
}

// Check whether every required media file has uploaded.
export async function areMediaFilesUploaded(
  storagePaths: string[]
): Promise<boolean> {
  if (!storagePaths.length) return true;

  await ensureMediaQueueColumns();

  const db = await getDb();

  const placeholders = storagePaths.map(() => '?').join(',');

  const result = await db.getAllAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM media_queue
     WHERE storage_path IN (${placeholders})
       AND status <> 'uploaded'`,
    storagePaths
  );

  return (result[0]?.count ?? 0) === 0;
}

// Upload pending files and failed files whose retry time has arrived.
export async function uploadPendingMedia(): Promise<void> {
  await ensureMediaQueueColumns();

  const db = await getDb();

  const now = new Date().toISOString();

  const rows = await db.getAllAsync<{
    id: string;
    local_uri: string;
    storage_path: string;
    attempts: number;
  }>(
    `SELECT
       id,
       local_uri,
       storage_path,
       attempts
     FROM media_queue
     WHERE status IN ('pending', 'failed')
       AND retryable = 1
       AND (
         next_retry_at IS NULL
         OR next_retry_at <= ?
       )
     ORDER BY attempts ASC`,
    [now]
  );

  console.log('[Media] Eligible uploads:', rows.length);

  for (const row of rows) {
    try {
      console.log('[Media] Starting upload:', {
        id: row.id,
        storagePath: row.storage_path,
        attempts: row.attempts,
      });

      // Check that the local file still exists.
      const fileInfo = await FileSystem.getInfoAsync(row.local_uri);

      if (!fileInfo.exists) {
        const message =
          'Local image file is missing. Manual attention required.';

        await db.runAsync(
          `UPDATE media_queue
           SET status = 'failed',
               retryable = 0,
               next_retry_at = NULL,
               last_error = ?
           WHERE id = ?`,
          [message, row.id]
        );

        console.error('[Media] Missing local image:', {
          id: row.id,
          localUri: row.local_uri,
        });

        continue;
      }

      // Read the image.
      const base64 = await FileSystem.readAsStringAsync(
        row.local_uri,
        {
          encoding: FileSystem.EncodingType.Base64,
        }
      );

      if (!base64) {
        throw new Error('Local image returned empty content.');
      }

      const bytes = base64ToUint8Array(base64);

      const contentType = row.storage_path.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';

      // Upload to Supabase Storage.
      const { error } = await supabase.storage
        .from('media')
        .upload(row.storage_path, bytes.buffer, {
          contentType,
          upsert: true,
        });

      if (error) {
        throw error;
      }

      // Mark uploaded only after Supabase confirms success.
      await db.runAsync(
        `UPDATE media_queue
         SET status = 'uploaded',
             next_retry_at = NULL,
             last_error = NULL,
             retryable = 1
         WHERE id = ?`,
        [row.id]
      );

      console.log('[Media] Upload successful:', row.storage_path);

    } catch (error) {
      const nextAttempts = row.attempts + 1;

      const delay = getRetryDelay(nextAttempts);

      const nextRetryAt = new Date(
        Date.now() + delay
      ).toISOString();

      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      // Keep it failed but allow another attempt after the delay.
      await db.runAsync(
        `UPDATE media_queue
         SET status = 'failed',
             attempts = ?,
             next_retry_at = ?,
             last_error = ?,
             retryable = 1
         WHERE id = ?`,
        [
          nextAttempts,
          nextRetryAt,
          errorMessage,
          row.id,
        ]
      );

      console.error('[Media] Upload failed:', {
        id: row.id,
        storagePath: row.storage_path,
        attempts: nextAttempts,
        nextRetryAt,
        error: errorMessage,
      });
    }
  }
}

// Manually retry a failed upload.
export async function retryMediaUpload(
  mediaId: string
): Promise<void> {
  await ensureMediaQueueColumns();

  const db = await getDb();

  await db.runAsync(
    `UPDATE media_queue
     SET status = 'pending',
         attempts = 0,
         next_retry_at = NULL,
         last_error = NULL,
         retryable = 1
     WHERE id = ?
       AND status <> 'uploaded'`,
    [mediaId]
  );

  console.log('[Media] Manual retry requested:', mediaId);
}

// Get failed media that need attention.
export async function getFailedMedia() {
  await ensureMediaQueueColumns();

  const db = await getDb();

  return db.getAllAsync<{
    id: string;
    local_uri: string;
    storage_path: string;
    attempts: number;
    last_error: string | null;
    retryable: number;
    next_retry_at: string | null;
  }>(
    `SELECT
       id,
       local_uri,
       storage_path,
       attempts,
       last_error,
       retryable,
       next_retry_at
     FROM media_queue
     WHERE status = 'failed'
     ORDER BY attempts DESC`
  );
}

// Resolve local image URI or retrieve a signed Supabase URL.
export async function resolveImageUri(
  storagePath: string | null | undefined
): Promise<string | null> {
  if (!storagePath) return null;

  await ensureMediaQueueColumns();

  const db = await getDb();

  const localRow = await db.getFirstAsync<{
    local_uri: string;
  }>(
    `SELECT local_uri
     FROM media_queue
     WHERE storage_path = ?`,
    [storagePath]
  );

  if (localRow?.local_uri) {
    const info = await FileSystem.getInfoAsync(
      localRow.local_uri
    ).catch(() => ({ exists: false }));

    if (info.exists) {
      return localRow.local_uri;
    }
  }

  try {
    const { data, error } = await supabase.storage
      .from('media')
      .createSignedUrl(storagePath, 3600);

    if (error) {
      console.error('[Media] Could not create signed URL:', error);
      return null;
    }

    return data?.signedUrl || null;
  } catch (error) {
    console.error('[Media] Image resolution failed:', error);
    return null;
  }
}
