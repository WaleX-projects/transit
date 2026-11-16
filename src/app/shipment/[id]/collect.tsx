import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { CollectionView } from '../../../features/collection/CollectionView';

export default function CollectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) return null;

  return <CollectionView shipmentId={id} />;
}
