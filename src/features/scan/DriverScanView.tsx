import { MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { CameraView } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { Chip, ProgressBar, Text, useTheme } from 'react-native-paper';

import { getDeviceId } from '../../data/device';
import { getScanGps } from '../../data/location';
import { copy } from '../../lib/copy';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { statusColors } from '../../theme';
import { radius, size, space, type } from '../../tokens';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';

interface ActiveTrip {
  id: string;
  origin_id: string;
  destination_id: string;
  status: string;
  driver_id: string | null;
}

interface UnscannedPackage {
  id: string;
  label_code: string;
  description: string | null;
  seq: number;
  shipment_id: string;
  waybill_no: string;
}

interface ScannedInfo {
  id: string;
  label_code: string;
  shipment_id: string;
  waybill_no: string;
  seq: number;
  status: string;
  current_trip_id: string | null;
  origin_id: string;
  destination_id: string;
}

interface ScanResult {
  success: boolean;
  text: string;
}

interface PackageProgress {
  loaded: number;
  expected: number;
}

interface CommandResult {
  id: string;
  status: 'applied' | 'rejected';
  reason?: string;
}

const SCAN_COOLDOWN_MS = 1500;

const log = (...args: unknown[]) => {
  console.log('[load-panel]', ...args);
};

const logError = (label: string, error: unknown) => {
  console.error('[load-panel]', label, error);
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'An unexpected error occurred.';
}

function getReasonMessage(reason: string): string {
  const reasons = copy.reasons as Record<string, string>;

  return reasons[reason] || reasons.invalid_state || 'Package scan rejected.';
}

// -----------------------------------------------------------------------------
// FETCH OPEN LOADING TRIPS
// Managers see every loading trip. Drivers see only trips assigned to them.
// -----------------------------------------------------------------------------

async function fetchLoadingTrips(user: {
  id: string;
  role: string;
}): Promise<ActiveTrip[]> {
  let query = supabase
    .from('trips')
    .select('id, origin_id, destination_id, status, driver_id')
    .eq('status', 'loading');

  if (user.role === 'driver') {
    query = query.eq('driver_id', user.id);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data ?? []) as ActiveTrip[];
}

async function fetchLocationNames(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('locations').select('id, name');

  if (error) {
    throw error;
  }

  return Object.fromEntries((data ?? []).map((l) => [l.id, l.name]));
}

// -----------------------------------------------------------------------------
// FETCH PACKAGES FOR THE TRIP'S ROUTE
// -----------------------------------------------------------------------------

async function fetchRoutePackages(
  trip: ActiveTrip
): Promise<{
  packages: UnscannedPackage[];
  progress: PackageProgress;
}> {
  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, waybill_no')
    .eq('origin_id', trip.origin_id)
    .eq('destination_id', trip.destination_id);

  if (shipmentError) {
    throw shipmentError;
  }

  const shipmentIds = (shipments ?? []).map((shipment) => shipment.id);

  if (shipmentIds.length === 0) {
    return {
      packages: [],
      progress: { loaded: 0, expected: 0 },
    };
  }

  const waybillByShipment = new Map<string, string>(
    (shipments ?? []).map((shipment) => [shipment.id, shipment.waybill_no])
  );

  const { data: rows, error: packageError } = await supabase
    .from('packages')
    .select(
      'id, label_code, description, seq, shipment_id, status, current_trip_id'
    )
    .in('shipment_id', shipmentIds);

  if (packageError) {
    throw packageError;
  }

  const allPackages = rows ?? [];

  const loaded = allPackages.filter(
    (pkg) => pkg.status === 'loaded' && pkg.current_trip_id === trip.id
  ).length;

  const packages: UnscannedPackage[] = allPackages
    .filter((pkg) => pkg.status === 'registered')
    .map((pkg) => ({
      id: pkg.id,
      label_code: pkg.label_code,
      description: pkg.description,
      seq: pkg.seq,
      shipment_id: pkg.shipment_id,
      waybill_no: waybillByShipment.get(pkg.shipment_id) ?? '',
    }))
    .sort((a, b) => {
      const waybillComparison = a.waybill_no.localeCompare(b.waybill_no);

      return waybillComparison !== 0 ? waybillComparison : a.seq - b.seq;
    });

  return {
    packages,
    progress: {
      loaded,
      expected: allPackages.length,
    },
  };
}

// -----------------------------------------------------------------------------
// LOOK UP A SCANNED PACKAGE
// -----------------------------------------------------------------------------

async function lookupPackage(labelCode: string): Promise<ScannedInfo | null> {
  const { data: pkg, error: packageError } = await supabase
    .from('packages')
    .select('id, label_code, shipment_id, seq, status, current_trip_id')
    .eq('label_code', labelCode)
    .maybeSingle();

  if (packageError) {
    throw packageError;
  }

  if (!pkg) {
    return null;
  }

  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select('waybill_no, origin_id, destination_id')
    .eq('id', pkg.shipment_id)
    .maybeSingle();

  if (shipmentError) {
    throw shipmentError;
  }

  if (!shipment) {
    return null;
  }

  return {
    id: pkg.id,
    label_code: pkg.label_code,
    shipment_id: pkg.shipment_id,
    waybill_no: shipment.waybill_no,
    seq: pkg.seq,
    status: pkg.status,
    current_trip_id: pkg.current_trip_id,
    origin_id: shipment.origin_id,
    destination_id: shipment.destination_id,
  };
}

// -----------------------------------------------------------------------------
// SEND A COMMAND TO SUPABASE
// -----------------------------------------------------------------------------

async function sendCommand(
  command: Record<string, unknown>
): Promise<CommandResult> {
  const network = await NetInfo.fetch();

  if (network.isConnected !== true) {
    throw new Error('offline');
  }

  const deviceId = await getDeviceId();
  const commandId = Crypto.randomUUID();

  const { data, error } = await supabase.rpc('apply_commands', {
    p_device_id: deviceId,
    p_commands: [
      {
        ...command,
        id: commandId,
        recorded_at: new Date().toISOString(),
      },
    ],
  });

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('missing_response');
  }

  const result = data.find((item: CommandResult) => item.id === commandId) as
    | CommandResult
    | undefined;

  if (!result) {
    throw new Error('missing_response');
  }

  if (result.status !== 'applied' && result.status !== 'rejected') {
    throw new Error('invalid_response');
  }

  return result;
}

async function submitLoadScan(
  tripId: string,
  labelCode: string
): Promise<CommandResult> {
  let gps: Awaited<ReturnType<typeof getScanGps>> = null;

  try {
    gps = await getScanGps();
  } catch (error) {
    logError('GPS unavailable; continuing without coordinates', error);
  }

  return sendCommand({
    type: 'load_scan',
    trip_id: tripId,
    label_code: labelCode,
    lat: gps?.lat ?? null,
    lng: gps?.lng ?? null,
  });
}

async function dispatchTrip(tripId: string): Promise<CommandResult> {
  return sendCommand({ type: 'start_trip', trip_id: tripId });
}

// -----------------------------------------------------------------------------
// LOAD PANEL
// The parent screen (ScanHubView) provides the Screen wrapper, app bar and
// camera permission, so this component returns fragments only.
// -----------------------------------------------------------------------------

export function LoadPanel({ initialTripId }: { initialTripId?: string }) {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);

  const [trips, setTrips] = useState<ActiveTrip[]>([]);
  const [trip, setTrip] = useState<ActiveTrip | null>(null);
  const [locationNames, setLocationNames] = useState<Record<string, string>>(
    {}
  );
  const [loadedCount, setLoadedCount] = useState(0);
  const [expectedCount, setExpectedCount] = useState(0);
  const [unscanned, setUnscanned] = useState<UnscannedPackage[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoadingTrip, setIsLoadingTrip] = useState(true);
  const [isDispatching, setIsDispatching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scanLock = useRef(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tripRef = useRef<ActiveTrip | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD OPEN TRIPS AND PACKAGE DATA
  // ---------------------------------------------------------------------------

  const loadTripData = useCallback(
    async (preferredId?: string) => {
      if (!user) {
        setTrips([]);
        setTrip(null);
        tripRef.current = null;
        setLoadedCount(0);
        setExpectedCount(0);
        setUnscanned([]);
        setIsLoadingTrip(false);
        return;
      }

      setIsLoadingTrip(true);
      setLoadError(null);

      try {
        const [open, names] = await Promise.all([
          fetchLoadingTrips(user),
          fetchLocationNames().catch(() => ({}) as Record<string, string>),
        ]);

        setTrips(open);
        setLocationNames(names);

        const wanted = preferredId ?? tripRef.current?.id;
        const active = open.find((t) => t.id === wanted) ?? open[0] ?? null;

        if (!active) {
          setTrip(null);
          tripRef.current = null;
          setLoadedCount(0);
          setExpectedCount(0);
          setUnscanned([]);
          return;
        }

        const result = await fetchRoutePackages(active);

        setTrip(active);
        tripRef.current = active;
        setLoadedCount(result.progress.loaded);
        setExpectedCount(result.progress.expected);
        setUnscanned(result.packages);

        log('Trip data loaded', {
          tripId: active.id,
          loaded: result.progress.loaded,
          expected: result.progress.expected,
          unscanned: result.packages.length,
        });
      } catch (error) {
        logError('Could not load trip data', error);
        setLoadError(getErrorMessage(error));
      } finally {
        setIsLoadingTrip(false);
      }
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      void loadTripData(initialTripId);
    }, [loadTripData, initialTripId])
  );

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) {
        clearTimeout(cooldownTimer.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // SCAN LOCK
  // ---------------------------------------------------------------------------

  function releaseLockAfterCooldown() {
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current);
    }

    cooldownTimer.current = setTimeout(() => {
      scanLock.current = false;
      cooldownTimer.current = null;
    }, SCAN_COOLDOWN_MS);
  }

  // ---------------------------------------------------------------------------
  // HANDLE QR SCAN
  // ---------------------------------------------------------------------------

  async function handleBarcodeScanned(raw: string) {
    if (scanLock.current || !trip || !user || isDispatching) {
      return;
    }

    scanLock.current = true;
    setScanResult(null);
    setNotice(null);

    const labelCode = raw.trim();

    try {
      if (!labelCode) {
        throw new Error('unknown_label');
      }

      const info = await lookupPackage(labelCode);

      if (!info) {
        throw new Error('unknown_label');
      }

      // Quick client-side feedback. The server remains the final authority.
      if (info.status === 'loaded') {
        throw new Error('already_scanned');
      }

      if (info.status !== 'registered') {
        throw new Error('invalid_state');
      }

      if (
        info.origin_id !== trip.origin_id ||
        info.destination_id !== trip.destination_id
      ) {
        throw new Error('wrong_destination');
      }

      if (info.current_trip_id && info.current_trip_id !== trip.id) {
        throw new Error('wrong_trip');
      }

      const result = await submitLoadScan(trip.id, labelCode);

      if (result.status === 'rejected') {
        throw new Error(result.reason || 'invalid_state');
      }

      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
      } catch {
        // A haptic failure must not turn a successful scan into a failure.
      }

      setScanResult({
        success: true,
        text: `${info.waybill_no} · Package ${info.seq} loaded`,
      });

      await loadTripData();
    } catch (error) {
      logError('Scan failed', error);

      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error
        );
      } catch {
        // Ignore haptic errors.
      }

      const code = getErrorMessage(error);

      if (code === 'offline') {
        setScanResult({
          success: false,
          text: 'Internet connection required. This scan was not submitted.',
        });
      } else if (code === 'unknown_label') {
        setScanResult({
          success: false,
          text: 'Package label was not found.',
        });
      } else if (code === 'missing_response') {
        setScanResult({
          success: false,
          text: 'No confirmation was received from the server. Check the package status before scanning again.',
        });
      } else if (code === 'invalid_response') {
        setScanResult({
          success: false,
          text: 'The server returned an unexpected response.',
        });
      } else if (code === 'already_scanned') {
        setScanResult({
          success: false,
          text: 'This package has already been loaded.',
        });
      } else {
        setScanResult({
          success: false,
          text: getReasonMessage(code),
        });
      }

      try {
        await loadTripData();
      } catch (refreshError) {
        logError('Trip refresh after scan failure failed', refreshError);
      }
    } finally {
      releaseLockAfterCooldown();
    }
  }

  // ---------------------------------------------------------------------------
  // DISPATCH THE TRIP (loading finished, vehicle leaves)
  // ---------------------------------------------------------------------------

  function confirmDispatch() {
    if (!trip || isDispatching) {
      return;
    }

    const count = loadedCount;

    Alert.alert(
      'Dispatch trip?',
      `${count} package(s) loaded. After dispatch, nothing more can be added.` +
        (unscanned.length > 0
          ? ' Shipments with packages still unscanned will be flagged as issues.'
          : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dispatch',
          onPress: async () => {
            setIsDispatching(true);
            setScanResult(null);

            try {
              const result = await dispatchTrip(trip.id);

              if (result.status === 'rejected') {
                throw new Error(result.reason || 'invalid_state');
              }

              setNotice(`Trip dispatched with ${count} package(s).`);
              await loadTripData();
            } catch (error) {
              logError('Dispatch failed', error);

              const code = getErrorMessage(error);

              setScanResult({
                success: false,
                text:
                  code === 'offline'
                    ? 'Internet connection required.'
                    : getReasonMessage(code),
              });
            } finally {
              setIsDispatching(false);
            }
          },
        },
      ]
    );
  }

  // ---------------------------------------------------------------------------
  // LOADING STATES
  // ---------------------------------------------------------------------------

  if (isLoadingTrip && !trip) {
    return (
      <EmptyState
        icon="truck"
        title="Loading trip"
        message="Getting trip and package information from the server."
      />
    );
  }

  if (loadError && !trip) {
    return (
      <>
        <EmptyState
          icon="alert-circle"
          title="Could not load trip"
          message={loadError}
        />
        <PrimaryButton onPress={() => void loadTripData()}>
          Try Again
        </PrimaryButton>
      </>
    );
  }

  if (!trip) {
    return (
      <>
        <EmptyState
          icon="qrcode-scan"
          title="No open loading trip"
          message={
            notice ??
            'Open a shipment that is Received and tap Start loading to begin.'
          }
        />
        <PrimaryButton onPress={() => void loadTripData()}>
          Refresh
        </PrimaryButton>
      </>
    );
  }

  const progress = expectedCount > 0 ? loadedCount / expectedCount : 0;

  const resultColor = scanResult?.success
    ? statusColors.delivered
    : colors.error;

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <>
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
          Loading vehicle to:{' '}
          {locationNames[trip.destination_id] ?? 'destination'}
        </Text>

        {trips.length > 1 && (
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: space.xs,
            }}
          >
            {trips.map((t) => (
              <Chip
                key={t.id}
                selected={t.id === trip.id}
                onPress={() => void loadTripData(t.id)}
              >
                {locationNames[t.origin_id] ?? '?'} →{' '}
                {locationNames[t.destination_id] ?? '?'}
              </Chip>
            ))}
          </View>
        )}
      </View>

      <View
        style={{
          height: size.scanner,
          borderRadius: radius.md,
          overflow: 'hidden',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.outline,
        }}
      >
        <CameraView
          style={{ width: '100%', height: '100%' }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => {
            void handleBarcodeScanned(result.data);
          }}
        />
      </View>

      {scanResult && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.xs,
            padding: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: resultColor,
          }}
        >
          <MaterialCommunityIcons
            name={scanResult.success ? 'check-circle' : 'alert-circle'}
            size={size.icon}
            color={resultColor}
          />

          <Text style={[type.label, { color: resultColor, flex: 1 }]}>
            {scanResult.text}
          </Text>
        </View>
      )}

      <View style={{ gap: space.xs }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={[type.label, { color: colors.onSurface }]}>
            {copy.driver.loadedOfExpected(loadedCount, expectedCount)}
          </Text>

          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
            {Math.round(progress * 100)}%
          </Text>
        </View>

        <ProgressBar progress={progress} color={colors.primary} />
      </View>

      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.driver.notScannedYet} ({unscanned.length})
        </Text>

        {unscanned.length === 0 ? (
          <EmptyState
            icon="check-all"
            title="All packages loaded"
            message="All registered packages for this route have been scanned."
          />
        ) : (
          unscanned.map((pkg) => (
            <View
              key={pkg.id}
              style={{
                padding: space.md,
                backgroundColor: colors.surface,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.outline,
                gap: space.xs,
              }}
            >
              <Text style={[type.heading, { color: colors.onSurface }]}>
                {pkg.waybill_no} · Package {pkg.seq}
              </Text>

              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                {pkg.description || 'No package description'}
              </Text>
            </View>
          ))
        )}
      </View>

      {loadError && (
        <Text style={[type.caption, { color: colors.error }]}>
          Refresh warning: {loadError}
        </Text>
      )}

      <PrimaryButton
        onPress={confirmDispatch}
        loading={isDispatching}
        disabled={isDispatching || loadedCount === 0}
      >
        Dispatch trip
      </PrimaryButton>

      <PrimaryButton onPress={() => void loadTripData()}>
        Refresh Trip
      </PrimaryButton>
    </>
  );
}