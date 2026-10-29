import React, { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  ImagePlus,
  Plus,
  QrCode,
  Search,
  X,
} from 'lucide-react';
import { AssetRecord, formatCurrency } from '../types/asset';
import { AssetImage } from './AssetImage';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  assets: AssetRecord[];
  onSelectAsset: (asset: AssetRecord) => void;
  onRegisterWithSerial: (serialCode: string) => void;
}

interface BarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

function normalizeScannedCode(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toUpperCase().startsWith('AT:')) {
    return trimmed.slice(3).trim();
  }
  return trimmed;
}

export function QrScannerModal({
  isOpen,
  onClose,
  assets,
  onSelectAsset,
  onRegisterWithSerial,
}: QrScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedValue, setScannedValue] = useState<string>('');
  const [manualInput, setManualInput] = useState<string>('');

  const stopScanner = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      setScannedValue('');
      setManualInput('');
      setCameraError(null);
      return;
    }

    let cancelled = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let nativeDetector: BarcodeDetectorLike | null = null;

    if (typeof window !== 'undefined' && window.BarcodeDetector) {
      try {
        nativeDetector = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'upc_a'],
        });
      } catch {
        nativeDetector = null;
      }
    }

    const scanLoop = async () => {
      if (cancelled) return;
      const video = videoRef.current;

      if (video && video.readyState >= video.HAVE_ENOUGH_DATA && ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (nativeDetector) {
          try {
            const barcodes = await nativeDetector.detect(canvas);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              const clean = normalizeScannedCode(barcodes[0].rawValue);
              if (clean) {
                setScannedValue(clean);
                stopScanner();
                return;
              }
            }
          } catch {
            // Fall through to jsQR
          }
        }

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const qrResult = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (qrResult && qrResult.data) {
          const clean = normalizeScannedCode(qrResult.data);
          if (clean) {
            setScannedValue(clean);
            stopScanner();
            return;
          }
        }
      }

      rafRef.current = requestAnimationFrame(() => {
        void scanLoop();
      });
    };

    const initCamera = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Live camera scanning is unavailable in this environment. Upload a barcode image or enter a serial tag below.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          rafRef.current = requestAnimationFrame(() => {
            void scanLoop();
          });
        }
      } catch {
        setCameraError(
          'Camera permission was denied or no camera was detected. Upload a QR label image or search by serial number below.'
        );
      }
    };

    void initCamera();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, stopScanner]);

  if (!isOpen) return null;

  const activeCode = scannedValue || normalizeScannedCode(manualInput);
  const matchedAsset = activeCode
    ? assets.find(
        (a) =>
          a.serialNumber.toLowerCase() === activeCode.toLowerCase() ||
          a.assetId.toLowerCase() === activeCode.toLowerCase()
      )
    : undefined;

  const handleImageFileScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imageData.data, imageData.width, imageData.height);
      if (decoded?.data) {
        const clean = normalizeScannedCode(decoded.data);
        setScannedValue(clean);
        setManualInput(clean);
      } else {
        setCameraError(
          'No QR code was detected in the selected image. Try entering the serial number directly below.'
        );
      }
    };
    img.src = url;
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Scan QR or Barcode"
    >
      <div className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 sm:hidden shrink-0" />

        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <QrCode className="w-5 h-5 text-slate-900" />
            <h2 className="text-base font-semibold text-slate-900">
              Scan Asset QR or Barcode
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {!scannedValue && (
            <div className="relative aspect-[16/10] rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center">
              {cameraError ? (
                <div className="p-6 text-center space-y-3">
                  <Camera className="w-6 h-6 text-slate-400 mx-auto" />
                  <p className="text-xs text-slate-300 leading-relaxed max-w-xs mx-auto">
                    {cameraError}
                  </p>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    <div className="w-48 h-36 border-2 border-white/80 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={scannedValue || manualInput}
                onChange={(e) => {
                  setScannedValue('');
                  setManualInput(e.target.value);
                }}
                placeholder="Enter or scan serial tag (e.g. AT-IT-745088)"
                className="w-full min-h-[44px] pl-10 pr-4 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageFileScan}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
            >
              <ImagePlus className="w-4 h-4" />
              <span>Scan Image</span>
            </button>
          </div>

          {activeCode && (
            <div className="pt-2 border-t border-slate-200">
              {matchedAsset ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Matched Inventory Record</span>
                  </div>

                  <div className="flex items-center gap-4 p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                    <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0 border border-slate-200">
                      <AssetImage
                        src={matchedAsset.photoUrl}
                        alt={matchedAsset.name}
                        category={matchedAsset.category}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {matchedAsset.name}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 truncate">
                        <span className="font-mono">{matchedAsset.serialNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{matchedAsset.status}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatCurrency(matchedAsset.currentValuation, matchedAsset.currency)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onSelectAsset(matchedAsset);
                      onClose();
                    }}
                    className="w-full min-h-[48px] px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <span>Open Asset Record</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-xs text-slate-600">
                    No asset matches code{' '}
                    <span className="font-mono font-semibold text-slate-900">
                      {activeCode}
                    </span>
                    . You can register a new asset using this serial identifier.
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onRegisterWithSerial(activeCode);
                      onClose();
                    }}
                    className="w-full min-h-[48px] px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition-colors inline-flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Register Asset with This Serial</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
