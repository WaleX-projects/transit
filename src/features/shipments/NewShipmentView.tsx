import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { HelperText, Menu, Text, TextInput, useTheme } from 'react-native-paper';
import { saveAndQueueMedia } from '../../data/media';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { normalizePhone } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';
import { space, type } from '../../tokens';
import { AppBar } from '../../ui/AppBar';
import { FormField } from '../../ui/FormField';
import { PhotoPicker } from '../../ui/PhotoPicker';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { fetchLocations } from './shipmentsQueries';

interface LocationItem {
  id: string;
  name: string;
  state: string;
}

export function NewShipmentView() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [senderName, setSenderName] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [description, setDescription] = useState('');
  const [numPackages, setNumPackages] = useState('1');
  const [originId, setOriginId] = useState('');
  const [destId, setDestId] = useState('');
  const [originMenuOpen, setOriginMenuOpen] = useState(false);
  const [destMenuOpen, setDestMenuOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchLocations().then((locs) => {
      setLocations(locs);
      if (locs.length > 0) {
        // Default origin to user's branch
        const defaultOrigin = locs.find((l) => l.id === user?.location_id) || locs[0];
        setOriginId(defaultOrigin.id);
        const otherLoc = locs.find((l) => l.id !== defaultOrigin.id);
        if (otherLoc) setDestId(otherLoc.id);
      }
    });
  }, [user]);

  async function handleGenerateLabels() {
    setError(null);

    if (photos.length === 0) {
      setError(copy.newShipment.photoRequired);
      return;
    }

    if (!senderName.trim() || !receiverName.trim() || !description.trim()) {
      setError('Please fill in all shipment fields.');
      return;
    }

    const normReceiverPhone = normalizePhone(receiverPhone);
    const normSenderPhone = normalizePhone(senderPhone);

    if (!normReceiverPhone) {
      setError(copy.newShipment.phoneError);
      return;
    }
   if (!normSenderPhone) {
      setError(copy.newShipment.phoneError);
      return;
    }
   

    if (!originId || !destId || originId === destId) {
      setError(copy.newShipment.sameLocationError);
      return;
    }

    const count = parseInt(numPackages, 10);
    if (isNaN(count) || count < 1 || count > 99) {
      setError('Number of packages must be between 1 and 99.');
      return;
    }

    // Check local waybill block
    function generateRandomWaybill(prefix = 'WB') {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomCode = Math.random().toString(36).substring(2, 6).toUpperCase();

      return `${prefix}-${date}-${randomCode}`;
    }

    if (!user) {
      setError(copy.reasons.not_allowed);
      return;
    }

    setIsSubmitting(true);

    try {
      const waybillNo = generateRandomWaybill();
      const shipmentId = Crypto.randomUUID();

      // Package preparation: package i uses photo i, or photo 1 if fewer photos
      const packagesPayload: Array<{
        package_id: string;
        seq: number;
        description: string;
        qty: number;
        photo_path: string;
      }> = [];

      for (let i = 1; i <= count; i++) {
        const photoLocalUri = photos[i - 1] || photos[0];
        const storagePath = await saveAndQueueMedia(photoLocalUri, user.id);
        packagesPayload.push({
          package_id: Crypto.randomUUID(),
          seq: i,
          description,
          qty: 1,
          photo_path: storagePath,
        });
      }

      await enqueueCommand(
        'create_shipment',
        {
          shipment_id: shipmentId,
          waybill_no: waybillNo,
          sender_name: senderName.trim(),
          receiver_name: receiverName.trim(),
          sender_phone: normSenderPhone, 
          receiver_phone: normReceiverPhone,
          origin_id: originId,
          destination_id: destId,
          notes: description.trim(),
          packages: packagesPayload,
        },
        {
          userId: user.id,
          role: user.role,
          locationId: user.location_id,
        }
      );

      router.replace(`/shipment/${shipmentId}/labels`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid_state';
      console.log("[log-out]",msg)
      setError(copy.reasons[msg] || 'Could not create shipment.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const originName = locations.find((l) => l.id === originId)?.name || 'Select Origin';
  const destName = locations.find((l) => l.id === destId)?.name || 'Select Destination';

  return (
    <Screen>
      <AppBar title={copy.newShipment.title} />

      <PhotoPicker
        label={copy.newShipment.photoLabel}
        photos={photos}
        onChange={setPhotos}
        max={5}
      />

      <FormField
        label={copy.newShipment.senderName}
        value={senderName}
        onChangeText={setSenderName}
      />

      <FormField
        label={copy.newShipment.receiverName}
        value={receiverName}
        onChangeText={setReceiverName}
      />
      <FormField
        label={copy.newShipment.senderPhone}
        value={senderPhone}
        onChangeText={setSenderPhone}
        keyboardType="phone-pad"
        left={<TextInput.Affix text="+234" />}
      />

      <FormField
        label={copy.newShipment.receiverPhone}
        value={receiverPhone}
        onChangeText={setReceiverPhone}
        keyboardType="phone-pad"
        left={<TextInput.Affix text="+234" />}
      />

      <FormField
        label={copy.newShipment.description}
        value={description}
        onChangeText={setDescription}
        multiline
      />

      <FormField
        label={copy.newShipment.packageCount}
        value={numPackages}
        onChangeText={setNumPackages}
        keyboardType="number-pad"
      />

      {/* Origin Picker */}
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: colors.onSurface }]}>
          {copy.newShipment.origin}
        </Text>
        <Menu
          visible={originMenuOpen}
          onDismiss={() => setOriginMenuOpen(false)}
          anchor={
            <PrimaryButton
              variant="outline"
              onPress={() => setOriginMenuOpen(true)}
            >
              {originName}
            </PrimaryButton>
          }
        >
          {locations.map((loc) => (
            <Menu.Item
              key={loc.id}
              title={loc.name}
              onPress={() => {
                setOriginId(loc.id);
                setOriginMenuOpen(false);
              }}
            />
          ))}
        </Menu>
      </View>

      {/* Destination Picker */}
      <View style={{ gap: space.xs }}>
        <Text style={[type.label, { color: colors.onSurface }]}>
          {copy.newShipment.destination}
        </Text>
        <Menu
          visible={destMenuOpen}
          onDismiss={() => setDestMenuOpen(false)}
          anchor={
            <PrimaryButton
              variant="outline"
              onPress={() => setDestMenuOpen(true)}
            >
              {destName}
            </PrimaryButton>
          }
        >
          {locations.map((loc) => (
            <Menu.Item
              key={loc.id}
              title={loc.name}
              onPress={() => {
                setDestId(loc.id);
                setDestMenuOpen(false);
              }}
            />
          ))}
        </Menu>
      </View>

      {!!error && (
        <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
          {error}
        </HelperText>
      )}

      <PrimaryButton
        onPress={handleGenerateLabels}
        loading={isSubmitting}
        disabled={isSubmitting}
      >
        {copy.newShipment.generateLabels}
      </PrimaryButton>
    </Screen>
  );
}
