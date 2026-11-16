import { View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { copy } from '../lib/copy';
import { useSyncStore } from '../store/syncStore';
import { statusColors } from '../theme';
import { radius, space, type } from '../tokens';

export function SyncBar() {
  const { colors } = useTheme();
  const isOnline = useSyncStore((s) => s.isOnline);
  const pendingCount = useSyncStore((s) => s.pendingCount);

  let statusText = copy.sync.synced;
  let dotColor = statusColors.delivered;

  if (!isOnline) {
    statusText = copy.sync.offline;
    dotColor = colors.error;
  } else if (pendingCount > 0) {
    statusText = copy.sync.waitingToSync(pendingCount);
    dotColor = statusColors.in_transit;
  }

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.xs,
        paddingHorizontal: space.md,
        paddingVertical: space.xs,
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderColor: colors.outline,
        marginTop:40,
      }}
    >
      <View
        style={{
          width: space.sm,
          height: space.sm,
          borderRadius: radius.pill,
          backgroundColor: dotColor,
        }}
      />
      <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
        {statusText}
      </Text>
    </View>
  );
}
