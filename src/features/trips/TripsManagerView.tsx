import * as Crypto from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { HelperText, Menu, Text, useTheme } from 'react-native-paper';
import { enqueueCommand } from '../../data/outbox';
import { copy } from '../../lib/copy';
import { useAuthStore } from '../../store/authStore';
import { radius, space, type } from '../../tokens';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StatusChip } from '../../ui/StatusChip';
import { fetchLocations } from '../shipments/shipmentsQueries';
import {
  fetchDrivers,
  fetchTripsList,
  fetchVehicles,
  TripListItem,
} from './tripsQueries';

export function TripsManagerView() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [vehicles, setVehicles] = useState<Array<{ id: string; plate: string; model: string | null }>>([]);
  const [drivers, setDrivers] = useState<Array<{ id: string; name: string; phone: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);

  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [selectedDriver, setSelectedDriver] = useState('');
  const [selectedOrigin, setSelectedOrigin] = useState('');
  const [selectedDest, setSelectedDest] = useState('');

  const [vehicleMenuOpen, setVehicleMenuOpen] = useState(false);
  const [driverMenuOpen, setDriverMenuOpen] = useState(false);
  const [originMenuOpen, setOriginMenuOpen] = useState(false);
  const [destMenuOpen, setDestMenuOpen] = useState(false);

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [tList, vList, dList, lList] = await Promise.all([
      fetchTripsList(),
      fetchVehicles(),
      fetchDrivers(),
      fetchLocations(),
    ]);

    setTrips(tList);
    setVehicles(vList);
    setDrivers(dList);
    setLocations(lList);

    if (vList.length > 0 && !selectedVehicle) setSelectedVehicle(vList[0].id);
    if (dList.length > 0 && !selectedDriver) setSelectedDriver(dList[0].id);
    if (lList.length > 0) {
      if (!selectedOrigin) {
        const defOrigin = lList.find((l) => l.id === user?.location_id) || lList[0];
        setSelectedOrigin(defOrigin.id);
        const defDest = lList.find((l) => l.id !== defOrigin.id);
        if (defDest && !selectedDest) setSelectedDest(defDest.id);
      }
    }
  }, [user, selectedVehicle, selectedDriver, selectedOrigin, selectedDest]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  async function handleCreateTrip() {
    setError(null);
    if (!selectedVehicle || !selectedDriver || !selectedOrigin || !selectedDest) {
      setError('Please select all trip fields.');
      return;
    }

    if (selectedOrigin === selectedDest) {
      setError('Origin and destination must be different.');
      return;
    }

    if (!user) return;
    setIsCreating(true);

    try {
      const tripId = Crypto.randomUUID();
      await enqueueCommand(
        'create_trip',
        {
          trip_id: tripId,
          vehicle_id: selectedVehicle,
          driver_id: selectedDriver,
          origin_id: selectedOrigin,
          destination_id: selectedDest,
        },
        {
          userId: user.id,
          role: user.role,
          locationId: user.location_id,
        }
      );
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'invalid_state';
      setError(copy.reasons[msg] || 'Could not create trip.');
    } finally {
      setIsCreating(false);
    }
  }

  const vehiclePlate = vehicles.find((v) => v.id === selectedVehicle)?.plate || 'Select Vehicle';
  const driverName = drivers.find((d) => d.id === selectedDriver)?.name || 'Select Driver';
  const originName = locations.find((l) => l.id === selectedOrigin)?.name || 'Select Origin';
  const destName = locations.find((l) => l.id === selectedDest)?.name || 'Select Destination';

  return (
    <Screen>
      {/* New Trip Card */}
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
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.tripsScreen.newTrip}
        </Text>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            {copy.tripsScreen.vehicle}
          </Text>
          <Menu
            visible={vehicleMenuOpen}
            onDismiss={() => setVehicleMenuOpen(false)}
            anchor={
              <PrimaryButton variant="outline" onPress={() => setVehicleMenuOpen(true)}>
                {vehiclePlate}
              </PrimaryButton>
            }
          >
            {vehicles.map((v) => (
              <Menu.Item
                key={v.id}
                title={`${v.plate} ${v.model ? '(' + v.model + ')' : ''}`}
                onPress={() => {
                  setSelectedVehicle(v.id);
                  setVehicleMenuOpen(false);
                }}
              />
            ))}
          </Menu>
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            {copy.tripsScreen.driver}
          </Text>
          <Menu
            visible={driverMenuOpen}
            onDismiss={() => setDriverMenuOpen(false)}
            anchor={
              <PrimaryButton variant="outline" onPress={() => setDriverMenuOpen(true)}>
                {driverName}
              </PrimaryButton>
            }
          >
            {drivers.map((d) => (
              <Menu.Item
                key={d.id}
                title={`${d.name} (${d.phone})`}
                onPress={() => {
                  setSelectedDriver(d.id);
                  setDriverMenuOpen(false);
                }}
              />
            ))}
          </Menu>
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            {copy.tripsScreen.origin}
          </Text>
          <Menu
            visible={originMenuOpen}
            onDismiss={() => setOriginMenuOpen(false)}
            anchor={
              <PrimaryButton variant="outline" onPress={() => setOriginMenuOpen(true)}>
                {originName}
              </PrimaryButton>
            }
          >
            {locations.map((l) => (
              <Menu.Item
                key={l.id}
                title={l.name}
                onPress={() => {
                  setSelectedOrigin(l.id);
                  setOriginMenuOpen(false);
                }}
              />
            ))}
          </Menu>
        </View>

        <View style={{ gap: space.xs }}>
          <Text style={[type.label, { color: colors.onSurfaceVariant }]}>
            {copy.tripsScreen.destination}
          </Text>
          <Menu
            visible={destMenuOpen}
            onDismiss={() => setDestMenuOpen(false)}
            anchor={
              <PrimaryButton variant="outline" onPress={() => setDestMenuOpen(true)}>
                {destName}
              </PrimaryButton>
            }
          >
            {locations.map((l) => (
              <Menu.Item
                key={l.id}
                title={l.name}
                onPress={() => {
                  setSelectedDest(l.id);
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

        <PrimaryButton onPress={handleCreateTrip} loading={isCreating} disabled={isCreating}>
          {copy.tripsScreen.createTrip}
        </PrimaryButton>
      </View>

      {/* Trips List */}
      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>All Trips</Text>

        {trips.length === 0 ? (
          <EmptyState
            icon="truck-fast"
            title={copy.tripsScreen.noTrips}
            message={copy.tripsScreen.noTripsSubtitle}
          />
        ) : (
          trips.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => router.push(`/trip/${t.id}`)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
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
                  <Text style={[type.heading, { color: colors.onSurface }]}>
                    {t.plate}
                  </Text>
                  <StatusChip status={t.status} />
                </View>

                <Text style={[type.body, { color: colors.onSurface }]}>
                  {t.origin_name} → {t.destination_name}
                </Text>

                <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                  Driver: {t.driver_name}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}
