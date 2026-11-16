import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { statusColors } from '../theme';
import { radius, size, space, type } from '../tokens';

export interface MapPlace {
  name: string;
  lat: number;
  lng: number;
}

interface TrackingMapProps {
  origin: MapPlace;
  destination: MapPlace;
  driver?: { lat: number; lng: number } | null;
}

type Point = { x: number; y: number };

function Segment({ a, b, color }: { a: Point; b: Point; color: string }) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = Math.atan2(b.y - a.y, b.x - a.x);

  return (
    <View
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2,
        width: len,
        height: 1,
        backgroundColor: color,
        transform: [{ rotate: `${angle}rad` }],
      }}
    />
  );
}

export function TrackingMap({ origin, destination, driver }: TrackingMapProps) {
  const { colors } = useTheme();
  const [layout, setLayout] = useState({ w: 0, h: 0 });

  const pad = space.xl;
  const latMin = Math.min(origin.lat, destination.lat);
  const latMax = Math.max(origin.lat, destination.lat);
  const lngMin = Math.min(origin.lng, destination.lng);
  const lngMax = Math.max(origin.lng, destination.lng);

  const project = (p: { lat: number; lng: number }): Point => ({
    x: pad + ((p.lng - lngMin) / (lngMax - lngMin || 1)) * Math.max(layout.w - pad - pad, 0),
    y: pad + (1 - (p.lat - latMin) / (latMax - latMin || 1)) * Math.max(layout.h - pad - pad, 0),
  });

  const o = project(origin);
  const d = project(destination);
  const t = driver ? project(driver) : null;
  const isReady = layout.w > 0 && layout.h > 0;

  return (
    <View
      style={{
        height: size.scanFrame,
        backgroundColor: colors.surface,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.outline,
        overflow: 'hidden',
      }}
      onLayout={(e) =>
        setLayout({
          w: e.nativeEvent.layout.width,
          h: e.nativeEvent.layout.height,
        })
      }
    >
      {isReady && (
        <>
          <Segment a={o} b={d} color={colors.outline} />
          {t && <Segment a={o} b={t} color={colors.primary} />}

          {/* Origin Marker */}
          <View
            style={{
              position: 'absolute',
              left: o.x - space.sm,
              top: o.y - space.sm,
              width: space.md,
              height: space.md,
              borderRadius: radius.pill,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.primary,
            }}
          />
          <Text
            style={[
              type.caption,
              {
                position: 'absolute',
                left: o.x - size.iconLg,
                top: o.y + space.sm,
                width: size.photoBox,
                color: colors.onSurface,
              },
            ]}
          >
            {origin.name}
          </Text>

          {/* Destination Marker */}
          <View
            style={{
              position: 'absolute',
              left: d.x - space.md,
              top: d.y - size.iconLg,
            }}
          >
            <MaterialCommunityIcons
              name="map-marker"
              size={size.iconLg}
              color={statusColors.issue}
            />
          </View>
          <Text
            style={[
              type.caption,
              {
                position: 'absolute',
                left: d.x - size.iconLg,
                top: d.y + space.xs,
                width: size.photoBox,
                color: colors.onSurface,
              },
            ]}
          >
            {destination.name}
          </Text>

          {/* Driver Marker */}
          {t && (
            <View
              style={{
                position: 'absolute',
                left: t.x - space.md,
                top: t.y - space.md,
                width: size.iconLg,
                height: size.iconLg,
                borderRadius: radius.pill,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons
                name="truck"
                size={size.icon}
                color={colors.onPrimary}
              />
            </View>
          )}
        </>
      )}
    </View>
  );
}
