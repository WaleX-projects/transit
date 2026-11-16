
import { useState } from 'react';
import { View } from 'react-native';
import {
    HelperText,
    SegmentedButtons,
    Text,
    TextInput,
    useTheme,
} from 'react-native-paper';
import { useAuthStore } from '../../store/authStore';
import { space, type } from '../../tokens';
import { FormField } from '../../ui/FormField';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

type UserRole = 'manager' | 'driver';

export function SignupView() {
  const { colors } = useTheme();

  const signUp = useAuthStore((s) => s.signUp);
  const isLoading = useAuthStore((s) => s.isLoading);
  const storeError = useAuthStore((s) => s.error);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [role, setRole] = useState<UserRole>('manager');
  const [locationId, setLocationId] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSignUp() {
    setLocalError(null);

    if (!name.trim() || !phone.trim() || !pin || !confirmPin) {
      setLocalError('Please complete all required fields.');
      return;
    }

    if (pin.length !== 6) {
      setLocalError('PIN must contain exactly 6 digits.');
      return;
    }

    if (pin !== confirmPin) {
      setLocalError('Your PINs do not match.');
      return;
    }

    const fullPhone = phone.startsWith('+234')
      ? phone
      : phone.startsWith('0')
        ? `+234${phone.slice(1)}`
        : `+234${phone}`;

    const ok = await signUp(
      name.trim(),
      fullPhone,
      pin,
      role,
      locationId.trim() || null
    );

    if (!ok) {
      setLocalError(
        useAuthStore.getState().error || 'Unable to create your account.'
      );
    }
  }

  const displayError = localError || storeError;

  return (
    <Screen>
      <View
        style={{
          gap: space.xl,
          justifyContent: 'center',
          flex: 1,
        }}
      >
        {/* Header */}
        <View style={{ gap: space.xs }}>
          <Text style={[type.title, { color: colors.primary }]}>
            Create account
          </Text>

          <Text style={{ color: colors.onSurfaceVariant }}>
            Register to get started with your account.
          </Text>
        </View>

        {/* Form */}
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
            left={<TextInput.Affix text="+234" />}
            autoCapitalize="none"
          />

          <FormField
            label="PIN"
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          <FormField
            label="Confirm PIN"
            value={confirmPin}
            onChangeText={setConfirmPin}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
          />

          {/* Role */}
          <View style={{ gap: space.xs }}>
            <Text style={{ color: colors.onSurface }}>
              Account role
            </Text>

            <SegmentedButtons
              value={role}
              onValueChange={(value) => setRole(value as UserRole)}
              buttons={[
                { value: 'manager', label: 'Manager' },
                { value: 'driver', label: 'Driver' },
              ]}
            />
          </View>

          {/* Optional location */}
          <FormField
            label="Location ID (optional)"
            value={locationId}
            onChangeText={setLocationId}
            autoCapitalize="none"
          />

          {!!displayError && (
            <HelperText
              type="error"
              visible
              style={{ paddingHorizontal: 0 }}
            >
              {displayError}
            </HelperText>
          )}

          <PrimaryButton
            onPress={handleSignUp}
            loading={isLoading}
            disabled={isLoading}
          >
            Create account
          </PrimaryButton>
        </View>
      </View>
    </Screen>
  );
}
