import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Button,
  HelperText,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { toE164NG } from '../../lib/phone';
import { useAuthStore } from '../../store/authStore';
import { space, type } from '../../tokens';
import { FormField } from '../../ui/FormField';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

type UserRole = 'manager' | 'officer';

const digitsOnly = (t: string) => t.replace(/\D/g, '').slice(0, 6);

export function SignupView() {
  const { colors } = useTheme();

  const signUp = useAuthStore((s) => s.signUp);
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [role, setRole] = useState<UserRole>('officer');
  const [locationId, setLocationId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  // clear any error left over from the login screen
  useEffect(() => {
    useAuthStore.setState({ error: null });
  }, []);

  async function handleSignUp() {
    setLocalError(null);

    const fullPhone = toE164NG(phone);

    if (!name.trim() || !phone.trim() || !pin || !confirmPin) {
      setLocalError('Please complete all required fields.');
      return;
    }
    if (!fullPhone) {
      setLocalError('Enter a valid Nigerian phone number.');
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setLocalError('PIN must contain exactly 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setLocalError('Your PINs do not match.');
      return;
    }

    const ok = await signUp(name.trim(), fullPhone, pin, role, locationId.trim() || null);

    if (!ok) {
      setLocalError(useAuthStore.getState().error || 'Unable to create your account.');
    }
  }

  const displayError = localError || storeError;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: space.xs }}>
          <Text style={[type.title, { color: colors.primary }]}>Create account</Text>
          <Text style={{ color: colors.onSurfaceVariant }}>
            Register to get started with your account.
          </Text>
        </View>

        <View style={{ gap: space.md }}>
          <FormField
            label="Full name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />

          <FormField
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            left={<TextInput.Affix text="+234" />}
          />

          <FormField
            label="PIN"
            value={pin}
            onChangeText={(t: string) => setPin(digitsOnly(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          <FormField
            label="Confirm PIN"
            value={confirmPin}
            onChangeText={(t: string) => setConfirmPin(digitsOnly(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          <View style={{ gap: space.xs }}>
            <Text style={{ color: colors.onSurface }}>Account role</Text>
            <SegmentedButtons
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              buttons={[
                { value: 'officer', label: 'officer' },
                { value: 'manager', label: 'Manager' },
              ]}
            />
          </View>

          <FormField
            label="Location ID (optional)"
            value={locationId}
            onChangeText={setLocationId}
            autoCapitalize="none"
          />

          {!!displayError && (
            <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
              {displayError}
            </HelperText>
          )}

          <PrimaryButton onPress={handleSignUp} loading={isLoading} disabled={isLoading}>
            Create account
          </PrimaryButton>

          <Button mode="text" onPress={() => router.replace('/login')}>
            Already have an account? Log in
          </Button>
        </View>
      </ScrollView>
    </Screen>
  );
}