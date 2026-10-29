import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';
import { SCHEMA_LIMITS } from '../types/asset';

export interface ProcessedPhotoResult {
  url: string;
  storageType: 'firebase-storage' | 'offline-embedded';
}

/**
 * Compresses an image File or Blob to a high-clarity JPEG bounded within
 * Firestore & Storage limits so both online Cloud Storage uploads and
 * offline local persistence succeed reliably.
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
 * Uploads compressed asset photo to Firebase Storage when online,
 * with resilient offline-first fallback to compressed data URL when offline
 * or if Cloud Storage bucket writes are unavailable.
 */
export async function uploadAssetPhoto(
  fileOrBlob: Blob,
  userId: string,
  isOnline: boolean
): Promise<ProcessedPhotoResult> {
  const { blob, dataUrl } = await compressImageBlob(fileOrBlob);

  if (!isOnline) {
    return {
      url: dataUrl,
      storageType: 'offline-embedded',
    };
  }

  try {
    const objectPath = `assets/${userId}/photo_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}.jpg`;
    const storageRef = ref(storage, objectPath);

    const uploadTask = uploadBytes(storageRef, blob, {
      contentType: 'image/jpeg',
    });

    // Bound Storage upload attempt to 4.5s so unprovisioned buckets or flaky cellular links never hang UI
    const snapshot = await Promise.race([
      uploadTask,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Storage upload timed out')), 4500)
      ),
    ]);

    const downloadUrl = await getDownloadURL(snapshot.ref);
    if (downloadUrl.length <= SCHEMA_LIMITS.PHOTO_URL_MAX_LEN) {
      return {
        url: downloadUrl,
        storageType: 'firebase-storage',
      };
    }
  } catch {
    // Graceful fallback ensures asset registration works offline and on Spark projects without Storage rules
  }

  return {
    url: dataUrl,
    storageType: 'offline-embedded',
  };
}
