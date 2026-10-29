import {
  deleteLocalAssetAndEnqueue,
  getLocalAssetsForOwner,
  getLocalEventsForAsset,
  getPendingOutboxForOwner,
  OutboxMutation,
  putLocalAssetAndEvent,
  reconcileRemoteAssets,
  reconcileRemoteEvents,
  removeOutboxItemAndMarkSynced,
  StoredAsset,
  StoredEvent,
} from '../lib/offlineDb';
import {
  apiCreateAsset,
  apiDeleteAsset,
  apiFetchAssetEvents,
  apiFetchAssets,
  apiUpdateAsset,
  getAccessToken,
} from '../lib/supabaseApi';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  AssetCategory,
  AssetEventAction,
  AssetEventRecord,
  AssetFormInput,
  AssetRecord,
  AssetStatus,
  formatCurrency,
  generateSafeId,
  SAMPLE_STARTER_ASSETS,
  SCHEMA_LIMITS,
} from '../types/asset';

export interface ValidatedAssetPayload {
  name: string;
  serialNumber: string;
  category: AssetCategory;
  purchasePrice: number;
  currentValuation: number;
  purchaseDate: string;
  warrantyExpiry: string;
  status: AssetStatus;
  department: string;
  location: string;
  assignedTo: string;
  notes: string;
  photoUrl: string;
}

type InventoryListener = () => void;
const listeners = new Set<InventoryListener>();

export function subscribeToInventoryChanges(listener: InventoryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyInventoryListeners() {
  listeners.forEach((fn) => fn());
}

export function sanitizeAndValidateAssetInput(input: AssetFormInput): ValidatedAssetPayload {
  const name = input.name.trim().slice(0, SCHEMA_LIMITS.NAME_MAX_LEN);
  if (!name) {
    throw new Error('Asset name is required.');
  }

  const serialNumber = input.serialNumber.trim().slice(0, SCHEMA_LIMITS.SERIAL_MAX_LEN);
  if (!serialNumber) {
    throw new Error('Serial or model number is required.');
  }

  if (!ASSET_CATEGORIES.includes(input.category)) {
    throw new Error('Please select a valid asset category.');
  }

  if (!ASSET_STATUSES.includes(input.status)) {
    throw new Error('Please select a valid lifecycle status.');
  }

  const purchasePrice = Number(input.purchasePrice);
  if (
    !Number.isFinite(purchasePrice) ||
    purchasePrice < 0 ||
    purchasePrice > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Purchase price must be between $0 and $1,000,000,000.');
  }

  const currentValuation = Number(input.currentValuation);
  if (
    !Number.isFinite(currentValuation) ||
    currentValuation < 0 ||
    currentValuation > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Current valuation must be between $0 and $1,000,000,000.');
  }

  const purchaseDate = input.purchaseDate.trim();
  if (!SCHEMA_LIMITS.DATE_PATTERN.test(purchaseDate)) {
    throw new Error('Purchase date must use YYYY-MM-DD format.');
  }

  const warrantyExpiry = input.warrantyExpiry.trim();
  if (!SCHEMA_LIMITS.OPTIONAL_DATE_PATTERN.test(warrantyExpiry)) {
    throw new Error('Warranty expiry date must use YYYY-MM-DD format or be left blank.');
  }

  const department = input.department.trim().slice(0, SCHEMA_LIMITS.DEPARTMENT_MAX_LEN);
  if (!department) {
    throw new Error('Department is required.');
  }

  const location = input.location.trim().slice(0, SCHEMA_LIMITS.LOCATION_MAX_LEN);
  if (!location) {
    throw new Error('Physical location is required.');
  }

  const assignedTo = input.assignedTo.trim().slice(0, SCHEMA_LIMITS.ASSIGNED_TO_MAX_LEN);
  const notes = input.notes.trim().slice(0, SCHEMA_LIMITS.NOTES_MAX_LEN);
  const photoUrl = input.photoUrl.trim();
  if (photoUrl.length > SCHEMA_LIMITS.PHOTO_URL_MAX_LEN) {
    throw new Error('Attached photo exceeds maximum allowed payload size.');
  }

  return {
    name,
    serialNumber,
    category: input.category,
    purchasePrice: Math.round(purchasePrice * 100) / 100,
    currentValuation: Math.round(currentValuation * 100) / 100,
    purchaseDate,
    warrantyExpiry,
    status: input.status,
    department,
    location,
    assignedTo,
    notes,
    photoUrl,
  };
}

let isFlushing = false;

/**
 * Flushes all queued offline mutations in FIFO order to Supabase PostgreSQL.
 */
export async function flushOutboxToSupabase(
  ownerId: string,
  canSyncCloud: boolean
): Promise<{ syncedCount: number; errorMessage: string | null }> {
  if (!canSyncCloud || !getAccessToken() || isFlushing) {
    return { syncedCount: 0, errorMessage: null };
  }

  isFlushing = true;
  let syncedCount = 0;
  let errorMessage: string | null = null;

  try {
    const queue = await getPendingOutboxForOwner(ownerId);
    for (const item of queue) {
      try {
        if (item.operation === 'CREATE' && item.assetPayload) {
          await apiCreateAsset(item.assetPayload, item.eventPayload);
        } else if (item.operation === 'UPDATE' && item.updatesPayload) {
          await apiUpdateAsset(item.assetId, item.updatesPayload, item.eventPayload);
        } else if (item.operation === 'DELETE') {
          await apiDeleteAsset(item.assetId);
        }

        await removeOutboxItemAndMarkSynced(
          item.queueId,
          item.assetId,
          item.eventPayload?.eventId
        );
        syncedCount += 1;
      } catch (err) {
        errorMessage =
          err instanceof Error ? err.message : 'Unable to sync pending changes to Supabase.';
        break;
      }
    }
  } finally {
    isFlushing = false;
    if (syncedCount > 0) {
      notifyInventoryListeners();
    }
  }

  return { syncedCount, errorMessage };
}

/**
 * Syncs outbox first, then pulls authoritative rows from Supabase into IndexedDB.
 */
export async function syncInventoryWithSupabase(
  ownerId: string,
  canSyncCloud: boolean
): Promise<{ assets: AssetRecord[]; syncError: string | null }> {
  let syncError: string | null = null;

  if (canSyncCloud && getAccessToken()) {
    const flushResult = await flushOutboxToSupabase(ownerId, true);
    if (flushResult.errorMessage) {
      syncError = flushResult.errorMessage;
    }

    try {
      const remoteAssets = await apiFetchAssets();
      await reconcileRemoteAssets(ownerId, remoteAssets);
    } catch (err) {
      syncError = err instanceof Error ? err.message : 'Unable to fetch Supabase inventory.';
    }
  }

  const assets = await getLocalAssetsForOwner(ownerId);
  return { assets, syncError };
}

export async function fetchAssetEventsOfflineAware(params: {
  assetId: string;
  ownerId: string;
  canSyncCloud: boolean;
}): Promise<AssetEventRecord[]> {
  if (params.canSyncCloud && getAccessToken()) {
    try {
      const remoteEvents = await apiFetchAssetEvents(params.assetId);
      await reconcileRemoteEvents(params.assetId, params.ownerId, remoteEvents);
    } catch {
      // Serve cached IndexedDB events seamlessly when offline
    }
  }
  return getLocalEventsForAsset(params.assetId, params.ownerId);
}

export async function createAssetWithEvent(params: {
  input: AssetFormInput;
  ownerId: string;
  actorEmail: string;
  canSyncCloud: boolean;
}): Promise<{ assetId: string; syncState: 'synced' | 'queued-offline' }> {
  const validated = sanitizeAndValidateAssetInput(params.input);
  const assetId = generateSafeId('ast');
  const eventId = generateSafeId('evt');
  const nowIso = new Date().toISOString();

  const storedAsset: StoredAsset = {
    assetId,
    ownerId: params.ownerId,
    ...validated,
    createdAt: nowIso,
    updatedAt: nowIso,
    hasPendingWrites: true,
  };

  const assigneeNote = validated.assignedTo ? ` · Assigned to ${validated.assignedTo}` : '';
  const storedEvent: StoredEvent = {
    eventId,
    assetId,
    ownerId: params.ownerId,
    action: 'Asset Registered',
    summary: `Registered in ${validated.category} at ${formatCurrency(
      validated.currentValuation
    )}${assigneeNote}`.slice(0, SCHEMA_LIMITS.EVENT_SUMMARY_MAX_LEN),
    actorEmail: params.actorEmail.slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
    createdAt: nowIso,
    hasPendingWrites: true,
  };

  const outboxItem: OutboxMutation = {
    queueId: generateSafeId('q'),
    ownerId: params.ownerId,
    operation: 'CREATE',
    assetId,
    assetPayload: storedAsset,
    eventPayload: storedEvent,
    enqueuedAt: Date.now(),
  };

  await putLocalAssetAndEvent(storedAsset, storedEvent, outboxItem);
  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) {
      return { assetId, syncState: 'synced' };
    }
  }

  return { assetId, syncState: 'queued-offline' };
}

export async function updateFullAssetWithEvent(params: {
  existing: AssetRecord;
  input: AssetFormInput;
  ownerId: string;
  actorEmail: string;
  canSyncCloud: boolean;
}): Promise<'synced' | 'queued-offline'> {
  if (params.existing.status === 'Disposed') {
    throw new Error('Disposed assets have finalized lifecycle records and cannot be edited.');
  }

  const validated = sanitizeAndValidateAssetInput(params.input);
  const nowIso = new Date().toISOString();

  let action: AssetEventAction = 'Details Updated';
  const changes: string[] = [];

  if (params.existing.status !== validated.status) {
    action = 'Status Changed';
    changes.push(`Status ${params.existing.status} -> ${validated.status}`);
  }
  if (params.existing.currentValuation !== validated.currentValuation) {
    if (action === 'Details Updated') action = 'Valuation Adjusted';
    changes.push(
      `Valuation ${formatCurrency(params.existing.currentValuation)} -> ${formatCurrency(
        validated.currentValuation
      )}`
    );
  }
  if (params.existing.photoUrl !== validated.photoUrl) {
    if (action === 'Details Updated') action = 'Photo Updated';
    changes.push('Updated asset photograph');
  }
  if (params.existing.assignedTo !== validated.assignedTo) {
    changes.push(
      validated.assignedTo ? `Assigned to ${validated.assignedTo}` : 'Cleared assignee'
    );
  }
  if (params.existing.location !== validated.location) {
    changes.push(`Relocated to ${validated.location}`);
  }
  if (changes.length === 0) {
    changes.push(`Updated specifications for ${validated.name}`);
  }

  const updatedAsset: StoredAsset = {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    ...validated,
    createdAt: params.existing.createdAt.toISOString(),
    updatedAt: nowIso,
    hasPendingWrites: true,
  };

  const storedEvent: StoredEvent = {
    eventId: generateSafeId('evt'),
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    action,
    summary: changes.join(' · ').slice(0, SCHEMA_LIMITS.EVENT_SUMMARY_MAX_LEN),
    actorEmail: params.actorEmail.slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
    createdAt: nowIso,
    hasPendingWrites: true,
  };

  const outboxItem: OutboxMutation = {
    queueId: generateSafeId('q'),
    ownerId: params.ownerId,
    operation: 'UPDATE',
    assetId: params.existing.assetId,
    updatesPayload: validated,
    eventPayload: storedEvent,
    enqueuedAt: Date.now(),
  };

  await putLocalAssetAndEvent(updatedAsset, storedEvent, outboxItem);
  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) return 'synced';
  }
  return 'queued-offline';
}

export async function updateAssetStatusAction(params: {
  existing: AssetRecord;
  newStatus: AssetStatus;
  assignedTo?: string;
  location?: string;
  ownerId: string;
  actorEmail: string;
  canSyncCloud: boolean;
}): Promise<'synced' | 'queued-offline'> {
  if (params.existing.status === 'Disposed') {
    throw new Error('Disposed assets have finalized lifecycle records and cannot be modified.');
  }

  const nextAssignedTo = (params.assignedTo ?? params.existing.assignedTo)
    .trim()
    .slice(0, SCHEMA_LIMITS.ASSIGNED_TO_MAX_LEN);
  const nextLocation = (params.location ?? params.existing.location)
    .trim()
    .slice(0, SCHEMA_LIMITS.LOCATION_MAX_LEN);

  if (!nextLocation) {
    throw new Error('Location cannot be empty.');
  }

  const nowIso = new Date().toISOString();
  const updatedAsset: StoredAsset = {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    name: params.existing.name,
    serialNumber: params.existing.serialNumber,
    category: params.existing.category,
    purchasePrice: params.existing.purchasePrice,
    currentValuation: params.existing.currentValuation,
    purchaseDate: params.existing.purchaseDate,
    warrantyExpiry: params.existing.warrantyExpiry,
    status: params.newStatus,
    department: params.existing.department,
    location: nextLocation,
    assignedTo: nextAssignedTo,
    notes: params.existing.notes,
    photoUrl: params.existing.photoUrl,
    createdAt: params.existing.createdAt.toISOString(),
    updatedAt: nowIso,
    hasPendingWrites: true,
  };

  const storedEvent: StoredEvent = {
    eventId: generateSafeId('evt'),
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    action: 'Status Changed',
    summary: `Lifecycle status changed from ${params.existing.status} to ${params.newStatus}`,
    actorEmail: params.actorEmail.slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
    createdAt: nowIso,
    hasPendingWrites: true,
  };

  const outboxItem: OutboxMutation = {
    queueId: generateSafeId('q'),
    ownerId: params.ownerId,
    operation: 'UPDATE',
    assetId: params.existing.assetId,
    updatesPayload: {
      status: params.newStatus,
      assignedTo: nextAssignedTo,
      location: nextLocation,
    },
    eventPayload: storedEvent,
    enqueuedAt: Date.now(),
  };

  await putLocalAssetAndEvent(updatedAsset, storedEvent, outboxItem);
  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) return 'synced';
  }
  return 'queued-offline';
}

export async function updateAssetValuationAction(params: {
  existing: AssetRecord;
  newValuation: number;
  notes?: string;
  ownerId: string;
  actorEmail: string;
  canSyncCloud: boolean;
}): Promise<'synced' | 'queued-offline'> {
  if (params.existing.status === 'Disposed') {
    throw new Error('Disposed assets have finalized lifecycle records and cannot be revalued.');
  }

  const cleanVal = Math.round(Number(params.newValuation) * 100) / 100;
  if (
    !Number.isFinite(cleanVal) ||
    cleanVal < 0 ||
    cleanVal > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Valuation must be between $0 and $1,000,000,000.');
  }

  const nextNotes = (params.notes ?? params.existing.notes)
    .trim()
    .slice(0, SCHEMA_LIMITS.NOTES_MAX_LEN);

  const nowIso = new Date().toISOString();
  const updatedAsset: StoredAsset = {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    name: params.existing.name,
    serialNumber: params.existing.serialNumber,
    category: params.existing.category,
    purchasePrice: params.existing.purchasePrice,
    currentValuation: cleanVal,
    purchaseDate: params.existing.purchaseDate,
    warrantyExpiry: params.existing.warrantyExpiry,
    status: params.existing.status,
    department: params.existing.department,
    location: params.existing.location,
    assignedTo: params.existing.assignedTo,
    notes: nextNotes,
    photoUrl: params.existing.photoUrl,
    createdAt: params.existing.createdAt.toISOString(),
    updatedAt: nowIso,
    hasPendingWrites: true,
  };

  const storedEvent: StoredEvent = {
    eventId: generateSafeId('evt'),
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    action: 'Valuation Adjusted',
    summary: `Book valuation updated from ${formatCurrency(
      params.existing.currentValuation
    )} to ${formatCurrency(cleanVal)}`,
    actorEmail: params.actorEmail.slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
    createdAt: nowIso,
    hasPendingWrites: true,
  };

  const outboxItem: OutboxMutation = {
    queueId: generateSafeId('q'),
    ownerId: params.ownerId,
    operation: 'UPDATE',
    assetId: params.existing.assetId,
    updatesPayload: {
      currentValuation: cleanVal,
      notes: nextNotes,
    },
    eventPayload: storedEvent,
    enqueuedAt: Date.now(),
  };

  await putLocalAssetAndEvent(updatedAsset, storedEvent, outboxItem);
  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) return 'synced';
  }
  return 'queued-offline';
}

export async function deleteAssetWithEvents(params: {
  assetId: string;
  ownerId: string;
  canSyncCloud: boolean;
}): Promise<'synced' | 'queued-offline'> {
  const outboxItem: OutboxMutation = {
    queueId: generateSafeId('q'),
    ownerId: params.ownerId,
    operation: 'DELETE',
    assetId: params.assetId,
    enqueuedAt: Date.now(),
  };

  await deleteLocalAssetAndEnqueue(params.assetId, outboxItem);
  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) return 'synced';
  }
  return 'queued-offline';
}

export async function seedSampleAssets(params: {
  ownerId: string;
  actorEmail: string;
  canSyncCloud: boolean;
}): Promise<'synced' | 'queued-offline'> {
  for (const sample of SAMPLE_STARTER_ASSETS) {
    const validated = sanitizeAndValidateAssetInput(sample);
    const assetId = generateSafeId('ast');
    const eventId = generateSafeId('evt');
    const nowIso = new Date().toISOString();

    const storedAsset: StoredAsset = {
      assetId,
      ownerId: params.ownerId,
      ...validated,
      createdAt: nowIso,
      updatedAt: nowIso,
      hasPendingWrites: true,
    };

    const storedEvent: StoredEvent = {
      eventId,
      assetId,
      ownerId: params.ownerId,
      action: 'Asset Registered',
      summary: `Initial catalog registration in ${validated.category} (${formatCurrency(
        validated.currentValuation
      )})`,
      actorEmail: params.actorEmail.slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
      createdAt: nowIso,
      hasPendingWrites: true,
    };

    const outboxItem: OutboxMutation = {
      queueId: generateSafeId('q'),
      ownerId: params.ownerId,
      operation: 'CREATE',
      assetId,
      assetPayload: storedAsset,
      eventPayload: storedEvent,
      enqueuedAt: Date.now(),
    };

    await putLocalAssetAndEvent(storedAsset, storedEvent, outboxItem);
  }

  notifyInventoryListeners();

  if (params.canSyncCloud && getAccessToken()) {
    const { errorMessage } = await flushOutboxToSupabase(params.ownerId, true);
    if (!errorMessage) return 'synced';
  }
  return 'queued-offline';
}

export function exportAssetsToCsv(assets: AssetRecord[]): void {
  const headers = [
    'Asset ID',
    'Asset Name',
    'Serial / Model Number',
    'Category',
    'Status',
    'Purchase Price (USD)',
    'Current Valuation (USD)',
    'Net Depreciation (USD)',
    'Purchase Date',
    'Warranty Expiry',
    'Department',
    'Location',
    'Assigned Person',
    'Sync State',
    'Last Updated',
    'Notes',
  ];

  const escapeCsvCell = (value: string | number): string => {
    const str = String(value ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = assets.map((asset) => {
    const depreciation = Math.round((asset.currentValuation - asset.purchasePrice) * 100) / 100;
    return [
      asset.assetId,
      asset.name,
      asset.serialNumber,
      asset.category,
      asset.status,
      asset.purchasePrice.toFixed(2),
      asset.currentValuation.toFixed(2),
      depreciation.toFixed(2),
      asset.purchaseDate,
      asset.warrantyExpiry || 'N/A',
      asset.department,
      asset.location,
      asset.assignedTo || 'Unassigned',
      asset.hasPendingWrites ? 'Pending Cloud Sync' : 'Synced',
      asset.updatedAt.toISOString(),
      asset.notes,
    ]
      .map(escapeCsvCell)
      .join(',');
  });

  const csvContent = [headers.map(escapeCsvCell).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `asset-track-inventory-${dateStamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
