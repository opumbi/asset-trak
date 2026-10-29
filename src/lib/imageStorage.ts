import { SCHEMA_LIMITS } from '../types/asset';
import { apiUploadPhotoToSupabaseStorage, getAccessToken } from './supabaseApi';

export interface ProcessedPhotoResult {
  url: string;
  storageType: 'supabase-storage' | 'offline-embedded';
}

/**
 * Compresses an image File or Blob to a high-clarity JPEG bounded within
 * payload limits so both online Supabase Storage uploads and offline
 * IndexedDB persistence succeed reliably.
 */
export async function compressImageBlob(
  source: Blob,
  maxDimension = 960,
  quality = 0.76
): Promise<{ blob: Blob; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(source);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width >= height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Unable to initialize image compression canvas.'));
        return;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      let activeQuality = quality;
      let dataUrl = canvas.toDataURL('image/jpeg', activeQuality);
      while (
        dataUrl.length > SCHEMA_LIMITS.PHOTO_URL_MAX_LEN - 10_000 &&
        activeQuality > 0.35
      ) {
        activeQuality -= 0.12;
        dataUrl = canvas.toDataURL('image/jpeg', activeQuality);
      }

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to encode compressed asset photo.'));
            return;
          }
          resolve({ blob, dataUrl });
        },
        'image/jpeg',
        activeQuality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Selected file could not be decoded as an image.'));
    };
    img.src = objectUrl;
  });
}

/**
 * Uploads compressed asset photo to Supabase Storage ('asset-photos' bucket)
 * when online with an active Supabase session, falling back to compressed
 * data URL when offline so asset registration never stalls.
 */
export async function uploadAssetPhoto(
  fileOrBlob: Blob,
  isOnline: boolean
): Promise<ProcessedPhotoResult> {
  const { dataUrl } = await compressImageBlob(fileOrBlob);

  if (!isOnline || !getAccessToken()) {
    return {
      url: dataUrl,
      storageType: 'offline-embedded',
    };
  }

  try {
    const publicUrl = await Promise.race([
      apiUploadPhotoToSupabaseStorage(dataUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Storage upload timed out')), 5000)
      ),
    ]);

    if (publicUrl && publicUrl.length <= SCHEMA_LIMITS.PHOTO_URL_MAX_LEN) {
      return {
        url: publicUrl,
        storageType: 'supabase-storage',
      };
    }
  } catch {
    // Graceful fallback preserves photo locally for offline sync or uninitialized bucket
  }

  return {
    url: dataUrl,
    storageType: 'offline-embedded',
  };
}
