import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  CloudOff,
  Plus,
  QrCode,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  convertCurrency,
  CurrencyCode,
  SUPPORTED_CURRENCIES,
} from '../lib/currency';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  AssetCategory,
  AssetRecord,
  AssetStatus,
  formatCurrency,
  formatShortDate,
} from '../types/asset';
import { AssetImage } from './AssetImage';

interface InventoryViewProps {
  assets: AssetRecord[];
  reportingCurrency: CurrencyCode;
  usdRates: Record<CurrencyCode, number>;
  selectedCategory: AssetCategory | 'All';
  selectedStatus: AssetStatus | 'All';
  onChangeCategory: (cat: AssetCategory | 'All') => void;
  onChangeStatus: (st: AssetStatus | 'All') => void;
  onSelectAsset: (asset: AssetRecord) => void;
  onOpenAddAsset: () => void;
  onOpenScanner: () => void;
}

type SortKey = 'updated_desc' | 'valuation_desc' | 'valuation_asc' | 'name_asc';

export function InventoryView({
  assets,
  reportingCurrency,
  usdRates,
  selectedCategory,
  selectedStatus,
  onChangeCategory,
  onChangeStatus,
  onSelectAsset,
  onOpenAddAsset,
  onOpenScanner,
}: InventoryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCurrency, setSelectedCurrency] = useState<CurrencyCode | 'All'>('All');
  const [sortBy, setSortBy] = useState<SortKey>('updated_desc');

  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const list = assets.filter((asset) => {
      if (selectedCategory !== 'All' && asset.category !== selectedCategory) {
        return false;
      }
      if (selectedStatus !== 'All' && asset.status !== selectedStatus) {
        return false;
      }
      if (selectedCurrency !== 'All' && asset.currency !== selectedCurrency) {
        return false;
      }
      if (!q) return true;

      return (
        asset.name.toLowerCase().includes(q) ||
        asset.serialNumber.toLowerCase().includes(q) ||
        asset.category.toLowerCase().includes(q) ||
        asset.currency.toLowerCase().includes(q) ||
        asset.department.toLowerCase().includes(q) ||
        asset.location.toLowerCase().includes(q) ||
        asset.assignedTo.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case 'valuation_desc': {
          const valA = convertCurrency(
            a.currentValuation,
            a.currency,
            reportingCurrency,
            usdRates
          );
          const valB = convertCurrency(
            b.currentValuation,
            b.currency,
            reportingCurrency,
            usdRates
          );
          return valB - valA;
        }
        case 'valuation_asc': {
          const valA = convertCurrency(
            a.currentValuation,
            a.currency,
            reportingCurrency,
            usdRates
          );
          const valB = convertCurrency(
            b.currentValuation,
            b.currency,
            reportingCurrency,
            usdRates
          );
          return valA - valB;
        }
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'updated_desc':
        default:
          return b.updatedAt.getTime() - a.updatedAt.getTime();
      }
    });

    return list;
  }, [
    assets,
    searchQuery,
    selectedCategory,
    selectedStatus,
    selectedCurrency,
    sortBy,
    reportingCurrency,
    usdRates,
  ]);

  const filteredValuation = useMemo(
    () =>
      filteredAssets
        .filter((a) => a.status !== 'Disposed')
        .reduce(
          (sum, a) =>
            sum + convertCurrency(a.currentValuation, a.currency, reportingCurrency, usdRates),
          0
        ),
    [filteredAssets, reportingCurrency, usdRates]
  );

  const hasActiveFilters =
    selectedCategory !== 'All' ||
    selectedStatus !== 'All' ||
    selectedCurrency !== 'All' ||
    searchQuery.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Asset Directory
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
            Showing {filteredAssets.length} of {assets.length} records · Consolidated active value{' '}
            {formatCurrency(filteredValuation, reportingCurrency)} ({reportingCurrency})
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onOpenScanner}
            className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan Tag</span>
          </button>
          <button
            type="button"
            onClick={onOpenAddAsset}
            className="min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Asset</span>
          </button>
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by asset name, serial number, category, currency, or custodian..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="min-h-[36px] min-w-[36px] absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <select
              value={selectedCurrency}
              onChange={(e) => setSelectedCurrency(e.target.value as CurrencyCode | 'All')}
              aria-label="Filter by native currency"
              className="min-h-[44px] px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="All">All Currencies</option>
              {SUPPORTED_CURRENCIES.map((ccy) => (
                <option key={ccy} value={ccy}>
                  Native: {ccy}
                </option>
              ))}
            </select>

            <SlidersHorizontal className="w-4 h-4 text-slate-400 hidden lg:block" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              aria-label="Sort inventory"
              className="min-h-[44px] px-3.5 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="updated_desc">Sort: Recently Updated</option>
              <option value="valuation_desc">Sort: Value High to Low ({reportingCurrency})</option>
              <option value="valuation_asc">Sort: Value Low to High ({reportingCurrency})</option>
              <option value="name_asc">Sort: Name (A to Z)</option>
            </select>
          </div>
        </div>

        {/* Interactive Segmented Filter Bars */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
          {/* Status Segmented Control */}
          <div
            role="group"
            aria-label="Filter by lifecycle status"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto"
          >
            {(['All', ...ASSET_STATUSES] as const).map((statusItem) => {
              const active = selectedStatus === statusItem;
              return (
                <button
                  key={statusItem}
                  type="button"
                  onClick={() => onChangeStatus(statusItem)}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {statusItem === 'All' ? 'All Statuses' : statusItem}
                </button>
              );
            })}
          </div>

          {/* Category Filter Control */}
          <div
            role="group"
            aria-label="Filter by category"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto"
          >
            {(['All', ...ASSET_CATEGORIES] as const).map((catItem) => {
              const active = selectedCategory === catItem;
              return (
                <button
                  key={catItem}
                  type="button"
                  onClick={() => onChangeCategory(catItem)}
                  className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {catItem === 'All' ? 'All Categories' : catItem}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results Table / Mobile Tap Rows */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {filteredAssets.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm font-medium text-slate-900">
              No matching assets found
            </p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Try clearing your search query or adjusting the active category, status, and currency filters.'
                : 'Register a new asset to begin tracking inventory.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCurrency('All');
                  onChangeCategory('All');
                  onChangeStatus('All');
                }}
                className="min-h-[40px] px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop High-Density Data Grid */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                    <th className="py-3 pl-6 pr-4 font-medium">Asset</th>
                    <th className="py-3 px-4 font-medium">Serial / Model</th>
                    <th className="py-3 px-4 font-medium">Category & Status</th>
                    <th className="py-3 px-4 font-medium">Custody & Location</th>
                    <th className="py-3 px-4 font-medium text-right">Purchase (Native)</th>
                    <th className="py-3 px-4 font-medium text-right">Valuation</th>
                    <th className="py-3 pl-4 pr-6 font-medium text-right">Sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredAssets.map((asset) => {
                    const convertedVal =
                      asset.currency !== reportingCurrency
                        ? convertCurrency(
                            asset.currentValuation,
                            asset.currency,
                            reportingCurrency,
                            usdRates
                          )
                        : null;

                    return (
                      <tr
                        key={asset.assetId}
                        onClick={() => onSelectAsset(asset)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectAsset(asset);
                          }
                        }}
                        className="hover:bg-slate-50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:bg-blue-50/40"
                      >
                        <td className="py-3 pl-6 pr-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 shrink-0">
                              <AssetImage
                                src={asset.photoUrl}
                                alt={asset.name}
                                category={asset.category}
                                iconSizeClass="w-4 h-4"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate max-w-[240px]">
                                {asset.name}
                              </div>
                              <div className="text-xs text-slate-500 font-mono tabular-nums">
                                {asset.currency} · Purchased {formatShortDate(asset.purchaseDate)}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                          {asset.serialNumber}
                        </td>

                        <td className="py-3 px-4">
                          <div className="text-xs text-slate-900 font-medium">
                            {asset.category}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {asset.status}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="text-xs text-slate-900 truncate max-w-[200px]">
                            {asset.department} · {asset.location}
                          </div>
                          <div className="text-xs text-slate-500 truncate max-w-[200px] mt-0.5">
                            {asset.assignedTo || 'Unassigned'}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                          {formatCurrency(asset.purchasePrice, asset.currency)}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-slate-900">
                            {formatCurrency(asset.currentValuation, asset.currency)}
                          </div>
                          {convertedVal !== null && (
                            <div className="text-[11px] text-slate-500">
                              ≈ {formatCurrency(convertedVal, reportingCurrency)}
                            </div>
                          )}
                        </td>

                        <td className="py-3 pl-4 pr-6 text-right whitespace-nowrap">
                          {asset.hasPendingWrites ? (
                            <span className="inline-flex items-center justify-end gap-1 text-xs text-amber-700">
                              <CloudOff className="w-3.5 h-3.5" />
                              <span>Local</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-end gap-1 text-xs text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Synced</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Ergonomic Tap Rows */}
            <div className="md:hidden divide-y divide-slate-100">
              {filteredAssets.map((asset) => {
                const convertedVal =
                  asset.currency !== reportingCurrency
                    ? convertCurrency(
                        asset.currentValuation,
                        asset.currency,
                        reportingCurrency,
                        usdRates
                      )
                    : null;

                return (
                  <button
                    key={asset.assetId}
                    type="button"
                    onClick={() => onSelectAsset(asset)}
                    className="w-full min-h-[68px] px-4 py-3.5 flex items-center justify-between gap-3 text-left active:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
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
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          <span className="font-mono text-slate-700">{asset.serialNumber}</span>
                          <span aria-hidden="true"> · </span>
                          <span>{asset.status}</span>
                          <span aria-hidden="true"> · </span>
                          <span className="font-mono">{asset.currency}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div className="text-sm font-semibold font-mono tabular-nums text-slate-900">
                          {formatCurrency(asset.currentValuation, asset.currency)}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500">
                          {convertedVal !== null
                            ? `≈ ${formatCurrency(convertedVal, reportingCurrency)}`
                            : asset.hasPendingWrites
                            ? 'Local queue'
                            : asset.department}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
