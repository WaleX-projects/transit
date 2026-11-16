import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { radius, space, type } from '../tokens';
import { StatusChip } from './StatusChip';

export interface ShipmentListItem {
  id: string;
  waybill_no: string;
  receiver_name: string;
  origin_name: string;
  destination_name: string;
  status: string;
}

interface ShipmentRowProps {
  shipment: ShipmentListItem;
}

export function ShipmentRow({ shipment }: ShipmentRowProps) {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={() => router.push(`/shipment/${shipment.id}`)}
      style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
    >
      <View
        style={{
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.outline,
          gap: space.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[type.heading, { color: colors.onSurface }]}>
            {shipment.waybill_no}
          </Text>
          <StatusChip status={shipment.status} />
        </View>

        <Text style={[type.body, { color: colors.onSurface }]}>
          {shipment.receiver_name}
        </Text>

        <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
          {shipment.origin_name} → {shipment.destination_name}
        </Text>
      </View>
    </Pressable>
  );
}
