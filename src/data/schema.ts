// SQLite local database schema matching Supabase synced tables and offline tables

export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  geofence_radius_m REAL DEFAULT 500,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  location_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  plate TEXT NOT NULL,
  model TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  driver_id TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_by TEXT NOT NULL,
  loading_confirmed_by TEXT,
  loading_confirmed_at TEXT,
  started_at TEXT,
  arrived_at TEXT,
  last_lat REAL,
  last_lng REAL,
  last_ping_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  waybill_no TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  sender_phone TEXT  NULL,
  receiver_phone TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  status TEXT NOT NULL,
  issue_reason TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  ready_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  label_code TEXT NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  photo_path TEXT,
  status TEXT NOT NULL,
  condition TEXT,
  arrival_photo_path TEXT,
  arrival_note TEXT,
  current_trip_id TEXT,
  current_holder_id TEXT,
  loaded_at TEXT,
  arrived_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS custody_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER,
  shipment_id TEXT NOT NULL,
  package_id TEXT,
  type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  trip_id TEXT,
  lat REAL,
  lng REAL,
  note TEXT,
  photo_path TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT  NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  shipment_id TEXT PRIMARY KEY,
  collector_name TEXT NOT NULL,
  collector_is_receiver INTEGER NOT NULL,
  relationship TEXT,
  id_checked INTEGER NOT NULL,
  id_type TEXT,
  verified_by TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  signature_path TEXT NOT NULL,
  lat REAL,
  lng REAL,
  collected_by TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_attempts (
  id TEXT PRIMARY KEY,
  shipment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  outcome TEXT NOT NULL,
  note TEXT,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pickup_codes (
  shipment_id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commands_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sv INTEGER NOT NULL
);

-- Offline Engine Tables
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'rejected')),
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  table_name TEXT PRIMARY KEY,
  sv INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS media_queue (
  id TEXT PRIMARY KEY,
  local_uri TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'uploaded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  retryable INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pings_local (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  speed_mps REAL,
  accuracy_m REAL,
  recorded_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const DROP_ALL_TABLES_SQL = `
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS profiles;
DROP TABLE IF EXISTS vehicles;
DROP TABLE IF EXISTS trips;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS packages;
DROP TABLE IF EXISTS custody_events;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS contact_attempts;
DROP TABLE IF EXISTS pickup_codes;
DROP TABLE IF EXISTS commands_log;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS sync_cursor;
DROP TABLE IF EXISTS media_queue;
DROP TABLE IF EXISTS pings_local;

DROP TABLE IF EXISTS kv;
`;
