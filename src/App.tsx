/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Boxes,
  CheckCircle2,
  CloudOff,
  HardDrive,
  LayoutDashboard,
  LogIn,
  LogOut,
  QrCode,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { getLocalAssetsForOwner } from './lib/offlineDb';
import {
  fetchSupabaseConfigStatus,
  setSupabaseTokens,
  signInWithSupabase,
  signUpWithSupabase,
  SupabaseSessionUser,
} from './lib/supabaseApi';
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
  seedSampleAssets,
  subscribeToInventoryChanges,
  syncInventoryWithSupabase,
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

const LOCAL_WORKSPACE_USER: SupabaseSessionUser = {
  id: 'local_offline_workspace',
  email: 'offline@local.workspace',
  isLocalOnly: true,
};

function AssetTrackWorkspace() {
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean>(false);
  const [configChecked, setConfigChecked] = useState<boolean>(false);

  const [user, setUser] = useState<SupabaseSessionUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfoMessage, setAuthInfoMessage] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [filterCategory, setFilterCategory] = useState<AssetCategory | 'All'>('All');
  const [filterStatus, setFilterStatus] = useState<AssetStatus | 'All'>('All');

  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  // Connectivity & Offline Simulation
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [simulatedOffline, setSimulatedOffline] = useState(false);

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);
  const [prefilledSerial, setPrefilledSerial] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const effectiveOnline = browserOnline && !simulatedOffline;
  const canSyncCloud = Boolean(
    effectiveOnline && supabaseConfigured && user && !user.isLocalOnly
  );

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
    let active = true;
    void fetchSupabaseConfigStatus().then((configured) => {
      if (!active) return;
      setSupabaseConfigured(configured);
      setConfigChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshLocalView = useCallback(async () => {
    if (!user) return;
    const localList = await getLocalAssetsForOwner(user.id);
    setAssets(localList);
  }, [user]);

  const runFullCloudSync = useCallback(async () => {
    if (!user) return;
    setIsSyncing(true);
    try {
      const { assets: updatedList, syncError } = await syncInventoryWithSupabase(
        user.id,
        canSyncCloud
      );
      setAssets(updatedList);
      setSyncWarning(syncError);
    } finally {
      setIsSyncing(false);
      setLoadingAssets(false);
    }
  }, [user, canSyncCloud]);

  // Subscribe to immediate IndexedDB mutations
  useEffect(() => {
    if (!user) {
      setAssets([]);
      return;
    }
    setLoadingAssets(true);
    void runFullCloudSync();

    const unsubscribe = subscribeToInventoryChanges(() => {
      void refreshLocalView();
    });
    return () => unsubscribe();
  }, [user, runFullCloudSync, refreshLocalView]);

  // Auto-sync when network reconnects
  useEffect(() => {
    if (canSyncCloud && user) {
      void runFullCloudSync();
    }
  }, [canSyncCloud, user, runFullCloudSync]);

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

  const handleSupabaseAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthInfoMessage(null);
    setIsAuthenticating(true);

    try {
      if (authMode === 'login') {
        const loggedInUser = await signInWithSupabase(emailInput, passwordInput);
        setUser(loggedInUser);
        setPasswordInput('');
      } else {
        const result = await signUpWithSupabase(emailInput, passwordInput);
        if (result.user) {
          setUser(result.user);
          setPasswordInput('');
        } else if (result.confirmationRequired) {
          setAuthInfoMessage(
            result.message || 'Check your email inbox to confirm your account, then sign in.'
          );
          setAuthMode('login');
        }
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleEnterOfflineWorkspace = () => {
    setAuthError(null);
    setSyncWarning(null);
    setUser(LOCAL_WORKSPACE_USER);
  };

  const handleSignOut = () => {
    setSupabaseTokens(null, null);
    setSimulatedOffline(false);
    setSyncWarning(null);
    setUser(null);
  };

  const handleToggleOfflineSimulation = () => {
    const nextOffline = !simulatedOffline;
    setSimulatedOffline(nextOffline);
    setToastMessage(
      nextOffline
        ? 'Offline mode active · Edits save to IndexedDB cache'
        : 'Reconnected · Auto-syncing local queue to Supabase'
    );
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
    if (!user) {
      throw new Error('Sign in required to save inventory.');
    }

    if (editingAsset) {
      const state = await updateFullAssetWithEvent({
        existing: editingAsset,
        input,
        ownerId: user.id,
        actorEmail: user.email,
        canSyncCloud,
      });
      setToastMessage(
        state === 'queued-offline'
          ? 'Saved locally · Queued for Supabase sync'
          : 'Asset changes synced to Supabase'
      );
    } else {
      const { syncState } = await createAssetWithEvent({
        input,
        ownerId: user.id,
        actorEmail: user.email,
        canSyncCloud,
      });
      setToastMessage(
        syncState === 'queued-offline'
          ? 'Asset saved locally · Queued for Supabase sync'
          : 'New asset registered in Supabase'
      );
    }
  };

  const handleQuickStatusUpdate = async (asset: AssetRecord, nextStatus: AssetStatus) => {
    if (!user) return;
    const syncState = await updateAssetStatusAction({
      existing: asset,
      newStatus: nextStatus,
      ownerId: user.id,
      actorEmail: user.email,
      canSyncCloud,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? `Status "${nextStatus}" saved locally`
        : `Status updated to "${nextStatus}"`
    );
  };

  const handleQuickValuationUpdate = async (asset: AssetRecord, nextValuation: number) => {
    if (!user) return;
    const syncState = await updateAssetValuationAction({
      existing: asset,
      newValuation: nextValuation,
      ownerId: user.id,
      actorEmail: user.email,
      canSyncCloud,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? 'Valuation saved locally · Pending sync'
        : 'Valuation updated in Supabase'
    );
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!user) return;
    const syncState = await deleteAssetWithEvents({
      assetId,
      ownerId: user.id,
      canSyncCloud,
    });
    setToastMessage(
      syncState === 'queued-offline'
        ? 'Deletion queued locally'
        : 'Asset record deleted from Supabase'
    );
  };

  const handleSeedSamples = async () => {
    if (!user) return;
    setIsSeeding(true);
    try {
      const syncState = await seedSampleAssets({
        ownerId: user.id,
        actorEmail: user.email,
        canSyncCloud,
      });
      setToastMessage(
        syncState === 'queued-offline'
          ? 'Sample catalog saved locally'
          : 'Sample corporate inventory synced to Supabase'
      );
    } finally {
      setIsSeeding(false);
    }
  };

  const handleExportCsv = () => {
    exportAssetsToCsv(assets);
    setToastMessage('Exported inventory CSV ledger');
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
              onClick={handleEnterOfflineWorkspace}
              className="min-h-[38px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Open Workspace
            </button>
          )}
        </div>
      </header>

      {/* Workspace Sync & Account Toolbar (Only when active workspace is open) */}
      {user && (
        <div className="bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-2.5">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Visual Offline-First & Real-Time Sync Status Indicator */}
            <div className="flex flex-wrap items-center gap-3">
              {!effectiveOnline || user.isLocalOnly ? (
                <div className="inline-flex items-center gap-1.5 font-medium text-amber-800">
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Offline - Saving Locally
                    {pendingWritesCount > 0 ? ` (${pendingWritesCount} queued)` : ''}
                  </span>
                </div>
              ) : isSyncing || pendingWritesCount > 0 ? (
                <div className="inline-flex items-center gap-1.5 font-medium text-blue-700">
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <span>
                    Syncing {pendingWritesCount > 0 ? `${pendingWritesCount} changes` : 'Supabase'}...
                  </span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Online - Synced</span>
                </div>
              )}

              {!user.isLocalOnly && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    |
                  </span>

                  <button
                    type="button"
                    onClick={handleToggleOfflineSimulation}
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
                </>
              )}
            </div>

            {/* Authenticated User & Sign Out */}
            <div className="flex items-center gap-3 text-slate-600">
              <span className="hidden sm:inline truncate max-w-[220px]">
                {user.isLocalOnly ? 'Local Offline Cache' : user.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[32px] px-2.5 py-1 rounded-lg hover:bg-slate-100 text-slate-700 font-medium transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{user.isLocalOnly ? 'Switch Account' : 'Sign Out'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-24 md:pb-12">
        {!configChecked ? (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <span className="text-sm">Initializing workspace...</span>
          </div>
        ) : !user ? (
          /* Corporate Sign-In & Supabase Overview Landing */
          <div className="py-6 sm:py-10 space-y-12">
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
              <div className="lg:col-span-7 space-y-6">
                <p className="text-xs font-semibold text-blue-600">
                  Corporate Capital & Equipment Registry · Powered by Supabase
                </p>
                <h1
                  className="text-3xl sm:text-5xl font-bold tracking-tight text-slate-900 leading-[1.12]"
                  style={{ textWrap: 'balance' }}
                >
                  Track every physical asset, valuation, and custody handoff—online or offline.
                </h1>
                <p className="text-base text-slate-600 leading-relaxed max-w-2xl">
                  Built for medium-sized operations teams managing IT workstations, fleet
                  vehicles, office furnishings, and industrial machinery with IndexedDB local
                  persistence and automatic Supabase PostgreSQL & Storage synchronization.
                </p>

                <div className="divide-y divide-slate-200 border-t border-b border-slate-200 text-sm max-w-2xl">
                  <div id="capabilities" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900">
                      01. Executive Valuation & QR Tagging
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Monitor portfolio book value, monthly acquisitions, camera barcode/QR
                      scanning, and downloadable asset QR labels.
                    </p>
                  </div>

                  <div id="offline-sync" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900">
                      02. Offline-First IndexedDB Outbox Sync
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Inspect, register, and update equipment without Wi-Fi; queued mutations
                      flush automatically to Supabase PostgreSQL when connectivity returns.
                    </p>
                  </div>

                  <div id="security" className="py-4 space-y-1">
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <span>03. Row Level Security & Immutable Audit Trail</span>
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Every registration, revaluation, and custody transfer is logged in
                      PostgreSQL with owner-isolated RLS policies.
                    </p>
                  </div>
                </div>
              </div>

              {/* Supabase Auth Card */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-5">
                {supabaseConfigured ? (
                  <>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setAuthError(null);
                        }}
                        className={`flex-1 min-h-[38px] text-xs font-medium rounded-lg transition-colors ${
                          authMode === 'login'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('signup');
                          setAuthError(null);
                        }}
                        className={`flex-1 min-h-[38px] text-xs font-medium rounded-lg transition-colors ${
                          authMode === 'signup'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Create Account
                      </button>
                    </div>

                    {authInfoMessage && (
                      <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                        {authInfoMessage}
                      </div>
                    )}

                    {authError && (
                      <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
                        {authError}
                      </div>
                    )}

                    <form onSubmit={handleSupabaseAuthSubmit} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Work Email
                        </label>
                        <input
                          type="email"
                          required
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="name@company.com"
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Password
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="Minimum 6 characters"
                          className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isAuthenticating}
                        className="w-full min-h-[48px] px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
                      >
                        {authMode === 'login' ? (
                          <>
                            <LogIn className="w-4 h-4" />
                            <span>{isAuthenticating ? 'Signing In...' : 'Sign In to Supabase'}</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4" />
                            <span>{isAuthenticating ? 'Creating Account...' : 'Create Account'}</span>
                          </>
                        )}
                      </button>
                    </form>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        Connect Your Supabase Project
                      </h2>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        Configure <span className="font-mono text-slate-900">SUPABASE_URL</span>{' '}
                        and <span className="font-mono text-slate-900">SUPABASE_ANON_KEY</span>{' '}
                        (plus optional{' '}
                        <span className="font-mono text-slate-900">SUPABASE_SERVICE_ROLE_KEY</span>)
                        in the Secrets panel, and execute{' '}
                        <span className="font-mono text-slate-900">supabase/schema.sql</span> in
                        your Supabase SQL Editor.
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleEnterOfflineWorkspace}
                    className="w-full min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <HardDrive className="w-4 h-4" />
                    <span>Continue in Local Offline Workspace</span>
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          /* Active Workspace Views */
          <div className="space-y-6">
            {syncWarning && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span>
                  {syncWarning} Changes remain safely stored in your local IndexedDB cache.
                </span>
                <button
                  type="button"
                  onClick={() => void runFullCloudSync()}
                  className="min-h-[34px] px-3 py-1 bg-white border border-amber-300 rounded-lg font-medium hover:bg-amber-100/50 shrink-0 whitespace-nowrap"
                >
                  Retry Sync
                </button>
              </div>
            )}

            {activeTab === 'dashboard' && (
              <DashboardView
                assets={assets}
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
                onExportCsv={handleExportCsv}
                onSelectAsset={(asset) => setSelectedAssetId(asset.assetId)}
              />
            )}
          </div>
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
            prefilledSerial={prefilledSerial}
            isOnline={canSyncCloud}
            onSubmit={handleFormSave}
          />

          <AssetDetailModal
            asset={selectedAsset}
            userId={user.id}
            canSyncCloud={canSyncCloud}
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
