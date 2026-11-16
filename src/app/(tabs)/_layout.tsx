import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuthStore } from '../../store/authStore';
import { theme } from '../../theme';
import { size } from '../../tokens';

export default function TabsLayout() {
  const user = useAuthStore((s) => s.user);
  const isDriver = user?.role === 'driver';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
          borderTopWidth: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: isDriver ? 'My trip' : 'Overview',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name={isDriver ? 'steering' : 'view-dashboard'}
              size={size.icon}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="shipments"
        options={{
          title: 'Shipments',
          href: isDriver ? null : '/shipments',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name="package-variant-closed"
              size={size.icon}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          href: isDriver ? null : '/trips',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name="truck-fast"
              size={size.icon}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="scan"
        options={{
          title: 'Scan',
          href:'/scan' ,
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name="qrcode-scan"
              size={size.icon}
              color={color}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name="account"
              size={size.icon}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
