// scripts/create-user.ts
// Creates a driver or manager locally with service role key

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('Warning: SUPABASE_SERVICE_ROLE_KEY is not set. Pass it via env or command line.');
}

function parseArgs(): {
  phone: string;
  pin: string;
  role: 'manager' | 'driver';
  name: string;
  locationId?: string;
} {
  const args = process.argv.slice(2);
  const map: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      map[key] = val;
    }
  }

  const phone = map.phone || '+2348012345678';
  const pin = map.pin || '123456';
  const role = (map.role === 'driver' ? 'driver' : 'manager') as 'manager' | 'driver';
  const name = map.name || (role === 'manager' ? 'DEMO Office Manager' : 'DEMO Bus Driver');
  const locationId = map.location || map.locationId;

  return { phone, pin, role, name, locationId };
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return `+${digits}`;
}

async function main() {
  const { phone, pin, role, name, locationId } = parseArgs();
  const normalizedPhone = normalizePhone(phone);
  const digits = normalizedPhone.replace(/\D/g, '');
  const syntheticEmail = `${digits}@internal.egaosas.com`;

  console.log(`Creating user: ${name} (${role})`);
  console.log(`Phone: ${normalizedPhone} | Synthetic email: ${syntheticEmail}`);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Check if user already exists in auth
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find(
    (u) => u.email === syntheticEmail || u.phone === normalizedPhone
  );

  let userId: string;

  if (existing) {
    console.log(`User already exists in Auth (${existing.id}), updating password and metadata...`);
    userId = existing.id;
    await supabase.auth.admin.updateUserById(userId, {
      password: pin,
      app_metadata: { role },
      user_metadata: { name, role, phone: normalizedPhone },
    });
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: syntheticEmail,
      password: pin,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { name, role, phone: normalizedPhone },
    });

    if (error || !data.user) {
      console.error('Failed to create auth user:', error?.message);
      process.exit(1);
    }
    userId = data.user.id;
  }

  // Insert or update profiles row
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: userId,
    name,
    phone: normalizedPhone,
    role,
    location_id: locationId || null,
    is_active: true,
  });

  if (profileError) {
    console.error('Failed to upsert profile:', profileError.message);
    process.exit(1);
  }

  console.log(`Successfully created profile for user ${userId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
