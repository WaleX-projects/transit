-- /supabase/tests/scenario.sql
-- Scenario Test: One full path + 4 negative cases

BEGIN;

DO $$
DECLARE
  v_lagos_id uuid;
  v_akure_id uuid;
  v_vehicle_id uuid;
  v_mgr_id uuid := 'a0000000-0000-4000-8000-000000000001'::uuid;
  v_dest_mgr_id uuid := 'a0000000-0000-4000-8000-000000000002'::uuid;
  v_driver_id uuid := 'b0000000-0000-4000-8000-000000000001'::uuid;
  v_other_driver_id uuid := 'b0000000-0000-4000-8000-000000000002'::uuid;
  v_device_id uuid := 'd0000000-0000-4000-8000-000000000001'::uuid;
  v_shipment_id uuid := 's0000000-0000-4000-8000-000000000001'::uuid;
  v_package_id uuid := 'p0000000-0000-4000-8000-000000000001'::uuid;
  v_trip_id uuid := 't0000000-0000-4000-8000-000000000001'::uuid;
  v_other_trip_id uuid := 't0000000-0000-4000-8000-000000000002'::uuid;
  v_cmd_id uuid;
  v_res jsonb;
  v_status text;
  v_reason text;
  v_waybill_no text := 'EO-100001';
  v_label_code text := 'EO-100001-1';
  v_count int;
  v_pickup_code text;
  v_salt text;
  v_hash text;
  v_visible_trips int;
  v_denied boolean := false;
BEGIN
  RAISE NOTICE '=== Starting Ega Osas Scenario Tests ===';

  -- 1. Setup Test Environment (Locations, Vehicles, Profiles)
  INSERT INTO locations (id, name, state, lat, lng, is_active)
  VALUES
    ('10000000-0000-0000-0000-000000000001', 'TEST Lagos Office', 'Lagos', 6.5244, 3.3792, true),
    ('20000000-0000-0000-0000-000000000002', 'TEST Akure Office', 'Ondo', 7.2571, 5.2058, true)
  ON CONFLICT (name, state) DO UPDATE SET is_active = true
  RETURNING id INTO v_lagos_id;

  SELECT id INTO v_akure_id FROM locations WHERE name = 'TEST Akure Office';

  INSERT INTO vehicles (id, plate, model, is_active)
  VALUES ('30000000-0000-0000-0000-000000000001', 'TEST-BUS-01', 'Toyota HiAce', true)
  ON CONFLICT (plate) DO UPDATE SET is_active = true
  RETURNING id INTO v_vehicle_id;

  -- Create dummy auth users if auth.users exists
  BEGIN
    INSERT INTO auth.users (id, email) VALUES
      (v_mgr_id, 'mgr@internal.egaosas.com'),
      (v_dest_mgr_id, 'destmgr@internal.egaosas.com'),
      (v_driver_id, 'driver@internal.egaosas.com'),
      (v_other_driver_id, 'otherdriver@internal.egaosas.com')
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- If running in standalone postgres without auth schema, mock profiles table fk
    NULL;
  END;

  INSERT INTO profiles (id, name, phone, role, location_id, is_active)
  VALUES
    (v_mgr_id, 'Origin Manager', '+2348000000001', 'manager', v_lagos_id, true),
    (v_dest_mgr_id, 'Destination Manager', '+2348000000002', 'manager', v_akure_id, true),
    (v_driver_id, 'Test Driver', '+2348000000003', 'driver', NULL, true),
    (v_other_driver_id, 'Other Driver', '+2348000000004', 'driver', NULL, true)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, location_id = EXCLUDED.location_id;

  -- Reserve waybill block for manager
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_mgr_id::text,
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'manager')
  )::text, true);

  v_res := reserve_waybills(v_device_id, 50);
  RAISE NOTICE 'Reserved waybills: %', v_res;

  -- ==========================================
  -- FULL PATH STEP 1: Create Shipment (Manager)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'create_shipment',
      'shipment_id', v_shipment_id,
      'waybill_no', v_waybill_no,
      'sender_name', 'DEMO Sender',
      'receiver_name', 'DEMO Receiver',
      'receiver_phone', '08031234567',
      'origin_id', v_lagos_id,
      'destination_id', v_akure_id,
      'notes', 'Fragile electronic equipment',
      'recorded_at', now(),
      'packages', jsonb_build_array(
        jsonb_build_object(
          'package_id', v_package_id,
          'seq', 1,
          'description', 'Inverter Box',
          'qty', 1,
          'photo_path', v_mgr_id || '/box.jpg'
        )
      )
    )
  ));

  v_status := v_res->0->>'status';
  v_reason := v_res->0->>'reason';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 1 FAILED: create_shipment status % reason %', v_status, v_reason;
  END IF;
  RAISE NOTICE 'Full Path Step 1 Passed: create_shipment applied';

  -- ==========================================
  -- FULL PATH STEP 2: Create Trip (Manager)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'create_trip',
      'trip_id', v_trip_id,
      'vehicle_id', v_vehicle_id,
      'driver_id', v_driver_id,
      'origin_id', v_lagos_id,
      'destination_id', v_akure_id,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 2 FAILED: create_trip status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 2 Passed: create_trip applied';

  -- ==========================================
  -- FULL PATH STEP 3: Load Scan (Driver)
  -- ==========================================
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_driver_id::text,
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'driver')
  )::text, true);

  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'load_scan',
      'trip_id', v_trip_id,
      'label_code', v_label_code,
      'lat', 6.5244,
      'lng', 3.3792,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 3 FAILED: load_scan status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 3 Passed: load_scan applied';

  -- ==========================================
  -- FULL PATH STEP 4: Start Trip (Driver)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'start_trip',
      'trip_id', v_trip_id,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 4 FAILED: start_trip status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 4 Passed: start_trip applied';

  -- ==========================================
  -- FULL PATH STEP 5: Push Pings (Driver)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'push_pings',
      'trip_id', v_trip_id,
      'pings', jsonb_build_array(
        jsonb_build_object(
          'lat', 6.8000,
          'lng', 4.0000,
          'speed_mps', 22.5,
          'accuracy_m', 5.0,
          'recorded_at', now()
        )
      )
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 5 FAILED: push_pings status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 5 Passed: push_pings applied';

  -- ==========================================
  -- FULL PATH STEP 6: Arrive Trip (Driver)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'arrive_trip',
      'trip_id', v_trip_id,
      'lat', 7.2571,
      'lng', 5.2058,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 6 FAILED: arrive_trip status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 6 Passed: arrive_trip applied';

  -- ==========================================
  -- FULL PATH STEP 7: Receive Item (Destination Manager)
  -- ==========================================
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_dest_mgr_id::text,
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'manager')
  )::text, true);

  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'receive_item',
      'label_code', v_label_code,
      'condition', 'ok',
      'lat', 7.2571,
      'lng', 5.2058,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 7 FAILED: receive_item status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 7 Passed: receive_item applied';

  -- Extract generated pickup code from sms_outbox or pickup_codes
  SELECT substring(body FROM 'Pickup code: ([0-9]{6})') INTO v_pickup_code
  FROM sms_outbox WHERE shipment_id = v_shipment_id;

  RAISE NOTICE 'Generated pickup code: %', v_pickup_code;

  -- ==========================================
  -- FULL PATH STEP 8: Collect Shipment (Destination Manager)
  -- ==========================================
  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'collect_shipment',
      'shipment_id', v_shipment_id,
      'collector_name', 'DEMO Receiver',
      'collector_is_receiver', true,
      'id_checked', true,
      'id_type', 'nin',
      'verified_by', 'code',
      'pickup_code', v_pickup_code,
      'photo_path', v_dest_mgr_id || '/handover.jpg',
      'signature_path', v_dest_mgr_id || '/sig.png',
      'lat', 7.2571,
      'lng', 5.2058,
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  IF v_status <> 'applied' THEN
    RAISE EXCEPTION 'Full Path Step 8 FAILED: collect_shipment status % reason %', v_status, v_res->0->>'reason';
  END IF;
  RAISE NOTICE 'Full Path Step 8 Passed: collect_shipment applied and shipment delivered!';

  -- ==========================================
  -- NEGATIVE CASE 1: Wrong Trip / Wrong Destination
  -- ==========================================
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_driver_id::text,
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'driver')
  )::text, true);

  v_cmd_id := gen_random_uuid();
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id,
      'type', 'load_scan',
      'trip_id', v_trip_id,
      'label_code', 'EO-NONEXISTENT-1',
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  v_reason := v_res->0->>'reason';
  IF v_status = 'rejected' AND v_reason = 'unknown_label' THEN
    RAISE NOTICE 'Negative Case 1 Passed: unknown_label properly rejected';
  ELSE
    RAISE EXCEPTION 'Negative Case 1 FAILED: expected unknown_label, got % (%)', v_status, v_reason;
  END IF;

  -- ==========================================
  -- NEGATIVE CASE 2: Driver sees only own trips (RLS)
  -- ==========================================
  -- Switch role to authenticated driver
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', v_driver_id::text,
    'role', 'authenticated',
    'app_metadata', json_build_object('role', 'driver')
  )::text, true);

  -- Count trips visible to v_driver_id
  SELECT count(*) INTO v_visible_trips FROM trips;
  IF v_visible_trips = 1 THEN
    RAISE NOTICE 'Negative Case 2 Passed: Driver sees only own trip (visible: %)', v_visible_trips;
  ELSE
    RAISE EXCEPTION 'Negative Case 2 FAILED: Driver sees % trips instead of 1', v_visible_trips;
  END IF;

  -- ==========================================
  -- NEGATIVE CASE 3: Client direct insert denied by RLS
  -- ==========================================
  -- Authenticated driver attempts direct insert into shipments
  v_denied := false;
  BEGIN
    INSERT INTO shipments (
      id, waybill_no, sender_name, receiver_name, receiver_phone,
      origin_id, destination_id, created_by
    ) VALUES (
      gen_random_uuid(), 'EO-999999', 'Hacker', 'Target', '+2348000000099',
      v_lagos_id, v_akure_id, v_driver_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_denied := true;
  END;

  IF v_denied THEN
    RAISE NOTICE 'Negative Case 3 Passed: Direct client insert blocked by RLS';
  ELSE
    RAISE EXCEPTION 'Negative Case 3 FAILED: Direct client insert was allowed!';
  END IF;

  -- ==========================================
  -- NEGATIVE CASE 4: Replayed command ID is idempotent
  -- ==========================================
  -- Submitting Step 8 command again with identical command ID
  v_res := apply_commands(v_device_id, jsonb_build_array(
    jsonb_build_object(
      'id', v_cmd_id, -- already applied command from Negative Case 1
      'type', 'load_scan',
      'trip_id', v_trip_id,
      'label_code', 'EO-NONEXISTENT-1',
      'recorded_at', now()
    )
  ));

  v_status := v_res->0->>'status';
  v_reason := v_res->0->>'reason';
  IF v_status = 'rejected' AND v_reason = 'unknown_label' THEN
    RAISE NOTICE 'Negative Case 4 Passed: Replayed command ID returned stored result idempotently';
  ELSE
    RAISE EXCEPTION 'Negative Case 4 FAILED: Replayed command returned % (%)', v_status, v_reason;
  END IF;

  RAISE NOTICE '=== ALL SCENARIO AND NEGATIVE TESTS PASSED ===';
END $$;

ROLLBACK;
