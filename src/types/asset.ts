import laptopImg from '../assets/images/asset_laptop_workstation_1793292946521.jpg';
import chairImg from '../assets/images/asset_ergonomic_chair_1793292948096.jpg';
import vanImg from '../assets/images/asset_fleet_van_1793292948895.jpg';
import machineryImg from '../assets/images/asset_industrial_machinery_1793292949144.jpg';
import { CurrencyCode, formatMoney } from '../lib/currency';

export const ASSET_CATEGORIES = [
  'IT Hardware',
  'Office Furniture',
  'Vehicles',
  'Machinery',
  'Lab & Medical',
  'Other',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = [
  'In Use',
  'Available',
  'Maintenance',
  'Disposed',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_EVENT_ACTIONS = [
  'Asset Registered',
  'Details Updated',
  'Status Changed',
  'Valuation Adjusted',
  'Photo Updated',
] as const;

export type AssetEventAction = (typeof ASSET_EVENT_ACTIONS)[number];

/**
 * Verbatim schema constraints synchronized with /firebase-blueprint.json and /firestore.rules
 */
export const SCHEMA_LIMITS = {
  ID_MAX_LEN: 128,
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  NAME_MAX_LEN: 120,
  SERIAL_MAX_LEN: 80,
  CATEGORY_MAX_LEN: 40,
  CURRENCY_LEN: 3,
  STATUS_MAX_LEN: 20,
  DEPARTMENT_MAX_LEN: 80,
  LOCATION_MAX_LEN: 120,
  ASSIGNED_TO_MAX_LEN: 100,
  NOTES_MAX_LEN: 1000,
  PHOTO_URL_MAX_LEN: 350000,
  EVENT_SUMMARY_MAX_LEN: 300,
  ACTOR_EMAIL_MAX_LEN: 160,
  MAX_MONETARY_VALUE: 1000000000,
  DATE_PATTERN: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  OPTIONAL_DATE_PATTERN: /^([0-9]{4}-[0-9]{2}-[0-9]{2})?$/,
} as const;

export interface AssetRecord {
  assetId: string;
  ownerId: string;
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
  createdAt: Date;
  updatedAt: Date;
  /** True when queued in local IndexedDB awaiting sync to Cloud Firestore */
  hasPendingWrites?: boolean;
}

export interface AssetFormInput {
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

export interface AssetEventRecord {
  eventId: string;
  assetId: string;
  ownerId: string;
  action: AssetEventAction;
  summary: string;
  actorEmail: string;
  createdAt: Date;
  hasPendingWrites?: boolean;
}

export function formatCurrency(
  amount: number,
  currencyCode: CurrencyCode = 'USD'
): string {
  return formatMoney(amount, currencyCode);
}

export function formatShortDate(isoOrDate: string | Date): string {
  if (!isoOrDate) return 'None';
  if (typeof isoOrDate === 'string') {
    const parts = isoOrDate.split('-');
    if (parts.length === 3) {
      const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!Number.isNaN(dt.getTime())) {
        return dt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }
    }
    return isoOrDate;
  }
  return isoOrDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function generateSafeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}_${randomPart}`;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const SAMPLE_STARTER_ASSETS: AssetFormInput[] = [
  {
    name: 'Dell Latitude 7450 Workstation Bundle',
    serialNumber: 'AT-IT-745088',
    category: 'IT Hardware',
    currency: 'USD',
    purchasePrice: 2890,
    currentValuation: 2540,
    purchaseDate: getTodayIsoDate(),
    warrantyExpiry: '2029-10-15',
    status: 'In Use',
    department: 'Product Engineering',
    location: 'HQ Floor 4 · Desk W-18',
    assignedTo: 'Elena Rostova',
    notes: 'Includes 27-inch 4K Thunderbolt hub monitor and wireless keyboard kit.',
    photoUrl: laptopImg,
  },
  {
    name: 'ErgoPro Executive Mesh Task Chair',
    serialNumber: 'AT-FN-309214',
    category: 'Office Furniture',
    currency: 'EUR',
    purchasePrice: 1090,
    currentValuation: 890,
    purchaseDate: '2026-06-12',
    warrantyExpiry: '2031-06-12',
    status: 'Available',
    department: 'EMEA Operations',
    location: 'Berlin Hub · Suite B',
    assignedTo: '',
    notes: 'Polished aluminum base, lumbar support inspected Q3.',
    photoUrl: chairImg,
  },
  {
    name: 'Ford E-Transit Electric Cargo Van #07',
    serialNumber: 'AT-VH-904512',
    category: 'Vehicles',
    currency: 'GBP',
    purchasePrice: 42800,
    currentValuation: 38500,
    purchaseDate: getTodayIsoDate(),
    warrantyExpiry: '2030-09-30',
    status: 'In Use',
    department: 'Regional Logistics',
    location: 'London Depot · Bay 07',
    assignedTo: 'Marcus Vance',
    notes: '68 kWh battery pack, Level 2 fleet charger assigned to Bay 07.',
    photoUrl: vanImg,
  },
  {
    name: 'Prism Precision 500 Fiber Laser Unit',
    serialNumber: 'AT-MC-500319',
    category: 'Machinery',
    currency: 'USD',
    purchasePrice: 38500,
    currentValuation: 34100,
    purchaseDate: '2026-03-20',
    warrantyExpiry: '2028-03-20',
    status: 'Maintenance',
    department: 'Hardware Fabrication',
    location: 'Annex Lab · Cell 03',
    assignedTo: 'Devon Brooks',
    notes: 'Scheduled optics calibration and chiller coolant replacement.',
    photoUrl: machineryImg,
  },
];
