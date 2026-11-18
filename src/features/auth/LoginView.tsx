import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import { copy } from '../../lib/copy';
import { toE164NG } from '../../lib/phone';
import { useAuthStore } from '../../store/authStore';
import { space, type } from '../../tokens';
import { FormField } from '../../ui/FormField';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

export function LoginView() {
  const { colors } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSignIn() {
    setLocalError(null);

    const fullPhone = toE164NG(phone);
    if (!fullPhone || pin.length < 6) {
      setLocalError(copy.auth.wrongCredentials);
      return;
    }

    const ok = await signIn(fullPhone, pin);
    if (!ok) {
      // read fresh state, not the stale value captured by this render
      setLocalError(useAuthStore.getState().error || copy.auth.wrongCredentials);
    }
  }

  const displayError = localError || storeError;

  return (
    <Screen>
      <View style={{ gap: space.xl, justifyContent: 'center', flex: 1 }}>
        <Text style={[type.title, { color: colors.primary }]}>{copy.companyName}</Text>

        <View style={{ gap: space.md }}>
          <FormField
            label={copy.auth.phoneLabel}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            left={<TextInput.Affix text={copy.auth.phonePrefix} />}
          />

          <FormField
            label={copy.auth.pinLabel}
            value={pin}
            onChangeText={(t: string) => setPin(t.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          {!!displayError && (
            <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
              {displayError}
            </HelperText>
          )}

          <PrimaryButton onPress={handleSignIn} loading={isLoading} disabled={isLoading}>
            {copy.auth.signInButton}
          </PrimaryButton>

          <View style={{ gap: space.xs }}>
            <Button mode="text" onPress={() => router.push('/passwordforget')}>
              Forgot your PIN? Reset it
            </Button>
            <Button mode="text" onPress={() => router.push('/signup')}>
              Don't have an account? Sign up
            </Button>
          </View>
        </View>
      </View>
    </Screen>
  );
}