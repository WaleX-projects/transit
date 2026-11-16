import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ShipmentDetailView } from '../../../features/shipments/ShipmentDetailView';

export default function ShipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return <ShipmentDetailView shipmentId={id} />;
}
