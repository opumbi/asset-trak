import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  AssetCategory,
  AssetFormInput,
  AssetRecord,
  AssetStatus,
  getTodayIsoDate,
  SCHEMA_LIMITS,
} from '../types/asset';
import { uploadAssetPhoto } from '../lib/imageStorage';
import { AssetImage } from './AssetImage';
import { CameraCaptureModal } from './CameraCaptureModal';

interface AssetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingAsset: AssetRecord | null;
  prefilledSerial?: string;
  isOnline: boolean;
  onSubmit: (input: AssetFormInput) => Promise<void>;
}

function generateSerialTag(category: AssetCategory): string {
  const prefixMap: Record<AssetCategory, string> = {
    'IT Hardware': 'IT',
    'Office Furniture': 'FN',
    Vehicles: 'VH',
    Machinery: 'MC',
    'Lab & Medical': 'LB',
    Other: 'GN',
  };
  const digits = Math.floor(100000 + Math.random() * 900000);
  return `AT-${prefixMap[category]}-${digits}`;
}

export function AssetFormModal({
  isOpen,
  onClose,
  editingAsset,
  prefilledSerial = '',
  isOnline,
  onSubmit,
}: AssetFormModalProps) {
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [category, setCategory] = useState<AssetCategory>('IT Hardware');
  const [status, setStatus] = useState<AssetStatus>('In Use');
  const [purchasePrice, setPurchasePrice] = useState('0');
  const [currentValuation, setCurrentValuation] = useState('0');
  const [purchaseDate, setPurchaseDate] = useState(getTodayIsoDate());
  const [warrantyExpiry, setWarrantyExpiry] = useState('');
  const [department, setDepartment] = useState('');
  const [location, setLocation] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setPhotoNotice(null);

    if (editingAsset) {
      setName(editingAsset.name);
      setSerialNumber(editingAsset.serialNumber);
      setCategory(editingAsset.category);
      setStatus(editingAsset.status);
      setPurchasePrice(String(editingAsset.purchasePrice));
      setCurrentValuation(String(editingAsset.currentValuation));
      setPurchaseDate(editingAsset.purchaseDate);
      setWarrantyExpiry(editingAsset.warrantyExpiry);
      setDepartment(editingAsset.department);
      setLocation(editingAsset.location);
      setAssignedTo(editingAsset.assignedTo);
      setNotes(editingAsset.notes);
      setPhotoUrl(editingAsset.photoUrl);
    } else {
      setName('');
      setSerialNumber(prefilledSerial || generateSerialTag('IT Hardware'));
      setCategory('IT Hardware');
      setStatus('In Use');
      setPurchasePrice('');
      setCurrentValuation('');
      setPurchaseDate(getTodayIsoDate());
      setWarrantyExpiry('');
      setDepartment('Operations');
      setLocation('HQ · Main Floor');
      setAssignedTo('');
      setNotes('');
      setPhotoUrl('');
    }
  }, [isOpen, editingAsset, prefilledSerial]);

  if (!isOpen) return null;

  const handlePhotoBlob = async (blob: Blob) => {
    setErrorMsg(null);
    setIsUploadingPhoto(true);
    try {
      const result = await uploadAssetPhoto(blob, isOnline);
      setPhotoUrl(result.url);
      setPhotoNotice(
        result.storageType === 'supabase-storage'
          ? 'Uploaded to Supabase Storage'
          : 'Compressed locally for offline-resilient sync'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to process photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleGalleryPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await handlePhotoBlob(file);
    }
    e.target.value = '';
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsedPurchase = Number(purchasePrice || 0);
    const parsedValuation =
      currentValuation.trim() === '' ? parsedPurchase : Number(currentValuation);

    setIsSubmitting(true);
    try {
      await onSubmit({
        name,
        serialNumber,
        category,
        status,
        purchasePrice: parsedPurchase,
        currentValuation: parsedValuation,
        purchaseDate,
        warrantyExpiry,
        department,
        location,
        assignedTo,
        notes,
        photoUrl,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to save asset record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label={editingAsset ? 'Edit Asset' : 'Register New Asset'}
      >
        <div className="bg-white w-full sm:max-w-2xl rounded-t-3xl sm:rounded-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
          <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {editingAsset ? 'Edit Asset Record' : 'Register New Asset'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {isOnline
                  ? 'Changes sync immediately to Supabase PostgreSQL'
                  : 'Offline mode active · Changes save locally and sync automatically'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              aria-label="Close form"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleFormSubmit} className="overflow-y-auto p-6 space-y-6">
            {errorMsg && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Photo Attachment Section */}
            <div className="space-y-2.5">
              <label className="block text-xs font-medium text-slate-700">
                Asset Photograph
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                <div className="w-full sm:w-36 aspect-[4/3] rounded-xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0">
                  <AssetImage
                    src={photoUrl}
                    alt={name || 'Asset preview'}
                    category={category}
                  />
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      disabled={isUploadingPhoto}
                      onClick={() => setIsCameraOpen(true)}
                      className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Use Camera</span>
                    </button>

                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleGalleryPick}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isUploadingPhoto}
                      onClick={() => galleryInputRef.current?.click()}
                      className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                    >
                      {isUploadingPhoto ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <ImagePlus className="w-4 h-4" />
                      )}
                      <span>{isUploadingPhoto ? 'Processing...' : 'Choose Gallery'}</span>
                    </button>

                    {photoUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoUrl('');
                          setPhotoNotice(null);
                        }}
                        className="min-h-[44px] px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 rounded-xl transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {photoNotice ||
                      'Capture directly with your device camera or select a high-resolution image from your gallery.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Identity & Classification */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Asset Name *
                </label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.NAME_MAX_LEN}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. MacBook Pro 16 M3 Max or Toyota Forklift 8FGCU25"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    Serial / Model Number *
                  </label>
                  <button
                    type="button"
                    onClick={() => setSerialNumber(generateSerialTag(category))}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Auto Tag</span>
                  </button>
                </div>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.SERIAL_MAX_LEN}
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="AT-IT-745088"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Category *
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AssetCategory)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {ASSET_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Financials & Dates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Purchase Price (USD) *
                </label>
                <input
                  type="number"
                  required
                  min="0"
                  max={SCHEMA_LIMITS.MAX_MONETARY_VALUE}
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="2500.00"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Current Valuation (USD) *
                </label>
                <input
                  type="number"
                  min="0"
                  max={SCHEMA_LIMITS.MAX_MONETARY_VALUE}
                  step="0.01"
                  value={currentValuation}
                  onChange={(e) => setCurrentValuation(e.target.value)}
                  placeholder={purchasePrice || '2200.00'}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Purchase Date *
                </label>
                <input
                  type="date"
                  required
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Warranty Expiry Date
                </label>
                <input
                  type="date"
                  value={warrantyExpiry}
                  onChange={(e) => setWarrantyExpiry(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            {/* Status & Custody */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Current Status *
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as AssetStatus)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {ASSET_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
                {status === 'Disposed' && (
                  <p className="text-[11px] text-amber-700 mt-1.5">
                    Note: Marking an asset as Disposed finalizes its audit record and locks future edits.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Assigned Person
                </label>
                <input
                  type="text"
                  maxLength={SCHEMA_LIMITS.ASSIGNED_TO_MAX_LEN}
                  value={assignedTo}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  placeholder="Unassigned or custodian full name"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Department *
                </label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.DEPARTMENT_MAX_LEN}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="e.g. Engineering, Logistics, Finance"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Physical Location *
                </label>
                <input
                  type="text"
                  required
                  maxLength={SCHEMA_LIMITS.LOCATION_MAX_LEN}
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. HQ Floor 4 · Room 402"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Condition & Maintenance Notes
                </label>
                <textarea
                  rows={2}
                  maxLength={SCHEMA_LIMITS.NOTES_MAX_LEN}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional procurement reference, accessories included, or service schedule..."
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[44px] px-5 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isUploadingPhoto}
                className="min-h-[44px] px-6 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{editingAsset ? 'Save Changes' : 'Register Asset'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      <CameraCaptureModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={(blob) => void handlePhotoBlob(blob)}
      />
    </>
  );
}
