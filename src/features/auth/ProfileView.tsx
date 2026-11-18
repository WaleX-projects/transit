import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, useTheme } from 'react-native-paper';
import { dismissSyncIssue, getSyncIssues, OutboxItem } from '../../data/outbox';
import { runSyncCycle } from '../../data/sync';
import { copy } from '../../lib/copy';
import { useAuthStore } from '../../store/authStore';
import { useSyncStore } from '../../store/syncStore';
import { radius, space, type } from '../../tokens';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

export function ProfileView() {
  const router = useRouter();
  const { colors } = useTheme();
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const refreshCounts = useSyncStore((s) => s.refreshCounts);
  const userId = user?.id;
  const role = user?.role;
  const locationId = user?.location_id;

  const [issues, setIssues] = useState<OutboxItem[]>([]);

  const loadIssues = useCallback(async () => {
    const list = await getSyncIssues();
    setIssues(list);
    await refreshCounts();
  }, [refreshCounts]);

  useFocusEffect(
    useCallback(() => {
      loadIssues();
    }, [loadIssues])
  );

  async function handleDismiss(id: string) {
    await dismissSyncIssue(id);
    await loadIssues();
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }



  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!userId || !role) return;

    setRefreshing(true);

    try {
      // Later, fetch updated data here.

      await runSyncCycle({ userId, role, locationId: locationId ?? null });

    } finally {
      setRefreshing(false);
    }
  };


  return (
    <Screen
      refreshing={refreshing}
      onRefresh={handleRefresh}
    >
      {/* User Info Card */}
      <View
        style={{
          padding: space.md,
          backgroundColor: colors.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.outline,
          gap: space.xs,
        }}
      >
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {user?.name || 'Staff User'}
        </Text>
        <Text style={[type.body, { color: colors.onSurface }]}>
          {user?.phone}
        </Text>
        <Text style={[type.label, { color: colors.primary }]}>
          Role: {user?.role ? user.role.toUpperCase() : ''}
        </Text>
        {user?.location_name && (
          <Text style={[type.caption, { color: colors.onSurfaceVariant }]}>
            Office: {user.location_name}
          </Text>
        )}
      </View>

      {/* Sync Issues Section */}
      <View style={{ gap: space.sm }}>
        <Text style={[type.heading, { color: colors.onSurface }]}>
          {copy.sync.syncIssuesTitle(issues.length)}
        </Text>

        {issues.length === 0 ? (
          <Text style={[type.body, { color: colors.onSurfaceVariant }]}>
            {copy.sync.noIssues}
          </Text>
        ) : (
          issues.map((item) => {
            const reasonCopy =
              (item.reason && copy.reasons[item.reason]) ||
              copy.reasons.invalid_state;

            return (
              <View
                key={item.id}
                style={{
                  padding: space.md,
                  backgroundColor: colors.surface,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: colors.error,
                  gap: space.xs,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={[type.label, { color: colors.error }]}>
                    {item.type.toUpperCase()}
                  </Text>
                  <Button
                    mode="text"
                    textColor={colors.error}
                    onPress={() => handleDismiss(item.id)}
                  >
                    {copy.sync.dismiss}
                  </Button>
                </View>
                <Text style={[type.body, { color: colors.onSurface }]}>
                  {reasonCopy}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {/* Sign Out & Version */}
      <View style={{ gap: space.md, marginTop: space.lg }}>
        <PrimaryButton variant="outline" onPress={handleSignOut}>
          {copy.profile.signOut}
        </PrimaryButton>

        <Text style={[type.caption, { color: colors.onSurfaceVariant, textAlign: 'center' }]}>
          {copy.profile.version}
        </Text>
      </View>
    </Screen>
  );
}
