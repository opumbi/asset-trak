import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  WriteBatch,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  cacheReportingCurrencyLocally,
  convertCurrency,
  CURRENCY_META,
  CurrencyCode,
  getCrossRate,
  isValidCurrencyCode,
} from '../lib/currency';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  AssetCategory,
  AssetEventAction,
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
  currency: CurrencyCode;
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

/**
 * Enforces blueprint volumetric, ISO currency, and regex constraints on outgoing mutations
 * prior to Firestore execution (Validation Synchronicity).
 */
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

  if (!isValidCurrencyCode(input.currency)) {
    throw new Error('Please select a supported ISO currency.');
  }

  if (!ASSET_STATUSES.includes(input.status)) {
    throw new Error('Please select a valid lifecycle status.');
  }

  const isZeroDec = Boolean(CURRENCY_META[input.currency].zeroDecimal);
  const roundMoney = (val: number) =>
    isZeroDec ? Math.round(val) : Math.round(val * 100) / 100;

  const purchasePrice = Number(input.purchasePrice);
  if (
    !Number.isFinite(purchasePrice) ||
    purchasePrice < 0 ||
    purchasePrice > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Purchase price must be between 0 and 1,000,000,000.');
  }

  const currentValuation = Number(input.currentValuation);
  if (
    !Number.isFinite(currentValuation) ||
    currentValuation < 0 ||
    currentValuation > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Current valuation must be between 0 and 1,000,000,000.');
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
    currency: input.currency,
    purchasePrice: roundMoney(purchasePrice),
    currentValuation: roundMoney(currentValuation),
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

async function commitBatchOfflineAware(
  batch: WriteBatch,
  operationType: OperationType,
  path: string,
  isOnline: boolean
): Promise<'synced' | 'queued-offline'> {
  const commitPromise = batch.commit().catch((error) => {
    handleFirestoreError(error, operationType, path);
  });

  if (!isOnline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return 'queued-offline';
  }

  return Promise.race([
    commitPromise.then(() => 'synced' as const),
    new Promise<'queued-offline'>((resolve) =>
      setTimeout(() => resolve('queued-offline'), 2800)
    ),
  ]);
}

function appendAuditEventToBatch(
  batch: WriteBatch,
  params: {
    assetId: string;
    ownerId: string;
    actorEmail: string;
    action: AssetEventAction;
    summary: string;
  }
) {
  const eventId = generateSafeId('evt');
  const eventRef = doc(db, 'assets', params.assetId, 'events', eventId);
  batch.set(eventRef, {
    eventId,
    assetId: params.assetId,
    ownerId: params.ownerId,
    action: params.action,
    summary: params.summary.trim().slice(0, SCHEMA_LIMITS.EVENT_SUMMARY_MAX_LEN),
    actorEmail: params.actorEmail.trim().slice(0, SCHEMA_LIMITS.ACTOR_EMAIL_MAX_LEN),
    createdAt: serverTimestamp(),
  });
}

export async function saveUserReportingCurrency(params: {
  userId: string;
  reportingCurrency: CurrencyCode;
  isOnline: boolean;
}): Promise<void> {
  if (!isValidCurrencyCode(params.reportingCurrency)) {
    throw new Error('Unsupported reporting currency.');
  }

  cacheReportingCurrencyLocally(params.reportingCurrency);
  const path = `userSettings/${params.userId}`;
  const writePromise = setDoc(doc(db, 'userSettings', params.userId), {
    userId: params.userId,
    reportingCurrency: params.reportingCurrency,
    updatedAt: serverTimestamp(),
  }).catch((error) => {
    handleFirestoreError(error, OperationType.WRITE, path);
  });

  if (!params.isOnline) {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return;
  }

  await Promise.race([
    writePromise,
    new Promise<void>((resolve) => setTimeout(resolve, 2500)),
  ]);
}

export async function createAssetWithEvent(params: {
  input: AssetFormInput;
  ownerId: string;
  actorEmail: string;
  isOnline: boolean;
}): Promise<{ assetId: string; syncState: 'synced' | 'queued-offline' }> {
  const validated = sanitizeAndValidateAssetInput(params.input);
  const assetId = generateSafeId('ast');
  const assetRef = doc(db, 'assets', assetId);

  const batch = writeBatch(db);
  batch.set(assetRef, {
    assetId,
    ownerId: params.ownerId,
    ...validated,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const assigneeNote = validated.assignedTo ? ` · Assigned to ${validated.assignedTo}` : '';
  appendAuditEventToBatch(batch, {
    assetId,
    ownerId: params.ownerId,
    actorEmail: params.actorEmail,
    action: 'Asset Registered',
    summary: `Registered in ${validated.category} at ${formatCurrency(
      validated.currentValuation,
      validated.currency
    )} (${validated.currency})${assigneeNote}`,
  });

  const syncState = await commitBatchOfflineAware(
    batch,
    OperationType.CREATE,
    `assets/${assetId}`,
    params.isOnline
  );
  return { assetId, syncState };
}

export async function updateFullAssetWithEvent(params: {
  existing: AssetRecord;
  input: AssetFormInput;
  ownerId: string;
  actorEmail: string;
  isOnline: boolean;
}): Promise<'synced' | 'queued-offline'> {
  if (params.existing.status === 'Disposed') {
    throw new Error('Disposed assets have finalized lifecycle records and cannot be edited.');
  }

  const validated = sanitizeAndValidateAssetInput(params.input);
  const assetRef = doc(db, 'assets', params.existing.assetId);
  const batch = writeBatch(db);

  batch.update(assetRef, {
    name: validated.name,
    serialNumber: validated.serialNumber,
    category: validated.category,
    currency: validated.currency,
    purchasePrice: validated.purchasePrice,
    currentValuation: validated.currentValuation,
    purchaseDate: validated.purchaseDate,
    warrantyExpiry: validated.warrantyExpiry,
    status: validated.status,
    department: validated.department,
    location: validated.location,
    assignedTo: validated.assignedTo,
    notes: validated.notes,
    photoUrl: validated.photoUrl,
    updatedAt: serverTimestamp(),
  });

  let action: AssetEventAction = 'Details Updated';
  const changes: string[] = [];

  if (params.existing.status !== validated.status) {
    action = 'Status Changed';
    changes.push(`Status ${params.existing.status} -> ${validated.status}`);
  }
  if (
    params.existing.currentValuation !== validated.currentValuation ||
    params.existing.currency !== validated.currency
  ) {
    if (action === 'Details Updated') action = 'Valuation Adjusted';
    changes.push(
      `Valuation ${formatCurrency(
        params.existing.currentValuation,
        params.existing.currency
      )} -> ${formatCurrency(validated.currentValuation, validated.currency)}`
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

  appendAuditEventToBatch(batch, {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    actorEmail: params.actorEmail,
    action,
    summary: changes.join(' · '),
  });

  return commitBatchOfflineAware(
    batch,
    OperationType.UPDATE,
    `assets/${params.existing.assetId}`,
    params.isOnline
  );
}

export async function updateAssetStatusAction(params: {
  existing: AssetRecord;
  newStatus: AssetStatus;
  assignedTo?: string;
  location?: string;
  ownerId: string;
  actorEmail: string;
  isOnline: boolean;
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
  const safeCurrency: CurrencyCode = isValidCurrencyCode(params.existing.currency)
    ? params.existing.currency
    : 'USD';

  if (!nextLocation) {
    throw new Error('Location cannot be empty.');
  }

  const assetRef = doc(db, 'assets', params.existing.assetId);
  const batch = writeBatch(db);

  batch.update(assetRef, {
    status: params.newStatus,
    assignedTo: nextAssignedTo,
    location: nextLocation,
    currency: safeCurrency,
    updatedAt: serverTimestamp(),
  });

  appendAuditEventToBatch(batch, {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    actorEmail: params.actorEmail,
    action: 'Status Changed',
    summary: `Lifecycle status changed from ${params.existing.status} to ${params.newStatus}`,
  });

  return commitBatchOfflineAware(
    batch,
    OperationType.UPDATE,
    `assets/${params.existing.assetId}`,
    params.isOnline
  );
}

export async function updateAssetValuationAction(params: {
  existing: AssetRecord;
  newValuation: number;
  newCurrency?: CurrencyCode;
  notes?: string;
  ownerId: string;
  actorEmail: string;
  isOnline: boolean;
}): Promise<'synced' | 'queued-offline'> {
  if (params.existing.status === 'Disposed') {
    throw new Error('Disposed assets have finalized lifecycle records and cannot be revalued.');
  }

  const targetCurrency: CurrencyCode =
    params.newCurrency && isValidCurrencyCode(params.newCurrency)
      ? params.newCurrency
      : isValidCurrencyCode(params.existing.currency)
      ? params.existing.currency
      : 'USD';

  const isZeroDec = Boolean(CURRENCY_META[targetCurrency].zeroDecimal);
  const cleanVal = isZeroDec
    ? Math.round(Number(params.newValuation))
    : Math.round(Number(params.newValuation) * 100) / 100;

  if (
    !Number.isFinite(cleanVal) ||
    cleanVal < 0 ||
    cleanVal > SCHEMA_LIMITS.MAX_MONETARY_VALUE
  ) {
    throw new Error('Valuation must be between 0 and 1,000,000,000.');
  }

  const nextNotes = (params.notes ?? params.existing.notes)
    .trim()
    .slice(0, SCHEMA_LIMITS.NOTES_MAX_LEN);

  const assetRef = doc(db, 'assets', params.existing.assetId);
  const batch = writeBatch(db);

  batch.update(assetRef, {
    currentValuation: cleanVal,
    currency: targetCurrency,
    notes: nextNotes,
    updatedAt: serverTimestamp(),
  });

  appendAuditEventToBatch(batch, {
    assetId: params.existing.assetId,
    ownerId: params.ownerId,
    actorEmail: params.actorEmail,
    action: 'Valuation Adjusted',
    summary: `Book valuation updated from ${formatCurrency(
      params.existing.currentValuation,
      params.existing.currency
    )} to ${formatCurrency(cleanVal, targetCurrency)} (${targetCurrency})`,
  });

  return commitBatchOfflineAware(
    batch,
    OperationType.UPDATE,
    `assets/${params.existing.assetId}`,
    params.isOnline
  );
}

export async function deleteAssetWithEvents(params: {
  assetId: string;
  ownerId: string;
  isOnline: boolean;
}): Promise<'synced' | 'queued-offline'> {
  const eventsPath = `assets/${params.assetId}/events`;
  const batch = writeBatch(db);

  try {
    const eventsQuery = query(
      collection(db, 'assets', params.assetId, 'events'),
      where('ownerId', '==', params.ownerId)
    );
    const eventsSnap = await getDocs(eventsQuery);
    eventsSnap.docs.forEach((eventDoc) => {
      batch.delete(eventDoc.ref);
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, eventsPath);
  }

  batch.delete(doc(db, 'assets', params.assetId));
  return commitBatchOfflineAware(
    batch,
    OperationType.DELETE,
    `assets/${params.assetId}`,
    params.isOnline
  );
}

export async function seedSampleAssets(params: {
  ownerId: string;
  actorEmail: string;
  isOnline: boolean;
}): Promise<'synced' | 'queued-offline'> {
  const batch = writeBatch(db);

  for (const sample of SAMPLE_STARTER_ASSETS) {
    const validated = sanitizeAndValidateAssetInput(sample);
    const assetId = generateSafeId('ast');
    const assetRef = doc(db, 'assets', assetId);

    batch.set(assetRef, {
      assetId,
      ownerId: params.ownerId,
      ...validated,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    appendAuditEventToBatch(batch, {
      assetId,
      ownerId: params.ownerId,
      actorEmail: params.actorEmail,
      action: 'Asset Registered',
      summary: `Initial catalog registration in ${validated.category} (${formatCurrency(
        validated.currentValuation,
        validated.currency
      )} ${validated.currency})`,
    });
  }

  return commitBatchOfflineAware(batch, OperationType.CREATE, 'assets', params.isOnline);
}

export function exportAssetsToCsv(
  assets: AssetRecord[],
  reportingCurrency: CurrencyCode,
  usdRates: Record<CurrencyCode, number>
): void {
  const headers = [
    'Asset ID',
    'Asset Name',
    'Serial / Model Number',
    'Category',
    'Status',
    'Native Currency',
    'Purchase Price (Native)',
    'Current Valuation (Native)',
    `Reporting Currency (${reportingCurrency})`,
    'FX Conversion Rate',
    `Converted Purchase (${reportingCurrency})`,
    `Converted Valuation (${reportingCurrency})`,
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
    const fxRate = getCrossRate(asset.currency, reportingCurrency, usdRates);
    const convertedPurchase = convertCurrency(
      asset.purchasePrice,
      asset.currency,
      reportingCurrency,
      usdRates
    );
    const convertedValuation = convertCurrency(
      asset.currentValuation,
      asset.currency,
      reportingCurrency,
      usdRates
    );
    const nativeDecimals = CURRENCY_META[asset.currency]?.zeroDecimal ? 0 : 2;
    const reportDecimals = CURRENCY_META[reportingCurrency]?.zeroDecimal ? 0 : 2;

    return [
      asset.assetId,
      asset.name,
      asset.serialNumber,
      asset.category,
      asset.status,
      asset.currency,
      asset.purchasePrice.toFixed(nativeDecimals),
      asset.currentValuation.toFixed(nativeDecimals),
      reportingCurrency,
      fxRate.toFixed(4),
      convertedPurchase.toFixed(reportDecimals),
      convertedValuation.toFixed(reportDecimals),
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
  link.setAttribute(
    'download',
    `asset-track-inventory-${reportingCurrency.toLowerCase()}-${dateStamp}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
