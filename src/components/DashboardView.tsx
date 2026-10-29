import React, { useMemo } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Download,
  Loader2,
  Plus,
  QrCode,
  Wrench,
} from 'lucide-react';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  AssetCategory,
  AssetRecord,
  AssetStatus,
  formatCurrency,
} from '../types/asset';
import { AssetImage } from './AssetImage';

interface DashboardViewProps {
  assets: AssetRecord[];
  isLoading: boolean;
  isSeeding: boolean;
  onOpenAddAsset: () => void;
  onOpenScanner: () => void;
  onExportCsv: () => void;
  onSeedSampleData: () => void;
  onSelectAsset: (asset: AssetRecord) => void;
  onFilterNavigate: (opts: { category?: AssetCategory | 'All'; status?: AssetStatus | 'All' }) => void;
}

function StatusRowIcon({ status }: { status: AssetStatus }) {
  switch (status) {
    case 'In Use':
      return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
    case 'Available':
      return <Clock className="w-4 h-4 text-blue-600 shrink-0" />;
    case 'Maintenance':
      return <Wrench className="w-4 h-4 text-amber-600 shrink-0" />;
    case 'Disposed':
      return <Archive className="w-4 h-4 text-slate-400 shrink-0" />;
  }
}

export function DashboardView({
  assets,
  isLoading,
  isSeeding,
  onOpenAddAsset,
  onOpenScanner,
  onExportCsv,
  onSeedSampleData,
  onSelectAsset,
  onFilterNavigate,
}: DashboardViewProps) {
  const metrics = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentYearMonthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    let totalValuation = 0;
    let totalPurchaseCost = 0;
    let addedThisMonthCount = 0;
    let addedThisMonthValue = 0;
    let activeCount = 0;
    let maintenanceCount = 0;

    for (const a of assets) {
      if (a.status !== 'Disposed') {
        totalValuation += a.currentValuation;
        totalPurchaseCost += a.purchasePrice;
        activeCount += 1;
      }
      if (a.status === 'Maintenance') {
        maintenanceCount += 1;
      }

      const createdThisMonth =
        a.createdAt.getFullYear() === currentYear &&
        a.createdAt.getMonth() === currentMonth;
      const purchasedThisMonth = a.purchaseDate.startsWith(currentYearMonthPrefix);

      if (createdThisMonth || purchasedThisMonth) {
        addedThisMonthCount += 1;
        addedThisMonthValue += a.currentValuation;
      }
    }

    const categoryStats = ASSET_CATEGORIES.map((category) => {
      const matching = assets.filter((a) => a.category === category);
      const valuation = matching
        .filter((a) => a.status !== 'Disposed')
        .reduce((sum, item) => sum + item.currentValuation, 0);
      const sharePct =
        totalValuation > 0 ? Math.round((valuation / totalValuation) * 100) : 0;
      return {
        category,
        count: matching.length,
        valuation,
        sharePct,
      };
    }).sort((a, b) => b.valuation - a.valuation || b.count - a.count);

    const statusStats = ASSET_STATUSES.map((status) => {
      const matching = assets.filter((a) => a.status === status);
      const valuation = matching.reduce((sum, item) => sum + item.currentValuation, 0);
      const sharePct =
        assets.length > 0 ? Math.round((matching.length / assets.length) * 100) : 0;
      return {
        status,
        count: matching.length,
        valuation,
        sharePct,
      };
    });

    return {
      totalCount: assets.length,
      activeCount,
      maintenanceCount,
      totalValuation,
      totalPurchaseCost,
      addedThisMonthCount,
      addedThisMonthValue,
      categoryStats,
      statusStats,
    };
  }, [assets]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-28 bg-white border border-slate-200 rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Executive Header & Quick Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900"
            style={{ textWrap: 'balance' }}
          >
            Executive Inventory Overview
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Real-time capital valuation, custody tracking, and lifecycle audit status across all departments.
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenAddAsset}
            className="min-h-[44px] px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Asset</span>
          </button>

          <button
            type="button"
            onClick={onOpenScanner}
            className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan QR / Barcode</span>
          </button>

          <button
            type="button"
            disabled={assets.length === 0}
            onClick={onExportCsv}
            className="min-h-[44px] px-4 py-2.5 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Export Report</span>
          </button>
        </div>
      </div>

      {/* Top Executive KPI Strip (Single-Elevation Container with Hairline Dividers) */}
      <section
        aria-label="Key Inventory Metrics"
        className="bg-white border border-slate-200 rounded-2xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200"
      >
        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Total Tracked Assets
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {metrics.totalCount}
          </div>
          <div className="text-xs text-slate-500 mt-2 flex items-center gap-1.5 font-mono tabular-nums">
            <span>{metrics.activeCount} active</span>
            <span aria-hidden="true">·</span>
            <span>{metrics.maintenanceCount} in maintenance</span>
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Total Portfolio Valuation
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {formatCurrency(metrics.totalValuation)}
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono tabular-nums">
            Acquisition basis {formatCurrency(metrics.totalPurchaseCost)}
          </div>
        </div>

        <div className="p-6">
          <div className="text-xs font-medium text-slate-500">
            Newly Added This Month
          </div>
          <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 mt-2">
            {metrics.addedThisMonthCount}
          </div>
          <div className="text-xs text-slate-500 mt-2 font-mono tabular-nums">
            {formatCurrency(metrics.addedThisMonthValue)} added book value
          </div>
        </div>
      </section>

      {assets.length === 0 ? (
        /* Empty State */
        <section className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 text-center">
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-700 flex items-center justify-center mx-auto">
              <Database className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              No Corporate Assets Registered Yet
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Register your first piece of IT hardware, fleet vehicle, or facility equipment—or
              load a sample catalog to explore valuation analytics, QR tags, and offline sync.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onOpenAddAsset}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Register First Asset</span>
              </button>
              <button
                type="button"
                disabled={isSeeding}
                onClick={onSeedSampleData}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isSeeding && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Load Sample Inventory</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* Visual Breakdowns: Category Valuation & Lifecycle Status */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Category Valuation Breakdown */}
            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Valuation by Asset Category
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Select any category to inspect matching inventory records
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  {metrics.categoryStats.map((item) => (
                    <button
                      key={item.category}
                      type="button"
                      onClick={() => onFilterNavigate({ category: item.category, status: 'All' })}
                      className="w-full text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg p-1 -mx-1"
                    >
                      <div className="flex items-baseline justify-between gap-4 text-sm mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                            {item.category}
                          </span>
                          <span className="text-xs text-slate-500 font-mono tabular-nums shrink-0">
                            · {item.count} {item.count === 1 ? 'unit' : 'units'}
                          </span>
                        </div>
                        <div className="text-xs font-mono tabular-nums text-slate-900 font-medium shrink-0">
                          {formatCurrency(item.valuation)}{' '}
                          <span className="text-slate-400">({item.sharePct}%)</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-slate-900 group-hover:bg-blue-600 rounded-full transition-colors"
                          style={{
                            width: `${item.count > 0 ? Math.max(4, item.sharePct) : 0}%`,
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Lifecycle Status List */}
            <section className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Lifecycle Status Breakdown
                </h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-4">
                  Operational readiness across tracked units
                </p>

                <div className="divide-y divide-slate-100">
                  {metrics.statusStats.map((st) => (
                    <button
                      key={st.status}
                      type="button"
                      onClick={() => onFilterNavigate({ status: st.status, category: 'All' })}
                      className="w-full min-h-[56px] py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50 -mx-2 px-2 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <StatusRowIcon status={st.status} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">
                            {st.status}
                          </div>
                          <div className="text-xs text-slate-500 font-mono tabular-nums">
                            {formatCurrency(st.valuation)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-sm font-semibold text-slate-900">
                            {st.count}
                          </div>
                          <div className="text-[11px] text-slate-400">{st.sharePct}%</div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {metrics.maintenanceCount > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-amber-800">
                  <span className="inline-flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      {metrics.maintenanceCount}{' '}
                      {metrics.maintenanceCount === 1 ? 'asset requires' : 'assets require'} service review
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onFilterNavigate({ status: 'Maintenance', category: 'All' })}
                    className="font-semibold hover:underline whitespace-nowrap"
                  >
                    Inspect
                  </button>
                </div>
              )}
            </section>
          </div>

          {/* Recently Updated Assets */}
          <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="text-base font-semibold text-slate-900">
                Recently Updated Inventory
              </h2>
              <button
                type="button"
                onClick={() => onFilterNavigate({ category: 'All', status: 'All' })}
                className="min-h-[36px] text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1 whitespace-nowrap"
              >
                <span>View All ({assets.length})</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {assets.slice(0, 5).map((asset) => (
                <button
                  key={asset.assetId}
                  type="button"
                  onClick={() => onSelectAsset(asset)}
                  className="w-full min-h-[64px] px-6 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0">
                      <AssetImage
                        src={asset.photoUrl}
                        alt={asset.name}
                        category={asset.category}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {asset.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="font-mono text-slate-700">{asset.serialNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{asset.category}</span>
                        <span aria-hidden="true">·</span>
                        <span>{asset.status}</span>
                        {asset.assignedTo && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{asset.assignedTo}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                        {formatCurrency(asset.currentValuation)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {asset.hasPendingWrites ? 'Saved locally' : asset.department}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  </div>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
