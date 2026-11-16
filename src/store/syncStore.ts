import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import { getPendingOutboxCount, getSyncIssues } from '../data/outbox';

interface SyncState {
  isOnline: boolean;
  pendingCount: number;
  syncIssuesCount: number;
  refreshCounts: () => Promise<void>;
  setIsOnline: (online: boolean) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  isOnline: true,
  pendingCount: 0,
  syncIssuesCount: 0,

  setIsOnline: (online: boolean) => set({ isOnline: online }),

  refreshCounts: async () => {
    try {
      const pendingCount = await getPendingOutboxCount();
      const issues = await getSyncIssues();
      set({ pendingCount, syncIssuesCount: issues.length });
    } catch {
      // Ignore count errors if DB initializing
    }
  },
}));

// Initialize NetInfo listener for sync store
NetInfo.addEventListener((state) => {
  useSyncStore.getState().setIsOnline(!!state.isConnected);
});
