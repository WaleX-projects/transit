
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';

import { supabase } from '../lib/supabase';
import { getDb } from './db';

function isWeb(): boolean {
  return Platform.OS === 'web';
}

function getRetryDelay(attempts: number): number {
  const delays = [
    30 * 1000,
    2 * 60 * 1000,
    10 * 60 * 1000,
    60 * 60 * 1000,
    6 * 60 * 60 * 1000,
  ];

  return delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)];
}

async function ensureMediaQueueColumns(): Promise<void> {
  const db = await getDb();

  const columns = await db.getAllAsync<{ name: string }>(
    'PRAGMA table_info(media_queue)'
  );

  const existing = new Set(columns.map(column => column.name));

  if (!existing.has('next_retry_at')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN next_retry_at TEXT'
    );
  }

  if (!existing.has('last_error')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN last_error TEXT'
    );
  }

  if (!existing.has('retryable')) {
    await db.execAsync(
      'ALTER TABLE media_queue ADD COLUMN retryable INTEGER NOT NULL DEFAULT 1'
    );
  }
}

// Read an image selected by Expo ImagePicker.
// On web, the URI can be a blob URL or data URL.
async function readWebImage(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);

  if (!response.ok) {
    throw new Error(`Could not read selected image: ${response.status}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function readNativeImage(uri: string): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

export async function saveAndQueueMedia(
  uri: string,
  userId: string,
  extension: 'jpg' | 'png' = 'jpg'
): Promise<string> {
  await ensureMediaQueueColumns();

  const db = await getDb();

  const mediaId = Crypto.randomUUID();
  const storagePath = `${userId}/${mediaId}.${extension}`;

  let finalUri = uri;

  // Keep the existing native compression behavior.
  // Browser image compression is left to the browser for this test.
  if (!isWeb()) {
    try {
      const ctx = ImageManipulator.manipulate(uri);
      ctx.resize({ width: 1280 });

      const rendered = await ctx.renderAsync();

      const saved = await rendered.saveAsync({
        compress: 0.7,
        format: extension === 'png' ? SaveFormat.PNG : SaveFormat.JPEG,
      });

      finalUri = saved.uri;
    } catch (error) {
      console.warn('[Media] Image compression failed; using original:', error);
    }

    const documentDirectory = FileSystem.documentDirectory;

    if (documentDirectory) {
      const permanentUri = `${documentDirectory}media_${mediaId}.${extension}`;

      try {
        await FileSystem.copyAsync({
          from: finalUri,
          to: permanentUri,
        });

        finalUri = permanentUri;
      } catch (error) {
        console.warn('[Media] Could not copy image:', error);
      }
    }

    const fileInfo = await FileSystem.getInfoAsync(finalUri);

    if (!fileInfo.exists) {
      throw new Error('Image could not be saved locally.');
    }
  }

  // On web, preserve the ImagePicker URI in the queue.
  // It must remain readable until the upload is completed.
  await db.runAsync(
    `INSERT INTO media_queue (
      id, local_uri, storage_path, status, attempts,
      next_retry_at, last_error, retryable
    )
    VALUES (?, ?, ?, 'pending', 0, NULL, NULL, 1)`,
    [mediaId, finalUri, storagePath]
  );

  console.log('[Media] Image saved and queued:', storagePath);

  return storagePath;
}

export async function areMediaFilesUploaded(
  storagePaths: string[]
): Promise<boolean> {
  if (!storagePaths.length) return true;

  await ensureMediaQueueColumns();

  const db = await getDb();
  const placeholders = storagePaths.map(() => '?').join(',');

  const result = await db.getAllAsync<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM media_queue
     WHERE storage_path IN (${placeholders})
       AND status <> 'uploaded'`,
    storagePaths
  );

  return (result[0]?.count ?? 0) === 0;
}

export async function uploadPendingMedia(): Promise<void> {
  await ensureMediaQueueColumns();

  const db = await getDb();
  const now = new Date().toISOString();

  const rows = await db.getAllAsync<{
    id: string;
    local_uri: string;
    storage_path: string;
    attempts: number;
  }>(
    `SELECT id, local_uri, storage_path, attempts
     FROM media_queue
     WHERE status IN ('pending', 'failed')
       AND retryable = 1
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY attempts ASC`,
    [now]
  );

  console.log('[Media] Eligible uploads:', rows.length);

  for (const row of rows) {
    try {
      console.log('[Media] Starting upload:', row.storage_path);

      const bytes = isWeb()
        ? await readWebImage(row.local_uri)
        : await readNativeImage(row.local_uri);

      if (!bytes.length) {
        throw new Error('Local image returned empty content.');
      }

      const contentType = row.storage_path.endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';

      const { error } = await supabase.storage
        .from('media')
        .upload(row.storage_path, bytes, {
          contentType,
          upsert: true,
        });

      if (error) throw error;

      await db.runAsync(
        `UPDATE media_queue
         SET status = 'uploaded',
             next_retry_at = NULL,
             last_error = NULL,
             retryable = 1
         WHERE id = ?`,
        [row.id]
      );

      console.log('[Media] Upload successful:', row.storage_path);
    } catch (error) {
      const nextAttempts = row.attempts + 1;
      const nextRetryAt = new Date(
        Date.now() + getRetryDelay(nextAttempts)
      ).toISOString();

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      await db.runAsync(
        `UPDATE media_queue
         SET status = 'failed',
             attempts = ?,
             next_retry_at = ?,
             last_error = ?,
             retryable = 1
         WHERE id = ?`,
        [nextAttempts, nextRetryAt, errorMessage, row.id]
      );

      console.error('[Media] Upload failed:', {
        storagePath: row.storage_path,
        attempts: nextAttempts,
        error: errorMessage,
      });
    }
  }
}

export async function retryMediaUpload(mediaId: string): Promise<void> {
  await ensureMediaQueueColumns();

  const db = await getDb();

  await db.runAsync(
    `UPDATE media_queue
     SET status = 'pending',
         attempts = 0,
         next_retry_at = NULL,
         last_error = NULL,
         retryable = 1
     WHERE id = ?
       AND status <> 'uploaded'`,
    [mediaId]
  );
}

export async function getFailedMedia() {
  await ensureMediaQueueColumns();

  const db = await getDb();

  return db.getAllAsync<{
    id: string;
    local_uri: string;
    storage_path: string;
    attempts: number;
    last_error: string | null;
    retryable: number;
    next_retry_at: string | null;
  }>(
    `SELECT id, local_uri, storage_path, attempts,
            last_error, retryable, next_retry_at
     FROM media_queue
     WHERE status = 'failed'
     ORDER BY attempts DESC`
  );
}

export async function resolveImageUri(
  storagePath: string | null | undefined
): Promise<string | null> {
  if (!storagePath) return null;

  try {
    await ensureMediaQueueColumns();

    const db = await getDb();

    const localRow = await db.getFirstAsync<{
      local_uri: string;
      status: string;
    }>(
      `SELECT local_uri, status
       FROM media_queue
       WHERE storage_path = ?`,
      [storagePath]
    );

    if (localRow?.local_uri) {
      if (isWeb()) {
        // Blob URLs from ImagePicker may expire after a page reload.
        // Only use them while they are still readable.
        try {
          const response = await fetch(localRow.local_uri);
          if (response.ok) return localRow.local_uri;
        } catch {
          // Fall through to Supabase.
        }
      } else {
        const info = await FileSystem.getInfoAsync(localRow.local_uri);
        if (info.exists) return localRow.local_uri;
      }
    }
  } catch (error) {
    console.warn('[Media] Local image lookup failed:', error);
  }

  try {
    const { data, error } = await supabase.storage
      .from('media')
      .createSignedUrl(storagePath, 3600);

    if (error) throw error;

    return data?.signedUrl ?? null;
  } catch (error) {
    console.error('[Media] Image resolution failed:', error);
    return null;
  }
}
