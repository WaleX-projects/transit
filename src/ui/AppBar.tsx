import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import { size, space, type } from '../tokens';

interface AppBarProps {
  title: string;
}

export function AppBar({ title }: AppBarProps) {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
      <IconButton
        icon="arrow-left"
        size={size.icon}
        accessibilityLabel="Go back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <Text style={[type.heading, { color: colors.onSurface }]}>{title}</Text>
    </View>
  );
}
