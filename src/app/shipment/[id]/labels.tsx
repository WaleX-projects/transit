import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { LabelsView } from '../../../features/shipments/LabelsView';

export default function LabelsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return <LabelsView shipmentId={id} />;
}
