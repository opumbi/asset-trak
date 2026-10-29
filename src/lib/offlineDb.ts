import { AssetEventRecord, AssetRecord } from '../types/asset';

const DB_NAME = 'asset_track_supabase_cache_v1';
const DB_VERSION = 1;

const STORE_ASSETS = 'assets';
const STORE_EVENTS = 'events';
const STORE_OUTBOX = 'outbox';

export interface StoredAsset {
  assetId: string;
  ownerId: string;
  name: string;
  serialNumber: string;
  category: AssetRecord['category'];
  purchasePrice: number;
  currentValuation: number;
  purchaseDate: string;
  warrantyExpiry: string;
  status: AssetRecord['status'];
  department: string;
  location: string;
  assignedTo: string;
  notes: string;
  photoUrl: string;
  createdAt: string;
  updatedAt: string;
  hasPendingWrites: boolean;
}

export interface StoredEvent {
  eventId: string;
  assetId: string;
  ownerId: string;
  action: AssetEventRecord['action'];
  summary: string;
  actorEmail: string;
  createdAt: string;
  hasPendingWrites: boolean;
}

export type OutboxOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export interface OutboxMutation {
  queueId: string;
  ownerId: string;
  operation: OutboxOperation;
  assetId: string;
  assetPayload?: StoredAsset;
  updatesPayload?: Partial<StoredAsset>;
  eventPayload?: StoredEvent;
  enqueuedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openLocalDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        const assetStore = db.createObjectStore(STORE_ASSETS, { keyPath: 'assetId' });
        assetStore.createIndex('by_owner', 'ownerId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_EVENTS)) {
        const eventStore = db.createObjectStore(STORE_EVENTS, { keyPath: 'eventId' });
        eventStore.createIndex('by_asset', 'assetId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: 'queueId' });
        outboxStore.createIndex('by_owner', 'ownerId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

export function deserializeAsset(stored: StoredAsset): AssetRecord {
  return {
    ...stored,
    createdAt: new Date(stored.createdAt),
    updatedAt: new Date(stored.updatedAt),
  };
}

export function deserializeEvent(stored: StoredEvent): AssetEventRecord {
  return {
    ...stored,
    createdAt: new Date(stored.createdAt),
  };
}

export async function getLocalAssetsForOwner(ownerId: string): Promise<AssetRecord[]> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readonly');
    const index = tx.objectStore(STORE_ASSETS).index('by_owner');
    const req = index.getAll(IDBKeyRange.only(ownerId));
    req.onsuccess = () => {
      const items = ((req.result as StoredAsset[]) || []).map(deserializeAsset);
      items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLocalEventsForAsset(
  assetId: string,
  ownerId: string
): Promise<AssetEventRecord[]> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const index = tx.objectStore(STORE_EVENTS).index('by_asset');
    const req = index.getAll(IDBKeyRange.only(assetId));
    req.onsuccess = () => {
      const items = ((req.result as StoredEvent[]) || [])
        .filter((e) => e.ownerId === ownerId)
        .map(deserializeEvent);
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putLocalAssetAndEvent(
  asset: StoredAsset,
  event?: StoredEvent,
  outboxItem?: OutboxMutation
): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const stores = [STORE_ASSETS];
    if (event) stores.push(STORE_EVENTS);
    if (outboxItem) stores.push(STORE_OUTBOX);

    const tx = db.transaction(stores, 'readwrite');
    tx.objectStore(STORE_ASSETS).put(asset);
    if (event) tx.objectStore(STORE_EVENTS).put(event);
    if (outboxItem) tx.objectStore(STORE_OUTBOX).put(outboxItem);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteLocalAssetAndEnqueue(
  assetId: string,
  outboxItem?: OutboxMutation
): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_ASSETS, STORE_EVENTS, STORE_OUTBOX], 'readwrite');
    tx.objectStore(STORE_ASSETS).delete(assetId);

    const eventStore = tx.objectStore(STORE_EVENTS);
    const eventIdx = eventStore.index('by_asset');
    const eventReq = eventIdx.getAllKeys(IDBKeyRange.only(assetId));
    eventReq.onsuccess = () => {
      for (const key of eventReq.result) {
        eventStore.delete(key);
      }
    };

    if (outboxItem) {
      tx.objectStore(STORE_OUTBOX).put(outboxItem);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingOutboxForOwner(ownerId: string): Promise<OutboxMutation[]> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_OUTBOX, 'readonly');
    const index = tx.objectStore(STORE_OUTBOX).index('by_owner');
    const req = index.getAll(IDBKeyRange.only(ownerId));
    req.onsuccess = () => {
      const items = (req.result as OutboxMutation[]) || [];
      items.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removeOutboxItemAndMarkSynced(
  queueId: string,
  assetId: string,
  eventId?: string
): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_OUTBOX, STORE_ASSETS, STORE_EVENTS], 'readwrite');
    tx.objectStore(STORE_OUTBOX).delete(queueId);

    const assetStore = tx.objectStore(STORE_ASSETS);
    const getAssetReq = assetStore.get(assetId);
    getAssetReq.onsuccess = () => {
      const existing = getAssetReq.result as StoredAsset | undefined;
      if (existing) {
        assetStore.put({ ...existing, hasPendingWrites: false });
      }
    };

    if (eventId) {
      const eventStore = tx.objectStore(STORE_EVENTS);
      const getEvtReq = eventStore.get(eventId);
      getEvtReq.onsuccess = () => {
        const existingEvt = getEvtReq.result as StoredEvent | undefined;
        if (existingEvt) {
          eventStore.put({ ...existingEvt, hasPendingWrites: false });
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Merges remote Supabase rows into IndexedDB while preserving any uncommitted
 * offline local records that still have pending outbox mutations.
 */
export async function reconcileRemoteAssets(
  ownerId: string,
  remoteAssets: StoredAsset[]
): Promise<void> {
  const pendingOutbox = await getPendingOutboxForOwner(ownerId);
  const pendingAssetIds = new Set(pendingOutbox.map((m) => m.assetId));

  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, 'readwrite');
    const store = tx.objectStore(STORE_ASSETS);
    const index = store.index('by_owner');
    const existingReq = index.getAll(IDBKeyRange.only(ownerId));

    existingReq.onsuccess = () => {
      const existingList = (existingReq.result as StoredAsset[]) || [];
      const remoteIds = new Set(remoteAssets.map((r) => r.assetId));

      for (const localItem of existingList) {
        if (!remoteIds.has(localItem.assetId) && !pendingAssetIds.has(localItem.assetId)) {
          store.delete(localItem.assetId);
        }
      }

      for (const remoteItem of remoteAssets) {
        if (!pendingAssetIds.has(remoteItem.assetId)) {
          store.put({ ...remoteItem, hasPendingWrites: false });
        }
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function reconcileRemoteEvents(
  assetId: string,
  ownerId: string,
  remoteEvents: StoredEvent[]
): Promise<void> {
  const db = await openLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);

    for (const evt of remoteEvents) {
      if (evt.ownerId === ownerId && evt.assetId === assetId) {
        store.put({ ...evt, hasPendingWrites: false });
      }
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
