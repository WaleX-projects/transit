import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { LOCATION_TRACKING_TASK } from '../lib/config';
import { getDb } from './db';

export interface GpsCoordinates {
  lat: number;
  lng: number;
}

let activeTripId: string | null = null;
let foregroundSubscription: Location.LocationSubscription | null = null;

export function setActiveTrackingTripId(tripId: string | null): void {
  activeTripId = tripId;
}

export async function getScanGps(): Promise<GpsCoordinates | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      const req = await Location.requestForegroundPermissionsAsync();
      if (req.status !== 'granted') return null;
    }

    // 1. Try last known position immediately
    const last = await Location.getLastKnownPositionAsync();
    if (last?.coords) {
      return {
        lat: last.coords.latitude,
        lng: last.coords.longitude,
      };
    }

    // 2. Try current fix with 3s timeout
    const currentPromise = Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));

    const result = await Promise.race([currentPromise, timeoutPromise]);
    if (result && 'coords' in result) {
      return {
        lat: result.coords.latitude,
        lng: result.coords.longitude,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function savePingLocally(
  tripId: string,
  lat: number,
  lng: number,
  speedMps?: number | null,
  accuracyM?: number | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO pings_local (trip_id, lat, lng, speed_mps, accuracy_m, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tripId, lat, lng, speedMps ?? null, accuracyM ?? null, new Date().toISOString()]
  );
}

// Background Task Definition
TaskManager.defineTask(LOCATION_TRACKING_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || !locations.length || !activeTripId) return;

  const loc = locations[locations.length - 1];
  await savePingLocally(
    activeTripId,
    loc.coords.latitude,
    loc.coords.longitude,
    loc.coords.speed,
    loc.coords.accuracy
  );
});

export async function startTripTracking(tripId: string): Promise<boolean> {
  setActiveTrackingTripId(tripId);

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return false;

    const bgAvailable = await Location.isBackgroundLocationAvailableAsync().catch(() => false);

    if (bgAvailable) {
      const bgPerm = await Location.requestBackgroundPermissionsAsync().catch(() => ({ status: 'denied' }));
      if (bgPerm.status === 'granted') {
        const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
        if (!started) {
          await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 15000,
            distanceInterval: 50,
            showsBackgroundLocationIndicator: true,
          });
        }
        return true;
      }
    }

    // Fall back to foreground watcher
    if (foregroundSubscription) {
      foregroundSubscription.remove();
    }

    foregroundSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000,
        distanceInterval: 50,
      },
      async (loc) => {
        if (activeTripId) {
          await savePingLocally(
            activeTripId,
            loc.coords.latitude,
            loc.coords.longitude,
            loc.coords.speed,
            loc.coords.accuracy
          );
        }
      }
    );

    return false; // Indicates foreground fallback
  } catch {
    return false;
  }
}

export async function stopTripTracking(): Promise<void> {
  setActiveTrackingTripId(null);

  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }

  const isStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK).catch(() => {});
  }
}
