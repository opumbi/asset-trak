import { StoredAsset, StoredEvent } from './offlineDb';

export interface SupabaseSessionUser {
  id: string;
  email: string;
  isLocalOnly?: boolean;
}

let inMemoryAccessToken: string | null = null;
let inMemoryRefreshToken: string | null = null;

export function setSupabaseTokens(accessToken: string | null, refreshToken: string | null) {
  inMemoryAccessToken = accessToken;
  inMemoryRefreshToken = refreshToken;
}

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (inMemoryAccessToken) {
    headers.set('Authorization', `Bearer ${inMemoryAccessToken}`);
  }

  let response = await fetch(url, { ...init, headers });

  if (response.status === 401 && inMemoryRefreshToken) {
    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: inMemoryRefreshToken }),
    });
    if (refreshRes.ok) {
      const refreshData = (await refreshRes.json()) as {
        accessToken: string;
        refreshToken: string;
      };
      inMemoryAccessToken = refreshData.accessToken;
      inMemoryRefreshToken = refreshData.refreshToken;
      headers.set('Authorization', `Bearer ${inMemoryAccessToken}`);
      response = await fetch(url, { ...init, headers });
    }
  }

  return response;
}

export async function fetchSupabaseConfigStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/config-status');
    if (!res.ok) return false;
    const data = (await res.json()) as { supabaseConfigured?: boolean };
    return Boolean(data.supabaseConfigured);
  } catch {
    return false;
  }
}

export async function signUpWithSupabase(
  email: string,
  password: string
): Promise<{
  user?: SupabaseSessionUser;
  confirmationRequired?: boolean;
  message?: string;
}> {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = (await res.json()) as {
    user?: SupabaseSessionUser;
    accessToken?: string;
    refreshToken?: string;
    confirmationRequired?: boolean;
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.error || 'Unable to create Supabase account.');
  }

  if (data.accessToken && data.user) {
    setSupabaseTokens(data.accessToken, data.refreshToken || null);
    return { user: data.user };
  }

  return {
    confirmationRequired: Boolean(data.confirmationRequired),
    message: data.message,
  };
}

export async function signInWithSupabase(
  email: string,
  password: string
): Promise<SupabaseSessionUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = (await res.json()) as {
    user?: SupabaseSessionUser;
    accessToken?: string;
    refreshToken?: string;
    error?: string;
  };

  if (!res.ok || !data.user || !data.accessToken) {
    throw new Error(data.error || 'Invalid email or password.');
  }

  setSupabaseTokens(data.accessToken, data.refreshToken || null);
  return data.user;
}

export async function apiFetchAssets(): Promise<StoredAsset[]> {
  const res = await authorizedFetch('/api/assets');
  const data = (await res.json()) as { assets?: StoredAsset[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch assets from Supabase.');
  }
  return (data.assets || []).map((a) => ({ ...a, hasPendingWrites: false }));
}

export async function apiCreateAsset(
  asset: StoredAsset,
  event?: StoredEvent
): Promise<StoredAsset> {
  const res = await authorizedFetch('/api/assets', {
    method: 'POST',
    body: JSON.stringify({ asset, event }),
  });
  const data = (await res.json()) as { asset?: StoredAsset; error?: string };
  if (!res.ok || !data.asset) {
    throw new Error(data.error || 'Failed to create asset in Supabase.');
  }
  return { ...data.asset, hasPendingWrites: false };
}

export async function apiUpdateAsset(
  assetId: string,
  updates: Partial<StoredAsset>,
  event?: StoredEvent
): Promise<StoredAsset> {
  const res = await authorizedFetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ updates, event }),
  });
  const data = (await res.json()) as { asset?: StoredAsset; error?: string };
  if (!res.ok || !data.asset) {
    throw new Error(data.error || 'Failed to update asset in Supabase.');
  }
  return { ...data.asset, hasPendingWrites: false };
}

export async function apiDeleteAsset(assetId: string): Promise<void> {
  const res = await authorizedFetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to delete asset from Supabase.');
  }
}

export async function apiFetchAssetEvents(assetId: string): Promise<StoredEvent[]> {
  const res = await authorizedFetch(
    `/api/assets/${encodeURIComponent(assetId)}/events`
  );
  const data = (await res.json()) as { events?: StoredEvent[]; error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Failed to load asset history from Supabase.');
  }
  return (data.events || []).map((e) => ({ ...e, hasPendingWrites: false }));
}

export async function apiUploadPhotoToSupabaseStorage(
  base64Data: string
): Promise<string> {
  const res = await authorizedFetch('/api/storage/upload', {
    method: 'POST',
    body: JSON.stringify({ base64Data }),
  });
  const data = (await res.json()) as { publicUrl?: string; error?: string };
  if (!res.ok || !data.publicUrl) {
    throw new Error(data.error || 'Supabase Storage upload failed.');
  }
  return data.publicUrl;
}
