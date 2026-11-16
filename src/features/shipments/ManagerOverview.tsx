import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import { copy } from '../../lib/copy';
import { formatDateTime, formatMinutesAgo, getGreeting } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';
import { statusColors } from '../../theme';
import { radius, size, space, type } from '../../tokens';
import { AlertBanner } from '../../ui/AlertBanner';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { StatCard } from '../../ui/StatCard';
import {
  ActiveTripOnRoad,
  fetchOverviewData,
  OverviewStats,
  ReadyCollectionItem,
} from './shipmentsQueries';

export function ManagerOverview() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);

  const [stats, setStats] = useState<OverviewStats>({
    shipmentsToday: 0,
    packagesToday: 0,
    inTransit: 0,
    deliveredToday: 0,
    issuesCount: 0,
  });
  const [readyItems, setReadyItems] = useState<ReadyCollectionItem[]>([]);
  const [tripsOnRoad, setTripsOnRoad] = useState<ActiveTripOnRoad[]>([]);

  const loadData = useCallback(() => {
    fetchOverviewData().then((data) => {
      setStats(data.stats);
      setReadyItems(data.readyForCollection);
      setTripsOnRoad(data.tripsOnRoad);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const firstName = user?.name ? user.name.split(' ')[0] : 'Manager';
  const greeting = `${getGreeting()}, ${firstName}`;
  const dateLine = formatDateTime(new Date().toISOString());

  return (
    <Screen>
      {/* Header */}
      <View style={{ gap: space.xs }}>
        <Text style={[type.title, { color: colors.onSurface }]}>{greeting}</Text>
        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>{dateLine}</Text>
      </View>

      {/* New Shipment Button - Orange Only */}
      <PrimaryButton
        variant="orange"
        icon="plus"
        onPress={() => router.push('/shipment/new')}
      >
        {copy.manager.newShipment}
      </PrimaryButton>

      {/* Issues Banner */}
      {stats.issuesCount > 0 && (
        <AlertBanner
          message={copy.manager.issuesAlert(stats.issuesCount)}
          onPress={() => router.push('/(tabs)/shipments')}
        />
      )}

      {/* 2x2 Stat Cards */}
      <View style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <StatCard
            label={copy.manager.shipmentsToday}
            value={stats.shipmentsToday}
            icon="package-variant-closed"
          />
          <StatCard
            label={copy.manager.packagesToday}
            value={stats.packagesToday}
            icon="cube-outline"
          />
        </View>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <StatCard
            label={copy.manager.inTransit}
            value={stats.inTransit}
            icon="truck-fast"
          />
          <StatCard
            label={copy.manager.deliveredToday}
            value={stats.deliveredToday}
            icon="check-circle"
          />
        </View>
      </View>

      {/* Ready for Collection Section */}
      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.manager.readyForCollection}
        </Text>

        {readyItems.length === 0 ? (
          <EmptyState
            icon="package-variant"
            title="No goods awaiting pickup"
            message="Items arrived at this office will be listed here."
          />
        ) : (
          readyItems.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/shipment/${item.id}`)}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
            >
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: space.md,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.outline,
                  borderRadius: radius.md,
                }}
              >
                <View style={{ gap: space.xs, flex: 1 }}>
                  <Text style={[type.heading, { color: colors.onSurface }]}>
                    {item.waybill_no}
                  </Text>
                  <Text style={[type.body, { color: colors.onSurface }]}>
                    {item.receiver_name}
                  </Text>
                  <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                    {copy.manager.waitingDays(item.waitingDays)}
                  </Text>
                </View>

                <IconButton
                  icon="phone"
                  size={size.icon}
                  iconColor={colors.primary}
                  onPress={() => Linking.openURL(`tel:${item.receiver_phone}`)}
                />
              </View>
            </Pressable>
          ))
        )}
      </View>

      {/* Trips on the Road Section */}
      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.manager.tripsOnTheRoad}
        </Text>

        {tripsOnRoad.length === 0 ? (
          <EmptyState
            icon="truck-fast"
            title="No active trips"
            message="Trips currently in transit will appear here."
          />
        ) : (
          tripsOnRoad.map((trip) => {
            const minAgo = formatMinutesAgo(trip.last_ping_at);
            const timeColor = minAgo > 1 ? statusColors.in_transit : colors.onSurfaceVariant;

            return (
              <Pressable
                key={trip.id}
                onPress={() => router.push(`/trip/${trip.id}`)}
                style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
              >
                <View
                  style={{
                    padding: space.md,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.outline,
                    borderRadius: radius.md,
                    gap: space.xs,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={[type.heading, { color: colors.onSurface }]}>
                      {trip.plate}
                    </Text>
                    <Text style={[type.caption, { color: timeColor }]}>
                      {copy.manager.lastSeenMinAgo(minAgo)}
                    </Text>
                  </View>

                  <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
                    {trip.origin_name} → {trip.destination_name}
                  </Text>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </Screen>
  );
}
