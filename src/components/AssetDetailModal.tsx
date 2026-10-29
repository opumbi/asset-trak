import React, { useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, query, Timestamp, where } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  CheckCircle2,
  Clock,
  CloudOff,
  Download,
  Edit3,
  Lock,
  Trash2,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ASSET_STATUSES,
  AssetEventAction,
  AssetEventRecord,
  AssetRecord,
  AssetStatus,
  formatCurrency,
  formatDateTime,
  formatShortDate,
} from '../types/asset';
import { AssetImage } from './AssetImage';

interface AssetDetailModalProps {
  asset: AssetRecord | null;
  userId: string;
  onClose: () => void;
  onEdit: (asset: AssetRecord) => void;
  onStatusChange: (asset: AssetRecord, nextStatus: AssetStatus) => Promise<void>;
  onValuationChange: (asset: AssetRecord, nextValuation: number) => Promise<void>;
  onDelete: (assetId: string) => Promise<void>;
}

export function AssetDetailModal({
  asset,
  userId,
  onClose,
  onEdit,
  onStatusChange,
  onValuationChange,
  onDelete,
}: AssetDetailModalProps) {
  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  const [events, setEvents] = useState<AssetEventRecord[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [confirmDispose, setConfirmDispose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [editingValuation, setEditingValuation] = useState(false);
  const [valuationDraft, setValuationDraft] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setConfirmDispose(false);
    setConfirmDelete(false);
    setEditingValuation(false);
    setActionError(null);

    if (!asset || !userId) {
      setEvents([]);
      return;
    }

    setValuationDraft(String(asset.currentValuation));
    setLoadingEvents(true);
    const eventsPath = `assets/${asset.assetId}/events`;
    const eventsQuery = query(
      collection(db, 'assets', asset.assetId, 'events'),
      where('ownerId', '==', userId)
    );

    const unsubscribe = onSnapshot(
      eventsQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const parsed: AssetEventRecord[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data({ serverTimestamps: 'estimate' });
          const ts = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : new Date();
          return {
            eventId: String(data.eventId || docSnap.id),
            assetId: String(data.assetId || asset.assetId),
            ownerId: String(data.ownerId || userId),
            action: (data.action as AssetEventAction) || 'Details Updated',
            summary: String(data.summary || ''),
            actorEmail: String(data.actorEmail || ''),
            createdAt: ts,
            hasPendingWrites: docSnap.metadata.hasPendingWrites,
          };
        });
        parsed.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        setEvents(parsed);
        setLoadingEvents(false);
      },
      (error) => {
        setLoadingEvents(false);
        handleFirestoreError(error, OperationType.LIST, eventsPath);
      }
    );

    return () => unsubscribe();
  }, [asset?.assetId, userId]);

  if (!asset) return null;

  const isDisposed = asset.status === 'Disposed';
  const netDelta = asset.currentValuation - asset.purchasePrice;
  const retentionPct =
    asset.purchasePrice > 0
      ? Math.round((asset.currentValuation / asset.purchasePrice) * 100)
      : 100;

  const handleQuickStatus = async (targetStatus: AssetStatus) => {
    if (targetStatus === asset.status || isDisposed) return;
    if (targetStatus === 'Disposed' && !confirmDispose) {
      setConfirmDispose(true);
      return;
    }
    setActionError(null);
    setIsUpdating(true);
    try {
      await onStatusChange(asset, targetStatus);
      setConfirmDispose(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveValuation = async () => {
    const parsed = Number(valuationDraft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setActionError('Enter a valid non-negative valuation.');
      return;
    }
    setActionError(null);
    setIsUpdating(true);
    try {
      await onValuationChange(asset, parsed);
      setEditingValuation(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Valuation update failed.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    setActionError(null);
    setIsUpdating(true);
    try {
      await onDelete(asset.assetId);
      onClose();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete asset.');
      setIsUpdating(false);
    }
  };

  const handleDownloadQrLabel = () => {
    const svgEl = qrContainerRef.current?.querySelector('svg');
    if (!svgEl) return;

    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 560;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

      ctx.drawImage(img, 90, 56, 300, 300);

      ctx.fillStyle = '#0f172a';
      ctx.font = '700 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ASSET TRACK', canvas.width / 2, 410);

      ctx.font = '600 18px monospace';
      ctx.fillText(asset.serialNumber, canvas.width / 2, 448);

      ctx.fillStyle = '#475569';
      ctx.font = '400 15px sans-serif';
      ctx.fillText(asset.name.slice(0, 34), canvas.width / 2, 486);

      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = `qr-tag-${asset.serialNumber}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
    img.src = url;
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Asset details for ${asset.name}`}
    >
      <div className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{asset.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-700">{asset.serialNumber}</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                {asset.hasPendingWrites ? (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-amber-600" />
                    <span className="text-amber-700 font-medium">Saved Locally</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-emerald-700 font-medium">Synced</span>
                  </>
                )}
              </span>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mt-1 truncate">
              {asset.name}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isDisposed && (
              <button
                type="button"
                onClick={() => onEdit(asset)}
                className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <Edit3 className="w-4 h-4" />
                <span>Edit</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              aria-label="Close asset details"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto p-6 space-y-8">
          {actionError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {actionError}
            </div>
          )}

          {/* Top Visual + Financial Split */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-stretch">
            <div className="md:col-span-7 aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
              <AssetImage
                src={asset.photoUrl}
                alt={asset.name}
                category={asset.category}
                iconSizeClass="w-10 h-10"
              />
            </div>

            <div className="md:col-span-5 flex flex-col justify-between gap-4">
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Current Valuation</span>
                    {!isDisposed && !editingValuation && (
                      <button
                        type="button"
                        onClick={() => setEditingValuation(true)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Adjust Value
                      </button>
                    )}
                  </div>

                  {editingValuation ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={valuationDraft}
                        onChange={(e) => setValuationDraft(e.target.value)}
                        className="w-full min-h-[40px] px-3 py-1.5 text-sm font-mono tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => void handleSaveValuation()}
                        className="min-h-[40px] px-3 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingValuation(false);
                          setValuationDraft(String(asset.currentValuation));
                        }}
                        className="min-h-[40px] px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
                      {formatCurrency(asset.currentValuation)}
                    </div>
                  )}

                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    Acquired {formatCurrency(asset.purchasePrice)} · {retentionPct}% book value (
                    {netDelta >= 0 ? `+${formatCurrency(netDelta)}` : formatCurrency(netDelta)})
                  </div>
                </div>

                {/* Printable QR Tag */}
                <div className="pt-4 border-t border-slate-200 flex items-center gap-4">
                  <div
                    ref={qrContainerRef}
                    className="p-2 bg-white border border-slate-200 rounded-lg shrink-0"
                  >
                    <QRCodeSVG
                      value={`AT:${asset.serialNumber}`}
                      size={76}
                      level="M"
                      includeMargin={false}
                    />
                  </div>
                  <div className="space-y-2 min-w-0">
                    <div className="text-xs font-medium text-slate-900">
                      QR Asset Label
                    </div>
                    <div className="text-xs font-mono text-slate-500 truncate">
                      AT:{asset.serialNumber}
                    </div>
                    <button
                      type="button"
                      onClick={handleDownloadQrLabel}
                      className="min-h-[36px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Label</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Lifecycle Status Selector */}
          <div className="pt-6 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Lifecycle Status
              </span>
              {isDisposed && (
                <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Disposed record locked</span>
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 bg-slate-100 rounded-xl">
              {ASSET_STATUSES.map((st) => {
                const active = asset.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    disabled={isDisposed || isUpdating}
                    onClick={() => void handleQuickStatus(st)}
                    className={`min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900 disabled:opacity-50'
                    }`}
                  >
                    {st}
                  </button>
                );
              })}
            </div>

            {confirmDispose && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-xs text-amber-900 leading-relaxed">
                  Confirm marking <strong>{asset.name}</strong> as Disposed? Disposed assets are
                  permanently locked from future edits for audit integrity.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmDispose(false)}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => void handleQuickStatus('Disposed')}
                    className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-700 hover:bg-amber-800 rounded-lg whitespace-nowrap"
                  >
                    Confirm Disposal
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Custody & Specification Metadata */}
          <div className="pt-6 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-y-5 gap-x-6 text-sm">
            <div>
              <div className="text-xs text-slate-500">Department</div>
              <div className="font-medium text-slate-900 mt-0.5">{asset.department}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Physical Location</div>
              <div className="font-medium text-slate-900 mt-0.5">{asset.location}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Assigned Custodian</div>
              <div className="font-medium text-slate-900 mt-0.5">
                {asset.assignedTo || 'Unassigned'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Purchase Date</div>
              <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                {formatShortDate(asset.purchaseDate)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Warranty Expiry</div>
              <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                {asset.warrantyExpiry ? formatShortDate(asset.warrantyExpiry) : 'No Warranty'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Last Updated</div>
              <div className="font-mono tabular-nums text-slate-900 mt-0.5">
                {formatDateTime(asset.updatedAt)}
              </div>
            </div>
            {asset.notes && (
              <div className="sm:col-span-3">
                <div className="text-xs text-slate-500">Condition & Service Notes</div>
                <p className="text-sm text-slate-700 mt-1 leading-relaxed">{asset.notes}</p>
              </div>
            )}
          </div>

          {/* Timestamp Audit History */}
          <div className="pt-6 border-t border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Timestamp Audit History
              </h3>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {events.length} {events.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>

            {loadingEvents ? (
              <div className="space-y-3">
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
                <div className="h-12 bg-slate-100 rounded-xl animate-pulse" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                Audit log entries will appear here as changes are recorded.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 border-t border-b border-slate-100">
                {events.map((evt) => (
                  <div
                    key={evt.eventId}
                    className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                        <span>{evt.action}</span>
                        {evt.hasPendingWrites && (
                          <span className="text-[11px] font-normal text-amber-700">
                            · Queued locally
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{evt.summary}</p>
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      <span>{formatDateTime(evt.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Danger Zone: Delete Asset */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-between gap-4">
            {confirmDelete ? (
              <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-red-50 border border-red-200">
                <span className="text-xs text-red-800">
                  Permanently remove <strong>{asset.name}</strong> and its audit history?
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isUpdating}
                    onClick={() => void handleDeleteConfirmed()}
                    className="min-h-[40px] px-3.5 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg whitespace-nowrap"
                  >
                    Delete Permanently
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="min-h-[44px] px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Asset Record</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
