import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

const storageBacking = new Map<string, string>();
const mockLocalStorage: Storage = {
  get length(): number {
    return storageBacking.size;
  },
  clear(): void {
    storageBacking.clear();
  },
  getItem(key: string): string | null {
    return storageBacking.get(key) ?? null;
  },
  key(index: number): string | null {
    return Array.from(storageBacking.keys())[index] ?? null;
  },
  removeItem(key: string): void {
    storageBacking.delete(key);
  },
  setItem(key: string, value: string): void {
    storageBacking.set(key, String(value));
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  configurable: true,
  writable: true,
});

const { usePrefabStore } = await import('../../store/prefabStore.ts');
const {
  PrefabApiError,
  deleteBackendPrefab,
  fetchBackendPrefabPayload,
  listBackendPrefabs,
  savePrefabToBackend,
} = await import('../../api/prefabClient.ts');

function getHeader(headers: HeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const target = name.toLowerCase();
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === target);
    return match?.[1];
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

describe('prefabStoreAndClient', () => {
  describe('1. usePrefabStore (Zustand + localStorage)', () => {
    beforeEach(() => {
      storageBacking.clear();
      usePrefabStore.setState({
        isEditorOpen: false,
        intermediatePrefabs: [],
        activePlacement: null,
        placedWorldPrefabs: [],
      });
    });

    it('toggles editor open and closed state', () => {
      assert.strictEqual(usePrefabStore.getState().isEditorOpen, false);

      usePrefabStore.getState().openEditor();
      assert.strictEqual(usePrefabStore.getState().isEditorOpen, true);

      usePrefabStore.getState().closeEditor();
      assert.strictEqual(usePrefabStore.getState().isEditorOpen, false);
    });

    it('saves intermediate prefabs and persists them in localStorage under "synapse-prefabs"', () => {
      const saved = usePrefabStore.getState().saveIntermediatePrefab({
        name: 'Market Stall',
        width: 3,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        payloadBase64: 'AQIDBA==',
      });

      assert.ok(typeof saved.id === 'string' && saved.id.length > 0);
      assert.strictEqual(saved.name, 'Market Stall');
      assert.strictEqual(saved.width, 3);
      assert.strictEqual(saved.height, 2);
      assert.strictEqual(saved.anchorX, 1);
      assert.strictEqual(saved.anchorY, 1);
      assert.strictEqual(saved.payloadBase64, 'AQIDBA==');

      const state = usePrefabStore.getState();
      assert.strictEqual(state.intermediatePrefabs.length, 1);
      assert.strictEqual(state.intermediatePrefabs[0].id, saved.id);

      const persistedRaw = mockLocalStorage.getItem('synapse-prefabs');
      assert.ok(persistedRaw !== null, 'expected synapse-prefabs key in localStorage');
      const parsed = JSON.parse(persistedRaw);
      assert.strictEqual(parsed.state.intermediatePrefabs.length, 1);
      assert.strictEqual(parsed.state.intermediatePrefabs[0].name, 'Market Stall');
      assert.strictEqual(parsed.state.intermediatePrefabs[0].payloadBase64, 'AQIDBA==');

      // Updating by id replaces rather than duplicates
      const updated = usePrefabStore.getState().saveIntermediatePrefab({
        id: saved.id,
        name: 'Market Stall v2',
        width: 4,
        height: 2,
        anchorX: 2,
        anchorY: 1,
        payloadBase64: 'BQYHCA==',
      });
      assert.strictEqual(updated.id, saved.id);
      assert.strictEqual(usePrefabStore.getState().intermediatePrefabs.length, 1);
      assert.strictEqual(usePrefabStore.getState().intermediatePrefabs[0].name, 'Market Stall v2');
    });

    it('deletes intermediate prefabs and clears matching activePlacement', () => {
      const first = usePrefabStore.getState().saveIntermediatePrefab({
        name: 'Well',
        width: 2,
        height: 2,
        anchorX: 1,
        anchorY: 1,
        payloadBase64: 'AAAA',
      });
      const second = usePrefabStore.getState().saveIntermediatePrefab({
        name: 'Bench',
        width: 2,
        height: 1,
        anchorX: 0,
        anchorY: 0,
        payloadBase64: 'BBBB',
      });

      usePrefabStore.getState().startWorldPlacement({
        prefabId: first.id,
        name: first.name,
        width: first.width,
        height: first.height,
        anchorX: first.anchorX,
        anchorY: first.anchorY,
        payloadBase64: first.payloadBase64,
      });
      assert.strictEqual(usePrefabStore.getState().activePlacement?.prefabId, first.id);

      usePrefabStore.getState().deleteIntermediatePrefab(first.id);

      const state = usePrefabStore.getState();
      assert.strictEqual(state.intermediatePrefabs.length, 1);
      assert.strictEqual(state.intermediatePrefabs[0].id, second.id);
      assert.strictEqual(state.activePlacement, null);

      const persistedRaw = mockLocalStorage.getItem('synapse-prefabs');
      assert.ok(persistedRaw !== null);
      const parsed = JSON.parse(persistedRaw);
      assert.strictEqual(parsed.state.intermediatePrefabs.length, 1);
      assert.strictEqual(parsed.state.intermediatePrefabs[0].id, second.id);
    });

    it('manages startWorldPlacement, cancelWorldPlacement, and recordPlacedWorldPrefab', () => {
      usePrefabStore.getState().startWorldPlacement({
        prefabId: 'prefab-1',
        name: 'Watchtower',
        width: 3,
        height: 4,
        anchorX: 1,
        anchorY: 3,
        anchorZ: -1,
        payloadBase64: 'CCCC',
      });

      assert.deepStrictEqual(usePrefabStore.getState().activePlacement, {
        prefabId: 'prefab-1',
        name: 'Watchtower',
        width: 3,
        height: 4,
        anchorX: 1,
        anchorY: 3,
        anchorZ: -1,
        payloadBase64: 'CCCC',
      });

      usePrefabStore.getState().setActivePlacementAnchorZ(2);
      assert.strictEqual(usePrefabStore.getState().activePlacement?.anchorZ, 2);

      const placed = usePrefabStore.getState().recordPlacedWorldPrefab({
        prefabId: 'prefab-1',
        name: 'Watchtower',
        worldX: 640,
        worldY: 320,
      });

      assert.ok(typeof placed.id === 'string' && placed.id.length > 0);
      assert.strictEqual(placed.prefabId, 'prefab-1');
      assert.strictEqual(placed.name, 'Watchtower');
      assert.strictEqual(placed.worldX, 640);
      assert.strictEqual(placed.worldY, 320);
      assert.ok(typeof placed.placedAt === 'number');
      assert.strictEqual(usePrefabStore.getState().placedWorldPrefabs.length, 1);

      usePrefabStore.getState().cancelWorldPlacement();
      assert.strictEqual(usePrefabStore.getState().activePlacement, null);
    });
  });

  describe('2. prefabClient (Binary HTTP API with injected fetchFn)', () => {
    const baseUrl = 'http://localhost:8080/api';
    const token = 'jwt-test-token';

    it('savePrefabToBackend sends binary octet-stream, X-Prefab-Name, and Bearer token', async () => {
      const payloadBytes = new Uint8Array([4, 0, 4, 0, 0, 0, 0, 0, 0]);
      const expectedSummary = {
        id: 42,
        name: 'Starter House',
        width: 4,
        height: 4,
        anchor_x: 0,
        anchor_y: 0,
        byte_length: payloadBytes.byteLength,
        created_at: '2026-11-12T00:00:00Z',
      };

      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const mockFetch: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(expectedSummary), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const summary = await savePrefabToBackend('Starter House', payloadBytes.buffer, {
        baseUrl,
        accessToken: token,
        fetchFn: mockFetch,
      });

      assert.deepStrictEqual(summary, expectedSummary);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, `${baseUrl}/v1/prefabs`);
      assert.strictEqual(calls[0].init?.method, 'POST');
      assert.strictEqual(
        getHeader(calls[0].init?.headers, 'Content-Type'),
        'application/octet-stream'
      );
      assert.strictEqual(getHeader(calls[0].init?.headers, 'X-Prefab-Name'), 'Starter House');
      assert.strictEqual(
        getHeader(calls[0].init?.headers, 'Authorization'),
        `Bearer ${token}`
      );
      assert.ok(calls[0].init?.body instanceof ArrayBuffer);
      assert.deepStrictEqual(new Uint8Array(calls[0].init.body as ArrayBuffer), payloadBytes);
    });

    it('listBackendPrefabs fetches and parses saved prefab summaries', async () => {
      const summaries = [
        {
          id: 1,
          name: 'Gate',
          width: 3,
          height: 2,
          anchor_x: 1,
          anchor_y: 1,
          byte_length: 21,
          created_at: '2026-11-12T00:00:00Z',
        },
      ];

      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const mockFetch: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(summaries), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const result = await listBackendPrefabs({
        baseUrl,
        accessToken: token,
        fetchFn: mockFetch,
      });

      assert.deepStrictEqual(result, summaries);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, `${baseUrl}/v1/prefabs`);
      assert.strictEqual(calls[0].init?.method ?? 'GET', 'GET');
      assert.strictEqual(
        getHeader(calls[0].init?.headers, 'Authorization'),
        `Bearer ${token}`
      );
    });

    it('fetchBackendPrefabPayload downloads raw binary ArrayBuffer', async () => {
      const binaryData = new Uint8Array([2, 0, 2, 0, 1, 0, 1, 0, 1, 0x01, 0x00, 0x01, 0x00, 4, 0]);
      const calls: Array<{ url: string; init?: RequestInit }> = [];

      const mockFetch: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(binaryData, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      };

      const buffer = await fetchBackendPrefabPayload(42, {
        baseUrl,
        accessToken: token,
        fetchFn: mockFetch,
      });

      assert.ok(buffer instanceof ArrayBuffer);
      assert.deepStrictEqual(new Uint8Array(buffer), binaryData);
      assert.strictEqual(calls.length, 1);
      assert.ok(calls[0].url.startsWith(`${baseUrl}/v1/prefabs/42`));
      assert.strictEqual(calls[0].init?.method ?? 'GET', 'GET');
      assert.strictEqual(
        getHeader(calls[0].init?.headers, 'Authorization'),
        `Bearer ${token}`
      );
    });

    it('deleteBackendPrefab sends DELETE with Bearer token', async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = [];
      const mockFetch: typeof fetch = async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(null, { status: 204 });
      };

      await deleteBackendPrefab(42, {
        baseUrl,
        accessToken: token,
        fetchFn: mockFetch,
      });

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].url, `${baseUrl}/v1/prefabs/42`);
      assert.strictEqual(calls[0].init?.method, 'DELETE');
      assert.strictEqual(
        getHeader(calls[0].init?.headers, 'Authorization'),
        `Bearer ${token}`
      );
    });

    it('throws typed PrefabApiError on 401, 400, and network failures', async () => {
      const unauthorizedFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        });

      await assert.rejects(
        () =>
          listBackendPrefabs({
            baseUrl,
            accessToken: 'bad-token',
            fetchFn: unauthorizedFetch,
          }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(err instanceof PrefabApiError);
          assert.strictEqual(err.status, 401);
          return true;
        }
      );

      const badRequestFetch: typeof fetch = async () =>
        new Response(JSON.stringify({ error: 'Invalid prefab name' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        });

      await assert.rejects(
        () =>
          savePrefabToBackend('', new ArrayBuffer(9), {
            baseUrl,
            accessToken: token,
            fetchFn: badRequestFetch,
          }),
        (err: unknown) => {
          assert.ok(err instanceof PrefabApiError);
          assert.strictEqual(err.status, 400);
          return true;
        }
      );

      const networkErrorFetch: typeof fetch = async () => {
        throw new TypeError('Failed to fetch');
      };

      await assert.rejects(
        () =>
          deleteBackendPrefab(7, {
            baseUrl,
            accessToken: token,
            fetchFn: networkErrorFetch,
          }),
        (err: unknown) => {
          assert.ok(err instanceof PrefabApiError);
          assert.strictEqual(err.status, 0);
          assert.match(err.message, /Failed to fetch/);
          return true;
        }
      );
    });
  });
});
