import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { radius, size, space, type } from '../tokens';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

export function StatCard({ label, value, icon }: StatCardProps) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        flex: 1,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.outline,
        gap: space.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.label, { color: colors.onSurfaceVariant, flex: 1 }]}>
          {label}
        </Text>
        <MaterialCommunityIcons
          name={icon}
          size={size.icon}
          color={colors.primary}
        />
      </View>
      <Text style={[type.stat, { color: colors.onSurface }]}>{value}</Text>
    </View>
  );
}
