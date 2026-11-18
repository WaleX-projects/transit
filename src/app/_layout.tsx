
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';

import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaView } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { useAuthStore } from '../store/authStore';
import { theme } from '../theme';
import { SyncBar } from '../ui/SyncBar';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
  });

  // Restore the existing authentication session on startup.
  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Handle authentication-based navigation.
  useEffect(() => {
    if (isLoading || !fontsLoaded) return;

    const currentRoute = segments[0];

    const isAuthRoute =
      currentRoute === 'login' ||
      currentRoute === 'signup' || currentRoute === 'passwordforget';

    const isIndexRoute =
      !currentRoute || currentRoute === '/index';

    if (!user && !isAuthRoute) {
      router.replace('/login');
      return;
    }

    if (user && (isAuthRoute || isIndexRoute)) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, fontsLoaded, segments, router]);

  if (!fontsLoaded || isLoading) return null;

  return (
    <PaperProvider theme={theme}>
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: theme.colors.background,
        }}
      >
        <StatusBar style="dark" />
        <SyncBar />

        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="index" />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="passwordforget" />
          <Stack.Screen name="shipment/new" />
          <Stack.Screen name="shipment/[id]/index" />
          <Stack.Screen name="shipment/[id]/labels" />
          <Stack.Screen name="shipment/[id]/collect" />
          <Stack.Screen name="trip/[id]" />
        </Stack>
      </SafeAreaView>
    </PaperProvider>
  );
}
