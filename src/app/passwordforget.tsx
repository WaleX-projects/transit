
// app/forgot-password.tsx
import { useRouter } from 'expo-router';
import { PasswordForgetView } from '../features/auth/PasswordForgetView';

export default function ForgotPassword() {
  const router = useRouter();
  return <PasswordForgetView onBackToLogin={() => router.replace('/login')} />;
}