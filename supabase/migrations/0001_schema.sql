-- 0001_schema.sql
-- Ega Osas Transport and Logistics Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SEQUENCE IF NOT EXISTS sync_seq START WITH 1;

-- Sync version trigger helper
CREATE OR REPLACE FUNCTION set_sync_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.sv := nextval('sync_seq');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Append-only trigger for custody_events
CREATE OR REPLACE FUNCTION forbid_custody_event_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'custody_events is append-only';
END;
$$ LANGUAGE plpgsql;

-- 1. Locations
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geofence_radius_m double precision DEFAULT 500 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq'),
  CONSTRAINT uq_locations_name_state UNIQUE(name, state)
);

CREATE TRIGGER trg_locations_sync
BEFORE INSERT OR UPDATE ON locations
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 2. Profiles (id matches auth.users.id)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text UNIQUE NOT NULL,
  role text NOT NULL CHECK (role IN ('driver', 'manager')),
  location_id uuid REFERENCES locations(id),
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_profiles_sync
BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 3. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text UNIQUE NOT NULL,
  model text,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_vehicles_sync
BEFORE INSERT OR UPDATE ON vehicles
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 4. Trips
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  driver_id uuid NOT NULL REFERENCES profiles(id),
  origin_id uuid NOT NULL REFERENCES locations(id),
  destination_id uuid NOT NULL REFERENCES locations(id),
  status text NOT NULL DEFAULT 'loading' CHECK (status IN ('loading', 'in_transit', 'arrived', 'cancelled')),
  created_by uuid NOT NULL REFERENCES profiles(id),
  loading_confirmed_by uuid REFERENCES profiles(id),
  loading_confirmed_at timestamptz,
  started_at timestamptz,
  arrived_at timestamptz,
  last_lat double precision,
  last_lng double precision,
  last_ping_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq'),
  CONSTRAINT chk_trip_endpoints CHECK (origin_id <> destination_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_open_trip_driver ON trips(driver_id) WHERE status IN ('loading', 'in_transit');
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_trip_vehicle ON trips(vehicle_id) WHERE status IN ('loading', 'in_transit');

CREATE TRIGGER trg_trips_sync
BEFORE INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 5. Shipments
CREATE TABLE IF NOT EXISTS shipments (
  id uuid PRIMARY KEY,
  waybill_no text UNIQUE NOT NULL,
  sender_name text NOT NULL,
  sender_phone text NOT NULL,
  receiver_name text NOT NULL,
  receiver_phone text NOT NULL,
  origin_id uuid NOT NULL REFERENCES locations(id),
  destination_id uuid NOT NULL REFERENCES locations(id),
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'loaded', 'in_transit', 'arrived', 'delivered', 'issue', 'cancelled')),
  issue_reason text,
  notes text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  ready_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq'),
  CONSTRAINT chk_shipment_endpoints CHECK (origin_id <> destination_id)
);

CREATE TRIGGER trg_shipments_sync
BEFORE INSERT OR UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 6. Packages
CREATE TABLE IF NOT EXISTS packages (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  seq smallint NOT NULL,
  label_code text UNIQUE NOT NULL,
  description text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  photo_path text,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'loaded', 'arrived', 'delivered')),
  condition text CHECK (condition IN ('ok', 'damaged', 'opened')),
  arrival_photo_path text,
  arrival_note text,
  current_trip_id uuid REFERENCES trips(id),
  current_holder_id uuid REFERENCES profiles(id),
  loaded_at timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq'),
  CONSTRAINT uq_packages_shipment_seq UNIQUE(shipment_id, seq),
  CONSTRAINT chk_package_condition CHECK (condition IS NULL OR condition = 'ok' OR arrival_photo_path IS NOT NULL)
);

CREATE TRIGGER trg_packages_sync
BEFORE INSERT OR UPDATE ON packages
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 7. Custody Events (Append-only)
CREATE TABLE IF NOT EXISTS custody_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  package_id uuid REFERENCES packages(id),
  type text NOT NULL CHECK (type IN ('registered', 'loaded', 'arrived', 'delivered', 'issue')),
  actor_id uuid NOT NULL REFERENCES profiles(id),
  trip_id uuid REFERENCES trips(id),
  lat double precision,
  lng double precision,
  note text,
  photo_path text,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_custody_events_insert_sync
BEFORE INSERT ON custody_events
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

CREATE TRIGGER trg_custody_events_append_only
BEFORE UPDATE OR DELETE ON custody_events
FOR EACH ROW EXECUTE FUNCTION forbid_custody_event_modification();

-- 8. Collections
CREATE TABLE IF NOT EXISTS collections (
  shipment_id uuid PRIMARY KEY REFERENCES shipments(id),
  collector_name text NOT NULL,
  collector_is_receiver boolean NOT NULL,
  relationship text,
  id_checked boolean NOT NULL,
  id_type text CHECK (id_type IN ('nin', 'drivers_licence', 'voters_card', 'passport', 'other')),
  verified_by text NOT NULL CHECK (verified_by IN ('code', 'call')),
  photo_path text NOT NULL,
  signature_path text NOT NULL,
  lat double precision,
  lng double precision,
  collected_by uuid NOT NULL REFERENCES profiles(id),
  collected_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_collections_sync
BEFORE INSERT OR UPDATE ON collections
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 9. Contact Attempts
CREATE TABLE IF NOT EXISTS contact_attempts (
  id uuid PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES shipments(id),
  user_id uuid NOT NULL REFERENCES profiles(id),
  channel text NOT NULL CHECK (channel IN ('call', 'sms')),
  outcome text NOT NULL CHECK (outcome IN ('reached', 'no_answer', 'wrong_number', 'sent')),
  note text,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_contact_attempts_sync
BEFORE INSERT OR UPDATE ON contact_attempts
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 10. Pickup Codes
CREATE TABLE IF NOT EXISTS pickup_codes (
  shipment_id uuid PRIMARY KEY REFERENCES shipments(id),
  salt text NOT NULL,
  code_hash text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_pickup_codes_sync
BEFORE INSERT OR UPDATE ON pickup_codes
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 11. Location Pings (Not synced down)
CREATE TABLE IF NOT EXISTS location_pings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed_mps double precision,
  accuracy_m double precision,
  recorded_at timestamptz NOT NULL,
  received_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_trip_recorded_at UNIQUE (trip_id, recorded_at)
);

-- 12. SMS Outbox
CREATE TABLE IF NOT EXISTS sms_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES shipments(id),
  to_phone text NOT NULL,
  template text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  provider_message_id text,
  error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  sent_at timestamptz
);

-- 13. Commands Log
CREATE TABLE IF NOT EXISTS commands_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES profiles(id),
  device_id uuid NOT NULL,
  type text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'rejected')),
  reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_commands_log_sync
BEFORE INSERT OR UPDATE ON commands_log
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 14. Waybills
CREATE TABLE IF NOT EXISTS waybill_counter (
  next_no bigint NOT NULL
);

-- Single row check
INSERT INTO waybill_counter (next_no)
SELECT 100001
WHERE NOT EXISTS (SELECT 1 FROM waybill_counter);

CREATE TABLE IF NOT EXISTS waybill_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  device_id uuid NOT NULL,
  from_no bigint NOT NULL,
  to_no bigint NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_waybill_blocks_sync
BEFORE INSERT OR UPDATE ON waybill_blocks
FOR EACH ROW EXECUTE FUNCTION set_sync_version();

-- 15. Settings
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  sv bigint NOT NULL DEFAULT nextval('sync_seq')
);

CREATE TRIGGER trg_settings_sync
BEFORE INSERT OR UPDATE ON settings
FOR EACH ROW EXECUTE FUNCTION set_sync_version();
