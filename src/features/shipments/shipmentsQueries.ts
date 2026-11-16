import { getDb } from '../../data/db';
import { formatWaitingDays } from '../../lib/format';

export interface OverviewStats {
  shipmentsToday: number;
  packagesToday: number;
  inTransit: number;
  deliveredToday: number;
  issuesCount: number;
}

export interface ReadyCollectionItem {
  id: string;
  waybill_no: string;
  receiver_name: string;
  receiver_phone: string;
  ready_at: string;
  waitingDays: number;
}

export interface ActiveTripOnRoad {
  id: string;
  plate: string;
  origin_name: string;
  destination_name: string;
  last_ping_at: string | null;
}

export async function fetchOverviewData(): Promise<{
  stats: OverviewStats;
  readyForCollection: ReadyCollectionItem[];
  tripsOnRoad: ActiveTripOnRoad[];
}> {
  const db = await getDb();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  // Shipments today
  const sToday = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM shipments WHERE created_at >= ?`,
    [todayIso]
  );

  // Packages today
  const pToday = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM packages WHERE created_at >= ?`,
    [todayIso]
  );

  // In transit
  const inTransit = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM shipments WHERE status = 'in_transit'`
  );

  // Delivered today
  const delToday = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM shipments WHERE status = 'delivered' AND delivered_at >= ?`,
    [todayIso]
  );

  // Issues count
  const issues = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM shipments WHERE status = 'issue'`
  );

  // Ready for collection rows
  const readyRows = await db.getAllAsync<{
    id: string;
    waybill_no: string;
    receiver_name: string;
    receiver_phone: string;
    ready_at: string;
  }>(
    `SELECT id, waybill_no, receiver_name, receiver_phone, ready_at
     FROM shipments
     WHERE ready_at IS NOT NULL AND status <> 'delivered'
     ORDER BY ready_at ASC`
  );

  const readyForCollection: ReadyCollectionItem[] = readyRows.map((r) => ({
    ...r,
    waitingDays: formatWaitingDays(r.ready_at),
  }));

  // Trips on the road
  const tripsOnRoad = await db.getAllAsync<ActiveTripOnRoad>(
    `SELECT t.id, v.plate, o.name as origin_name, d.name as destination_name, t.last_ping_at
     FROM trips t
     JOIN vehicles v ON v.id = t.vehicle_id
     JOIN locations o ON o.id = t.origin_id
     JOIN locations d ON d.id = t.destination_id
     WHERE t.status = 'in_transit'
     ORDER BY t.started_at DESC`
  );

  return {
    stats: {
      shipmentsToday: sToday?.count || 0,
      packagesToday: pToday?.count || 0,
      inTransit: inTransit?.count || 0,
      deliveredToday: delToday?.count || 0,
      issuesCount: issues?.count || 0,
    },
    readyForCollection,
    tripsOnRoad,
  };
}

export async function fetchLocations(): Promise<
  Array<{ id: string; name: string; state: string; lat: number; lng: number }>
> {
  const db = await getDb();
  return await db.getAllAsync(
    `SELECT id, name, state, lat, lng FROM locations WHERE is_active = 1 ORDER BY name ASC`
  );
}

export async function fetchShipmentList(
  searchQuery: string,
  filterChip: string
): Promise<
  Array<{
    id: string;
    waybill_no: string;
    receiver_name: string;
    origin_name: string;
    destination_name: string;
    status: string;
  }>
> {
  const db = await getDb();
  let sql = `
    SELECT s.id, s.waybill_no, s.receiver_name, o.name as origin_name, d.name as destination_name, s.status
    FROM shipments s
    JOIN locations o ON o.id = s.origin_id
    JOIN locations d ON d.id = s.destination_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (searchQuery.trim()) {
    const q = `%${searchQuery.trim()}%`;
    sql += ` AND (s.waybill_no LIKE ? OR s.receiver_name LIKE ? OR s.receiver_phone LIKE ?)`;
    params.push(q, q, q);
  }

  if (filterChip === 'Ready for collection') {
    sql += ` AND s.ready_at IS NOT NULL AND s.status <> 'delivered'`;
  } else if (filterChip === 'Received') {
    sql += ` AND s.status = 'registered'`;
  } else if (filterChip === 'Loaded') {
    sql += ` AND s.status = 'loaded'`;
  } else if (filterChip === 'In Transit') {
    sql += ` AND s.status = 'in_transit'`;
  } else if (filterChip === 'Arrived') {
    sql += ` AND s.status = 'arrived'`;
  } else if (filterChip === 'Delivered') {
    sql += ` AND s.status = 'delivered'`;
  } else if (filterChip === 'Issue') {
    sql += ` AND s.status = 'issue'`;
  }

  sql += ` ORDER BY s.created_at DESC`;

  return await db.getAllAsync(sql, params);
}
