import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (blob: Blob) => void;
}

export function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsReady(false);
  }, []);

  const startCamera = useCallback(
    async (mode: 'environment' | 'user') => {
      stopCamera();
      setCameraError(null);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraError(
          'Camera access is not supported in this browser. Use the Gallery option to upload a photo.'
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setIsReady(true);
        }
      } catch {
        setCameraError(
          'Unable to access camera. Check camera permissions or select a photo from your device gallery.'
        );
      }
    },
    [stopCamera]
  );

  useEffect(() => {
    if (isOpen) {
      void startCamera(facingMode);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode, startCamera, stopCamera]);

  if (!isOpen) return null;

  const handleSnapPhoto = () => {
    const video = videoRef.current;
    if (!video || !isReady) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 960;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          stopCamera();
          onCapture(blob);
          onClose();
        }
      },
      'image/jpeg',
      0.86
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Capture Asset Photo"
    >
      <div className="bg-slate-900 text-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl overflow-hidden border border-slate-800">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-base font-semibold">Capture Asset Photograph</h3>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            aria-label="Close camera"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative aspect-[4/3] bg-black flex items-center justify-center overflow-hidden">
          {cameraError ? (
            <div className="p-6 text-center max-w-sm">
              <p className="text-sm text-slate-300 leading-relaxed">{cameraError}</p>
            </div>
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-4 bg-slate-900">
          <button
            type="button"
            onClick={() =>
              setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
            }
            className="min-h-[44px] px-4 py-2 text-xs font-medium text-slate-200 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Switch Lens</span>
          </button>

          <button
            type="button"
            disabled={!isReady || Boolean(cameraError)}
            onClick={handleSnapPhoto}
            className="min-h-[48px] px-6 py-2.5 text-sm font-semibold text-slate-900 bg-white rounded-xl hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Camera className="w-4 h-4" />
            <span>Use Photo</span>
          </button>
        </div>
      </div>
    </div>
  );
}
