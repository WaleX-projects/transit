import * as Crypto from 'expo-crypto';
import {
  applyLocalCommand,
  CommandEnvelope,
  CommandPayloadMap,
  CommandType,
  UserContext,
} from './applyLocal';
import { getDb } from './db';

export interface OutboxItem {
  id: string;
  type: CommandType;
  payload: string;
  status: 'pending' | 'rejected';
  reason: string | null;
  created_at: string;
}

export async function enqueueCommand<T extends CommandType>(
  type: T,
  payload: CommandPayloadMap[T],
  user: UserContext
): Promise<string> {
  const id = Crypto.randomUUID();
  const recorded_at = new Date().toISOString();
  const envelope: CommandEnvelope<T> = {
    id,
    type,
    payload,
    recorded_at,
  };
console.info('[quey-take] ')
  await applyLocalCommand(envelope, user);
  return id;
}

export async function getPendingOutboxCount(): Promise<number> {
  const db = await getDb();
  const res = await db.getFirstAsync<{ count: number }>(
    `SELECT count(*) as count FROM outbox WHERE status = 'pending'`
  );
  return res?.count || 0;
}

export async function getPendingOutboxItems(limit = 20): Promise<OutboxItem[]> {
  const db = await getDb();
  return await db.getAllAsync<OutboxItem>(
    `SELECT id, type, payload, status, reason, created_at FROM outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`,
    [limit]
  );
}

export async function getSyncIssues(): Promise<OutboxItem[]> {
  const db = await getDb();
  return await db.getAllAsync<OutboxItem>(
    `SELECT id, type, payload, status, reason, created_at FROM outbox WHERE status = 'rejected' ORDER BY created_at DESC`
  );
}

export async function dismissSyncIssue(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
}
