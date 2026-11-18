// features/scan/ScanHubView.tsx
import { useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { SegmentedButtons } from 'react-native-paper';
import { AppBar } from '../../ui/AppBar';
import { EmptyState } from '../../ui/EmptyState';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';
import { LoadPanel } from './DriverScanView';
import { ReceivePanel } from './ReceivePackageView';

type Mode = 'load' | 'receive';

export function ScanHubView() {
  const { mode: initialMode } = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(
    initialMode === 'receive' ? 'receive' : 'load'
  );
  const [permission, requestPermission] = useCameraPermissions();
 //if (!permission?.granted) {
  if (!true) {
    return (
      <Screen>
        <AppBar title="Load & Receive" />
        <EmptyState
          icon="camera-off"
          title="Camera permission needed"
          message="Camera access is required to scan package QR codes."
        />
        <PrimaryButton onPress={requestPermission}>Grant Permission</PrimaryButton>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar title="Load & Receive" />

      <SegmentedButtons
        value={mode}
        onValueChange={(v) => setMode(v as Mode)}
        buttons={[
          { value: 'load', label: 'Load', icon: 'truck-delivery' },
          { value: 'receive', label: 'Receive', icon: 'package-variant' },
        ]}
      />

      {mode === 'load' ? <LoadPanel /> : <ReceivePanel />}
    </Screen>
  );
}