import { getDb } from '../../data/db';

export interface TripListItem {
  id: string;
  plate: string;
  origin_name: string;
  destination_name: string;
  driver_name: string;
  status: string;
}

export interface TripDetailData {
  id: string;
  vehicle_id: string;
  plate: string;
  model: string | null;
  driver_id: string;
  driver_name: string;
  origin_id: string;
  destination_id: string;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  status: string;
  started_at: string | null;
  arrived_at: string | null;
  loading_confirmed_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  packagesOnBoard: number;
}

export interface DriverTripData {
  trip: TripDetailData;
  loadedCount: number;
  expectedCount: number;
}

export async function fetchTripsList(): Promise<TripListItem[]> {
  const db = await getDb();
  return await db.getAllAsync<TripListItem>(
    `SELECT t.id, v.plate, o.name as origin_name, d.name as destination_name,
            p.name as driver_name, t.status
     FROM trips t
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN profiles p ON p.id = t.driver_id
     JOIN locations o ON o.id = t.origin_id
     JOIN locations d ON d.id = t.destination_id
     ORDER BY t.created_at DESC`
  );
}

export async function fetchTripDetail(tripId: string): Promise<TripDetailData | null> {
  const db = await getDb();
  const trip = await db.getFirstAsync<{
    id: string;
    vehicle_id: string;
    plate: string;
    model: string | null;
    driver_id: string;
    driver_name: string;
    origin_id: string;
    destination_id: string;
    origin_name: string;
    origin_lat: number;
    origin_lng: number;
    destination_name: string;
    destination_lat: number;
    destination_lng: number;
    status: string;
    started_at: string | null;
    arrived_at: string | null;
    loading_confirmed_at: string | null;
    last_lat: number | null;
    last_lng: number | null;
  }>(
    `SELECT t.id, t.vehicle_id, v.plate, v.model, t.driver_id, p.name as driver_name,
            t.origin_id, t.destination_id, o.name as origin_name, o.lat as origin_lat, o.lng as origin_lng,
            d.name as destination_name, d.lat as destination_lat, d.lng as destination_lng,
            t.status, t.started_at, t.arrived_at, t.loading_confirmed_at, t.last_lat, t.last_lng
     FROM trips t
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN profiles p ON p.id = t.driver_id
     JOIN locations o ON o.id = t.origin_id
     JOIN locations d ON d.id = t.destination_id
     WHERE t.id = ?`,
    [tripId]
  );

  if (!trip) return null;

  const countRow = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM packages WHERE current_trip_id = ? AND status IN ('loaded', 'arrived', 'delivered')`,
    [tripId]
  );

  return {
    ...trip,
    packagesOnBoard: countRow?.count || 0,
  };
}

export async function fetchDriverActiveTrip(driverId: string): Promise<DriverTripData | null> {
  const db = await getDb();
  const tripRow = await db.getFirstAsync<{
    id: string;
    vehicle_id: string;
    plate: string;
    model: string | null;
    driver_id: string;
    driver_name: string;
    origin_id: string;
    destination_id: string;
    origin_name: string;
    origin_lat: number;
    origin_lng: number;
    destination_name: string;
    destination_lat: number;
    destination_lng: number;
    status: string;
    started_at: string | null;
    arrived_at: string | null;
    loading_confirmed_at: string | null;
    last_lat: number | null;
    last_lng: number | null;
  }>(
    `SELECT t.id, t.vehicle_id, v.plate, v.model, t.driver_id, p.name as driver_name,
            t.origin_id, t.destination_id, o.name as origin_name, o.lat as origin_lat, o.lng as origin_lng,
            d.name as destination_name, d.lat as destination_lat, d.lng as destination_lng,
            t.status, t.started_at, t.arrived_at, t.loading_confirmed_at, t.last_lat, t.last_lng
     FROM trips t
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN profiles p ON p.id = t.driver_id
     JOIN locations o ON o.id = t.origin_id
     JOIN locations d ON d.id = t.destination_id
     WHERE t.driver_id = ? AND t.status IN ('loading', 'in_transit')
     ORDER BY t.created_at DESC LIMIT 1`,
    [driverId]
  );

  if (!tripRow) return null;

  // Loaded packages on this trip
  const loadedRow = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM packages WHERE current_trip_id = ? AND status = 'loaded'`,
    [tripRow.id]
  );

  // Expected packages: registered packages destined for this trip's route + packages already loaded
  const expectedRow = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM packages p
     JOIN shipments s ON s.id = p.shipment_id
     WHERE (p.current_trip_id = ? AND p.status = 'loaded')
        OR (s.origin_id = ? AND s.destination_id = ? AND p.status = 'registered')`,
    [tripRow.id, tripRow.origin_id, tripRow.destination_id]
  );

  const loadedCount = loadedRow?.count || 0;
  const expectedCount = Math.max(loadedCount, expectedRow?.count || 0);

  return {
    trip: {
      ...tripRow,
      packagesOnBoard: loadedCount,
    },
    loadedCount,
    expectedCount,
  };
}

export async function fetchVehicles(): Promise<Array<{ id: string; plate: string; model: string | null }>> {
  const db = await getDb();
  return await db.getAllAsync(`SELECT id, plate, model FROM vehicles WHERE is_active = 1 ORDER BY plate ASC`);
}

export async function fetchDrivers(): Promise<Array<{ id: string; name: string; phone: string }>> {
  const db = await getDb();
  return await db.getAllAsync(
    `SELECT id, name, phone FROM profiles WHERE role = 'driver' AND is_active = 1 ORDER BY name ASC`
  );
}
