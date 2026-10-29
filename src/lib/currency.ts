export const SUPPORTED_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
  'CHF',
  'INR',
  'SGD',
  'ZAR',
  'NGN',
  'BRL',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export interface CurrencyMetadata {
  code: CurrencyCode;
  symbol: string;
  name: string;
  zeroDecimal?: boolean;
}

export const CURRENCY_META: Record<CurrencyCode, CurrencyMetadata> = {
  USD: { code: 'USD', symbol: '$', name: 'US Dollar' },
  EUR: { code: 'EUR', symbol: '€', name: 'Euro' },
  GBP: { code: 'GBP', symbol: '£', name: 'British Pound' },
  CAD: { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar' },
  AUD: { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  JPY: { code: 'JPY', symbol: '¥', name: 'Japanese Yen', zeroDecimal: true },
  CHF: { code: 'CHF', symbol: 'CHF', name: 'Swiss Franc' },
  INR: { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
  SGD: { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  ZAR: { code: 'ZAR', symbol: 'R', name: 'South African Rand' },
  NGN: { code: 'NGN', symbol: '₦', name: 'Nigerian Naira' },
  BRL: { code: 'BRL', symbol: 'R$', name: 'Brazilian Real' },
};

/**
 * Units of currency per 1 USD (used as offline fallback prior to first live FX sync)
 */
export const FALLBACK_USD_RATES: Record<CurrencyCode, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.38,
  AUD: 1.52,
  JPY: 152.4,
  CHF: 0.88,
  INR: 84.1,
  SGD: 1.34,
  ZAR: 17.8,
  NGN: 1620.0,
  BRL: 5.72,
};

export interface FxRatesSnapshot {
  /** Units of each currency per 1 USD */
  usdRates: Record<CurrencyCode, number>;
  updatedAtIso: string;
  source: 'live' | 'cached' | 'baseline';
}

const FX_STORAGE_KEY = 'asset_track_fx_rates_v1';
const REPORTING_CCY_STORAGE_KEY = 'asset_track_reporting_ccy_v1';

export function isValidCurrencyCode(value: unknown): value is CurrencyCode {
  return (
    typeof value === 'string' &&
    (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
  );
}

export function loadCachedReportingCurrency(): CurrencyCode {
  try {
    const raw = localStorage.getItem(REPORTING_CCY_STORAGE_KEY);
    if (raw && isValidCurrencyCode(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage read issues
  }
  return 'USD';
}

export function cacheReportingCurrencyLocally(currency: CurrencyCode): void {
  try {
    localStorage.setItem(REPORTING_CCY_STORAGE_KEY, currency);
  } catch {
    // Ignore storage write issues
  }
}

export function loadInitialFxRates(): FxRatesSnapshot {
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        usdRates?: Partial<Record<CurrencyCode, number>>;
        updatedAtIso?: string;
      };
      if (parsed && parsed.usdRates) {
        const merged: Record<CurrencyCode, number> = { ...FALLBACK_USD_RATES };
        for (const code of SUPPORTED_CURRENCIES) {
          const val = Number(parsed.usdRates[code]);
          if (Number.isFinite(val) && val > 0) {
            merged[code] = val;
          }
        }
        merged.USD = 1;
        return {
          usdRates: merged,
          updatedAtIso: parsed.updatedAtIso || new Date().toISOString(),
          source: 'cached',
        };
      }
    }
  } catch {
    // Ignore malformed cache
  }

  return {
    usdRates: { ...FALLBACK_USD_RATES },
    updatedAtIso: new Date().toISOString(),
    source: 'baseline',
  };
}

export async function fetchLiveFxRates(): Promise<FxRatesSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`FX HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    if (!payload.rates) {
      throw new Error('Missing FX rates map');
    }

    const updatedRates: Record<CurrencyCode, number> = { ...FALLBACK_USD_RATES };
    for (const code of SUPPORTED_CURRENCIES) {
      const rate = Number(payload.rates[code]);
      if (Number.isFinite(rate) && rate > 0) {
        updatedRates[code] = rate;
      }
    }
    updatedRates.USD = 1;

    const snapshot: FxRatesSnapshot = {
      usdRates: updatedRates,
      updatedAtIso: new Date().toISOString(),
      source: 'live',
    };

    try {
      localStorage.setItem(
        FX_STORAGE_KEY,
        JSON.stringify({
          usdRates: snapshot.usdRates,
          updatedAtIso: snapshot.updatedAtIso,
        })
      );
    } catch {
      // Ignore storage quota errors
    }

    return snapshot;
  } finally {
    clearTimeout(timeout);
  }
}

export function getCrossRate(
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  usdRates: Record<CurrencyCode, number>
): number {
  if (fromCurrency === toCurrency) return 1;
  const fromPerUsd = usdRates[fromCurrency] || FALLBACK_USD_RATES[fromCurrency] || 1;
  const toPerUsd = usdRates[toCurrency] || FALLBACK_USD_RATES[toCurrency] || 1;
  return toPerUsd / fromPerUsd;
}

export function convertCurrency(
  amount: number,
  fromCurrency: CurrencyCode,
  toCurrency: CurrencyCode,
  usdRates: Record<CurrencyCode, number>
): number {
  if (!Number.isFinite(amount)) return 0;
  if (fromCurrency === toCurrency) return amount;
  return amount * getCrossRate(fromCurrency, toCurrency, usdRates);
}

export function formatMoney(
  amount: number,
  currencyCode: CurrencyCode = 'USD'
): string {
  const safeCode = isValidCurrencyCode(currencyCode) ? currencyCode : 'USD';
  const meta = CURRENCY_META[safeCode];
  const digits = meta.zeroDecimal ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: safeCode,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(amount) ? amount : 0);
}
