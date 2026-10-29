/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CloudOff,
  Globe,
  LayoutDashboard,
  LogIn,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  setFirestoreNetworkEnabled,
} from './lib/firebase';
import {
  cacheReportingCurrencyLocally,
  CURRENCY_META,
  CurrencyCode,
  fetchLiveFxRates,
  FxRatesSnapshot,
  isValidCurrencyCode,
  loadCachedReportingCurrency,
  loadInitialFxRates,
  SUPPORTED_CURRENCIES,
} from './lib/currency';
import {
  AssetCategory,
  AssetFormInput,
  AssetRecord,
  AssetStatus,
} from './types/asset';
import {
  createAssetWithEvent,
  deleteAssetWithEvents,
  exportAssetsToCsv,
  saveUserReportingCurrency,
  seedSampleAssets,
  updateAssetStatusAction,
  updateAssetValuationAction,
  updateFullAssetWithEvent,
} from './services/assetService';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { ReportsView } from './components/ReportsView';
import { AssetFormModal } from './components/AssetFormModal';
import { AssetDetailModal } from './components/AssetDetailModal';
import { QrScannerModal } from './components/QrScannerModal';

type ActiveTab = 'dashboard' | 'inventory' | 'reports';

function AssetTrackWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'All'>('All');
  const [filterStatus, setFilterStatus] = useState<AssetStatus | 'All'>('All');

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);

  // Multicurrency Portfolio Reporting State + Live/Offline FX Rates
  const [reportingCurrency, setReportingCurrency] = useState<CurrencyCode>(() =>
    loadCachedReportingCurrency()
  );
  const [fxSnapshot, setFxSnapshot] = useState<FxRatesSnapshot>(() => loadInitialFxRates());
  const [isRefreshingFx, setIsRefreshingFx] = useState(false);

  // Real-time connectivity + Offline simulation state
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [togglingNetwork, setTogglingNetwork] = useState(false);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [prefilledSerial, setPrefilledSerial] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const effectiveOnline = browserOnline && !simulatedOffline;

  const refreshExchangeRates = useCallback(async (showToast = false) => {
    setIsRefreshingFx(true);
    try {
      const latest = await fetchLiveFxRates();
      setFxSnapshot(latest);
      if (showToast) {
        setToastMessage('Updated live market FX exchange rates');
      }
    } catch {
      if (showToast) {
        setToastMessage('Using cached FX rates · Live rate service unreachable');
      }
    } finally {
      setIsRefreshingFx(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveOnline) {
      void refreshExchangeRates(false);
    }
  }, [effectiveOnline, refreshExchangeRates]);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to user reporting currency preference in Firestore
  useEffect(() => {
    if (!authReady || !user) return;
    const settingsPath = `userSettings/${user.uid}`;
    const unsubscribe = onSnapshot(
      doc(db, 'userSettings', user.uid),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (isValidCurrencyCode(data.reportingCurrency)) {
            setReportingCurrency(data.reportingCurrency);
            cacheReportingCurrencyLocally(data.reportingCurrency);
          }
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, settingsPath);
      }
    );
    return () => unsubscribe();
  }, [authReady, user]);

  // Subscribe to user assets in Firestore
  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      setAssets([]);
      setLoadingAssets(false);
      return;
    }

    setLoadingAssets(true);
    const assetsPath = 'assets';
    const q = query(collection(db, assetsPath), where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        const mapped: AssetRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data({ serverTimestamps: 'estimate' });
          const createdAt =
            data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();
          const updatedAt =
            data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : new Date();
          const ccy: CurrencyCode = isValidCurrencyCode(data.currency)
            ? data.currency
            : 'USD';

          return {
            assetId: String(data.assetId || docSnap.id),
            ownerId: String(data.ownerId || user.uid),
            name: String(data.name || ''),
            serialNumber: String(data.serialNumber || ''),
            category: (data.category as AssetCategory) || 'Other',
            currency: ccy,
            purchasePrice: Number(data.purchasePrice || 0),
            currentValuation: Number(data.currentValuation || 0),
            purchaseDate: String(data.purchaseDate || ''),
            warrantyExpiry: String(data.warrantyExpiry || ''),
            status: (data.status as AssetStatus) || 'Available',
            department: String(data.department || ''),
            location: String(data.location || ''),
            assignedTo: String(data.assignedTo || ''),
            notes: String(data.notes || ''),
            photoUrl: String(data.photoUrl || ''),
            createdAt,
            updatedAt,
            hasPendingWrites: docSnap.metadata.hasPendingWrites,
          };
        });

        mapped.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
        setAssets(mapped);
        setLoadingAssets(false);
      },
      (error) => {
        setLoadingAssets(false);
        handleFirestoreError(error, OperationType.LIST, assetsPath);
      }
    );

    return () => unsubscribe();
  }, [authReady, user]);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const pendingWritesCount = useMemo(
    () => assets.filter((a) => a.hasPendingWrites).length,
    [assets]
  );

  const selectedAsset = useMemo(
    () => assets.find((a) => a.assetId === selectedAssetId) || null,
    [assets, selectedAssetId]
  );

  const handleReportingCurrencyChange = async (nextCurrency: CurrencyCode) => {
    setReportingCurrency(nextCurrency);
    cacheReportingCurrencyLocally(nextCurrency);
    if (user) {
      await saveUserReportingCurrency({
        userId: user.uid,
        reportingCurrency: nextCurrency,
        isOnline: effectiveOnline,
      });
    }
    setToastMessage(`Portfolio reporting currency set to ${nextCurrency}`);
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in cancelled or failed.';
      if (!msg.includes('auth/popup-closed-by-user')) {
        setAuthError(msg);
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (simulatedOffline) {
      await setFirestoreNetworkEnabled(true);
      setSimulatedOffline(false);
    }
    await signOut(auth);
  };

  const handleToggleOfflineSimulation = async () => {
    setTogglingNetwork(true);
    try {
      const nextOffline = !simulatedOffline;
      await setFirestoreNetworkEnabled(!nextOffline);
      setSimulatedOffline(nextOffline);
      setToastMessage(
        nextOffline
          ? 'Offline mode active · Edits save to local IndexedDB cache'
          : 'Reconnected · Auto-syncing local queue to Cloud Firestore'
      );
    } finally {
      setTogglingNetwork(false);
    }
  };

  const openNewAssetModal = (serial = '') => {
    setEditingAsset(null);
    setPrefilledSerial(serial);
    setIsFormOpen(true);
  };

  const openEditAssetModal = (asset: AssetRecord) => {
    setSelectedAssetId(null);
    setEditingAsset(asset);
    setPrefilledSerial('');
    setIsFormOpen(true);
  };

  const handleFormSave = async (input: AssetFormInput) => {
    if (!user || !user.email) {
      throw new Error('Verified Google account required to save inventory.');
    }

    if (editingAsset) {
      const state = await updateFullAssetWithEvent({
        existing: editingAsset,
        input,
        ownerId: user.uid,
        actorEmail: user.email,
        isOnline: effectiveOnline,
      });
      setToastMessage(
        state === 'queued-offline'
          ? 'Saved locally · Will sync automatically when online'
          : 'Asset changes synced to Cloud Firestore'
      );
    } else {
      const { syncState } = await createAssetWithEvent({
        input,
        ownerId: user.uid,
        actorEmail: user.email,
        isOnline: effectiveOnline,
      });
      setToastMessage(
        syncState === 'queued-offline'
          ? 'Asset saved locally · Queued for background sync'
          : `New asset registered in ${input.currency}`
      );
    }
  };

  const handleQuickStatusUpdate = async (asset: AssetRecord, nextStatus: AssetStatus) => {
    if (!user || !user.email) return;
    const syncState = await updateAssetStatusAction({
      existing: asset,
      newStatus: nextStatus,
      ownerId: user.uid,
      actorEmail: user.email,
      isOnline: effectiveOnline,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? `Status "${nextStatus}" saved locally`
        : `Status updated to "${nextStatus}"`
    );
  };

  const handleQuickValuationUpdate = async (
    asset: AssetRecord,
    nextValuation: number,
    nextCurrency: CurrencyCode
  ) => {
    if (!user || !user.email) return;
    const syncState = await updateAssetValuationAction({
      existing: asset,
      newValuation: nextValuation,
      newCurrency: nextCurrency,
      ownerId: user.uid,
      actorEmail: user.email,
      isOnline: effectiveOnline,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? 'Valuation saved locally · Pending sync'
        : `Valuation updated in ${nextCurrency}`
    );
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!user) return;
    const syncState = await deleteAssetWithEvents({
      assetId,
      ownerId: user.uid,
      isOnline: effectiveOnline,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? 'Deletion queued locally'
        : 'Asset record deleted'
    );
  };

  const handleSeedSamples = async () => {
    if (!user || !user.email) return;
    setIsSeeding(true);
    try {
      const syncState = await seedSampleAssets({
        ownerId: user.uid,
        actorEmail: user.email,
        isOnline: effectiveOnline,
      });
      setToastMessage(
        syncState === 'queued-offline'
          ? 'Multicurrency sample catalog saved locally'
          : 'Loaded sample catalog (USD, EUR, GBP)'
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const handleExportCsv = () => {
    exportAssetsToCsv(assets, reportingCurrency, fxSnapshot.usdRates);
    setToastMessage(`Exported multicurrency CSV ledger (${reportingCurrency})`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Strict 3-Zone Top Bar Contract (<header>) */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          Asset Track
        </a>

        {/* Zone 2: Concise Single-Line Navigation Links */}
        {user ? (
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'dashboard'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('inventory')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'inventory'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              Inventory
            </button>
            <button
              type="button"
              onClick={() => setIsScannerOpen(true)}
              className="py-1 border-b-2 border-transparent hover:text-slate-900 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0"
            >
              Scanner
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className={`py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'reports'
                  ? 'border-slate-900 text-slate-900 font-semibold'
                  : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              Reports
            </button>
          </nav>
        ) : (
          <nav
            aria-label="Features"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600"
          >
            <a
              href="#capabilities"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#offline-sync"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Offline Sync
            </a>
            <a
              href="#security"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              Security
            </a>
          </nav>
        )}

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => openNewAssetModal()}
              className="min-h-[38px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Add Asset
            </button>
          ) : (
            <button
              type="button"
              disabled={isSigningIn || !authReady}
              onClick={() => void handleGoogleSignIn()}
              className="min-h-[38px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              {isSigningIn ? 'Signing In...' : 'Sign In'}
            </button>
          )}
        </div>
      </header>

      {/* Workspace Sync, Multicurrency Base Selector & Account Toolbar */}
      {user && (
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Left: Sync Status + Offline Toggle + Portfolio Currency Selector */}
            <div className="flex flex-wrap items-center gap-3">
              {!effectiveOnline ? (
                <div className="inline-flex items-center gap-1.5 font-medium text-amber-800">
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Offline - Saving Locally
                    {pendingWritesCount > 0 ? ` (${pendingWritesCount} queued)` : ''}
                  </span>
                </div>
              ) : pendingWritesCount > 0 ? (
                <div className="inline-flex items-center gap-1.5 font-medium text-blue-700">
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>Syncing {pendingWritesCount} local changes...</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Online - Synced</span>
                </div>
              )}

              <span aria-hidden="true" className="text-slate-300">
                |
              </span>

              {/* Consolidated Portfolio Currency Selector */}
              <div className="inline-flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <label htmlFor="reporting-currency-select" className="text-slate-600 hidden sm:inline">
                  Portfolio:
                </label>
                <select
                  id="reporting-currency-select"
                  value={reportingCurrency}
                  onChange={(e) =>
                    void handleReportingCurrencyChange(e.target.value as CurrencyCode)
                  }
                  aria-label="Consolidated portfolio reporting currency"
                  className="min-h-[32px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {SUPPORTED_CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code} ({CURRENCY_META[code].symbol})
                    </option>
                  ))}
                </select>
              </div>

              <span aria-hidden="true" className="text-slate-300">
                |
              </span>

              <button
                type="button"
                disabled={togglingNetwork}
                onClick={() => void handleToggleOfflineSimulation()}
                className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                {simulatedOffline ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Reconnect Cloud</span>
                  </>
                ) : (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-slate-500" />
                    <span>Test Offline Mode</span>
                  </>
                )}
              </button>
            </div>

            {/* Right: Authenticated User & Sign Out */}
            <div className="flex items-center gap-3 text-slate-600">
              <span className="hidden lg:inline truncate max-w-[220px]">
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="min-h-[32px] px-2.5 py-1 rounded-lg hover:bg-slate-100 text-slate-700 font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 md:pb-12">
        {!authReady ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <span className="text-sm">Initializing offline-first database...</span>
          </div>
        ) : !user ? (
          /* Corporate Sign-In & Overview Landing */
          <div className="py-6 sm:py-12 space-y-16">
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7 space-y-6">
                <p className="text-xs font-semibold text-blue-600">
                  Multicurrency Corporate Capital & Equipment Registry
                </p>
                <h1
                  className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]"
                  style={{ textWrap: 'balance' }}
                >
                  Track every physical asset, global currency valuation, and custody handoff—online or offline.
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                  Built for medium-sized operations teams managing IT workstations, fleet
                  vehicles, office furnishings, and industrial machinery across 12 global
                  currencies with IndexedDB local persistence and automatic Cloud Firestore sync.
                </p>

                {authError && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 max-w-lg">
                    {authError}
                  </div>
                )}

                <div className="pt-1 flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    disabled={isSigningIn}
                    onClick={() => void handleGoogleSignIn()}
                    className="min-h-[48px] px-6 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors inline-flex items-center gap-2.5 whitespace-nowrap"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{isSigningIn ? 'Connecting Account...' : 'Sign In with Google'}</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900">
                    Operational Architecture
                  </h2>
                  <p className="text-xs text-slate-500">
                    Production-ready capabilities included in your workspace
                  </p>
                </div>

                <div className="divide-y divide-slate-100 text-sm">
                  <div id="capabilities" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900">
                      01. Multicurrency Valuation & QR Tagging
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Register assets in USD, EUR, GBP, JPY, CAD, AUD, CHF, INR, SGD, ZAR, NGN, or
                      BRL and consolidate executive KPIs in any reporting currency.
                    </p>
                  </div>

                  <div id="offline-sync" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900">
                      02. Offline-First IndexedDB Cache
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Inspect, register, and update equipment in warehouses without Wi-Fi using
                      cached FX rates; queued mutations sync automatically upon reconnection.
                    </p>
                  </div>

                  <div id="security" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <span>03. Immutable Lifecycle Audit Trail</span>
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Every registration, currency revaluation, and custody transfer is logged with
                      server-verified timestamps and strict owner-isolated Firestore rules.
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* Authenticated Views */
          <>
            {activeTab === 'dashboard' && (
              <DashboardView
                assets={assets}
                reportingCurrency={reportingCurrency}
                usdRates={fxSnapshot.usdRates}
                isLoading={loadingAssets}
                isSeeding={isSeeding}
                onOpenAddAsset={() => openNewAssetModal()}
                onOpenScanner={() => setIsScannerOpen(true)}
                onExportCsv={handleExportCsv}
                onSeedSampleData={() => void handleSeedSamples()}
                onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
                onFilterNavigate={({ category, status }) => {
                  if (category !== undefined) setFilterCategory(category);
                  if (status !== undefined) setFilterStatus(status);
                  setActiveTab('inventory');
                }}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryView
                assets={assets}
                reportingCurrency={reportingCurrency}
                usdRates={fxSnapshot.usdRates}
                selectedCategory={filterCategory}
                selectedStatus={filterStatus}
                onChangeCategory={setFilterCategory}
                onChangeStatus={setFilterStatus}
                onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
                onOpenAddAsset={() => openNewAssetModal()}
                onOpenScanner={() => setIsScannerOpen(true)}
              />
            )}

            {activeTab === 'reports' && (
              <ReportsView
                assets={assets}
                reportingCurrency={reportingCurrency}
                fxSnapshot={fxSnapshot}
                isRefreshingFx={isRefreshingFx}
                isOnline={effectiveOnline}
                onRefreshFx={() => void refreshExchangeRates(true)}
                onExportCsv={handleExportCsv}
                onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb-Zone Tab Bar */}
      {user && (
        <nav
          aria-label="Mobile Bottom Navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center"
        >
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`min-h-[48px] flex flex-col items-center justify-center ${
              activeTab === 'dashboard' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[11px] mt-1">Dashboard</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('inventory')}
            className={`min-h-[48px] flex flex-col items-center justify-center ${
              activeTab === 'inventory' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <Boxes className="w-5 h-5" />
            <span className="text-[11px] mt-1">Inventory</span>
          </button>

          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="min-h-[48px] flex flex-col items-center justify-center text-slate-500 active:text-blue-600"
          >
            <QrCode className="w-5 h-5" />
            <span className="text-[11px] mt-1">Scan Tag</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reports')}
            className={`min-h-[48px] flex flex-col items-center justify-center ${
              activeTab === 'reports' ? 'text-blue-600 font-semibold' : 'text-slate-500'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[11px] mt-1">Reports</span>
          </button>
        </nav>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Modals */}
      {user && (
        <>
          <AssetFormModal
            isOpen={isFormOpen}
            onClose={() => setIsFormOpen(false)}
            editingAsset={editingAsset}
            defaultCurrency={reportingCurrency}
            prefilledSerial={prefilledSerial}
            userId={user.uid}
            isOnline={effectiveOnline}
            onSubmit={handleFormSave}
          />

          <AssetDetailModal
            asset={selectedAsset}
            userId={user.uid}
            reportingCurrency={reportingCurrency}
            usdRates={fxSnapshot.usdRates}
            onClose={() => setSelectedAssetId(null)}
            onEdit={openEditAssetModal}
            onStatusChange={handleQuickStatusUpdate}
            onValuationChange={handleQuickValuationUpdate}
            onDelete={handleDeleteAsset}
          />

          <QrScannerModal
            isOpen={isScannerOpen}
            onClose={() => setIsScannerOpen(false)}
            assets={assets}
            onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
            onRegisterWithSerial={(serial) => openNewAssetModal(serial)}
          />
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AssetTrackWorkspace />
    </ErrorBoundary>
  );
}
