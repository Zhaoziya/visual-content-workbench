import { delMany, entries, get, set } from 'idb-keyval';
import type { Draft } from './model';

export type DraftRecord = { id: string; draft: Draft; updatedAt: number; createdAt?: number; fileName?: string };
const prefix = 'rednote-document:';
const storageKey = 'rednote-storage-mode-v1';
const directoryKey = 'rednote-working-directory-v1';
const filePrefix = 'rednote-draft-';
const fileSuffix = '.rednote.json';
export type StorageMode = 'browser' | 'folder';
type WorkingDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};
const recordChanges = new Map<string, Promise<unknown>>();
const legacyFilename = (id: string) => `${filePrefix}${id}.json`;

function queueRecordChange<T>(id: string, change: () => Promise<T>): Promise<T> {
  const pending = (recordChanges.get(id) ?? Promise.resolve()).catch(() => {}).then(change);
  recordChanges.set(id, pending);
  return pending.finally(() => { if (recordChanges.get(id) === pending) recordChanges.delete(id); });
}

async function directory() {
  return await get<StorageMode>(storageKey) === 'folder' ? await get<WorkingDirectory>(directoryKey) : undefined;
}

function suggestedFilename(record: DraftRecord) {
  const time = new Date(record.createdAt ?? record.updatedAt);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}_${pad(time.getHours())}-${pad(time.getMinutes())}-${pad(time.getSeconds())}`;
  const title = (record.draft.title.split(/\r?\n/)[0].trim() || '未命名草稿')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/, '').slice(0, 60).trim() || '未命名草稿';
  return `${stamp}_${title}`;
}

async function availableFilename(handle: WorkingDirectory, record: DraftRecord) {
  const base = suggestedFilename(record);
  if (record.fileName?.endsWith(fileSuffix)) {
    const current = record.fileName.slice(0, -fileSuffix.length);
    if (current === base || current.startsWith(`${base} (`) && /^\d+\)$/.test(current.slice(base.length + 2))) return record.fileName;
  }
  for (let index = 1; index < 10000; index++) {
    const name = `${base}${index === 1 ? '' : ` (${index})`}${fileSuffix}`;
    try {
      const existing = await handle.getFileHandle(name);
      const stored: unknown = JSON.parse(await (await existing.getFile()).text());
      if (stored && typeof stored === 'object' && 'id' in stored && stored.id === record.id) return name;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return name;
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  throw new Error('同名草稿过多，无法创建工作目录文件。');
}

async function writeFile(handle: WorkingDirectory, record: DraftRecord) {
  const file = await handle.getFileHandle(record.fileName!, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(JSON.stringify(record)); await stream.close(); }
  catch (error) { await stream.abort().catch(() => {}); throw error; }
}

async function removeFile(handle: WorkingDirectory, name: string) {
  try { await handle.removeEntry(name); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
}

export async function getStorageMode(): Promise<StorageMode | null> {
  const mode = await get<StorageMode>(storageKey);
  if (mode === 'browser') return mode;
  return mode === 'folder' && await get(directoryKey) ? mode : null;
}

export function supportsWorkingDirectory() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function useBrowserStorage() {
  await set(storageKey, 'browser');
  await delMany([directoryKey]);
}

export async function selectWorkingDirectory(valid: (value: unknown) => value is Draft) {
  const picker = (window as Window & { showDirectoryPicker?: (options: { mode: 'readwrite' }) => Promise<WorkingDirectory> }).showDirectoryPicker;
  if (!picker) throw new Error('当前浏览器不支持选择工作目录。');
  const handle = await picker.call(window, { mode: 'readwrite' });
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted' && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('未获得工作目录的读写权限。');
  }
  const restored = new Map<string, DraftRecord>();
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !(entry.name.endsWith(fileSuffix) || entry.name.startsWith(filePrefix) && entry.name.endsWith('.json'))) continue;
    try {
      const file = await handle.getFileHandle(entry.name);
      const record: unknown = JSON.parse(await (await file.getFile()).text());
      if (record && typeof record === 'object' && 'id' in record && typeof record.id === 'string' &&
          record.id.length > 0 && record.id.length < 100 &&
          (!entry.name.startsWith(filePrefix) || entry.name === legacyFilename(record.id)) &&
          'draft' in record && valid(record.draft) && 'updatedAt' in record &&
          typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)) {
        const item = { ...record, fileName: entry.name } as DraftRecord;
        const existing = restored.get(item.id);
        if (!existing || item.updatedAt > existing.updatedAt) restored.set(item.id, item);
      }
    } catch { /* Ignore malformed or unreadable files; never remove them. */ }
  }
  for (const record of restored.values()) {
    const existing = await get<DraftRecord>(prefix + record.id);
    if (!existing || record.updatedAt > existing.updatedAt) await set(prefix + record.id, record);
  }
  await set(directoryKey, handle);
  await set(storageKey, 'folder');
  return restored.size;
}

export async function saveDocument(id: string, draft: Draft) {
  return queueRecordChange(id, async () => {
    const previous = await get<DraftRecord>(prefix + id);
    const now = Date.now();
    const record: DraftRecord = { id, draft, updatedAt: now, createdAt: previous?.createdAt ?? previous?.updatedAt ?? now, fileName: previous?.fileName };
    const handle = await directory();
    if (handle) {
      const nextName = await availableFilename(handle, record);
      record.fileName = nextName;
      await writeFile(handle, record);
      const oldName = previous?.fileName ?? (previous ? legacyFilename(id) : null);
      if (oldName && oldName !== nextName) await removeFile(handle, oldName);
    }
    await set(prefix + id, record);
    return record;
  });
}
export async function listDocuments(): Promise<DraftRecord[]> {
  return (await entries()).filter(([key]) => typeof key === 'string' && key.startsWith(prefix))
    .map(([, value]) => value as DraftRecord).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteDocument(id: string) {
  await queueRecordChange(id, async () => {
    const record = await get<DraftRecord>(prefix + id);
    const handle = await directory();
    if (handle) for (const name of new Set([record?.fileName, legacyFilename(id)].filter((name): name is string => !!name))) await removeFile(handle, name);
    await delMany(id === 'legacy' ? [prefix + id, 'rednote-draft-v1'] : [prefix + id]);
  });
}
export async function migrateLegacy(valid: (value: unknown) => value is Draft) {
  // A stable key makes migration safe even when two tabs start together.
  if (await get(prefix + 'legacy')) return;
  const old = await get('rednote-draft-v1');
  if (valid(old)) await saveDocument('legacy', old);
}
