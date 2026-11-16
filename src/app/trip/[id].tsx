import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { TripDetailView } from '../../features/trips/TripDetailView';

export default function TripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return <TripDetailView tripId={id} />;
}
