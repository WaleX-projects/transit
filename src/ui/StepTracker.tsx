import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { radius, size, space, type } from '../tokens';

const STEPS = [
  { key: 'registered', label: 'Received' },
  { key: 'loaded', label: 'Loaded' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'delivered', label: 'Delivered' },
];

interface StepTrackerProps {
  currentStatus: string;
}

export function StepTracker({ currentStatus }: StepTrackerProps) {
  const { colors } = useTheme();

  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);
  const activeIdx = currentIndex >= 0 ? currentIndex : 0;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingVertical: space.sm,
      }}
    >
      {STEPS.map((s, i) => {
        const isDone = i < activeIdx;
        const isActive = i === activeIdx;

        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center' }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                width: '100%',
              }}
            >
              <View
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: i === 0 ? 'transparent' : isDone || isActive ? colors.primary : colors.outline,
                }}
              />
              <View
                style={{
                  width: size.stepDot,
                  height: size.stepDot,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDone || isActive ? colors.primary : colors.surface,
                  borderWidth: isDone || isActive ? 0 : 1,
                  borderColor: colors.outline,
                }}
              >
                {isDone ? (
                  <MaterialCommunityIcons
                    name="check"
                    size={space.md}
                    color={colors.onPrimary}
                  />
                ) : isActive ? (
                  <View
                    style={{
                      width: space.sm,
                      height: space.sm,
                      borderRadius: radius.pill,
                      backgroundColor: colors.onPrimary,
                    }}
                  />
                ) : null}
              </View>
              <View
                style={{
                  flex: 1,
                  height: 1,
                  backgroundColor: i === STEPS.length - 1 ? 'transparent' : isDone ? colors.primary : colors.outline,
                }}
              />
            </View>

            <Text
              style={[
                type.caption,
                {
                  marginTop: space.xs,
                  textAlign: 'center',
                  color: isActive ? colors.primary : colors.onSurfaceVariant,
                },
              ]}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
