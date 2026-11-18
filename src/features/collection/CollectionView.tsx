import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Button, HelperText, SegmentedButtons, Switch, Text, useTheme } from 'react-native-paper';
import { getDb } from '../../data/db';
import { getScanGps } from '../../data/location';
import { saveAndQueueMedia } from '../../data/media';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { formatDateTime } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';
import { statusColors } from '../../theme';
import { radius, size, space, type } from '../../tokens';
import { AppBar } from '../../ui/AppBar';
import { FormField } from '../../ui/FormField';
import { PhotoPicker } from '../../ui/PhotoPicker';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { SignatureSheet } from '../../ui/SignatureSheet';

interface CollectionViewProps {
  shipmentId: string;
}

type CodeState = 'idle' | 'match' | 'wrong' | 'unavailable';

/* ---------- Small helpers ---------- */

function SwitchRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: space.xs,
      }}
    >
      <Text style={[type.label, { color: colors.onSurface, flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} color={colors.primary} />
    </View>
  );
}

function SectionTitle({ children }: { children: string }) {
  const { colors } = useTheme();
  return (
    <Text style={[type.label, { color: colors.onSurfaceVariant, marginTop: space.sm }]}>
      {children}
    </Text>
  );
}

/* ---------- Screen ---------- */

export function CollectionView({ shipmentId }: CollectionViewProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [verifiedBy, setVerifiedBy] = useState<'code' | 'call'>('code');
  const [pickupCode, setPickupCode] = useState('');
  const [codeState, setCodeState] = useState<CodeState>('idle');

  const [collectorIsReceiver, setCollectorIsReceiver] = useState(true);
  const [collectorName, setCollectorName] = useState('');
  const [relationship, setRelationship] = useState('');

  const [idChecked, setIdChecked] = useState(false);
  const [idType, setIdType] = useState<string | null>(null);

  const [handoverPhotos, setHandoverPhotos] = useState<string[]>([]);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [receiverName, setReceiverName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDelivered, setIsDelivered] = useState(false);
  const [deliveredTimestamp, setDeliveredTimestamp] = useState('');

  const codeMessage: Record<CodeState, string | null> = {
    idle: null,
    match: copy.collection.codeMatches,
    wrong: copy.collection.wrongCode,
    unavailable: copy.collection.codeNotAvailable,
  };

  /* Load receiver */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const db = await getDb();
      const s = await db.getFirstAsync<{ receiver_name: string }>(
        'SELECT receiver_name FROM shipments WHERE id = ?',
        [shipmentId]
      );
      if (s && !cancelled) {
        setReceiverName(s.receiver_name);
        setCollectorName(s.receiver_name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shipmentId]);

  /* Verify pickup code against local hash.
     The cancelled flag stops a slow earlier check overwriting a newer result. */
  useEffect(() => {
    if (verifiedBy !== 'code' || pickupCode.length < 6) {
      setCodeState('idle');
      return;
    }

    let cancelled = false;
    (async () => {
      const db = await getDb();
      const pc = await db.getFirstAsync<{ salt: string; code_hash: string }>(
        'SELECT salt, code_hash FROM pickup_codes WHERE shipment_id = ?',
        [shipmentId]
      );
      if (cancelled) return;

      if (!pc) {
        setCodeState('unavailable');
        return;
      }

      const computed = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        pc.salt + pickupCode
      );
      if (cancelled) return;

      setCodeState(computed.toLowerCase() === pc.code_hash.toLowerCase() ? 'match' : 'wrong');
    })();

    return () => {
      cancelled = true;
    };
  }, [pickupCode, verifiedBy, shipmentId]);

  async function handleConfirmCollection() {
    if (isSubmitting) return;
    setError(null);
    if (!user) return;

    if (verifiedBy === 'code') {
      if (codeState !== 'match') {
        setError(copy.reasons.bad_code);
        return;
      }
    } else {
      const db = await getDb();
      const contact = await db.getFirstAsync(
        `SELECT id FROM contact_attempts WHERE shipment_id = ? AND channel = 'call' AND outcome = 'reached'`,
        [shipmentId]
      );
      if (!contact) {
        setError(copy.reasons.call_not_logged);
        return;
      }
    }

    const finalCollectorName = collectorIsReceiver ? receiverName : collectorName.trim();
    if (!collectorIsReceiver && (!finalCollectorName || !relationship.trim())) {
      setError('Collector name and relationship are required.');
      return;
    }

    if (idChecked && !idType) {
      setError('Select the type of ID that was checked.');
      return;
    }

    if (handoverPhotos.length === 0 || !signatureUri) {
      setError(copy.reasons.missing_photo);
      return;
    }

    setIsSubmitting(true);
    try {
      const photoPath = await saveAndQueueMedia(handoverPhotos[0], user.id);
      const sigPath = await saveAndQueueMedia(signatureUri, user.id, 'png');
      const gps = await getScanGps();

      await enqueueCommand(
        'collect_shipment',
        {
          shipment_id: shipmentId,
          collector_name: finalCollectorName,
          collector_is_receiver: collectorIsReceiver,
          relationship: collectorIsReceiver ? null : relationship.trim(),
          id_checked: idChecked,
          id_type: (idChecked ? idType : null) as never,
          verified_by: verifiedBy,
          pickup_code: verifiedBy === 'code' ? pickupCode : null,
          photo_path: photoPath,
          signature_path: sigPath,
          lat: gps?.lat ?? null,
          lng: gps?.lng ?? null,
        },
        { userId: user.id, role: user.role, locationId: user.location_id }
      );

      setDeliveredTimestamp(formatDateTime(new Date().toISOString()));
      setIsDelivered(true);
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : 'invalid_state';
      setError(copy.reasons[code] || copy.reasons.invalid_state);
    } finally {
      setIsSubmitting(false);
    }
  }

  /* ---------- Success ---------- */
  if (isDelivered) {
    return (
      <Screen>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.md,
            padding: space.xl,
          }}
        >
          <MaterialCommunityIcons
            name="check-circle"
            size={size.iconLg}
            color={statusColors.delivered}
          />
          <Text style={[type.title, { color: statusColors.delivered, textAlign: 'center' }]}>
            {copy.collection.deliveredSuccess}
          </Text>
          <Text style={[type.body, { color: colors.onSurfaceVariant, textAlign: 'center' }]}>
            {deliveredTimestamp}
          </Text>
          <PrimaryButton onPress={() => router.replace('/')}>
            {copy.collection.backToOverview}
          </PrimaryButton>
        </View>
      </Screen>
    );
  }

  /* ---------- Form ---------- */
  return (
    <Screen>
      <AppBar title={copy.collection.title} />

      {/* 1. Verification */}
      <SectionTitle>Verification</SectionTitle>
      <SegmentedButtons
        value={verifiedBy}
        onValueChange={(val) => setVerifiedBy(val as 'code' | 'call')}
        buttons={[
          { value: 'code', label: copy.collection.pickupCodeTab },
          { value: 'call', label: copy.collection.callTab },
        ]}
      />

      {verifiedBy === 'code' && (
        <View style={{ gap: space.xs }}>
          <FormField
            label={copy.collection.codeField}
            value={pickupCode}
            onChangeText={(t: string) => setPickupCode(t.replace(/\D/g, ''))}
            keyboardType="number-pad"
            maxLength={6}
          />
          {!!codeMessage[codeState] && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <MaterialCommunityIcons
                name={codeState === 'match' ? 'check-circle' : 'alert-circle'}
                size={16}
                color={codeState === 'match' ? statusColors.delivered : colors.error}
              />
              <Text
                style={[
                  type.caption,
                  { color: codeState === 'match' ? statusColors.delivered : colors.error },
                ]}
              >
                {codeMessage[codeState]}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* 2. Collector */}
      <SectionTitle>Collector</SectionTitle>
      <SwitchRow
        label={copy.collection.collectorIsReceiver}
        value={collectorIsReceiver}
        onChange={setCollectorIsReceiver}
      />

      {!collectorIsReceiver && (
        <View style={{ gap: space.sm }}>
          <FormField
            label={copy.collection.collectorName}
            value={collectorName}
            onChangeText={setCollectorName}
          />
          <FormField
            label={copy.collection.relationship}
            value={relationship}
            onChangeText={setRelationship}
          />
        </View>
      )}

      <SwitchRow label={copy.collection.idChecked} value={idChecked} onChange={setIdChecked} />

      {idChecked && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {copy.collection.idTypes.map((item) => {
            const isSelected = idType === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setIdType(item.id)}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View
                  style={{
                    paddingHorizontal: space.md,
                    paddingVertical: space.xs,
                    borderRadius: radius.pill,
                    backgroundColor: isSelected ? colors.primary : colors.surface,
                    borderWidth: isSelected ? 0 : 1,
                    borderColor: colors.outline,
                  }}
                >
                  <Text
                    style={[
                      type.caption,
                      { color: isSelected ? colors.onPrimary : colors.onSurfaceVariant },
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* 3. Proof of handover */}
      <SectionTitle>Proof of handover</SectionTitle>
      <PhotoPicker
        label={copy.collection.photoLabel}
        photos={handoverPhotos}
        onChange={setHandoverPhotos}
        max={1}
      />

      {/* Signature: tap to open the sheet, preview once captured */}
      {signatureUri ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: colors.outline,
            borderRadius: 12,
            padding: space.sm,
            gap: space.xs,
            backgroundColor: '#fff',
          }}
        >
          <Image
            source={{ uri: signatureUri }}
            style={{ width: '100%', height: 100 }}
            resizeMode="contain"
          />
          <Button mode="text" icon="pencil" onPress={() => setSheetOpen(true)}>
            Sign again
          </Button>
        </View>
      ) : (
        <Pressable
          onPress={() => setSheetOpen(true)}
          style={({ pressed }) => ({
            opacity: pressed ? 0.7 : 1,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: colors.outline,
            borderRadius: 12,
            paddingVertical: space.lg ?? space.md,
            alignItems: 'center',
            gap: space.xs,
          })}
        >
          <MaterialCommunityIcons name="draw" size={28} color={colors.primary} />
          <Text style={[type.label, { color: colors.primary }]}>Tap to sign</Text>
        </Pressable>
      )}

      {!!error && (
        <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
          {error}
        </HelperText>
      )}

      <PrimaryButton
        onPress={handleConfirmCollection}
        loading={isSubmitting}
        disabled={isSubmitting}
      >
        {copy.collection.confirmButton}
      </PrimaryButton>

      <SignatureSheet
        visible={sheetOpen}
        title="Receiver signature"
        onClose={() => setSheetOpen(false)}
        onSave={(uri) => {
          setSignatureUri(uri);
          setSheetOpen(false);
          setError(null);
        }}
      />
    </Screen>
  );
}