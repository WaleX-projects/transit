import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { copy } from '../../lib/copy';
import { radius, space, type } from '../../tokens';
import { EmptyState } from '../../ui/EmptyState';
import { FormField } from '../../ui/FormField';
import { Screen } from '../../ui/Screen';
import { ShipmentListItem, ShipmentRow } from '../../ui/ShipmentRow';
import { fetchShipmentList } from './shipmentsQueries';

export function ShipmentsList() {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');
  const [activeChip, setActiveChip] = useState('All');
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);

  const loadShipments = useCallback(() => {
    fetchShipmentList(search, activeChip).then(setShipments);
  }, [search, activeChip]);

  useFocusEffect(
    useCallback(() => {
      loadShipments();
    }, [loadShipments])
  );

  return (
    <Screen>
      <FormField
        placeholder={copy.manager.searchPlaceholder}
        value={search}
        onChangeText={(val) => {
          setSearch(val);
        }}
        left={{ type: 'icon', iconName: 'magnify' } as never}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.xs }}>
        {copy.manager.chips.map((chip) => {
          const isSelected = activeChip === chip;
          return (
            <Pressable
              key={chip}
              onPress={() => setActiveChip(chip)}
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
                  {chip}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {shipments.length === 0 ? (
        <EmptyState
          title={copy.empty.noData}
          message={copy.empty.noDataSubtitle}
        />
      ) : (
        <View style={{ gap: space.sm }}>
          {shipments.map((s) => (
            <ShipmentRow key={s.id} shipment={s} />
          ))}
        </View>
      )}
    </Screen>
  );
}
