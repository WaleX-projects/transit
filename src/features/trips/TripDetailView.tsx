import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { useAuthStore } from '../../store/authStore';
import { radius, space, type } from '../../tokens';
import { AppBar } from '../../ui/AppBar';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StatusChip } from '../../ui/StatusChip';
import { TrackingMap } from '../../ui/TrackingMap';
import { fetchTripDetail, TripDetailData } from './tripsQueries';

interface Props {
  tripId: string;
}

export function TripDetailView({ tripId }: Props) {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [trip, setTrip] = useState<TripDetailData | null>(null);

  const loadTrip = useCallback(() => {
    fetchTripDetail(tripId).then(setTrip);
  }, [tripId]);

  useFocusEffect(
    useCallback(() => {
      loadTrip();
    }, [loadTrip])
  );

  if (!trip) return null;

  const canConfirmLoading = user?.role === 'manager' && trip.status === 'loading';
  const canReceive =
    user?.role === 'manager' &&
    trip.status === 'arrived' &&
    user.location_id === trip.destination_id;

  async function handleConfirmLoading() {
    if (!user || !trip) return;
    await enqueueCommand(
      'confirm_loading',
      { trip_id: trip.id },
      {
        userId: user.id,
        role: user.role,
        locationId: user.location_id,
      }
    );
    loadTrip();
  }

  const driverCoords =
    trip.last_lat && trip.last_lng
      ? { lat: trip.last_lat, lng: trip.last_lng }
      : { lat: trip.origin_lat, lng: trip.origin_lng };

  return (
    <Screen>
      <AppBar title={trip.plate} />

      {/* Schematic Map */}
      <TrackingMap
        origin={{
          name: trip.origin_name,
          lat: trip.origin_lat,
          lng: trip.origin_lng,
        }}
        destination={{
          name: trip.destination_name,
          lat: trip.destination_lat,
          lng: trip.destination_lng,
        }}
        driver={driverCoords}
      />

      {/* Info Card */}
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.title, { color: colors.onSurface }]}>{trip.plate}</Text>
          <StatusChip status={trip.status} />
        </View>

        <Text style={[type.body, { color: colors.onSurface }]}>
          {trip.origin_name} → {trip.destination_name}
        </Text>

        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
          Driver: {trip.driver_name}
        </Text>

        <Text style={[type.label, { color: colors.primary, marginTop: space.sm }]}>
          {copy.shipmentDetail.packagesOnBoard(trip.packagesOnBoard)}
        </Text>
      </View>

      {/* Action Buttons */}
      <View style={{ gap: space.sm }}>
        {canConfirmLoading && (
          <PrimaryButton onPress={handleConfirmLoading}>
            {copy.tripsScreen.confirmLoading}
          </PrimaryButton>
        )}

        {canReceive && (
          <PrimaryButton onPress={() => router.push('/(tabs)/scan')}>
            {copy.tripsScreen.receivePackages}
          </PrimaryButton>
        )}
      </View>
    </Screen>
  );
}
