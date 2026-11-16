import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { size, space, type } from '../tokens';

interface EmptyStateProps {
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  message?: string;
}

export function EmptyState({
  icon = 'package-variant',
  title,
  message,
}: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xl,
        gap: space.xs,
      }}
    >
      <MaterialCommunityIcons
        name={icon}
        size={size.iconLg}
        color={colors.onSurfaceVariant}
      />
      <Text style={[type.heading, { color: colors.onSurface, textAlign: 'center' }]}>
        {title}
      </Text>
      {!!message && (
        <Text style={[type.body, { color: colors.onSurfaceVariant, textAlign: 'center' }]}>
          {message}
        </Text>
      )}
    </View>
  );
}
