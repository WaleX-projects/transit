import * as Crypto from 'expo-crypto';
import { formatLabelCode, normalizePhone } from '../lib/format';
import { getDb } from './db';

export interface CommandPayloadMap {
  create_shipment: {
    shipment_id: string;
    waybill_no: string;
    sender_name: string;
    sender_phone: string;
    receiver_name: string;
    receiver_phone: string;
    origin_id: string;
    destination_id: string;
    notes?: string;
    packages: Array<{
      package_id: string;
      seq: number;
      description: string;
      qty: number;
      photo_path: string;
    }>;
  };
  create_trip: {
    trip_id: string;
    vehicle_id: string;
    driver_id: string;
    origin_id: string;
    destination_id: string;
  };
  load_scan: {
    trip_id: string;
    label_code: string;
    lat?: number | null;
    lng?: number | null;
  };
  confirm_loading: {
    trip_id: string;
  };
  start_trip: {
    trip_id: string;
  };
  push_pings: {
    trip_id: string;
    pings: Array<{
      lat: number;
      lng: number;
      speed_mps?: number | null;
      accuracy_m?: number | null;
      recorded_at: string;
    }>;
  };
  arrive_trip: {
    trip_id: string;
    lat?: number | null;
    lng?: number | null;
  };
  receive_item: {
    label_code: string;
    condition: 'ok' | 'damaged' | 'opened';
    note?: string | null;
    arrival_photo_path?: string | null;
    lat?: number | null;
    lng?: number | null;
  };
  record_contact: {
    contact_id: string;
    shipment_id: string;
    channel: 'call' | 'sms';
    outcome: 'reached' | 'no_answer' | 'wrong_number' | 'sent';
    note?: string | null;
  };
  collect_shipment: {
    shipment_id: string;
    collector_name: string;
    collector_is_receiver: boolean;
    relationship?: string | null;
    id_checked: boolean;
    id_type?: 'nin' | 'drivers_licence' | 'voters_card' | 'passport' | 'other' | null;
    verified_by: 'code' | 'call';
    pickup_code?: string | null;
    photo_path: string;
    signature_path: string;
    lat?: number | null;
    lng?: number | null;
  };
  flag_issue: {
    shipment_id: string;
    reason: string;
  };
}

export type CommandType = keyof CommandPayloadMap;

export interface CommandEnvelope<T extends CommandType = CommandType> {
  id: string;
  type: T;
  payload: CommandPayloadMap[T];
  recorded_at: string;
}

export interface UserContext {
  userId: string;
  role: 'manager' | 'driver';
  locationId?: string | null;
}
export interface ApplyOptions {
  saveToOutbox?: boolean;
}
export async function applyLocalCommand<T extends CommandType>(
  command: CommandEnvelope<T>,
  user: UserContext,
  options: ApplyOptions = {}
): Promise<void> {
  const db = await getDb();
  const recordedAt = command.recorded_at || new Date().toISOString();

  await db.withTransactionAsync(async () => {
    switch (command.type) {
      case 'create_shipment': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['create_shipment'];

        if (p.origin_id === p.destination_id) throw new Error('invalid_state');

        const normReceiverPhone = normalizePhone(p.receiver_phone);
        const normSenderPhone = normalizePhone(p.sender_phone);
        if (!normSenderPhone) throw new Error('bad_phone');
        if (!normReceiverPhone) throw new Error('bad_phone');
        if (!p.packages || p.packages.length === 0) throw new Error('invalid_state');
        if (!p.packages.some((pkg) => !!pkg.photo_path)) throw new Error('missing_photo');




        if (!p.waybill_no?.trim()) {
          throw new Error('invalid_waybill');
        }

        const waybillNo = p.waybill_no.trim();
        {/*
const block = await db.getFirstAsync<{
          from_no: number;
          to_no: number;
          next_no: number;
        }>('SELECT from_no, to_no, next_no FROM waybill_block WHERE id = 1');

        console.log('[waybill] block', block, 'waybill_no', p.waybill_no);

        if (!block) {
          console.log('[waybill] FAIL: no waybill_block row (never allocated or synced)');
          throw new Error('waybill_out_of_block');
        }
        if (block.next_no > block.to_no) {
          console.log('[waybill] FAIL: block exhausted', block);
          throw new Error('waybill_out_of_block');
        }


        const waybillNum = parseInt(p.waybill_no.replace(/^EO-/, ''), 10);
        console.log('[waybill] parsed number', waybillNum);

        if (isNaN(waybillNum) || waybillNum < block.from_no || waybillNum > block.to_no) {
          console.log('[waybill] FAIL: number not in block', { waybillNum, block });
          throw new Error('waybill_out_of_block');
        }

        // Advance waybill counter if this used the next_no
        if (waybillNum >= block.next_no) {
          await db.runAsync('UPDATE waybill_block SET next_no = ? WHERE id = 1', [waybillNum + 1]);
        }
*/}
        await db.runAsync(
          `INSERT INTO shipments (
    id, waybill_no, sender_name, receiver_name, sender_phone,
    receiver_phone, origin_id, destination_id, status, notes,
    created_by, created_at, updated_at, sv
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?, ?, ?, 0)
  ON CONFLICT(id) DO UPDATE SET
    waybill_no = excluded.waybill_no,
    sender_name = excluded.sender_name,
    receiver_name = excluded.receiver_name,
    sender_phone = excluded.sender_phone,
    receiver_phone = excluded.receiver_phone,
    origin_id = excluded.origin_id,
    destination_id = excluded.destination_id,
    notes = excluded.notes`,
          [
            p.shipment_id,
            waybillNo,
            p.sender_name,
            p.receiver_name,
            normSenderPhone,
            normReceiverPhone,
            p.origin_id,
            p.destination_id,
            p.notes || null,
            user.userId,
            recordedAt,
            recordedAt,
          ]
        );
        for (const pkg of p.packages) {
          const labelCode = formatLabelCode(waybillNo, pkg.seq);
          await db.runAsync(
            `INSERT INTO packages (
    id, shipment_id, seq, label_code, description, qty,
    photo_path, status, created_at, updated_at, sv
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'registered', ?, ?, 0)
  ON CONFLICT(id) DO UPDATE SET
    shipment_id = excluded.shipment_id,
    seq = excluded.seq,
    label_code = excluded.label_code,
    description = excluded.description,
    qty = excluded.qty,
    photo_path = excluded.photo_path`,
            [
              pkg.package_id,
              p.shipment_id,
              pkg.seq,
              labelCode,
              pkg.description,
              pkg.qty || 1,
              pkg.photo_path,
              recordedAt,
              recordedAt,
            ]
          );
          await db.runAsync(
            `INSERT INTO custody_events (
    shipment_id, package_id, type, actor_id, recorded_at, created_at, sv
  )
  SELECT ?, ?, 'registered', ?, ?, ?, 0
  WHERE NOT EXISTS (
    SELECT 1 FROM custody_events
    WHERE shipment_id = ?
      AND package_id = ?
      AND type = 'registered'
      AND actor_id = ?
      AND recorded_at = ?
  )`,
            [
              p.shipment_id,
              pkg.package_id,
              user.userId,
              recordedAt,
              recordedAt,
              p.shipment_id,
              pkg.package_id,
              user.userId,
              recordedAt,
            ]
          );
        }
        break;
      }

      case 'create_trip': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['create_trip'];

        if (p.origin_id === p.destination_id) throw new Error('invalid_state');

        const driverBusy = await db.getFirstAsync(
          `SELECT id FROM trips WHERE driver_id = ? AND status IN ('loading', 'in_transit')`,
          [p.driver_id]
        );
        if (driverBusy) throw new Error('driver_busy');

        const vehicleBusy = await db.getFirstAsync(
          `SELECT id FROM trips WHERE vehicle_id = ? AND status IN ('loading', 'in_transit')`,
          [p.vehicle_id]
        );
        if (vehicleBusy) throw new Error('vehicle_busy');

        await db.runAsync(
          `INSERT INTO trips (
            id, vehicle_id, driver_id, origin_id, destination_id,
            status, created_by, created_at, updated_at, sv
          ) VALUES (?, ?, ?, ?, ?, 'loading', ?, ?, ?, 0)`,
          [
            p.trip_id,
            p.vehicle_id,
            p.driver_id,
            p.origin_id,
            p.destination_id,
            user.userId,
            recordedAt,
            recordedAt,
          ]
        );
        break;
      }

      case 'load_scan': {
        if (user.role !== 'driver') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['load_scan'];

        const trip = await db.getFirstAsync<{
          id: string;
          driver_id: string;
          status: string;
          origin_id: string;
          destination_id: string;
        }>('SELECT * FROM trips WHERE id = ?', [p.trip_id]);

        if (!trip || trip.driver_id !== user.userId || trip.status !== 'loading') {
          throw new Error('not_your_trip');
        }

        const pkg = await db.getFirstAsync<{
          id: string;
          shipment_id: string;
          status: string;
          current_trip_id: string | null;
          s_origin: string;
          s_dest: string;
        }>(
          `SELECT p.*, s.origin_id as s_origin, s.destination_id as s_dest
           FROM packages p
           JOIN shipments s ON s.id = p.shipment_id
           WHERE p.label_code = ?`,
          [p.label_code]
        );
        console.log("pkg", pkg)
        if (!pkg) throw new Error('unknown_label');
        if (pkg.status === 'loaded') throw new Error('already_scanned');
        if (pkg.status !== 'registered') throw new Error('invalid_state');
        if (pkg.s_origin !== trip.origin_id || pkg.s_dest !== trip.destination_id) {
          throw new Error('wrong_destination');
        }
        if (pkg.current_trip_id && pkg.current_trip_id !== p.trip_id) {
          throw new Error('wrong_trip');
        }

        await db.runAsync(
          `UPDATE packages
           SET status = 'loaded', current_trip_id = ?, current_holder_id = ?, loaded_at = ?, updated_at = ?
           WHERE id = ?`,
          [p.trip_id, user.userId, recordedAt, recordedAt, pkg.id]
        );

        await db.runAsync(
          `INSERT INTO custody_events (
            shipment_id, package_id, type, actor_id, trip_id, lat, lng, recorded_at, created_at, sv
          ) VALUES (?, ?, 'loaded', ?, ?, ?, ?, ?, ?, 0)`,
          [
            pkg.shipment_id,
            pkg.id,
            user.userId,
            p.trip_id,
            p.lat ?? null,
            p.lng ?? null,
            recordedAt,
            recordedAt,
          ]
        );

        const remaining = await db.getFirstAsync<{ count: number }>(
          `SELECT count(*) as count FROM packages WHERE shipment_id = ? AND status <> 'loaded'`,
          [pkg.shipment_id]
        );
        if (remaining && remaining.count === 0) {
          await db.runAsync(
            `UPDATE shipments SET status = 'loaded', updated_at = ? WHERE id = ?`,
            [recordedAt, pkg.shipment_id]
          );
        }
        break;
      }

      case 'confirm_loading': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['confirm_loading'];

        await db.runAsync(
          `UPDATE trips
           SET loading_confirmed_by = COALESCE(loading_confirmed_by, ?),
               loading_confirmed_at = COALESCE(loading_confirmed_at, ?),
               updated_at = ?
           WHERE id = ?`,
          [user.userId, recordedAt, recordedAt, p.trip_id]
        );
        break;
      }

      case 'start_trip': {
        if (user.role !== 'driver') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['start_trip'];

        const trip = await db.getFirstAsync<{ id: string; driver_id: string; status: string }>(
          'SELECT id, driver_id, status FROM trips WHERE id = ?',
          [p.trip_id]
        );
        if (!trip || trip.driver_id !== user.userId) throw new Error('not_your_trip');
        if (trip.status !== 'loading') throw new Error('invalid_state');

        const loadedPkgs = await db.getFirstAsync<{ count: number }>(
          `SELECT count(*) as count FROM packages WHERE current_trip_id = ? AND status = 'loaded'`,
          [p.trip_id]
        );
        if (!loadedPkgs || loadedPkgs.count === 0) throw new Error('invalid_state');

        await db.runAsync(
          `UPDATE trips SET status = 'in_transit', started_at = ?, updated_at = ? WHERE id = ?`,
          [recordedAt, recordedAt, p.trip_id]
        );

        const shipmentsOnTrip = await db.getAllAsync<{ shipment_id: string }>(
          `SELECT DISTINCT shipment_id FROM packages WHERE current_trip_id = ?`,
          [p.trip_id]
        );

        for (const s of shipmentsOnTrip) {
          const notLoaded = await db.getFirstAsync<{ count: number }>(
            `SELECT count(*) as count FROM packages WHERE shipment_id = ? AND (status <> 'loaded' OR current_trip_id <> ?)`,
            [s.shipment_id, p.trip_id]
          );

          if (!notLoaded || notLoaded.count === 0) {
            await db.runAsync(
              `UPDATE shipments SET status = 'in_transit', updated_at = ? WHERE id = ?`,
              [recordedAt, s.shipment_id]
            );
          } else {
            await db.runAsync(
              `UPDATE shipments SET status = 'issue', issue_reason = 'Not all packages were loaded.', updated_at = ? WHERE id = ?`,
              [recordedAt, s.shipment_id]
            );
          }
        }
        break;
      }

      case 'push_pings': {
        if (user.role !== 'driver') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['push_pings'];

        const trip = await db.getFirstAsync<{ id: string; driver_id: string; status: string }>(
          'SELECT id, driver_id, status FROM trips WHERE id = ?',
          [p.trip_id]
        );
        if (!trip || trip.driver_id !== user.userId) throw new Error('not_your_trip');
        if (trip.status !== 'in_transit') throw new Error('invalid_state');

        if (p.pings && p.pings.length > 0) {
          const newest = p.pings[p.pings.length - 1];
          await db.runAsync(
            `UPDATE trips SET last_lat = ?, last_lng = ?, last_ping_at = ?, updated_at = ? WHERE id = ?`,
            [newest.lat, newest.lng, newest.recorded_at, recordedAt, p.trip_id]
          );
        }
        break;
      }

      case 'arrive_trip': {
        if (user.role !== 'driver') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['arrive_trip'];

        const trip = await db.getFirstAsync<{ id: string; driver_id: string; status: string }>(
          'SELECT id, driver_id, status FROM trips WHERE id = ?',
          [p.trip_id]
        );
        if (!trip || trip.driver_id !== user.userId) throw new Error('not_your_trip');
        if (trip.status !== 'in_transit') throw new Error('invalid_state');

        await db.runAsync(
          `UPDATE trips SET status = 'arrived', arrived_at = ?, updated_at = ? WHERE id = ?`,
          [recordedAt, recordedAt, p.trip_id]
        );

        await db.runAsync(
          `UPDATE shipments SET status = 'arrived', updated_at = ?
           WHERE status = 'in_transit' AND id IN (
             SELECT shipment_id FROM packages WHERE current_trip_id = ?
           )`,
          [recordedAt, p.trip_id]
        );
        break;
      }

      case 'receive_item': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['receive_item'];

        const pkg = await db.getFirstAsync<{
          id: string;
          shipment_id: string;
          seq: number;
          status: string;
          current_trip_id: string | null;
          s_dest: string;
          s_waybill: string;
          t_status: string | null;
        }>(
          `SELECT p.*, s.destination_id as s_dest, s.waybill_no as s_waybill, t.status as t_status
           FROM packages p
           JOIN shipments s ON s.id = p.shipment_id
           LEFT JOIN trips t ON t.id = p.current_trip_id
           WHERE p.label_code = ?`,
          [p.label_code]
        );

        if (!pkg) throw new Error('unknown_label');
        if (pkg.status === 'arrived' || pkg.status === 'delivered') throw new Error('already_received');
        if (pkg.status !== 'loaded') throw new Error('invalid_state');
        if (pkg.t_status !== 'arrived') throw new Error('trip_not_arrived');
        if (user.locationId && user.locationId !== pkg.s_dest) throw new Error('wrong_branch');
        if (!['ok', 'damaged', 'opened'].includes(p.condition)) throw new Error('invalid_state');
        if (p.condition !== 'ok' && !p.arrival_photo_path) throw new Error('missing_photo');

        await db.runAsync(
          `UPDATE packages
           SET status = 'arrived', condition = ?, arrival_photo_path = ?, arrival_note = ?, arrived_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            p.condition,
            p.arrival_photo_path || null,
            p.note || null,
            recordedAt,
            recordedAt,
            pkg.id,
          ]
        );

        await db.runAsync(
          `INSERT INTO custody_events (
            shipment_id, package_id, type, actor_id, trip_id, lat, lng, note, photo_path, recorded_at, created_at, sv
          ) VALUES (?, ?, 'arrived', ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            pkg.shipment_id,
            pkg.id,
            user.userId,
            pkg.current_trip_id,
            p.lat ?? null,
            p.lng ?? null,
            p.note || null,
            p.arrival_photo_path || null,
            recordedAt,
            recordedAt,
          ]
        );

        if (p.condition !== 'ok') {
          const totalPkgs = await db.getFirstAsync<{ count: number }>(
            `SELECT count(*) as count FROM packages WHERE shipment_id = ?`,
            [pkg.shipment_id]
          );
          const total = totalPkgs?.count || 1;
          const condName = p.condition === 'damaged' ? 'Damaged' : 'Opened';
          const issueReason = `${condName} item ${pkg.seq} of ${total}${p.note ? ' - ' + p.note : ''}`;

          await db.runAsync(
            `UPDATE shipments SET status = 'issue', issue_reason = ?, updated_at = ? WHERE id = ?`,
            [issueReason, recordedAt, pkg.shipment_id]
          );

          await db.runAsync(
            `INSERT INTO custody_events (
              shipment_id, package_id, type, actor_id, note, photo_path, recorded_at, created_at, sv
            ) VALUES (?, ?, 'issue', ?, ?, ?, ?, ?, 0)`,
            [
              pkg.shipment_id,
              pkg.id,
              user.userId,
              issueReason,
              p.arrival_photo_path || null,
              recordedAt,
              recordedAt,
            ]
          );
        }

        const unarrived = await db.getFirstAsync<{ count: number }>(
          `SELECT count(*) as count FROM packages WHERE shipment_id = ? AND status <> 'arrived'`,
          [pkg.shipment_id]
        );

        if (!unarrived || unarrived.count === 0) {
          await db.runAsync(
            `UPDATE shipments SET ready_at = ?, updated_at = ? WHERE id = ?`,
            [recordedAt, recordedAt, pkg.shipment_id]
          );
        }
        break;
      }

      case 'record_contact': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['record_contact'];

        const s = await db.getFirstAsync('SELECT id FROM shipments WHERE id = ?', [p.shipment_id]);
        if (!s) throw new Error('invalid_state');

        await db.runAsync(
          `INSERT INTO contact_attempts (
            id, shipment_id, user_id, channel, outcome, note, recorded_at, created_at, updated_at, sv
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            p.contact_id,
            p.shipment_id,
            user.userId,
            p.channel,
            p.outcome,
            p.note || null,
            recordedAt,
            recordedAt,
            recordedAt,
          ]
        );
        break;
      }

      case 'collect_shipment': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['collect_shipment'];

        const s = await db.getFirstAsync<{ id: string; destination_id: string }>(
          'SELECT id, destination_id FROM shipments WHERE id = ?',
          [p.shipment_id]
        );
        if (!s) throw new Error('invalid_state');

        const unarrived = await db.getFirstAsync<{ count: number }>(
          `SELECT count(*) as count FROM packages WHERE shipment_id = ? AND status <> 'arrived'`,
          [p.shipment_id]
        );
        if (unarrived && unarrived.count > 0) throw new Error('invalid_state');

        if (user.locationId && user.locationId !== s.destination_id) throw new Error('wrong_branch');

        if (p.verified_by === 'code') {
          const pc = await db.getFirstAsync<{ salt: string; code_hash: string }>(
            'SELECT salt, code_hash FROM pickup_codes WHERE shipment_id = ?',
            [p.shipment_id]
          );
          if (!pc || !p.pickup_code) throw new Error('bad_code');

          // Verify hash
          const computed = await Crypto.digestStringAsync(
            Crypto.CryptoDigestAlgorithm.SHA256,
            pc.salt + p.pickup_code
          );
          if (computed.toLowerCase() !== pc.code_hash.toLowerCase()) {
            throw new Error('bad_code');
          }
        } else if (p.verified_by === 'call') {
          const contact = await db.getFirstAsync(
            `SELECT id FROM contact_attempts WHERE shipment_id = ? AND channel = 'call' AND outcome = 'reached'`,
            [p.shipment_id]
          );
          if (!contact) throw new Error('call_not_logged');
        }

        if (!p.collector_is_receiver) {
          if (!p.collector_name || !p.relationship) throw new Error('invalid_state');
        }

        if (!p.photo_path || !p.signature_path) throw new Error('missing_photo');

        await db.runAsync(
          `INSERT INTO collections (
            shipment_id, collector_name, collector_is_receiver, relationship,
            id_checked, id_type, verified_by, photo_path, signature_path,
            lat, lng, collected_by, collected_at, created_at, updated_at, sv
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            p.shipment_id,
            p.collector_name,
            p.collector_is_receiver ? 1 : 0,
            p.relationship || null,
            p.id_checked ? 1 : 0,
            p.id_type || null,
            p.verified_by,
            p.photo_path,
            p.signature_path,
            p.lat ?? null,
            p.lng ?? null,
            user.userId,
            recordedAt,
            recordedAt,
            recordedAt,
          ]
        );

        await db.runAsync(
          `UPDATE packages SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE shipment_id = ?`,
          [recordedAt, recordedAt, p.shipment_id]
        );

        const pkgs = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM packages WHERE shipment_id = ?',
          [p.shipment_id]
        );
        for (const pkg of pkgs) {
          await db.runAsync(
            `INSERT INTO custody_events (
              shipment_id, package_id, type, actor_id, lat, lng, recorded_at, created_at, sv
            ) VALUES (?, ?, 'delivered', ?, ?, ?, ?, ?, 0)`,
            [p.shipment_id, pkg.id, user.userId, p.lat ?? null, p.lng ?? null, recordedAt, recordedAt]
          );
        }

        await db.runAsync(
          `UPDATE shipments SET status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ?`,
          [recordedAt, recordedAt, p.shipment_id]
        );
        break;
      }

      case 'flag_issue': {
        if (user.role !== 'manager') throw new Error('not_allowed');
        const p = command.payload as CommandPayloadMap['flag_issue'];

        if (!p.reason || !p.reason.trim()) throw new Error('invalid_state');

        const s = await db.getFirstAsync<{ id: string; status: string }>(
          'SELECT id, status FROM shipments WHERE id = ?',
          [p.shipment_id]
        );
        if (!s || s.status === 'delivered') throw new Error('invalid_state');

        await db.runAsync(
          `UPDATE shipments SET status = 'issue', issue_reason = ?, updated_at = ? WHERE id = ?`,
          [p.reason, recordedAt, p.shipment_id]
        );

        await db.runAsync(
          `INSERT INTO custody_events (
            shipment_id, package_id, type, actor_id, note, recorded_at, created_at, sv
          ) VALUES (?, NULL, 'issue', ?, ?, ?, ?, 0)`,
          [p.shipment_id, user.userId, p.reason, recordedAt, recordedAt]
        );
        break;
      }
    }

    // Insert into outbox
    if (options.saveToOutbox !== false) {
      const payloadJson = JSON.stringify({
        ...command.payload,
        recorded_at: recordedAt,
      });

      await db.runAsync(
        `INSERT INTO outbox (
      id, type, payload, status, reason, created_at
    ) VALUES (?, ?, ?, 'pending', NULL, ?)`,
        [command.id, command.type, payloadJson, recordedAt]
      );
    }
  });
}
