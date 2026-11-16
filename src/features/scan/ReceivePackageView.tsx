
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Button, HelperText, Text, useTheme } from 'react-native-paper';
import { getDb } from '../../data/db';
import { getScanGps } from '../../data/location';
import { saveAndQueueMedia } from '../../data/media';
import { enqueueCommand } from '../../data/outbox';
import { logError } from "../../data/sync";
import { copy } from '../../lib/copy';
import { useAuthStore } from '../../store/authStore';
import { radius, size, space, type } from '../../tokens';
import { AppBar } from '../../ui/AppBar';
import { EmptyState } from '../../ui/EmptyState';
import { FormField } from '../../ui/FormField';
import { PhotoPicker } from '../../ui/PhotoPicker';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
type Condition = 'ok' | 'damaged' | 'opened';

interface ScannedPackage {
  labelCode: string;
  shipmentId: string;
  waybillNo: string;
  seq: number;
  receiverName: string;
}

interface PackageProgress {
  total: number;
  arrived: number;
}

const CONDITIONS: Condition[] = ['ok', 'damaged', 'opened'];
const SCAN_ERROR_COOLDOWN_MS = 1500;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();

    if (message) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'An unexpected error occurred. Please try again.';
}

async function lookupPackage(labelCode: string): Promise<ScannedPackage | null> {
  const db = await getDb();

  const row = await db.getFirstAsync<{
    shipment_id: string;
    waybill_no: string;
    seq: number;
    receiver_name: string | null;
  }>(
    `SELECT
       p.shipment_id,
       p.seq,
       s.waybill_no,
       s.receiver_name
     FROM packages AS p
     INNER JOIN shipments AS s ON s.id = p.shipment_id
     WHERE p.label_code = ?
     LIMIT 1`,
    [labelCode]
  );

  if (!row) return null;

  return {
    labelCode,
    shipmentId: row.shipment_id,
    waybillNo: row.waybill_no,
    seq: row.seq,
    receiverName: row.receiver_name ?? '',
  };
}

async function fetchProgress(shipmentId: string): Promise<PackageProgress | null> {
  const db = await getDb();

  return db.getFirstAsync<PackageProgress>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(
         SUM(CASE WHEN status IN ('arrived', 'delivered') THEN 1 ELSE 0 END),
         0
       ) AS arrived
     FROM packages
     WHERE shipment_id = ?`,
    [shipmentId]
  );
}

export function ReceivePackageView() {
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const [permission, requestPermission] = useCameraPermissions();

  const [scanned, setScanned] = useState<ScannedPackage | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [condition, setCondition] = useState<Condition>('ok');
  const [arrivalPhotos, setArrivalPhotos] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState<PackageProgress | null>(null);

  const lookupLock = useRef(false);
  const submitLock = useRef(false);
  const scanErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScanErrorTimer = useCallback(() => {
    if (scanErrorTimer.current) {
      clearTimeout(scanErrorTimer.current);
      scanErrorTimer.current = null;
    }
  }, []);

  const resetSheet = useCallback(() => {
    clearScanErrorTimer();
    setScanned(null);
    setManualCode('');
    setCondition('ok');
    setArrivalPhotos([]);
    setNote('');
    setError(null);
    lookupLock.current = false;
  }, [clearScanErrorTimer]);

  useEffect(() => {
    return () => {
      clearScanErrorTimer();
    };
  }, [clearScanErrorTimer]);

  async function handleLookup(raw: string) {
    if (lookupLock.current || submitLock.current || scanned) return;

    const labelCode = raw.trim();

    if (!labelCode) {
      setError('Enter or scan a package label code.');
      return;
    }

    lookupLock.current = true;
    clearScanErrorTimer();
    setError(null);

    try {
      const found = await lookupPackage(labelCode);

      if (!found) {
        setError('Package not found on this device. Check the label code or sync your shipments.');

        scanErrorTimer.current = setTimeout(() => {
          lookupLock.current = false;
          scanErrorTimer.current = null;
        }, SCAN_ERROR_COOLDOWN_MS);

        return;
      }

      setScanned(found);
    } catch (err: unknown) {
      console.error('[receive-package] Package lookup failed:', err);
      setError(`Package lookup failed: ${getErrorMessage(err)}`);
      lookupLock.current = false;
    }
  }

  async function handleConfirmReceive() {
    if (!scanned || !user || submitLock.current) return;

    if (condition !== 'ok' && arrivalPhotos.length === 0) {
      setError('A photo is required when the package is damaged or opened.');
      return;
    }

    submitLock.current = true;
    setError(null);
    setIsSubmitting(true);

    try {
      let arrivalPhotoPath: string | null = null;

      if (arrivalPhotos.length > 0) {
        try {
          arrivalPhotoPath = await saveAndQueueMedia(arrivalPhotos[0], user.id);
        } catch (photoError: unknown) {
          throw new Error(`Photo could not be saved: ${getErrorMessage(photoError)}`);
        }
      }

      let gps: Awaited<ReturnType<typeof getScanGps>>;

      try {
        gps = await getScanGps();
      } catch (gpsError: unknown) {
        console.error('[receive-package] GPS lookup failed:', gpsError);
        gps = null;
      }

      try {
        await enqueueCommand(
          'receive_item',
          {
            label_code: scanned.labelCode,
            condition,
            note: note.trim() || null,
            arrival_photo_path: arrivalPhotoPath,
            lat: gps?.lat ?? null,
            lng: gps?.lng ?? null,
          },
          {
            userId: user.id,
            role: user.role,
            locationId: user.location_id,
          }
        );
      } catch (queueError: unknown) {
        throw new Error(`Receipt could not be saved locally: ${getErrorMessage(queueError)}`);
      }

      const shipmentId = scanned.shipmentId;

      // The receipt is now queued locally.
      resetSheet();

      try {
        const counts = await fetchProgress(shipmentId);
        if (counts) setProgress(counts);
      } catch (progressError: unknown) {
        logError('[receive-package] Progress refresh failed:', progressError);
        console.error('[receive-package] Progress refresh failed:', progressError);
      }
    } catch (err: unknown) {
      console.error('[receive-package] Receipt command failed:', err);
      logError('[receive-package] Receipt command failed:', err)
      setError(getErrorMessage(err));
    } finally {
      submitLock.current = false;
      setIsSubmitting(false);
    }
  }

  if (!permission?.granted) {
    return (
      <Screen>
        <AppBar title={copy.receive.title} />

        <EmptyState
          icon="camera-off"
          title="Camera permission needed"
          message="Camera access is required to receive package QR codes."
        />

        {!!permission && !permission.granted && (
          <HelperText type="error" visible>
            Camera permission has not been granted.
          </HelperText>
        )}

        <PrimaryButton onPress={requestPermission}>
          Grant Permission
        </PrimaryButton>
      </Screen>
    );
  }

  const conditionLabels: Record<Condition, string> = {
    ok: copy.receive.ok,
    damaged: copy.receive.damaged,
    opened: copy.receive.opened,
  };

  return (
    <Screen>
      <AppBar title={copy.receive.title} />

      {progress && (
        <View
          style={{
            padding: space.md,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.outline,
          }}
        >
          <Text style={[type.heading, { color: colors.primary }]}>
            {copy.receive.receivedCount(progress.arrived, progress.total)}
          </Text>
        </View>
      )}

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
          onBarcodeScanned={
            scanned || isSubmitting
              ? undefined
              : (result) => handleLookup(result.data)
          }
        />
      </View>

      <View style={{ gap: space.xs }}>
        <FormField
          placeholder="Or type label code manually..."
          value={manualCode}
          onChangeText={setManualCode}
          autoCapitalize="characters"
        />

        <Button
          mode={manualCode ? 'contained' : 'outlined'}
          onPress={() => handleLookup(manualCode)}
          disabled={!manualCode.trim() || isSubmitting}
        >
          Lookup Code
        </Button>
      </View>

      {!scanned && !!error && (
        <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
          {error}
        </HelperText>
      )}

      <Modal
        visible={!!scanned}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!isSubmitting) resetSheet();
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              padding: space.lg,
              paddingBottom: space.lg,
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              gap: space.md,
            }}
          >
            <View style={{ gap: space.xs }}>
              <Text style={[type.heading, { color: colors.onSurface }]}>
                {scanned?.waybillNo}
              </Text>

              <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
                Package {scanned?.seq}
                {scanned?.receiverName ? ` · ${scanned.receiverName}` : ''}
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: space.xs }}>
              {CONDITIONS.map((cond) => {
                const selected = condition === cond;

                return (
                  <Pressable
                    key={cond}
                    disabled={isSubmitting}
                    onPress={() => {
                      setCondition(cond);
                      setError(null);
                    }}
                    style={({ pressed }) => ({
                      opacity: pressed || isSubmitting ? 0.7 : 1,
                    })}
                  >
                    <View
                      style={{
                        paddingHorizontal: space.md,
                        paddingVertical: space.xs,
                        borderRadius: radius.pill,
                        backgroundColor: selected ? colors.primary : colors.surface,
                        borderWidth: selected ? 0 : 1,
                        borderColor: colors.outline,
                      }}
                    >
                      <Text
                        style={[
                          type.label,
                          {
                            color: selected
                              ? colors.onPrimary
                              : colors.onSurfaceVariant,
                          },
                        ]}
                      >
                        {conditionLabels[cond]}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {condition !== 'ok' && (
              <PhotoPicker
                label={copy.receive.takeArrivalPhoto}
                photos={arrivalPhotos}
                onChange={(photos) => {
                  setArrivalPhotos(photos);
                  setError(null);
                }}
                max={1}
              />
            )}

            <FormField
              placeholder={copy.receive.notePlaceholder}
              value={note}
              onChangeText={setNote}
            />

            {!!error && (
              <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
                {error}
              </HelperText>
            )}

            <PrimaryButton
              onPress={handleConfirmReceive}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              Confirm Receipt
            </PrimaryButton>

            <Button
              mode="text"
              onPress={resetSheet}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
