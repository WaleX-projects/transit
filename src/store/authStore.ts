import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';
import { getDb, wipeDatabase } from '../data/db';

import {
  runSyncCycle,
  setupSyncListeners,
  stopSyncListeners
} from '../data/sync';
import { copy } from '../lib/copy';
import { normalizePhone } from '../lib/format';
import { supabase } from '../lib/supabase';
// ---------- logging helpers (dev only) ----------
const TAG = '[auth]';

const log = (step: string, data?: unknown) => {
  if (!__DEV__) return;
  if (data === undefined) console.log(TAG, step);
  else console.log(TAG, step, data);
};

// Pulls out the useful fields from Supabase / SQLite / JS errors
const describeError = (e: any) => ({
  name: e?.name,
  message: e?.message,
  status: e?.status,
  code: e?.code,
  details: e?.details,
  hint: e?.hint,
});

const logError = (step: string, e: unknown) => {
  if (!__DEV__) return;
  console.error(TAG, `${step} FAILED`, describeError(e));
};

export interface UserProfile {
  id: string;
  name: string;
  phone: string;
  role: 'manager' | 'driver';
  location_id: string | null;
  location_name?: string | null;
}

interface AuthState {
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;

  signIn: (phone: string, pin: string) => Promise<boolean>;

  signUp: (
    name: string,
    phone: string,
    pin: string,
    role: 'manager' | 'driver',
    locationId?: string | null
  ) => Promise<boolean>;

  signOut: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  error: null,

  signIn: async (phone: string, pin: string): Promise<boolean> => {
    log('signIn: started', { phone, pinLength: pin?.length });
    set({ isLoading: true, error: null });

    const net = await NetInfo.fetch();
    log('signIn: network', { isConnected: net.isConnected, type: net.type });
    if (!net.isConnected) {
      set({ isLoading: false, error: copy.auth.networkError });
      return false;
    }

    const normPhone = normalizePhone(phone);
    log('signIn: normalized phone', { input: phone, normPhone });
    if (!normPhone) {
      log('signIn: invalid phone, aborting');
      set({ isLoading: false, error: copy.auth.wrongCredentials });
      return false;
    }

    // Must be formatted exactly like signUp, or Supabase treats it as a different phone
    const formattedPhone = normPhone.startsWith('+') ? normPhone : `+${normPhone}`;
    log('signIn: phone', formattedPhone);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        phone: formattedPhone,
        password: pin,
      });

      if (error || !data.user) {
        logError('signIn: supabase.auth.signInWithPassword', error);
        set({ isLoading: false, error: copy.auth.wrongCredentials });
        return false;
      }

      const userId = data.user.id;
      log('signIn: auth OK', {
        userId,
        email: data.user.email,
        hasSession: !!data.session,
        app_metadata: data.user.app_metadata,
        user_metadata: data.user.user_metadata,
      });

      const db = await getDb();

      // Check if logged-in user differs from previous local owner
      const prevOwner = await db.getFirstAsync<{ value: string }>(
        `SELECT value FROM kv WHERE key = 'current_user_id'`
      );
      log('signIn: previous local owner', prevOwner);

      if (prevOwner && prevOwner.value !== userId) {
        log('signIn: different user, wiping local database');
        await wipeDatabase();
      }

      await db.runAsync(
        `INSERT INTO kv (key, value) VALUES ('current_user_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [userId]
      );
      log('signIn: saved current_user_id');

      // Fetch profile from server
      const { data: profileData, error: profileFetchError } = await supabase
        .from('profiles')
        .select('*, locations(name)')
        .eq('id', userId)
        .single();

      if (profileFetchError) {
        logError('signIn: fetch server profile', profileFetchError);
      }
      log('signIn: server profile', profileData);

      const role = (profileData?.role || data.user.app_metadata?.role || 'manager') as 'manager' | 'driver';
      const name = profileData?.name || data.user.user_metadata?.name || 'User';
      const locationId = profileData?.location_id || null;
      const locationName = profileData?.locations?.name || null;
      log('signIn: resolved profile values', { role, name, locationId, locationName });

      // Upsert profile into local SQLite
      await db.runAsync(
        `INSERT INTO profiles (id, name, phone, role, location_id, is_active, created_at, updated_at, sv)
         VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), 0)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, location_id = excluded.location_id`,
        [userId, name, normPhone, role, locationId]
      );
      log('signIn: local profile upserted');

      const userProfile: UserProfile = {
        id: userId,
        name,
        phone: normPhone,
        role,
        location_id: locationId,
        location_name: locationName,
      };

      set({ user: userProfile, isLoading: false, error: null });
      log('signIn: store updated, user set', userProfile);

      const userContext = {
        userId,
        role,
        locationId,
      };

      
      // Initial sync cycle
      log('signIn: starting sync', userContext);
      runSyncCycle(userContext);
      setupSyncListeners(userContext);

      log('signIn: SUCCESS');
      return true;
    } catch (e) {
      logError('signIn: unexpected exception', e);
      set({ isLoading: false, error: copy.auth.wrongCredentials });
      return false;
    }
  },

  signUp: async (
    name: string,
    phone: string,
    pin: string,
    role: 'manager' | 'driver',
    locationId: string | null = null
  ): Promise<boolean> => {
    log('signUp: started', { name, phone, role, locationId, pinLength: pin?.length });
    set({ isLoading: true, error: null });

    try {
      // 1. Check network connection
      const net = await NetInfo.fetch();
      log('signUp: network', { isConnected: net.isConnected, type: net.type });

      if (!net.isConnected) {
        set({ isLoading: false, error: copy.auth.networkError });
        return false;
      }

      // 2. Validate input
      const cleanName = name.trim();
      const normPhone = normalizePhone(phone);
      log('signUp: validated input', { cleanName, input: phone, normPhone });

      if (!cleanName || !normPhone || !pin) {
        log('signUp: missing required fields', {
          hasName: !!cleanName,
          hasPhone: !!normPhone,
          hasPin: !!pin,
        });
        set({
          isLoading: false,
          error: 'Name, phone number and PIN are required.',
        });
        return false;
      }

      if (!['manager', 'driver'].includes(role)) {
        log('signUp: invalid role', role);
        set({
          isLoading: false,
          error: 'Invalid user role.',
        });
        return false;
      }

      if (pin.length < 6) {
        log('signUp: PIN too short', { pinLength: pin.length });
        set({
          isLoading: false,
          error: 'PIN must contain at least 6 characters.',
        });
        return false;
      }

      // 3. Generate the same synthetic email used by signIn

      // 1. Ensure phone is formatted with '+' for E.164 compliance (e.g., +234...)
      const formattedPhone = normPhone.startsWith('+') ? normPhone : `+${normPhone}`;

      log('signUp: phone', formattedPhone);

      // 2. Create Supabase authentication account using phone + pin (password)
      const { data, error } = await supabase.auth.signUp({
        phone: formattedPhone,
        password: pin,
        options: {
          data: {
            name: cleanName,
            phone: normPhone,
            role,
            location_id: locationId,
          },
        },
      });
      log('signUp: supabase.auth.signUp response', {
        userId: data?.user?.id,
        email: data?.user?.email,
        hasSession: !!data?.session,
        identities: data?.user?.identities?.length,
        user_metadata: data?.user?.user_metadata,
      });

      if (error) {
        logError('signUp: supabase.auth.signUp', error);
        set({
          isLoading: false,
          error: error.message,
        });
        return false;
      }

      if (!data.user) {
        log('signUp: no user returned');
        set({
          isLoading: false,
          error: 'Account creation failed.',
        });
        return false;
      }

      // Synthetic emails cannot receive confirmation emails.
      // This flow requires Supabase email confirmation to be disabled.
      if (!data.session) {
        log('signUp: NO SESSION returned, email confirmation is probably enabled in Supabase');
        set({
          isLoading: false,
          error: 'Account created, but authentication requires email confirmation. Disable email confirmation for this phone-based signup flow.',
        });
        return false;
      }

      const userId = data.user.id;

      // 5. Create server profile
      const profilePayload = {
        id: userId,
        name: cleanName,
        phone: normPhone,
        role,
        location_id: locationId,
        is_active: true,
      };
      log('signUp: upserting server profile', profilePayload);

      const { error: profileError } = await supabase
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });

      if (profileError) {
        logError('signUp: server profile upsert (check table columns and RLS policies)', profileError);
        // Do not silently treat an account without a profile as complete.
        await supabase.auth.signOut();

        set({
          isLoading: false,
          error: `Account created, but profile setup failed: ${profileError.message}`,
        });

        return false;
      }
      log('signUp: server profile saved');

      // 6. Save profile in local SQLite
      const db = await getDb();

      await db.runAsync(
        `INSERT INTO profiles
        (id, name, phone, role, location_id, is_active,
         created_at, updated_at, sv)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'), 0)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         phone = excluded.phone,
         role = excluded.role,
         location_id = excluded.location_id,
         is_active = 1`,
        [userId, cleanName, normPhone, role, locationId]
      );
      log('signUp: local profile saved');

      // 7. Save the local database owner
      await db.runAsync(
        `INSERT INTO kv (key, value)
       VALUES ('current_user_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [userId]
      );
      log('signUp: saved current_user_id');

      // 8. Build authenticated user profile
      let locationName: string | null = null;

      if (locationId) {
        const location = await db.getFirstAsync<{ name: string }>(
          'SELECT name FROM locations WHERE id = ?',
          [locationId]
        );
        log('signUp: location lookup', { locationId, location });

        locationName = location?.name || null;
      }

      const userProfile: UserProfile = {
        id: userId,
        name: cleanName,
        phone: normPhone,
        role,
        location_id: locationId,
        location_name: locationName,
      };

      // 9. Update Zustand state
      set({
        user: userProfile,
        isLoading: false,
        error: null,
      });
      log('signUp: store updated, user set', userProfile);

      // 10. Start sync
      const userContext = {
        userId,
        role,
        locationId,
      };

      if (role === 'manager') {
        log('signUp: checking refill waybills');
        //await checkRefillWaybills();
      }

      log('signUp: starting sync', userContext);
      runSyncCycle(userContext);
      setupSyncListeners(userContext);

      log('signUp: SUCCESS');
      return true;

    } catch (error) {
      logError('signUp: unexpected exception', error);
      set({
        isLoading: false,
        error: error instanceof Error
          ? error.message
          : 'Unable to create account.',
      });

      return false;
    }
  },
signOut: async () => {
  stopSyncListeners();

  await supabase.auth.signOut();

  set({ user: null });
}


  ,

  restoreSession: async () => {
    log('restoreSession: started');
    set({ isLoading: true, error: null });
    try {
      const db = await getDb();
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) logError('restoreSession: supabase.auth.getSession', sessionError);

      const session = data?.session;
      log('restoreSession: session', {
        hasSession: !!session,
        userId: session?.user?.id,
        email: session?.user?.email,
        expiresAt: session?.expires_at,
      });

      if (session?.user) {
        const userId = session.user.id;
        const localProfile = await db.getFirstAsync<{
          id: string;
          name: string;
          phone: string;
          role: string;
          location_id: string | null;
        }>('SELECT * FROM profiles WHERE id = ?', [userId]);
        log('restoreSession: local profile', localProfile);

        let locationName: string | null = null;
        if (localProfile?.location_id) {
          const loc = await db.getFirstAsync<{ name: string }>(
            'SELECT name FROM locations WHERE id = ?',
            [localProfile.location_id]
          );
          log('restoreSession: location lookup', loc);
          locationName = loc?.name || null;
        }

        const role = (localProfile?.role || session.user.app_metadata?.role || 'manager') as 'manager' | 'driver';

        const userProfile: UserProfile = {
          id: userId,
          name: localProfile?.name || session.user.user_metadata?.name || 'User',
          phone: localProfile?.phone || session.user.user_metadata?.phone || '',
          role,
          location_id: localProfile?.location_id || null,
          location_name: locationName,
        };

        set({ user: userProfile, isLoading: false });
        log('restoreSession: user restored', userProfile);

        const userCtx = {
          userId,
          role,
          locationId: userProfile.location_id,
        };

        setupSyncListeners(userCtx);
        runSyncCycle(userCtx);
      } else {
        log('restoreSession: no session, user is logged out');
        set({ user: null, isLoading: false });
      }
    } catch (e) {
      logError('restoreSession: unexpected exception', e);
      set({ user: null, isLoading: false });
    }
  },
}));