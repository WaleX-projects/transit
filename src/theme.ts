import { MD3LightTheme, configureFonts } from 'react-native-paper';
export const theme = { ...MD3LightTheme, roundness: 3, fonts: configureFonts({ config: { fontFamily: 'Inter_400Regular' } }),
  colors: { ...MD3LightTheme.colors, primary: '#1E4FD8', onPrimary: '#FFFFFF', secondary: '#FF8A00', onSecondary: '#FFFFFF', background: '#F5F7FA', surface: '#FFFFFF', onSurface: '#111827', onSurfaceVariant: '#6B7280', outline: '#E5E7EB', error: '#DC2626' } };
export const statusColors = { received: '#6B7280', loaded: '#7C3AED', in_transit: '#F59E0B', arrived: '#0EA5E9', delivered: '#16A34A', issue: '#DC2626' };
