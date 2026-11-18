import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import { supabase } from '../../lib/supabase'; // adjust to your path
import { FormField } from '../../ui/FormField';
import { PrimaryButton } from '../../ui/PrimaryButton';
import { Screen } from '../../ui/Screen';

type Step = 'phone' | 'code' | 'password';
type Props = { onBackToLogin: () => void };

function PasswordForgetView({ onBackToLogin }: Props) {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // accepts 0803..., 803..., or 234803...
  const digits = phone.replace(/\D/g, '').replace(/^(234|0)/, '');
  const e164 = digits.length === 10 ? `+234${digits}` : null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // each action returns an error message, or null on success
  const run = async (action: () => Promise<string | null>) => {
    setLoading(true);
    setError(null);
    const message = await action();
    setLoading(false);
    if (message) setError(message);
  };

  const sendCode = () =>
    run(async () => {
      if (!e164) return 'Enter a valid Nigerian phone number';
      const { error } = await supabase.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: false }, // don't create accounts from this screen
      });
      if (error) return error.message;
      setStep('code');
      setCooldown(30);
      return null;
    });

  const verifyCode = () =>
    run(async () => {
      if (code.length < 6) return 'Enter the 6-digit code';
      const { error } = await supabase.auth.verifyOtp({
        phone: e164!,
        token: code,
        type: 'sms',
      });
      if (error) return 'Invalid or expired code';
      setStep('password');
      return null;
    });

  const resetPassword = () =>
    run(async () => {
      if (password.length < 8) return 'Password must be at least 8 characters';
      if (password !== confirm) return 'Passwords do not match';
      const { error } = await supabase.auth.updateUser({ password });
      if (error) return error.message;
      await supabase.auth.signOut(); // make them log in with the new password
      onBackToLogin();
      return null;
    });

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
        {step === 'phone' && (
          <>
            <Text variant="titleLarge">Forgot password</Text>
            <Text>Enter your phone number and we'll text you a code.</Text>
            <FormField
              label="Phone"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              left={<TextInput.Affix text="+234" />}
            />
            <PrimaryButton onPress={sendCode} disabled={loading}>
              Send code
            </PrimaryButton>
          </>
        )}

        {step === 'code' && (
          <>
            <Text variant="titleLarge">Enter code</Text>
            <Text>We sent a 6-digit code to {e164}.</Text>
            <FormField
              label="Code"
              value={code}
              onChangeText={(t: string) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
            />
            <PrimaryButton onPress={verifyCode} disabled={loading}>
              Verify
            </PrimaryButton>
            <Button onPress={sendCode} disabled={loading || cooldown > 0}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Button>
          </>
        )}

        {step === 'password' && (
          <>
            <Text variant="titleLarge">New password</Text>
            <FormField
              label="New password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <FormField
              label="Confirm password"
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry
            />
            <PrimaryButton onPress={resetPassword} disabled={loading}>
              Reset password
            </PrimaryButton>
          </>
        )}

        {error && <HelperText type="error" visible>{error}</HelperText>}

        <Button onPress={onBackToLogin} disabled={loading}>
          Back to login
        </Button>
      </View>
    </Screen>
  );
}

export { PasswordForgetView };
