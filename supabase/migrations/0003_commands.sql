-- 0003_commands.sql
-- Server Command Processor and Waybill Reservation


-- Normalise Nigerian phone number in PL/pgSQL
CREATE OR REPLACE FUNCTION normalize_nigerian_phone(p_raw text)
RETURNS text AS $$
DECLARE
  v_digits text;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;
  v_digits := regexp_replace(p_raw, '\D', '', 'g');
  IF length(v_digits) = 13 AND substring(v_digits from 1 for 3) = '234' THEN
    RETURN '+' || v_digits;
  END IF;
  IF length(v_digits) = 11 AND substring(v_digits from 1 for 1) = '0' THEN
    RETURN '+234' || substring(v_digits from 2);
  END IF;
  IF length(v_digits) = 10 THEN
    RETURN '+234' || v_digits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION apply_commands(p_device_id uuid, p_commands jsonb)
RETURNS jsonb AS $$
DECLARE
  v_caller_id uuid;
  v_role text;
  v_caller_location uuid;
  v_results jsonb := '[]'::jsonb;
  v_cmd jsonb;
  v_cmd_id uuid;
  v_cmd_type text;
  v_recorded_at timestamptz;
  v_status text;
  v_reason text;
  v_existing RECORD;

  -- command variables
  v_shipment_id uuid;
  v_trip_id uuid;
  v_label_code text;
  v_waybill_no text;
  v_phone text;
  v_sender_phone text;
  v_origin_id uuid;
  v_destination_id uuid;
  v_pkg_record RECORD;
  v_shipment_record RECORD;
  v_trip_record RECORD;
  v_all_loaded boolean;
  v_code text;
  v_salt text;
  v_hash text;
  v_origin_name text;
  v_dest_name text;
  v_total_pkgs int;
  v_error_message text;
BEGIN
  v_caller_id := auth.uid();
  v_role := app_role();
  v_caller_location := my_location();

  FOR v_cmd IN SELECT * FROM jsonb_array_elements(p_commands)
  LOOP
    v_cmd_id := (v_cmd->>'id')::uuid;
    v_cmd_type := v_cmd->>'type';
    v_recorded_at := COALESCE((v_cmd->>'recorded_at')::timestamptz, now());
    v_status := 'rejected';
    v_reason := NULL;

    -- Sub-transaction per command
    BEGIN
      -- Idempotence: check commands_log
      SELECT status, reason INTO v_existing
      FROM commands_log
      WHERE id = v_cmd_id;

      IF FOUND THEN
        v_results := v_results || jsonb_build_object(
          'id', v_cmd_id,
          'status', v_existing.status,
          'reason', v_existing.reason
        );
        CONTINUE;
      END IF;

      -- Command 1: create_shipment
      IF v_cmd_type = 'create_shipment' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_shipment_id := (v_cmd->>'shipment_id')::uuid;
          v_waybill_no := v_cmd->>'waybill_no';
          v_origin_id := (v_cmd->>'origin_id')::uuid;
          v_destination_id := (v_cmd->>'destination_id')::uuid;

          -- Accept independently generated waybill numbers.
          -- Do not require the EO-<number> format or a reserved waybill block.
          IF v_waybill_no IS NULL OR btrim(v_waybill_no) = '' THEN
            v_reason := 'invalid_waybill';
          END IF;

          -- Check phone normalisation
          IF v_reason IS NULL THEN
            v_phone := normalize_nigerian_phone(v_cmd->>'receiver_phone');
            IF v_phone IS NULL THEN
              v_reason := 'bad_phone';
            END IF;
          END IF;

          -- Check endpoints
          IF v_reason IS NULL THEN
            IF v_origin_id = v_destination_id THEN
              v_reason := 'invalid_state::other by endpoints';
            END IF;
          END IF;

          -- Check packages present
          IF v_reason IS NULL THEN
            IF jsonb_array_length(v_cmd->'packages') = 0 THEN
              v_reason := 'invalid_state:other by package';
            END IF;
          END IF;
          IF v_reason IS NULL THEN
            v_sender_phone := normalize_nigerian_phone(v_cmd->>'sender_phone');

            IF v_sender_phone IS NULL THEN
              v_reason := 'bad_phone';
            END IF;
          END IF;
          IF v_reason IS NULL THEN
          
          
            -- Insert shipment
            INSERT INTO shipments (
              id,
              waybill_no,
              sender_name,
              sender_phone,
              receiver_name,
              receiver_phone,
              origin_id,
              destination_id,
              status,
              notes,
              created_by
            ) VALUES (
              v_shipment_id,
              v_waybill_no,
              v_cmd->>'sender_name',
              v_sender_phone,
              v_cmd->>'receiver_name',
              v_phone,
              v_origin_id,
              v_destination_id,
              'registered',
              v_cmd->>'notes',
              v_caller_id
            );

            -- Insert packages and custody events
            FOR v_pkg_record IN
              SELECT
                (value->>'package_id')::uuid AS package_id,
                (value->>'seq')::smallint AS seq,
                value->>'description' AS description,
                COALESCE((value->>'qty')::int, 1) AS qty,
                value->>'photo_path' AS photo_path
              FROM jsonb_array_elements(v_cmd->'packages')
            LOOP
              INSERT INTO packages (
                id, shipment_id, seq, label_code, description, qty, photo_path, status
              ) VALUES (
                v_pkg_record.package_id, v_shipment_id, v_pkg_record.seq,
                v_waybill_no || '-' || v_pkg_record.seq,
                v_pkg_record.description, v_pkg_record.qty, v_pkg_record.photo_path, 'registered'
              );

              INSERT INTO custody_events (
                shipment_id, package_id, type, actor_id, recorded_at
              ) VALUES (
                v_shipment_id, v_pkg_record.package_id, 'registered', v_caller_id, v_recorded_at
              );
            END LOOP;

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 2: create_trip
      ELSIF v_cmd_type = 'create_trip' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          v_origin_id := (v_cmd->>'origin_id')::uuid;
          v_destination_id := (v_cmd->>'destination_id')::uuid;

          IF v_origin_id = v_destination_id THEN
            v_reason := 'invalid_state';
          ELSIF EXISTS (
            SELECT 1 FROM trips
            WHERE driver_id = (v_cmd->>'driver_id')::uuid
              AND status IN ('loading', 'in_transit')
          ) THEN
            v_reason := 'driver_busy';
          ELSIF EXISTS (
            SELECT 1 FROM trips
            WHERE vehicle_id = (v_cmd->>'vehicle_id')::uuid
              AND status IN ('loading', 'in_transit')
          ) THEN
            v_reason := 'vehicle_busy';
          ELSE
            INSERT INTO trips (
              id, vehicle_id, driver_id, origin_id, destination_id, status, created_by
            ) VALUES (
              v_trip_id,
              (v_cmd->>'vehicle_id')::uuid,
              (v_cmd->>'driver_id')::uuid,
              v_origin_id,
              v_destination_id,
              'loading',
              v_caller_id
            );
            v_status := 'applied';
          END IF;
        END IF;

      -- Command 3: load_scan
      ELSIF v_cmd_type = 'load_scan' THEN
        IF v_role <> 'driver' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          v_label_code := v_cmd->>'label_code';

          -- 1. own trip with status 'loading'
          SELECT * INTO v_trip_record FROM trips WHERE id = v_trip_id;
          IF NOT FOUND OR v_trip_record.driver_id <> v_caller_id OR v_trip_record.status <> 'loading' THEN
            v_reason := 'not_your_trip';
          ELSE
            -- 2. label exists
            SELECT p.*, s.origin_id AS s_origin, s.destination_id AS s_dest
            INTO v_pkg_record
            FROM packages p
            JOIN shipments s ON s.id = p.shipment_id
            WHERE p.label_code = v_label_code;

            IF NOT FOUND THEN
              v_reason := 'unknown_label';
            -- 3. package registered (else already_scanned if loaded, else invalid_state)
            ELSIF v_pkg_record.status = 'loaded' THEN
              v_reason := 'already_scanned';
            ELSIF v_pkg_record.status <> 'registered' THEN
              v_reason := 'invalid_state';
            -- 4. origin and destination equal trip's
            ELSIF v_pkg_record.s_origin <> v_trip_record.origin_id OR v_pkg_record.s_dest <> v_trip_record.destination_id THEN
              v_reason := 'wrong_destination';
            -- 5. current_trip_id null or this trip
            ELSIF v_pkg_record.current_trip_id IS NOT NULL AND v_pkg_record.current_trip_id <> v_trip_id THEN
              v_reason := 'wrong_trip';
            ELSE
              -- Effects
              UPDATE packages
              SET status = 'loaded',
                  current_trip_id = v_trip_id,
                  current_holder_id = v_caller_id,
                  loaded_at = v_recorded_at
              WHERE id = v_pkg_record.id;

              INSERT INTO custody_events (
                shipment_id, package_id, type, actor_id, trip_id, lat, lng, recorded_at
              ) VALUES (
                v_pkg_record.shipment_id, v_pkg_record.id, 'loaded', v_caller_id, v_trip_id,
                (v_cmd->>'lat')::double precision, (v_cmd->>'lng')::double precision, v_recorded_at
              );

              -- shipment 'loaded' once all its packages are loaded
              IF NOT EXISTS (
                SELECT 1 FROM packages
                WHERE shipment_id = v_pkg_record.shipment_id
                  AND status <> 'loaded'
              ) THEN
                UPDATE shipments SET status = 'loaded' WHERE id = v_pkg_record.shipment_id;
              END IF;

              v_status := 'applied';
            END IF;
          END IF;
        END IF;

      -- Command 4: confirm_loading
      ELSIF v_cmd_type = 'confirm_loading' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          UPDATE trips
          SET loading_confirmed_by = COALESCE(loading_confirmed_by, v_caller_id),
              loading_confirmed_at = COALESCE(loading_confirmed_at, now())
          WHERE id = v_trip_id;

          IF FOUND THEN
            v_status := 'applied';
          ELSE
            v_reason := 'invalid_state';
          END IF;
        END IF;

      -- Command 5: start_trip
      ELSIF v_cmd_type = 'start_trip' THEN
        IF v_role <> 'driver' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          SELECT * INTO v_trip_record FROM trips WHERE id = v_trip_id;

          IF NOT FOUND OR v_trip_record.driver_id <> v_caller_id THEN
            v_reason := 'not_your_trip';
          ELSIF v_trip_record.status <> 'loading' THEN
            v_reason := 'invalid_state';
          ELSIF NOT EXISTS (
            SELECT 1 FROM packages WHERE current_trip_id = v_trip_id AND status = 'loaded'
          ) THEN
            v_reason := 'invalid_state';
          ELSE
            UPDATE trips
            SET status = 'in_transit', started_at = v_recorded_at
            WHERE id = v_trip_id;

            -- shipments with all packages loaded become 'in_transit'; partial become 'issue'
            FOR v_shipment_record IN
              SELECT DISTINCT s.id
              FROM shipments s
              JOIN packages p ON p.shipment_id = s.id
              WHERE p.current_trip_id = v_trip_id
            LOOP
              IF NOT EXISTS (
                SELECT 1 FROM packages
                WHERE shipment_id = v_shipment_record.id
                  AND (status <> 'loaded' OR current_trip_id <> v_trip_id)
              ) THEN
                UPDATE shipments SET status = 'in_transit' WHERE id = v_shipment_record.id;
              ELSE
                UPDATE shipments
                SET status = 'issue', issue_reason = 'Not all packages were loaded.'
                WHERE id = v_shipment_record.id;
              END IF;
            END LOOP;

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 6: push_pings
      ELSIF v_cmd_type = 'push_pings' THEN
        IF v_role <> 'driver' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          SELECT * INTO v_trip_record FROM trips WHERE id = v_trip_id;

          IF NOT FOUND OR v_trip_record.driver_id <> v_caller_id THEN
            v_reason := 'not_your_trip';
          ELSIF v_trip_record.status <> 'in_transit' THEN
            v_reason := 'invalid_state';
          ELSE
            -- Insert location_pings ON CONFLICT DO NOTHING
            INSERT INTO location_pings (trip_id, lat, lng, speed_mps, accuracy_m, recorded_at)
            SELECT
              v_trip_id,
              (p->>'lat')::double precision,
              (p->>'lng')::double precision,
              (p->>'speed_mps')::double precision,
              (p->>'accuracy_m')::double precision,
              (p->>'recorded_at')::timestamptz
            FROM jsonb_array_elements(v_cmd->'pings') AS p
            ON CONFLICT (trip_id, recorded_at) DO NOTHING;

            -- Update trips last_lat, last_lng, last_ping_at from newest ping
            SELECT (p->>'lat')::double precision, (p->>'lng')::double precision, (p->>'recorded_at')::timestamptz
            INTO v_trip_record.last_lat, v_trip_record.last_lng, v_trip_record.last_ping_at
            FROM jsonb_array_elements(v_cmd->'pings') AS p
            ORDER BY (p->>'recorded_at')::timestamptz DESC
            LIMIT 1;

            UPDATE trips
            SET last_lat = v_trip_record.last_lat,
                last_lng = v_trip_record.last_lng,
                last_ping_at = v_trip_record.last_ping_at
            WHERE id = v_trip_id;

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 7: arrive_trip
      ELSIF v_cmd_type = 'arrive_trip' THEN
        IF v_role <> 'driver' THEN
          v_reason := 'not_allowed';
        ELSE
          v_trip_id := (v_cmd->>'trip_id')::uuid;
          SELECT * INTO v_trip_record FROM trips WHERE id = v_trip_id;

          IF NOT FOUND OR v_trip_record.driver_id <> v_caller_id THEN
            v_reason := 'not_your_trip';
          ELSIF v_trip_record.status <> 'in_transit' THEN
            v_reason := 'invalid_state';
          ELSE
            UPDATE trips
            SET status = 'arrived', arrived_at = v_recorded_at
            WHERE id = v_trip_id;

            UPDATE shipments
            SET status = 'arrived'
            WHERE status = 'in_transit'
              AND id IN (SELECT shipment_id FROM packages WHERE current_trip_id = v_trip_id);

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 8: receive_item
      ELSIF v_cmd_type = 'receive_item' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_label_code := v_cmd->>'label_code';

          -- 1. label exists
          SELECT p.*, s.destination_id AS s_dest, s.waybill_no AS s_waybill,
                 s.origin_id AS s_origin, s.receiver_phone AS s_phone,
                 t.status AS t_status
          INTO v_pkg_record
          FROM packages p
          JOIN shipments s ON s.id = p.shipment_id
          LEFT JOIN trips t ON t.id = p.current_trip_id
          WHERE p.label_code = v_label_code;

          IF NOT FOUND THEN
            v_reason := 'unknown_label';
          -- 2. package 'loaded' (already_received if arrived or delivered)
          ELSIF v_pkg_record.status IN ('arrived', 'delivered') THEN
            v_reason := 'already_received';
          ELSIF v_pkg_record.status <> 'loaded' THEN
            v_reason := 'invalid_state';
          -- 3. its trip 'arrived'
          ELSIF v_pkg_record.t_status <> 'arrived' THEN
            v_reason := 'trip_not_arrived';
          -- 4. my_location() = shipment.destination_id
          ELSIF v_caller_location IS NULL OR v_caller_location <> v_pkg_record.s_dest THEN
            v_reason := 'wrong_branch';
          -- 5. condition in ('ok','damaged','opened')
          ELSIF v_cmd->>'condition' NOT IN ('ok', 'damaged', 'opened') THEN
            v_reason := 'invalid_state';
          -- 6. non-ok needs arrival_photo_path
          ELSIF v_cmd->>'condition' <> 'ok' AND (v_cmd->>'arrival_photo_path' IS NULL OR v_cmd->>'arrival_photo_path' = '') THEN
            v_reason := 'missing_photo';
          ELSE
            -- Effects
            SELECT count(*) INTO v_total_pkgs FROM packages WHERE shipment_id = v_pkg_record.shipment_id;

            UPDATE packages
            SET status = 'arrived',
                condition = v_cmd->>'condition',
                arrival_photo_path = v_cmd->>'arrival_photo_path',
                arrival_note = v_cmd->>'note',
                arrived_at = v_recorded_at
            WHERE id = v_pkg_record.id;

            INSERT INTO custody_events (
              shipment_id, package_id, type, actor_id, trip_id, lat, lng, note, photo_path, recorded_at
            ) VALUES (
              v_pkg_record.shipment_id, v_pkg_record.id, 'arrived', v_caller_id, v_pkg_record.current_trip_id,
              (v_cmd->>'lat')::double precision, (v_cmd->>'lng')::double precision,
              v_cmd->>'note', v_cmd->>'arrival_photo_path', v_recorded_at
            );

            -- If non-ok, issue custody event and mark shipment issue
            IF v_cmd->>'condition' <> 'ok' THEN
              INSERT INTO custody_events (
                shipment_id, package_id, type, actor_id, note, photo_path, recorded_at
              ) VALUES (
                v_pkg_record.shipment_id, v_pkg_record.id, 'issue', v_caller_id,
                initcap(v_cmd->>'condition') || ' item ' || v_pkg_record.seq || ' of ' || v_total_pkgs || COALESCE(': ' || (v_cmd->>'note'), ''),
                v_cmd->>'arrival_photo_path', v_recorded_at
              );

              UPDATE shipments
              SET status = 'issue',
                  issue_reason = initcap(v_cmd->>'condition') || ' item ' || v_pkg_record.seq || ' of ' || v_total_pkgs || COALESCE(' - ' || (v_cmd->>'note'), '')
              WHERE id = v_pkg_record.shipment_id;
            END IF;

            -- Check if every package of shipment is 'arrived'
            IF NOT EXISTS (
              SELECT 1 FROM packages
              WHERE shipment_id = v_pkg_record.shipment_id
                AND status <> 'arrived'
            ) THEN
              UPDATE shipments SET ready_at = now() WHERE id = v_pkg_record.shipment_id;

              -- Random 6 digits code and salt
              v_code := lpad(floor(random() * 1000000)::text, 6, '0');
              v_salt := encode(gen_random_bytes(16), 'hex');
              v_hash := encode(digest(v_salt || v_code, 'sha256'), 'hex');

              INSERT INTO pickup_codes (shipment_id, salt, code_hash)
              VALUES (v_pkg_record.shipment_id, v_salt, v_hash)
              ON CONFLICT (shipment_id) DO UPDATE
              SET salt = EXCLUDED.salt, code_hash = EXCLUDED.code_hash;

              SELECT name INTO v_origin_name FROM locations WHERE id = v_pkg_record.s_origin;
              SELECT name INTO v_dest_name FROM locations WHERE id = v_pkg_record.s_dest;

              INSERT INTO sms_outbox (shipment_id, to_phone, template, body, status)
              VALUES (
                v_pkg_record.shipment_id,
                v_pkg_record.s_phone,
                'ready_for_collection',
                'Your goods ' || v_pkg_record.s_waybill || ' from ' || COALESCE(v_origin_name, 'origin') || ' have arrived in ' || COALESCE(v_dest_name, 'destination') || '. Pickup code: ' || v_code || '. Bring a valid ID.',
                'queued'
              );
            END IF;

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 9: record_contact
      ELSIF v_cmd_type = 'record_contact' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_shipment_id := (v_cmd->>'shipment_id')::uuid;
          IF NOT EXISTS (SELECT 1 FROM shipments WHERE id = v_shipment_id) THEN
            v_reason := 'invalid_state';
          ELSIF v_cmd->>'channel' NOT IN ('call', 'sms') OR v_cmd->>'outcome' NOT IN ('reached', 'no_answer', 'wrong_number', 'sent') THEN
            v_reason := 'invalid_state';
          ELSE
            INSERT INTO contact_attempts (id, shipment_id, user_id, channel, outcome, note, recorded_at)
            VALUES (
              (v_cmd->>'contact_id')::uuid,
              v_shipment_id,
              v_caller_id,
              v_cmd->>'channel',
              v_cmd->>'outcome',
              v_cmd->>'note',
              v_recorded_at
            );
            v_status := 'applied';
          END IF;
        END IF;

      -- Command 10: collect_shipment
      ELSIF v_cmd_type = 'collect_shipment' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_shipment_id := (v_cmd->>'shipment_id')::uuid;
          SELECT * INTO v_shipment_record FROM shipments WHERE id = v_shipment_id;

          IF NOT FOUND THEN
            v_reason := 'invalid_state';
          ELSIF EXISTS (
            SELECT 1 FROM packages WHERE shipment_id = v_shipment_id AND status <> 'arrived'
          ) THEN
            v_reason := 'invalid_state';
          ELSIF v_caller_location IS NULL OR v_caller_location <> v_shipment_record.destination_id THEN
            v_reason := 'wrong_branch';
          ELSIF v_cmd->>'verified_by' = 'code' THEN
            SELECT * INTO v_existing FROM pickup_codes WHERE shipment_id = v_shipment_id;
            IF NOT FOUND OR encode(digest(v_existing.salt || (v_cmd->>'pickup_code'), 'sha256'), 'hex') <> v_existing.code_hash THEN
              v_reason := 'bad_code';
            END IF;
          ELSIF v_cmd->>'verified_by' = 'call' THEN
            IF NOT EXISTS (
              SELECT 1 FROM contact_attempts
              WHERE shipment_id = v_shipment_id AND channel = 'call' AND outcome = 'reached'
            ) THEN
              v_reason := 'call_not_logged';
            END IF;
          END IF;

          IF v_reason IS NULL THEN
            IF (v_cmd->>'collector_is_receiver')::boolean = false THEN
              IF v_cmd->>'collector_name' IS NULL OR v_cmd->>'collector_name' = '' OR
                 v_cmd->>'relationship' IS NULL OR v_cmd->>'relationship' = '' THEN
                v_reason := 'invalid_state';
              END IF;
            END IF;
          END IF;

          IF v_reason IS NULL THEN
            IF v_cmd->>'photo_path' IS NULL OR v_cmd->>'photo_path' = '' OR
               v_cmd->>'signature_path' IS NULL OR v_cmd->>'signature_path' = '' THEN
              v_reason := 'missing_photo';
            END IF;
          END IF;

          IF v_reason IS NULL THEN
            INSERT INTO collections (
              shipment_id, collector_name, collector_is_receiver, relationship,
              id_checked, id_type, verified_by, photo_path, signature_path,
              lat, lng, collected_by, collected_at
            ) VALUES (
              v_shipment_id,
              v_cmd->>'collector_name',
              (v_cmd->>'collector_is_receiver')::boolean,
              v_cmd->>'relationship',
              (v_cmd->>'id_checked')::boolean,
              v_cmd->>'id_type',
              v_cmd->>'verified_by',
              v_cmd->>'photo_path',
              v_cmd->>'signature_path',
              (v_cmd->>'lat')::double precision,
              (v_cmd->>'lng')::double precision,
              v_caller_id,
              v_recorded_at
            );

            UPDATE packages
            SET status = 'delivered', delivered_at = v_recorded_at
            WHERE shipment_id = v_shipment_id;

            FOR v_pkg_record IN SELECT id FROM packages WHERE shipment_id = v_shipment_id
            LOOP
              INSERT INTO custody_events (
                shipment_id, package_id, type, actor_id, lat, lng, recorded_at
              ) VALUES (
                v_shipment_id, v_pkg_record.id, 'delivered', v_caller_id,
                (v_cmd->>'lat')::double precision, (v_cmd->>'lng')::double precision, v_recorded_at
              );
            END LOOP;

            UPDATE shipments
            SET status = 'delivered', delivered_at = v_recorded_at
            WHERE id = v_shipment_id;

            v_status := 'applied';
          END IF;
        END IF;

      -- Command 11: flag_issue
      ELSIF v_cmd_type = 'flag_issue' THEN
        IF v_role <> 'manager' THEN
          v_reason := 'not_allowed';
        ELSE
          v_shipment_id := (v_cmd->>'shipment_id')::uuid;
          IF v_cmd->>'reason' IS NULL OR trim(v_cmd->>'reason') = '' THEN
            v_reason := 'invalid_state';
          ELSE
            SELECT * INTO v_shipment_record FROM shipments WHERE id = v_shipment_id;
            IF NOT FOUND OR v_shipment_record.status = 'delivered' THEN
              v_reason := 'invalid_state';
            ELSE
              UPDATE shipments
              SET status = 'issue', issue_reason = v_cmd->>'reason'
              WHERE id = v_shipment_id;

              INSERT INTO custody_events (
                shipment_id, package_id, type, actor_id, note, recorded_at
              ) VALUES (
                v_shipment_id, NULL, 'issue', v_caller_id, v_cmd->>'reason', v_recorded_at
              );

              v_status := 'applied';
            END IF;
          END IF;
        END IF;

      ELSE
        v_reason := 'invalid_state';
      END IF;
      EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
          v_error_message = MESSAGE_TEXT;

        RAISE LOG 'apply_commands error: command_id=%, type=%, error=%',
          v_cmd_id, v_cmd_type, v_error_message;

        v_status := 'rejected';
        v_reason := 'database_error';
      END;

    EXCEPTION WHEN OTHERS THEN
      v_status := 'rejected';
      v_reason := COALESCE(v_reason, 'invalid_state');
    END;

    -- Record command outcome in commands_log
    INSERT INTO commands_log (id, user_id, device_id, type, status, reason)
    VALUES (v_cmd_id, v_caller_id, p_device_id, v_cmd_type, v_status, v_reason);

    v_results := v_results || jsonb_build_object(
      'id', v_cmd_id,
      'status', v_status,
      'reason', v_reason
    );
  END LOOP;

  RETURN v_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions;
