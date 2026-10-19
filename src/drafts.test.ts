import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialDraft, type Draft } from './model';

const database = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
  get: async (key: string) => database.get(key),
  set: async (key: string, value: unknown) => { database.set(key, key === 'rednote-working-directory-v1' ? value : structuredClone(value)); },
  entries: async () => [...database.entries()],
  delMany: async (keys: string[]) => { keys.forEach(key => database.delete(key)); },
}));
import { deleteDocument, getStorageMode, listDocuments, migrateLegacy, saveDocument, selectWorkingDirectory, useBrowserStorage } from './drafts';

describe('local draft library', () => {
  beforeEach(() => database.clear());
  afterEach(() => vi.unstubAllGlobals());
  it('saves different drafts under independent keys', async () => {
    await saveDocument('one', { ...initialDraft, title: 'First' });
    await saveDocument('two', { ...initialDraft, title: 'Second' });
    await saveDocument('one', { ...initialDraft, title: 'Edited first' });
    const documents = await listDocuments();
    expect(documents).toHaveLength(2);
    expect(documents.find(record => record.id === 'two')?.draft.title).toBe('Second');
    expect(documents.find(record => record.id === 'one')?.draft.title).toBe('Edited first');
  });
  it('keeps the creation time when a draft is saved again', async () => {
    const first = await saveDocument('one', initialDraft);
    const next = await saveDocument('one', { ...initialDraft, title: 'Edited' });
    expect(next.createdAt).toBe(first.createdAt);
  });
  it('preserves legacy draft and assets without remigrating over edits', async () => {
    const legacy = { ...initialDraft, title: 'Legacy', assets: { photo: 'data:image/png;base64,original' } };
    database.set('rednote-draft-v1', legacy);
    const valid = (value: unknown): value is Draft => !!value && (value as Draft).version === 1;
    await migrateLegacy(valid);
    expect((await listDocuments())[0].draft.assets).toEqual(legacy.assets);
    await saveDocument('legacy', { ...legacy, title: 'Edited' });
    await migrateLegacy(valid);
    expect((await listDocuments())[0].draft.title).toBe('Edited');
    expect(database.get('rednote-draft-v1')).toEqual(legacy);
  });
  it('ignores unrelated storage entries and invalid legacy values', async () => {
    database.set('rednote-draft-v1', 'invalid');
    database.set('unrelated', { title: 'Other' });
    await migrateLegacy((_value): _value is Draft => false);
    expect(await listDocuments()).toEqual([]);
  });
  it('deletes only the selected draft', async () => {
    await saveDocument('one', initialDraft);
    await saveDocument('two', initialDraft);
    await deleteDocument('one');
    expect((await listDocuments()).map(record => record.id)).toEqual(['two']);
  });
  it('does not resurrect a deleted legacy draft after migration', async () => {
    database.set('rednote-draft-v1', initialDraft);
    const valid = (value: unknown): value is Draft => !!value && (value as Draft).version === 1;
    await migrateLegacy(valid);
    await deleteDocument('legacy');
    await migrateLegacy(valid);
    expect(await listDocuments()).toEqual([]);
    expect(database.has('rednote-draft-v1')).toBe(false);
  });
  it('records an explicit browser-only choice', async () => {
    expect(await getStorageMode()).toBeNull();
    await useBrowserStorage();
    expect(await getStorageMode()).toBe('browser');
  });
  it('mirrors drafts to a chosen directory and restores them when reselected', async () => {
    const files = new Map<string, string>();
    const handle = {
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      async *values() { for (const name of files.keys()) yield { kind: 'file', name }; },
      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!options?.create && !files.has(name)) throw new DOMException('File not found', 'NotFoundError');
        return {
          getFile: async () => new Blob([files.get(name) ?? '']),
          createWritable: async () => ({
            write: async (text: string) => { files.set(name, text); },
            close: async () => {},
            abort: async () => {},
          }),
        };
      },
      async removeEntry(name: string) { files.delete(name); },
    };
    vi.stubGlobal('window', { showDirectoryPicker: async () => handle });
    const valid = (value: unknown): value is Draft => !!value && (value as Draft).version === 1;
    await selectWorkingDirectory(valid);
    expect(await getStorageMode()).toBe('folder');
    await saveDocument('one', { ...initialDraft, title: 'Saved in folder' });
    const firstName = [...files.keys()][0];
    expect(firstName).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_Saved in folder\.rednote\.json$/);
    expect(JSON.parse(files.get(firstName) ?? '{}').draft.title).toBe('Saved in folder');
    await saveDocument('one', { ...initialDraft, title: 'Renamed / draft' });
    expect(files.size).toBe(1);
    expect([...files.keys()][0]).toContain('Renamed - draft.rednote.json');

    const first = (await listDocuments())[0];
    database.set('rednote-document:two', { ...first, id: 'two', fileName: undefined });
    await saveDocument('two', first.draft);
    expect(files.size).toBe(2);
    expect([...files.keys()].some(name => name.includes('Renamed - draft (2).rednote.json'))).toBe(true);

    database.clear();
    expect(await selectWorkingDirectory(valid)).toBe(2);
    expect((await listDocuments()).map(record => record.draft.title)).toEqual(['Renamed / draft', 'Renamed / draft']);
    await deleteDocument('one');
    expect(files.size).toBe(1);
    await deleteDocument('two');
    expect(files.size).toBe(0);
    expect(await listDocuments()).toEqual([]);

    const old = { id: 'old', draft: initialDraft, updatedAt: Date.now() - 1000 };
    files.set('rednote-draft-old.json', JSON.stringify(old));
    database.set('rednote-document:old', old);
    await saveDocument('old', { ...initialDraft, title: 'Migrated' });
    expect(files.has('rednote-draft-old.json')).toBe(false);
    expect([...files.keys()][0]).toContain('_Migrated.rednote.json');
  });
});
