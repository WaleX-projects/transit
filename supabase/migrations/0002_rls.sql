-- 0002_rls.sql
-- Row Level Security and Helper Functions

-- Helper: app_role() reads auth.jwt()->'app_metadata'->>'role'
CREATE OR REPLACE FUNCTION app_role()
RETURNS text AS $$
  SELECT COALESCE(
    auth.jwt() -> 'app_metadata' ->> 'role',
    (SELECT role FROM profiles WHERE id = auth.uid())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: my_location() reads profiles.location_id for auth.uid()
CREATE OR REPLACE FUNCTION my_location()
RETURNS uuid AS $$
  SELECT location_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Enable RLS on all tables
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pickup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE location_pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE commands_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE waybill_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE waybill_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- 1. locations, vehicles, profiles, settings = any authenticated
CREATE POLICY "locations_select_auth" ON locations
FOR SELECT TO authenticated USING (true);

CREATE POLICY "vehicles_select_auth" ON vehicles
FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_select_auth" ON profiles
FOR SELECT TO authenticated USING (true);

CREATE POLICY "settings_select_auth" ON settings
FOR SELECT TO authenticated USING (true);

-- 2. trips = manager all, driver where driver_id = auth.uid()
CREATE POLICY "trips_select_policy" ON trips
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
  OR (app_role() = 'driver' AND driver_id = auth.uid())
);

-- 3. shipments = manager all; driver only where package's current_trip_id is in own trips
--    OR (shipment.origin_id and destination_id equal origin and destination of one of own trips with status 'loading', and shipment is not delivered)
CREATE POLICY "shipments_select_policy" ON shipments
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
  OR (
    app_role() = 'driver' AND (
      id IN (
        SELECT p.shipment_id FROM packages p
        JOIN trips t ON t.id = p.current_trip_id
        WHERE t.driver_id = auth.uid()
      )
      OR (
        status <> 'delivered' AND EXISTS (
          SELECT 1 FROM trips t
          WHERE t.driver_id = auth.uid()
            AND t.status = 'loading'
            AND t.origin_id = shipments.origin_id
            AND t.destination_id = shipments.destination_id
        )
      )
    )
  )
);

-- 4. packages = manager all; driver only where package current_trip_id is in own trips
--    OR (shipment origin and destination equal own loading trip and shipment is not delivered)
CREATE POLICY "packages_select_policy" ON packages
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
  OR (
    app_role() = 'driver' AND (
      current_trip_id IN (
        SELECT id FROM trips WHERE driver_id = auth.uid()
      )
      OR (
        status <> 'delivered' AND EXISTS (
          SELECT 1 FROM trips t
          JOIN shipments s ON s.id = packages.shipment_id
          WHERE t.driver_id = auth.uid()
            AND t.status = 'loading'
            AND t.origin_id = s.origin_id
            AND t.destination_id = s.destination_id
        )
      )
    )
  )
);

-- 5. custody_events = manager all; driver where trip in own trips or package on own trips
CREATE POLICY "custody_events_select_policy" ON custody_events
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
  OR (
    app_role() = 'driver' AND (
      trip_id IN (
        SELECT id FROM trips WHERE driver_id = auth.uid()
      )
      OR package_id IN (
        SELECT p.id FROM packages p
        JOIN trips t ON t.id = p.current_trip_id
        WHERE t.driver_id = auth.uid()
      )
    )
  )
);

-- 6. collections, contact_attempts = manager only
CREATE POLICY "collections_select_policy" ON collections
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
);

CREATE POLICY "contact_attempts_select_policy" ON contact_attempts
FOR SELECT TO authenticated USING (
  app_role() = 'manager'
);

-- 7. pickup_codes = manager where shipment.destination_id = my_location()
CREATE POLICY "pickup_codes_select_policy" ON pickup_codes
FOR SELECT TO authenticated USING (
  app_role() = 'manager' AND EXISTS (
    SELECT 1 FROM shipments s
    WHERE s.id = pickup_codes.shipment_id
      AND s.destination_id = my_location()
  )
);

-- 8. commands_log and waybill_blocks = own rows
CREATE POLICY "commands_log_select_policy" ON commands_log
FOR SELECT TO authenticated USING (
  user_id = auth.uid()
);

CREATE POLICY "waybill_blocks_select_policy" ON waybill_blocks
FOR SELECT TO authenticated USING (
  user_id = auth.uid()
);

-- Note: location_pings and sms_outbox have no select policy (no client access)
-- Note: waybill_counter has no select policy (accessed via reserve_waybills)
-- Note: NO insert, update, or delete policies exist on any table.
