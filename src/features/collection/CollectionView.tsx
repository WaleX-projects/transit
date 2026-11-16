import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { HelperText, SegmentedButtons, Switch, Text, useTheme } from 'react-native-paper';
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
import { SignaturePad } from '../../ui/SignaturePad';

interface CollectionViewProps {
  shipmentId: string;
}

export function CollectionView({ shipmentId }: CollectionViewProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [verifiedBy, setVerifiedBy] = useState<'code' | 'call'>('code');
  const [pickupCode, setPickupCode] = useState('');
  const [codeStatus, setCodeStatus] = useState<string | null>(null);

  const [collectorIsReceiver, setCollectorIsReceiver] = useState(true);
  const [collectorName, setCollectorName] = useState('');
  const [relationship, setRelationship] = useState('');

  const [idChecked, setIdChecked] = useState(false);
  const [idType, setIdType] = useState<string | null>(null);

  const [handoverPhotos, setHandoverPhotos] = useState<string[]>([]);
  const [signatureUri, setSignatureUri] = useState<string | null>(null);

  const [receiverName, setReceiverName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDelivered, setIsDelivered] = useState(false);
  const [deliveredTimestamp, setDeliveredTimestamp] = useState('');

  useEffect(() => {
    async function loadShipment() {
      const db = await getDb();
      const s = await db.getFirstAsync<{ receiver_name: string }>(
        'SELECT receiver_name FROM shipments WHERE id = ?',
        [shipmentId]
      );
      if (s) {
        setReceiverName(s.receiver_name);
        setCollectorName(s.receiver_name);
      }
    }
    loadShipment();
  }, [shipmentId]);

  // Code verification against local pickup_codes table
  useEffect(() => {
    if (verifiedBy !== 'code') {
      setCodeStatus(null);
      return;
    }

    if (pickupCode.length < 6) {
      setCodeStatus(null);
      return;
    }

    async function verify() {
      const db = await getDb();
      const pc = await db.getFirstAsync<{ salt: string; code_hash: string }>(
        'SELECT salt, code_hash FROM pickup_codes WHERE shipment_id = ?',
        [shipmentId]
      );

      if (!pc) {
        setCodeStatus(copy.collection.codeNotAvailable);
        return;
      }

      const computed = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        pc.salt + pickupCode
      );

      if (computed.toLowerCase() === pc.code_hash.toLowerCase()) {
        setCodeStatus(copy.collection.codeMatches);
      } else {
        setCodeStatus(copy.collection.wrongCode);
      }
    }

    verify();
  }, [pickupCode, verifiedBy, shipmentId]);

  async function handleConfirmCollection() {
    setError(null);
    if (!user) return;

    if (verifiedBy === 'code') {
      if (codeStatus !== copy.collection.codeMatches) {
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
    if (!collectorIsReceiver) {
      if (!finalCollectorName || !relationship.trim()) {
        setError('Collector name and relationship are required.');
        return;
      }
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
        {
          userId: user.id,
          role: user.role,
          locationId: user.location_id,
        }
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

  // Success Screen
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

  return (
    <Screen>
      <AppBar title={copy.collection.title} />

      {/* Segmented Verification */}
      <SegmentedButtons
        value={verifiedBy}
        onValueChange={(val) => setVerifiedBy(val as 'code' | 'call')}
        buttons={[
          { value: 'code', label: copy.collection.pickupCodeTab },
          { value: 'call', label: copy.collection.callTab },
        ]}
      />

      {verifiedBy === 'code' ? (
        <View style={{ gap: space.xs }}>
          <FormField
            label={copy.collection.codeField}
            value={pickupCode}
            onChangeText={setPickupCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          {!!codeStatus && (
            <Text
              style={[
                type.caption,
                {
                  color:
                    codeStatus === copy.collection.codeMatches
                      ? statusColors.delivered
                      : colors.error,
                },
              ]}
            >
              {codeStatus}
            </Text>
          )}
        </View>
      ) : null}

      {/* Switch: Collector is the receiver */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: space.xs,
        }}
      >
        <Text style={[type.label, { color: colors.onSurface }]}>
          {copy.collection.collectorIsReceiver}
        </Text>
        <Switch
          value={collectorIsReceiver}
          onValueChange={setCollectorIsReceiver}
          color={colors.primary}
        />
      </View>

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

      {/* Switch: ID checked */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: space.xs,
        }}
      >
        <Text style={[type.label, { color: colors.onSurface }]}>
          {copy.collection.idChecked}
        </Text>
        <Switch
          value={idChecked}
          onValueChange={setIdChecked}
          color={colors.primary}
        />
      </View>

      {idChecked && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {copy.collection.idTypes.map((item) => {
            const isSelected = idType === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => setIdType(item.id)}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
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

      {/* Handover Photo */}
      <PhotoPicker
        label={copy.collection.photoLabel}
        photos={handoverPhotos}
        onChange={setHandoverPhotos}
        max={1}
      />

      {/* Signature Pad */}
      <SignaturePad onSignatureChange={setSignatureUri} />

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
    </Screen>
  );
}
