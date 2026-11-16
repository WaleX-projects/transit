import { DriverScanView } from '../../features/scan/DriverScanView';
import { ReceivePackageView } from '../../features/scan/ReceivePackageView';
import { useAuthStore } from '../../store/authStore';

export default function ScanScreen() {
  const user = useAuthStore((s) => s.user);

  if (user?.role === 'manager') {
    return <ReceivePackageView />;
  }

  return <DriverScanView />;
}
