import React from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { copy } from '../lib/copy';
import { statusColors } from '../theme';
import { radius, space, type } from '../tokens';

export type ShipmentStatusType =
  | 'registered'
  | 'loaded'
  | 'in_transit'
  | 'arrived'
  | 'delivered'
  | 'issue'
  | 'cancelled';

interface StatusChipProps {
  status: ShipmentStatusType | string;
}

export function StatusChip({ status }: StatusChipProps) {
  const { colors } = useTheme();

  const normalizedStatus = (status in statusColors ? status : 'received') as keyof typeof statusColors;
  const dotColor = statusColors[normalizedStatus] || colors.onSurfaceVariant;
  const labelText = copy.statuses[normalizedStatus as keyof typeof copy.statuses] || status;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.outline,
        backgroundColor: colors.surface,
        alignSelf: 'flex-start',
      }}
    >
      <View
        style={{
          width: space.sm,
          height: space.sm,
          borderRadius: radius.pill,
          backgroundColor: dotColor,
        }}
      />
      <Text style={[type.caption, { color: colors.onSurface }]}>{labelText}</Text>
    </View>
  );
}
