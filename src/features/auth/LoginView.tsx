
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { HelperText, Text, TextInput, useTheme } from 'react-native-paper';
import { copy } from '../../lib/copy';
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

    if (!phone || !pin) {
      setLocalError(copy.auth.wrongCredentials);
      return;
    }

    const fullPhone = phone.startsWith('+234')
      ? phone
      : phone.startsWith('0')
        ? `+234${phone.slice(1)}`
        : `+234${phone}`;

    const ok = await signIn(fullPhone, pin);

    if (!ok) {
      setLocalError(storeError || copy.auth.wrongCredentials);
    }
  }

  const displayError = localError || storeError;

  return (
    <Screen>
      <View style={{ gap: space.xl, justifyContent: 'center', flex: 1 }}>
        <View style={{ gap: space.xs }}>
          <Text style={[type.title, { color: colors.primary }]}>
            {copy.companyName}
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <FormField
            label={copy.auth.phoneLabel}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            left={<TextInput.Affix text={copy.auth.phonePrefix} />}
            autoCapitalize="none"
          />

          <FormField
            label={copy.auth.pinLabel}
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          {!!displayError && (
            <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
              {displayError}
            </HelperText>
          )}

          <PrimaryButton
            onPress={handleSignIn}
            loading={isLoading}
            disabled={isLoading}
          >
            {copy.auth.signInButton}
          </PrimaryButton>

          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
          

<Pressable onPress={() => router.push('/signup')}>
  <Text style={{ color: colors.primary, textAlign: 'center' }}>
    Don't have an account? Sign up
  </Text>
</Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}
