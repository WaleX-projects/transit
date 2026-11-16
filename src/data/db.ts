import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../lib/config';
import { CREATE_TABLES_SQL, DROP_ALL_TABLES_SQL } from './schema';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await dbInstance.execAsync('PRAGMA journal_mode = WAL;');
    await dbInstance.execAsync(CREATE_TABLES_SQL);
  }
  return dbInstance;
}

export async function wipeDatabase(): Promise<void> {
  const db = await getDb();
  await db.execAsync(DROP_ALL_TABLES_SQL);
  await db.execAsync(CREATE_TABLES_SQL);
}

export async function runQuery<T = unknown>(
  sql: string,
  params: (string | number | null | undefined)[] = []
): Promise<T[]> {
  const db = await getDb();
  return (await db.getAllAsync(sql, params as SQLite.SQLiteVariadicBindParams)) as T[];
}

export async function runGetFirst<T = unknown>(
  sql: string,
  params: (string | number | null | undefined)[] = []
): Promise<T | null> {
  const db = await getDb();
  return (await db.getFirstAsync(sql, params as SQLite.SQLiteVariadicBindParams)) as T | null;
}

export async function runExecute(
  sql: string,
  params: (string | number | null | undefined)[] = []
): Promise<SQLite.SQLiteRunResult> {
  const db = await getDb();
  return await db.runAsync(sql, params as SQLite.SQLiteVariadicBindParams);
}
