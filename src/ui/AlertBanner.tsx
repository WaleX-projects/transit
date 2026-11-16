import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { radius, size, space, type } from '../tokens';

interface AlertBannerProps {
  message: string;
  onPress?: () => void;
}

export function AlertBanner({ message, onPress }: AlertBannerProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [{ opacity: pressed && onPress ? 0.7 : 1 }]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          padding: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.error,
        }}
      >
        <MaterialCommunityIcons
          name="alert-circle"
          size={size.icon}
          color={colors.error}
        />
        <Text style={[type.label, { color: colors.error, flex: 1 }]}>{message}</Text>
        {!!onPress && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={size.icon}
            color={colors.error}
          />
        )}
      </View>
    </Pressable>
  );
}
