import React, { useMemo } from 'react';
import { CalendarClock, Download, RefreshCw, Wrench } from 'lucide-react';
import {
  convertCurrency,
  CURRENCY_META,
  CurrencyCode,
  FxRatesSnapshot,
  getCrossRate,
} from '../lib/currency';
import {
  AssetRecord,
  formatCurrency,
  formatDateTime,
  formatShortDate,
} from '../types/asset';

interface ReportsViewProps {
  assets: AssetRecord[];
  reportingCurrency: CurrencyCode;
  fxSnapshot: FxRatesSnapshot;
  isRefreshingFx: boolean;
  isOnline: boolean;
  onRefreshFx: () => void;
  onExportCsv: () => void;
  onSelectAsset: (asset: AssetRecord) => void;
}

export function ReportsView({
  assets,
  reportingCurrency,
  fxSnapshot,
  isRefreshingFx,
  isOnline,
  onRefreshFx,
  onExportCsv,
  onSelectAsset,
}: ReportsViewProps) {
  const reportData = useMemo(() => {
    const activeAssets = assets.filter((a) => a.status !== 'Disposed');
    const usdRates = fxSnapshot.usdRates;

    const totalPurchase = activeAssets.reduce(
      (s, a) => s + convertCurrency(a.purchasePrice, a.currency, reportingCurrency, usdRates),
      0
    );
    const totalValuation = activeAssets.reduce(
      (s, a) => s + convertCurrency(a.currentValuation, a.currency, reportingCurrency, usdRates),
      0
    );
    const netDepreciation = totalValuation - totalPurchase;
    const retentionRate =
      totalPurchase > 0 ? Math.round((totalValuation / totalPurchase) * 1000) / 10 : 100;

    // Currency Exposure Breakdown
    const ccyMap = new Map<
      CurrencyCode,
      {
        currency: CurrencyCode;
        count: number;
        nativePurchase: number;
        nativeValuation: number;
        convertedValuation: number;
        crossRate: number;
      }
    >();

    for (const a of activeAssets) {
      const existing = ccyMap.get(a.currency) || {
        currency: a.currency,
        count: 0,
        nativePurchase: 0,
        nativeValuation: 0,
        convertedValuation: 0,
        crossRate: getCrossRate(a.currency, reportingCurrency, usdRates),
      };
      existing.count += 1;
      existing.nativePurchase += a.purchasePrice;
      existing.nativeValuation += a.currentValuation;
      existing.convertedValuation += convertCurrency(
        a.currentValuation,
        a.currency,
        reportingCurrency,
        usdRates
      );
      ccyMap.set(a.currency, existing);
    }

    const currencyExposure = Array.from(ccyMap.values()).sort(
      (a, b) => b.convertedValuation - a.convertedValuation
    );

    // Department Cost Center Summary (consolidated in reportingCurrency)
    const deptMap = new Map<
      string,
      { department: string; count: number; purchaseTotal: number; valuationTotal: number }
    >();

    for (const a of activeAssets) {
      const key = a.department || 'Unassigned';
      const existing = deptMap.get(key) || {
        department: key,
        count: 0,
        purchaseTotal: 0,
        valuationTotal: 0,
      };
      existing.count += 1;
      existing.purchaseTotal += convertCurrency(
        a.purchasePrice,
        a.currency,
        reportingCurrency,
        usdRates
      );
      existing.valuationTotal += convertCurrency(
        a.currentValuation,
        a.currency,
        reportingCurrency,
        usdRates
      );
      deptMap.set(key, existing);
    }

    const departments = Array.from(deptMap.values()).sort(
      (a, b) => b.valuationTotal - a.valuationTotal
    );

    // Warranty & Maintenance Watchlist
    const now = new Date();
    const horizon = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
    const todayIso = now.toISOString().slice(0, 10);
    const horizonIso = horizon.toISOString().slice(0, 10);

    const watchlist = activeAssets
      .filter(
        (a) =>
          a.status === 'Maintenance' ||
          (a.warrantyExpiry !== '' && a.warrantyExpiry <= horizonIso)
      )
      .map((asset) => ({
        asset,
        isExpired: asset.warrantyExpiry !== '' && asset.warrantyExpiry < todayIso,
      }))
      .sort((a, b) =>
        (a.asset.warrantyExpiry || '9999').localeCompare(b.asset.warrantyExpiry || '9999')
      );

    return {
      totalPurchase,
      totalValuation,
      netDepreciation,
      retentionRate,
      currencyExposure,
      departments,
      watchlist,
    };
  }, [assets, reportingCurrency, fxSnapshot]);

  const fxSourceLabel =
    fxSnapshot.source === 'live'
      ? 'Live Market FX Rates'
      : fxSnapshot.source === 'cached'
      ? 'Offline Cached FX Rates'
      : 'Baseline Reference FX Rates';

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Valuation & Multicurrency Reports
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Consolidated in{' '}
            <span className="font-mono font-semibold text-slate-900">{reportingCurrency}</span>{' '}
            ({CURRENCY_META[reportingCurrency].name}) · {fxSourceLabel}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={!isOnline || isRefreshingFx}
            onClick={onRefreshFx}
            className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshingFx ? 'animate-spin' : ''}`} />
            <span>Refresh FX Rates</span>
          </button>

          <button
            type="button"
            disabled={assets.length === 0}
            onClick={onExportCsv}
            className="min-h-[44px] px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Download CSV Ledger</span>
          </button>
        </div>
      </div>

      {/* Financial Summary Strip */}
      <section className="bg-white border border-slate-200 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Acquisition Basis ({reportingCurrency})
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {formatCurrency(reportData.totalPurchase, reportingCurrency)}
          </div>
        </div>
        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Current Book Valuation ({reportingCurrency})
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {formatCurrency(reportData.totalValuation, reportingCurrency)}
          </div>
        </div>
        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Net Variance / Depreciation
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {reportData.netDepreciation >= 0
              ? `+${formatCurrency(reportData.netDepreciation, reportingCurrency)}`
              : formatCurrency(reportData.netDepreciation, reportingCurrency)}
          </div>
        </div>
        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">Book Value Retention</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {reportData.retentionRate}%
          </div>
        </div>
      </section>

      {/* Multicurrency Exposure Breakdown */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Native Currency Exposure & FX Conversion
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            Updated {formatDateTime(new Date(fxSnapshot.updatedAtIso))}
          </span>
        </div>

        {reportData.currencyExposure.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No active holdings to evaluate across currencies.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 pl-6 pr-4 font-medium">Native Currency</th>
                  <th className="py-3 px-4 font-medium text-right">Active Units</th>
                  <th className="py-3 px-4 font-medium text-right">Native Book Value</th>
                  <th className="py-3 px-4 font-medium text-right">Applied FX Rate</th>
                  <th className="py-3 pl-4 pr-6 font-medium text-right">
                    Converted ({reportingCurrency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {reportData.currencyExposure.map((row) => (
                  <tr key={row.currency} className="hover:bg-slate-50">
                    <td className="py-3.5 pl-6 pr-4">
                      <span className="font-mono font-semibold text-slate-900">
                        {row.currency}
                      </span>{' '}
                      <span className="text-xs text-slate-500">
                        · {CURRENCY_META[row.currency].name}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {row.count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {formatCurrency(row.nativeValuation, row.currency)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-slate-500">
                      1 {row.currency} = {row.crossRate.toFixed(4)} {reportingCurrency}
                    </td>
                    <td className="py-3.5 pl-4 pr-6 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatCurrency(row.convertedValuation, reportingCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Departmental Cost-Center Table */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Departmental Cost-Center Allocation ({reportingCurrency})
          </h2>
        </div>

        {reportData.departments.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No active departmental assets available to summarize.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-3 pl-6 pr-4 font-medium">Department</th>
                  <th className="py-3 px-4 font-medium text-right">Active Units</th>
                  <th className="py-3 px-4 font-medium text-right">
                    Acquisition ({reportingCurrency})
                  </th>
                  <th className="py-3 pl-4 pr-6 font-medium text-right">
                    Book Value ({reportingCurrency})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {reportData.departments.map((dept) => (
                  <tr key={dept.department} className="hover:bg-slate-50">
                    <td className="py-3.5 pl-6 pr-4 font-medium text-slate-900">
                      {dept.department}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {dept.count}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {formatCurrency(dept.purchaseTotal, reportingCurrency)}
                    </td>
                    <td className="py-3.5 pl-4 pr-6 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {formatCurrency(dept.valuationTotal, reportingCurrency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Service & Warranty Watchlist */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            Maintenance & 180-Day Warranty Watchlist
          </h2>
        </div>

        {reportData.watchlist.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            All active assets have current warranty coverage and nominal operational status.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {reportData.watchlist.map(({ asset, isExpired }) => (
              <button
                key={asset.assetId}
                type="button"
                onClick={() => onSelectAsset(asset)}
                className="w-full min-h-[60px] px-6 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-900">{asset.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    <span className="font-mono text-slate-700">{asset.serialNumber}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{asset.department}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{asset.location}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs shrink-0">
                  {asset.status === 'Maintenance' && (
                    <span className="inline-flex items-center gap-1.5 text-amber-700 font-medium">
                      <Wrench className="w-3.5 h-3.5" />
                      <span>Under Maintenance</span>
                    </span>
                  )}
                  {asset.warrantyExpiry && (
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono tabular-nums ${
                        isExpired ? 'text-red-600 font-medium' : 'text-slate-600'
                      }`}
                    >
                      <CalendarClock className="w-3.5 h-3.5" />
                      <span>
                        {isExpired ? 'Expired ' : 'Expires '}
                        {formatShortDate(asset.warrantyExpiry)}
                      </span>
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
