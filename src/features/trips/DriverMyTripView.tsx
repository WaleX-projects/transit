import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { getScanGps, startTripTracking, stopTripTracking } from '../../data/location';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { formatElapsedTime } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';
import { radius, space, type } from '../../tokens';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StatusChip } from '../../ui/StatusChip';
import { TrackingMap } from '../../ui/TrackingMap';
import { DriverTripData, fetchDriverActiveTrip } from './tripsQueries';

export function DriverMyTripView() {
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [tripData, setTripData] = useState<DriverTripData | null>(null);
  const [hasLocationPerm, setHasLocationPerm] = useState(true);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [arriveDialogOpen, setArriveDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isArriving, setIsArriving] = useState(false);

  const loadTrip = useCallback(async () => {
    if (!user) return;
    const res = await fetchDriverActiveTrip(user.id);
    setTripData(res);

    const perm = await Location.getForegroundPermissionsAsync().catch(() => ({ status: 'granted' }));
    setHasLocationPerm(perm.status === 'granted');
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      loadTrip();
    }, [loadTrip])
  );

  // Timer for elapsed time
  useEffect(() => {
    if (!tripData?.trip.started_at || tripData.trip.status !== 'in_transit') return;

    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(tripData.trip.started_at));
    }, 1000);

    return () => clearInterval(interval);
  }, [tripData?.trip.started_at, tripData?.trip.status]);

  if (!tripData) {
    return (
      <Screen>
        <EmptyState
          icon="steering"
          title={copy.driver.noTrip}
          message={copy.driver.noTripSubtitle}
        />
      </Screen>
    );
  }

  const { trip, loadedCount, expectedCount } = tripData;
  const isLoading = trip.status === 'loading';
  const isInTransit = trip.status === 'in_transit';
  const canStart = isLoading && loadedCount > 0;

  async function handleStartTrip() {
    if (!user || !trip) return;
    setIsStarting(true);
    try {
      await enqueueCommand(
        'start_trip',
        { trip_id: trip.id },
        {
          userId: user.id,
          role: user.role,
          locationId: user.location_id,
        }
      );
      await startTripTracking(trip.id);
      await loadTrip();
    } finally {
      setIsStarting(false);
    }
  }

  async function handleArriveTrip() {
    setArriveDialogOpen(false);
    if (!user || !trip) return;
    setIsArriving(true);
    try {
      const gps = await getScanGps();
      await enqueueCommand(
        'arrive_trip',
        {
          trip_id: trip.id,
          lat: gps?.lat ?? null,
          lng: gps?.lng ?? null,
        },
        {
          userId: user.id,
          role: user.role,
          locationId: user.location_id,
        }
      );
      await stopTripTracking();
      await loadTrip();
    } finally {
      setIsArriving(false);
    }
  }

  const driverCoords =
    trip.last_lat && trip.last_lng
      ? { lat: trip.last_lat, lng: trip.last_lng }
      : { lat: trip.origin_lat, lng: trip.origin_lng };

  return (
    <Screen>
      {/* Location Denied Warning */}
      {!hasLocationPerm && (
        <View
          style={{
            padding: space.md,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.error,
            gap: space.sm,
          }}
        >
          <Text style={[type.label, { color: colors.error }]}>
            {copy.driver.locationNeeded}
          </Text>
          <PrimaryButton variant="outline" onPress={() => Linking.openSettings()}>
            {copy.driver.openSettings}
          </PrimaryButton>
        </View>
      )}

      {/* Background tracking note */}
      <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
        {copy.driver.backgroundTrackingNotice}
      </Text>

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

      {/* Trip Card */}
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={[type.title, { color: colors.onSurface }]}>{trip.plate}</Text>
          <StatusChip status={trip.status} />
        </View>

        <Text style={[type.body, { color: colors.onSurface }]}>
          {trip.origin_name} → {trip.destination_name}
        </Text>

        <Text style={[type.heading, { color: colors.primary }]}>
          {copy.driver.loadedOfExpected(loadedCount, expectedCount)}
        </Text>

        {isInTransit && (
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            Trip Duration: {elapsed}
          </Text>
        )}
      </View>

      {/* Action Buttons */}
      <View style={{ gap: space.sm }}>
        {isLoading && (
          <PrimaryButton
            onPress={handleStartTrip}
            loading={isStarting}
            disabled={!canStart || isStarting}
          >
            {copy.driver.startTrip}
          </PrimaryButton>
        )}

        {isInTransit && (
          <PrimaryButton
            onPress={() => setArriveDialogOpen(true)}
            loading={isArriving}
            disabled={isArriving}
          >
            {copy.driver.haveArrived}
          </PrimaryButton>
        )}
      </View>

      {/* Arrival Confirmation Dialog */}
      <Portal>
        <Dialog visible={arriveDialogOpen} onDismiss={() => setArriveDialogOpen(false)}>
          <Dialog.Title>{copy.driver.confirmArrivalTitle}</Dialog.Title>
          <Dialog.Actions>
            <Button onPress={() => setArriveDialogOpen(false)}>
              {copy.driver.cancel}
            </Button>
            <Button onPress={handleArriveTrip}>
              {copy.driver.yesArrived}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
