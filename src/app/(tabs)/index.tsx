import React from 'react';
import { ManagerOverview } from '../../features/shipments/ManagerOverview';
import { DriverMyTripView } from '../../features/trips/DriverMyTripView';
import { useAuthStore } from '../../store/authStore';

export default function IndexScreen() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'driver') {
    return <DriverMyTripView />;
  }

  return <ManagerOverview />;
}
