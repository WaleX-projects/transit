
import { MaterialCommunityIcons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ProgressBar, Text, useTheme } from 'react-native-paper';

import { getDeviceId } from '../../data/device';
import { getScanGps } from '../../data/location';
import { copy } from '../../lib/copy';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store/authStore';
import { statusColors } from '../../theme';
import { radius, size, space, type } from '../../tokens';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

interface ActiveTrip {
  id: string;
  origin_id: string;
  destination_id: string;
  status: string;
  driver_id: string;
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
  console.log('[driver-scan]', ...args);
};

const logError = (label: string, error: unknown) => {
  console.error('[driver-scan]', label, error);
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
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
// FETCH DRIVER'S ACTIVE LOADING TRIP FROM SUPABASE
// -----------------------------------------------------------------------------

async function fetchActiveLoadingTrip(
  driverId: string
): Promise<ActiveTrip | null> {
  const { data, error } = await supabase
    .from('trips')
    .select('id, origin_id, destination_id, status, driver_id')
    .eq('driver_id', driverId)
    .eq('status', 'loading')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as ActiveTrip | null;
}

// -----------------------------------------------------------------------------
// FETCH PACKAGES FOR THE ACTIVE TRIP'S ROUTE
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
    (shipments ?? []).map((shipment) => [
      shipment.id,
      shipment.waybill_no,
    ])
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
    (pkg) =>
      pkg.status === 'loaded' &&
      pkg.current_trip_id === trip.id
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

      return waybillComparison !== 0
        ? waybillComparison
        : a.seq - b.seq;
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
// LOOK UP SCANNED PACKAGE DIRECTLY FROM SUPABASE
// -----------------------------------------------------------------------------

async function lookupPackage(
  labelCode: string
): Promise<ScannedInfo | null> {
  const { data: pkg, error: packageError } = await supabase
    .from('packages')
    .select(
      'id, label_code, shipment_id, seq, status, current_trip_id'
    )
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
// SUBMIT LOAD SCAN DIRECTLY TO SUPABASE
// -----------------------------------------------------------------------------

async function submitLoadScan(
  tripId: string,
  labelCode: string
): Promise<CommandResult> {
  const network = await NetInfo.fetch();

  if (network.isConnected !== true) {
    throw new Error('offline');
  }

  const deviceId = await getDeviceId();

  let gps: Awaited<ReturnType<typeof getScanGps>> = null;

  try {
    gps = await getScanGps();
  } catch (error) {
    logError('GPS unavailable; continuing without coordinates', error);
  }

  const commandId = Crypto.randomUUID();

  const { data, error } = await supabase.rpc('apply_commands', {
    p_device_id: deviceId,
    p_commands: [
      {
        id: commandId,
        type: 'load_scan',
        trip_id: tripId,
        label_code: labelCode,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
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

  const result = data.find(
    (item: CommandResult) => item.id === commandId
  ) as CommandResult | undefined;

  if (!result) {
    throw new Error('missing_response');
  }

  if (result.status !== 'applied' && result.status !== 'rejected') {
    throw new Error('invalid_response');
  }

  return result;
}

// -----------------------------------------------------------------------------
// DRIVER SCAN SCREEN
// -----------------------------------------------------------------------------

export function DriverScanView() {
  const { colors } = useTheme();
  const user = useAuthStore((state) => state.user);
  const [permission, requestPermission] = useCameraPermissions();

  const [trip, setTrip] = useState<ActiveTrip | null>(null);
  const [loadedCount, setLoadedCount] = useState(0);
  const [expectedCount, setExpectedCount] = useState(0);
  const [unscanned, setUnscanned] = useState<UnscannedPackage[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isLoadingTrip, setIsLoadingTrip] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const scanLock = useRef(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tripId = trip?.id ?? null;

  // ---------------------------------------------------------------------------
  // LOAD CURRENT TRIP AND PACKAGE DATA
  // ---------------------------------------------------------------------------

  const loadTripData = useCallback(async () => {
    if (!user) {
      setTrip(null);
      setLoadedCount(0);
      setExpectedCount(0);
      setUnscanned([]);
      setIsLoadingTrip(false);
      return;
    }

    setIsLoadingTrip(true);
    setLoadError(null);

    try {
      log('Fetching active loading trip from Supabase', user.id);

      const activeTrip = await fetchActiveLoadingTrip(user.id);

      if (!activeTrip) {
        setTrip(null);
        setLoadedCount(0);
        setExpectedCount(0);
        setUnscanned([]);
        return;
      }

      const result = await fetchRoutePackages(activeTrip);

      setTrip(activeTrip);
      setLoadedCount(result.progress.loaded);
      setExpectedCount(result.progress.expected);
      setUnscanned(result.packages);

      log('Trip data loaded from Supabase', {
        tripId: activeTrip.id,
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
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void loadTripData();
    }, [loadTripData])
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
    if (scanLock.current || !trip || !user) {
      return;
    }

    scanLock.current = true;
    setScanResult(null);

    const labelCode = raw.trim();

    try {
      if (!labelCode) {
        throw new Error('unknown_label');
      }

      log('Looking up package directly in Supabase', labelCode);

      const info = await lookupPackage(labelCode);

      if (!info) {
        throw new Error('unknown_label');
      }

      // Client-side checks provide quick feedback.
      // The RPC remains the final authority.
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

      if (
        info.current_trip_id &&
        info.current_trip_id !== trip.id
      ) {
        throw new Error('wrong_trip');
      }

      log('Submitting load_scan directly to Supabase', {
        tripId: trip.id,
        labelCode,
      });

      const result = await submitLoadScan(trip.id, labelCode);

      if (result.status === 'rejected') {
        log('Supabase rejected scan', result.reason);

        throw new Error(result.reason || 'invalid_state');
      }

      log('Supabase applied load_scan', result.id);

      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success
        );
      } catch {
        // Haptic failure must not turn a successful scan into a failure.
      }

      setScanResult({
        success: true,
        text: `${info.waybill_no} · Package ${info.seq} loaded`,
      });

      // Read the updated server state after a successful scan.
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
          text: 'Package label was not found in Supabase.',
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

      // Refresh server data even after a rejected scan.
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
  // LOADING STATES
  // ---------------------------------------------------------------------------

  if (isLoadingTrip && !trip) {
    return (
      <Screen>
        <EmptyState
          icon="truck"
          title="Loading trip"
          message="Getting your assigned trip and package information from the server."
        />
      </Screen>
    );
  }

  if (loadError && !trip) {
    return (
      <Screen>
        <EmptyState
          icon="alert-circle"
          title="Could not load trip"
          message={loadError}
        />
        <PrimaryButton onPress={() => void loadTripData()}>
          Try Again
        </PrimaryButton>
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <EmptyState
          icon="qrcode-scan"
          title="No open loading trip"
          message="You can scan packages when you have an assigned trip with status Loading."
        />
        <PrimaryButton onPress={() => void loadTripData()}>
          Refresh
        </PrimaryButton>
      </Screen>
    );
  }

  if (!permission?.granted) {
    return (
      <Screen>
        <EmptyState
          icon="camera-off"
          title="Camera permission needed"
          message="Camera access is required to scan package QR codes."
        />
        <PrimaryButton onPress={requestPermission}>
          Grant Permission
        </PrimaryButton>
      </Screen>
    );
  }

  const progress =
    expectedCount > 0 ? loadedCount / expectedCount : 0;

  const resultColor = scanResult?.success
    ? statusColors.delivered
    : colors.error;

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <Screen>
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
            if (!scanResult?.success || !scanLock.current) {
              void handleBarcodeScanned(result.data);
            }
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
            message="All scheduled packages have been scanned onto the vehicle."
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

      <PrimaryButton onPress={() => void loadTripData()}>
        Refresh Trip
      </PrimaryButton>
    </Screen>
  );
}
