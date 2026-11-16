import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import React, { useRef, useState } from 'react';
import { GestureResponderEvent, View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import Svg, { Path } from 'react-native-svg';
import { copy } from '../lib/copy';
import { radius, size, space, type } from '../tokens';

interface Point {
  x: number;
  y: number;
}

interface SignaturePadProps {
  onSignatureChange: (uri: string | null) => void;
}

export function SignaturePad({ onSignatureChange }: SignaturePadProps) {
  const { colors } = useTheme();
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef<Point[]>([]);

  function pointsToSvgPath(pts: Point[]): string {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i].x} ${pts[i].y}`;
    }
    return d;
  }

  function handleTouchStart(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current = [{ x: locationX, y: locationY }];
  }

  function handleTouchMove(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    currentPath.current.push({ x: locationX, y: locationY });
    const d = pointsToSvgPath(currentPath.current);
    setPaths((prev) => [...prev.slice(0, -1), d]);
  }

  async function handleTouchEnd() {
    if (currentPath.current.length > 0) {
      const d = pointsToSvgPath(currentPath.current);
      const newPaths = [...paths, d];
      setPaths(newPaths);
      currentPath.current = [];

      // Save SVG locally to a file
      const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><path d="${newPaths.join(' ')}" stroke="black" stroke-width="2" fill="none"/></svg>`;
      const fileName = `sig_${Crypto.randomUUID()}.png`;
      const fileUri = `${FileSystem.documentDirectory || ''}${fileName}`;

      try {
        await FileSystem.writeAsStringAsync(fileUri, svgContent, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        onSignatureChange(fileUri);
      } catch {
        onSignatureChange(fileUri);
      }
    }
  }

  function handleClear() {
    setPaths([]);
    currentPath.current = [];
    onSignatureChange(null);
  }

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[type.label, { color: colors.onSurface }]}>
          {copy.collection.signatureLabel}
        </Text>
        <Button mode="text" onPress={handleClear} textColor={colors.primary}>
          {copy.collection.clearSignature}
        </Button>
      </View>

      <View
        style={{
          height: size.signature,
          borderWidth: 1,
          borderColor: colors.outline,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouchStart}
        onResponderMove={handleTouchMove}
        onResponderRelease={handleTouchEnd}
      >
        <Svg style={{ flex: 1 }}>
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke={colors.onSurface}
              strokeWidth={1}
              fill="none"
            />
          ))}
        </Svg>
      </View>
    </View>
  );
}
