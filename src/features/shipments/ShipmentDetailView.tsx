import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Image, Linking, Modal, Pressable, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { getDb } from '../../data/db';
import { resolveImageUri } from '../../data/media';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { formatDateTime } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';
import { statusColors } from '../../theme';
import { radius, size, space, type } from '../../tokens';
import { AlertBanner } from '../../ui/AlertBanner';
import { AppBar } from '../../ui/AppBar';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StatusChip } from '../../ui/StatusChip';
import { StepTracker } from '../../ui/StepTracker';

interface ShipmentDetailData {
  id: string;
  waybill_no: string;
  sender_name: string;
  receiver_name: string;
  receiver_phone: string;
  origin_id: string;
  destination_id: string;
  origin_name: string;
  destination_name: string;
  status: string;
  issue_reason: string | null;
  notes: string | null;
  ready_at: string | null;
  delivered_at: string | null;
}

interface PackageItem {
  id: string;
  seq: number;
  label_code: string;
  description: string;
  qty: number;
  photo_path: string | null;
  status: string;
  condition: string | null;
  arrival_photo_path: string | null;
  arrival_note: string | null;
}

interface CustodyEventItem {
  id: number;
  type: string;
  actor_name: string;
  lat: number | null;
  lng: number | null;
  note: string | null;
  recorded_at: string;
  isPendingSync?: boolean;
}

interface ContactAttemptItem {
  id: string;
  channel: string;
  outcome: string;
  note: string | null;
  recorded_at: string;
}

interface CollectionProof {
  collector_name: string;
  collector_is_receiver: number;
  relationship: string | null;
  id_checked: number;
  id_type: string | null;
  verified_by: string;
  photo_path: string;
  signature_path: string;
  collected_at: string;
}

interface Props {
  shipmentId: string;
}

export function ShipmentDetailView({ shipmentId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [shipment, setShipment] = useState<ShipmentDetailData | null>(null);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [timeline, setTimeline] = useState<CustodyEventItem[]>([]);
  const [contacts, setContacts] = useState<ContactAttemptItem[]>([]);
  const [collection, setCollection] = useState<CollectionProof | null>(null);

  // Compare photos modal
  const [compareModalVisible, setCompareModalVisible] = useState(false);
  const [comparePhotos, setComparePhotos] = useState<{ originUri: string | null; arrivalUri: string | null }>({
    originUri: null,
    arrivalUri: null,
  });

  // Call outcome modal
  const [callModalVisible, setCallModalVisible] = useState(false);

  // Flag issue dialog
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [issueReason, setIssueReason] = useState('');

  const loadAllData = useCallback(async () => {
    const db = await getDb();

    // 1. Shipment
    const s = await db.getFirstAsync<ShipmentDetailData>(
      `SELECT s.*, o.name as origin_name, d.name as destination_name
       FROM shipments s
       JOIN locations o ON o.id = s.origin_id
       JOIN locations d ON d.id = s.destination_id
       WHERE s.id = ?`,
      [shipmentId]
    );
    setShipment(s || null);

    // 2. Packages
    const pkgs = await db.getAllAsync<PackageItem>(
      `SELECT * FROM packages WHERE shipment_id = ? ORDER BY seq ASC`,
      [shipmentId]
    );
    setPackages(pkgs);

    // 3. Custody Timeline (pulled events + pending outbox)
    const events = await db.getAllAsync<{
      id: number;
      type: string;
      actor_id: string;
      lat: number | null;
      lng: number | null;
      note: string | null;
      recorded_at: string;
      actor_name: string;
    }>(
      `SELECT c.*, COALESCE(p.name, 'Staff') as actor_name
       FROM custody_events c
       LEFT JOIN profiles p ON p.id = c.actor_id
       WHERE c.shipment_id = ?
       ORDER BY c.recorded_at ASC`,
      [shipmentId]
    );

    const pendingOutbox = await db.getAllAsync<{
      id: string;
      type: string;
      payload: string;
      created_at: string;
    }>(`SELECT id, type, payload, created_at FROM outbox WHERE status = 'pending'`);

    const pendingTimeline: CustodyEventItem[] = [];
    for (const item of pendingOutbox) {
      const p = JSON.parse(item.payload);
      if (p.shipment_id === shipmentId) {
        pendingTimeline.push({
          id: -1,
          type: item.type,
          actor_name: user?.name || 'You',
          lat: p.lat ?? null,
          lng: p.lng ?? null,
          note: p.reason || p.notes || null,
          recorded_at: item.created_at,
          isPendingSync: true,
        });
      }
    }

    setTimeline([...events, ...pendingTimeline]);

    // 4. Contact Attempts
    const contactRows = await db.getAllAsync<ContactAttemptItem>(
      `SELECT * FROM contact_attempts WHERE shipment_id = ? ORDER BY recorded_at DESC`,
      [shipmentId]
    );
    setContacts(contactRows);

    // 5. Collection Proof
    const col = await db.getFirstAsync<CollectionProof>(
      `SELECT * FROM collections WHERE shipment_id = ?`,
      [shipmentId]
    );
    setCollection(col || null);
  }, [shipmentId, user]);

  useFocusEffect(
    useCallback(() => {
      loadAllData();
    }, [loadAllData])
  );

  if (!shipment) return null;

  const totalPkgs = packages.length;
  const hasArrivalPhoto = packages.some((p) => !!p.arrival_photo_path);
  const isReady = shipment.ready_at !== null && shipment.status !== 'delivered';
  const isManagerAtDestination = user?.role === 'manager' && user.location_id === shipment.destination_id;

  async function openComparePhotos() {
    const pkgWithArrival = packages.find((p) => !!p.arrival_photo_path);
    if (pkgWithArrival) {
      const originUri = await resolveImageUri(pkgWithArrival.photo_path);
      const arrivalUri = await resolveImageUri(pkgWithArrival.arrival_photo_path);
      setComparePhotos({ originUri, arrivalUri });
      setCompareModalVisible(true);
    }
  }

  function handleCallReceiver() {
    Linking.openURL(`tel:${shipment?.receiver_phone}`);
    setCallModalVisible(true);
  }

  async function handleRecordCallOutcome(outcome: 'reached' | 'no_answer' | 'wrong_number') {
    setCallModalVisible(false);
    if (!user || !shipment) return;

    await enqueueCommand(
      'record_contact',
      {
        contact_id: Crypto.randomUUID(),
        shipment_id: shipment.id,
        channel: 'call',
        outcome,
        note: null,
      },
      {
        userId: user.id,
        role: user.role,
        locationId: user.location_id,
      }
    );
    loadAllData();
  }

  async function handleSendSms() {
    if (!shipment || !user) return;
    const body = copy.shipmentDetail.smsBody(
      shipment.waybill_no,
      shipment.origin_name,
      shipment.destination_name
    );
    Linking.openURL(`sms:${shipment.receiver_phone}?body=${encodeURIComponent(body)}`);

    await enqueueCommand(
      'record_contact',
      {
        contact_id: Crypto.randomUUID(),
        shipment_id: shipment.id,
        channel: 'sms',
        outcome: 'sent',
        note: body,
      },
      {
        userId: user.id,
        role: user.role,
        locationId: user.location_id,
      }
    );
    loadAllData();
  }

  async function handleFlagIssue() {
    if (!issueReason.trim() || !user || !shipment) return;
    setIssueDialogOpen(false);

    await enqueueCommand(
      'flag_issue',
      {
        shipment_id: shipment.id,
        reason: issueReason.trim(),
      },
      {
        userId: user.id,
        role: user.role,
        locationId: user.location_id,
      }
    );
    setIssueReason('');
    loadAllData();
  }

  return (
    <Screen>
      <AppBar title={shipment.waybill_no} />

      {/* Header Info */}
      <View
        style={{
          padding: space.md,
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.outline,
          gap: space.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[type.title, { color: colors.onSurface }]}>
            {shipment.waybill_no}
          </Text>
          <StatusChip status={shipment.status} />
        </View>

        <Text style={[type.body, { color: colors.onSurface }]}>
          {shipment.origin_name} → {shipment.destination_name}
        </Text>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            Receiver: {shipment.receiver_name} ({shipment.receiver_phone})
          </Text>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            Sender: {shipment.sender_name}
          </Text>
        </View>

        <StepTracker currentStatus={shipment.status} />
      </View>

      {/* Issue Banner */}
      {shipment.status === 'issue' && (
        <AlertBanner
          message={shipment.issue_reason || 'This shipment has an issue recorded.'}
        />
      )}

      {/* Packages Section */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[type.heading, { color: colors.onSurface }]}>
            Packages ({totalPkgs})
          </Text>
          {hasArrivalPhoto && (
            <Button mode="text" textColor={colors.primary} onPress={openComparePhotos}>
              {copy.shipmentDetail.comparePhotos}
            </Button>
          )}
        </View>

        {packages.map((pkg) => (
          <View
            key={pkg.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: space.md,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.outline,
              gap: space.md,
            }}
          >
            {pkg.photo_path ? (
              <Image
                source={{ uri: pkg.photo_path }}
                style={{
                  width: size.thumb,
                  height: size.thumb,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surface,
                }}
              />
            ) : (
              <View
                style={{
                  width: size.thumb,
                  height: size.thumb,
                  borderRadius: radius.sm,
                  backgroundColor: colors.outline,
                }}
              />
            )}

            <View style={{ flex: 1, gap: space.xs }}>
              <Text style={[type.label, { color: colors.primary }]}>
                {copy.labels.itemSeq(pkg.seq, totalPkgs)}
              </Text>
              <Text style={[type.body, { color: colors.onSurface }]}>
                {pkg.description}
              </Text>
              <StatusChip status={pkg.status} />
            </View>
          </View>
        ))}
      </View>

      {/* Custody Timeline */}
      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.shipmentDetail.custodyEvents}
        </Text>

        <View
          style={{
            padding: space.md,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.outline,
            gap: space.md,
          }}
        >
          {timeline.map((event, idx) => (
            <View key={idx} style={{ gap: space.xs }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.label, { color: colors.onSurface }]}>
                  {event.type.toUpperCase()}
                </Text>
                {event.isPendingSync ? (
                  <Text style={[type.caption, { color: statusColors.in_transit }]}>
                    {copy.shipmentDetail.waitingToSync}
                  </Text>
                ) : (
                  <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                    {formatDateTime(event.recorded_at)}
                  </Text>
                )}
              </View>

              <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                Actor: {event.actor_name}
              </Text>

              {event.lat && event.lng && (
                <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                  GPS: {event.lat.toFixed(4)}, {event.lng.toFixed(4)}
                </Text>
              )}

              {event.note && (
                <Text style={[type.caption, { color: colors.error }]}>
                  Note: {event.note}
                </Text>
              )}
            </View>
          ))}
        </View>
      </View>

      {/* Contact Attempts Log */}
      {contacts.length > 0 && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.heading, { color: colors.onSurface }]}>Contact Log</Text>
          <View
            style={{
              padding: space.md,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.outline,
              gap: space.sm,
            }}
          >
            {contacts.map((c) => (
              <View key={c.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.body, { color: colors.onSurface }]}>
                  {c.channel.toUpperCase()} ({c.outcome})
                </Text>
                <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                  {formatDateTime(c.recorded_at)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Proof of Delivery */}
      {collection && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.heading, { color: colors.onSurface }]}>
            {copy.shipmentDetail.proofOfDelivery}
          </Text>
          <View
            style={{
              padding: space.md,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: colors.outline,
              gap: space.xs,
            }}
          >
            <Text style={[type.body, { color: colors.onSurface }]}>
              Collector: {collection.collector_name}
            </Text>
            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
              Verified by: {collection.verified_by.toUpperCase()}
            </Text>
            <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
              Delivered: {formatDateTime(collection.collected_at)}
            </Text>
          </View>
        </View>
      )}

      {/* Actions */}
      <View style={{ gap: space.sm }}>
        <PrimaryButton
          variant="outline"
          icon="qrcode"
          onPress={() => router.push(`/shipment/${shipment.id}/labels`)}
        >
          {copy.shipmentDetail.labelsButton}
        </PrimaryButton>

        {isReady && (
          <>
            <PrimaryButton icon="phone" onPress={handleCallReceiver}>
              {copy.shipmentDetail.callReceiver}
            </PrimaryButton>

            <PrimaryButton icon="message-text" onPress={handleSendSms}>
              {copy.shipmentDetail.sendSms}
            </PrimaryButton>

            {isManagerAtDestination && (
              <PrimaryButton
                onPress={() => router.push(`/shipment/${shipment.id}/collect`)}
              >
                {copy.shipmentDetail.confirmCollection}
              </PrimaryButton>
            )}
          </>
        )}

        {user?.role === 'manager' && shipment.status !== 'delivered' && (
          <Button
            mode="text"
            textColor={colors.error}
            onPress={() => setIssueDialogOpen(true)}
          >
            {copy.shipmentDetail.flagIssue}
          </Button>
        )}
      </View>

      {/* Call Outcome Modal Sheet */}
      <Modal visible={callModalVisible} transparent animationType="slide">
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
              borderTopLeftRadius: radius.lg,
              borderTopRightRadius: radius.lg,
              gap: space.md,
            }}
          >
            <Text style={[type.heading, { color: colors.onSurface }]}>
              {copy.shipmentDetail.callSheet.title}
            </Text>

            <PrimaryButton onPress={() => handleRecordCallOutcome('reached')}>
              {copy.shipmentDetail.callSheet.reached}
            </PrimaryButton>

            <PrimaryButton
              variant="outline"
              onPress={() => handleRecordCallOutcome('no_answer')}
            >
              {copy.shipmentDetail.callSheet.noAnswer}
            </PrimaryButton>

            <PrimaryButton
              variant="outline"
              onPress={() => handleRecordCallOutcome('wrong_number')}
            >
              {copy.shipmentDetail.callSheet.wrongNumber}
            </PrimaryButton>

            <Button mode="text" onPress={() => setCallModalVisible(false)}>
              Cancel
            </Button>
          </View>
        </View>
      </Modal>

      {/* Compare Photos Modal */}
      <Modal visible={compareModalVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            justifyContent: 'center',
            padding: space.md,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              padding: space.md,
              gap: space.md,
            }}
          >
            <Text style={[type.heading, { color: colors.onSurface }]}>
              Photo Comparison
            </Text>

            <View style={{ flexDirection: 'row', gap: space.md }}>
              <View style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
                <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
                  Origin Photo
                </Text>
                {comparePhotos.originUri && (
                  <Image
                    source={{ uri: comparePhotos.originUri }}
                    style={{ width: size.photoBox, height: size.photoBox, borderRadius: radius.sm }}
                  />
                )}
              </View>

              <View style={{ flex: 1, alignItems: 'center', gap: space.xs }}>
                <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
                  Arrival Photo
                </Text>
                {comparePhotos.arrivalUri && (
                  <Image
                    source={{ uri: comparePhotos.arrivalUri }}
                    style={{ width: size.photoBox, height: size.photoBox, borderRadius: radius.sm }}
                  />
                )}
              </View>
            </View>

            <PrimaryButton onPress={() => setCompareModalVisible(false)}>
              Close
            </PrimaryButton>
          </View>
        </View>
      </Modal>

      {/* Flag Issue Dialog */}
      <Portal>
        <Dialog visible={issueDialogOpen} onDismiss={() => setIssueDialogOpen(false)}>
          <Dialog.Title>{copy.shipmentDetail.flagIssue}</Dialog.Title>
          <Dialog.Content>
            <TextInput
              mode="outlined"
              label={copy.shipmentDetail.issueReasonPrompt}
              placeholder={copy.shipmentDetail.issueReasonPlaceholder}
              value={issueReason}
              onChangeText={setIssueReason}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setIssueDialogOpen(false)}>Cancel</Button>
            <Button onPress={handleFlagIssue} textColor={colors.error}>
              Confirm
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
