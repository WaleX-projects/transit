import { WAYBILL_PREFIX } from './config';

/**
 * Normalises phone numbers from 080..., 234..., +234... to +234...
 * Returns null if not a valid Nigerian mobile phone.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) {
    return `+${digits}`;
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+234${digits}`;
  }
  return null;
}

export function formatWaybill(num: number | bigint): string {
  return `${WAYBILL_PREFIX}-${num}`;
}

export function formatLabelCode(waybill: string, seq: number): string {
  return `${waybill}-${seq}`;
}

export function getGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function formatWaitingDays(dateIso: string | null | undefined): number {
  if (!dateIso) return 0;
  const now = Date.now();
  const past = new Date(dateIso).getTime();
  const diffDays = Math.floor((now - past) / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

export function formatMinutesAgo(dateIso: string | null | undefined): number {
  if (!dateIso) return 0;
  const now = Date.now();
  const past = new Date(dateIso).getTime();
  const diffMinutes = Math.floor((now - past) / (1000 * 60));
  return Math.max(0, diffMinutes);
}

export function formatElapsedTime(startedAtIso: string | null | undefined): string {
  if (!startedAtIso) return '00:00:00';
  const start = new Date(startedAtIso).getTime();
  const diffSeconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(diffSeconds / 3600);
  const m = Math.floor((diffSeconds % 3600) / 60);
  const s = diffSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
