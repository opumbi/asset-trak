import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AuthenticatedRequest extends Request {
  authUser?: {
    id: string;
    email: string;
  };
  accessToken?: string;
}

interface DbAssetRow {
  asset_id: string;
  owner_id: string;
  name: string;
  serial_number: string;
  category: string;
  purchase_price: number | string;
  current_valuation: number | string;
  purchase_date: string;
  warranty_expiry: string;
  status: string;
  department: string;
  location: string;
  assigned_to: string;
  notes: string;
  photo_url: string;
  created_at: string;
  updated_at: string;
}

interface DbEventRow {
  event_id: string;
  asset_id: string;
  owner_id: string;
  action: string;
  summary: string;
  actor_email: string;
  created_at: string;
}

function getSupabaseEnv() {
  const url = (process.env.SUPABASE_URL || '').trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  const isPlaceholderUrl =
    !url ||
    url === 'https://your-project-id.supabase.co' ||
    url === 'MY_SUPABASE_URL' ||
    !url.startsWith('http');

  const hasValidAnon =
    Boolean(anonKey) && anonKey !== 'your-supabase-anon-key' && anonKey !== 'MY_SUPABASE_ANON_KEY';
  const hasValidService =
    Boolean(serviceRoleKey) &&
    serviceRoleKey !== 'your-supabase-service-role-key' &&
    serviceRoleKey !== 'MY_SUPABASE_SERVICE_ROLE_KEY';

  return {
    configured: !isPlaceholderUrl && (hasValidAnon || hasValidService),
    url,
    anonKey: hasValidAnon ? anonKey : serviceRoleKey,
    serviceRoleKey: hasValidService ? serviceRoleKey : '',
  };
}

function createAuthClient(): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env.configured) return null;
  return createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createScopedDbClient(accessToken: string): SupabaseClient | null {
  const env = getSupabaseEnv();
  if (!env.configured) return null;
  if (env.serviceRoleKey) {
    return createClient(env.url, env.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function mapRowToAssetDto(row: DbAssetRow) {
  return {
    assetId: row.asset_id,
    ownerId: row.owner_id,
    name: row.name,
    serialNumber: row.serial_number,
    category: row.category,
    purchasePrice: Number(row.purchase_price || 0),
    currentValuation: Number(row.current_valuation || 0),
    purchaseDate: row.purchase_date,
    warrantyExpiry: row.warranty_expiry || '',
    status: row.status,
    department: row.department,
    location: row.location,
    assignedTo: row.assigned_to || '',
    notes: row.notes || '',
    photoUrl: row.photo_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRowToEventDto(row: DbEventRow) {
  return {
    eventId: row.event_id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    action: row.action,
    summary: row.summary,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

async function requireSupabaseAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authClient = createAuthClient();
  if (!authClient) {
    res.status(503).json({
      error: 'Supabase credentials are not configured yet in the Secrets panel.',
    });
    return;
  }

  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization Bearer token.' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired Supabase session token.' });
    return;
  }

  req.authUser = {
    id: data.user.id,
    email: data.user.email || 'user@organization.com',
  };
  req.accessToken = token;
  next();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '6mb' }));

  // 1. Supabase Configuration Status
  app.get('/api/config-status', (_req: Request, res: Response) => {
    const env = getSupabaseEnv();
    res.json({ supabaseConfigured: env.configured });
  });

  // 2. Supabase Authentication Endpoints
  app.post('/api/auth/signup', async (req: Request, res: Response) => {
    const env = getSupabaseEnv();
    const authClient = createAuthClient();
    if (!authClient) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_ANON_KEY in Secrets to enable cloud accounts.',
      });
      return;
    }

    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || password.length < 6) {
      res.status(400).json({ error: 'Valid email and password (min 6 characters) are required.' });
      return;
    }

    try {
      // If service role key is configured, auto-confirm email so corporate accounts work immediately
      if (env.serviceRoleKey) {
        const adminClient = createClient(env.url, env.serviceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (createErr && !createErr.message.toLowerCase().includes('already')) {
          res.status(400).json({ error: createErr.message });
          return;
        }
        const { data: loginData, error: loginErr } = await authClient.auth.signInWithPassword({
          email,
          password,
        });
        if (loginErr || !loginData.session || !loginData.user) {
          res.status(400).json({ error: loginErr?.message || 'Unable to sign in new user.' });
          return;
        }
        res.json({
          user: { id: loginData.user.id, email: loginData.user.email || email },
          accessToken: loginData.session.access_token,
          refreshToken: loginData.session.refresh_token,
        });
        return;
      }

      const { data, error } = await authClient.auth.signUp({ email, password });
      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (!data.session || !data.user) {
        res.status(200).json({
          confirmationRequired: true,
          message:
            'Account created. Please confirm your email inbox (or disable Confirm Email in Supabase Auth settings) and sign in.',
        });
        return;
      }

      res.json({
        user: { id: data.user.id, email: data.user.email || email },
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    } catch {
      res.status(500).json({ error: 'Authentication service failed during sign-up.' });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const authClient = createAuthClient();
    if (!authClient) {
      res.status(503).json({
        error: 'Configure SUPABASE_URL and SUPABASE_ANON_KEY in Secrets to sign in.',
      });
      return;
    }

    const email = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    try {
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error || !data.session || !data.user) {
        res.status(401).json({ error: error?.message || 'Invalid login credentials.' });
        return;
      }

      res.json({
        user: { id: data.user.id, email: data.user.email || email },
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    } catch {
      res.status(500).json({ error: 'Authentication service failed during sign-in.' });
    }
  });

  app.post('/api/auth/refresh', async (req: Request, res: Response) => {
    const authClient = createAuthClient();
    if (!authClient) {
      res.status(503).json({ error: 'Supabase is not configured.' });
      return;
    }

    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
      res.status(400).json({ error: 'Missing refresh token.' });
      return;
    }

    try {
      const { data, error } = await authClient.auth.refreshSession({
        refresh_token: refreshToken,
      });
      if (error || !data.session || !data.user) {
        res.status(401).json({ error: 'Session expired. Please sign in again.' });
        return;
      }
      res.json({
        user: { id: data.user.id, email: data.user.email || '' },
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
      });
    } catch {
      res.status(500).json({ error: 'Unable to refresh session.' });
    }
  });

  app.get('/api/auth/me', requireSupabaseAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.authUser });
  });

  // 3. Asset Inventory CRUD Endpoints (Supabase PostgreSQL)
  app.get('/api/assets', requireSupabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    const supabase = createScopedDbClient(req.accessToken!);
    if (!supabase || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.' });
      return;
    }

    try {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('owner_id', req.authUser.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Supabase fetch assets error:', error);
        res.status(500).json({
          error:
            error.code === '42P01'
              ? 'Database tables not initialized yet. Please run supabase/schema.sql in your Supabase SQL Editor.'
              : 'Failed to load assets from Supabase.',
        });
        return;
      }

      res.json({ assets: ((data as DbAssetRow[]) || []).map(mapRowToAssetDto) });
    } catch (err) {
      console.error('Unexpected fetch assets error:', err);
      res.status(500).json({ error: 'Failed to query assets.' });
    }
  });

  app.post('/api/assets', requireSupabaseAuth, async (req: AuthenticatedRequest, res: Response) => {
    const supabase = createScopedDbClient(req.accessToken!);
    if (!supabase || !req.authUser) {
      res.status(503).json({ error: 'Database unavailable.' });
      return;
    }

    const { asset, event } = req.body || {};
    if (!asset || !asset.assetId || !asset.name || !asset.serialNumber) {
      res.status(400).json({ error: 'Invalid asset payload.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const assetRow = {
      asset_id: String(asset.assetId),
      owner_id: req.authUser.id,
      name: String(asset.name).slice(0, 120),
      serial_number: String(asset.serialNumber).slice(0, 80),
      category: String(asset.category),
      purchase_price: Number(asset.purchasePrice || 0),
      current_valuation: Number(asset.currentValuation || 0),
      purchase_date: String(asset.purchaseDate),
      warranty_expiry: String(asset.warrantyExpiry || ''),
      status: String(asset.status),
      department: String(asset.department).slice(0, 80),
      location: String(asset.location).slice(0, 120),
      assigned_to: String(asset.assignedTo || '').slice(0, 100),
      notes: String(asset.notes || '').slice(0, 1000),
      photo_url: String(asset.photoUrl || ''),
      created_at: asset.createdAt || nowIso,
      updated_at: nowIso,
    };

    try {
      const { data: savedRows, error: assetErr } = await supabase
        .from('assets')
        .upsert(assetRow, { onConflict: 'asset_id' })
        .select('*')
        .single();

      if (assetErr) {
        console.error('Supabase insert asset error:', assetErr);
        res.status(500).json({
          error:
            assetErr.code === '42P01'
              ? 'Database tables not initialized yet. Run supabase/schema.sql in your Supabase SQL Editor.'
              : 'Failed to save asset to Supabase.',
        });
        return;
      }

      if (event && event.eventId) {
        await supabase.from('asset_events').upsert(
          {
            event_id: String(event.eventId),
            asset_id: assetRow.asset_id,
            owner_id: req.authUser.id,
            action: String(event.action || 'Asset Registered'),
            summary: String(event.summary || 'Asset registered').slice(0, 300),
            actor_email: req.authUser.email.slice(0, 160),
            created_at: event.createdAt || nowIso,
          },
          { onConflict: 'event_id' }
        );
      }

      res.status(201).json({ asset: mapRowToAssetDto(savedRows as DbAssetRow) });
    } catch (err) {
      console.error('Unexpected insert asset error:', err);
      res.status(500).json({ error: 'Unable to persist asset.' });
    }
  });

  app.patch(
    '/api/assets/:assetId',
    requireSupabaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const supabase = createScopedDbClient(req.accessToken!);
      if (!supabase || !req.authUser) {
        res.status(503).json({ error: 'Database unavailable.' });
        return;
      }

      const assetId = String(req.params.assetId || '');
      const { updates, event } = req.body || {};
      if (!assetId || !updates) {
        res.status(400).json({ error: 'Missing asset updates.' });
        return;
      }

      try {
        const { data: existing, error: fetchErr } = await supabase
          .from('assets')
          .select('status, owner_id')
          .eq('asset_id', assetId)
          .eq('owner_id', req.authUser.id)
          .maybeSingle();

        if (fetchErr) {
          res.status(500).json({ error: 'Failed to verify existing asset state.' });
          return;
        }
        if (!existing) {
          res.status(404).json({ error: 'Asset record not found.' });
          return;
        }
        if (existing.status === 'Disposed') {
          res.status(409).json({
            error: 'Disposed assets have finalized lifecycle records and cannot be modified.',
          });
          return;
        }

        const nowIso = new Date().toISOString();
        const dbPatch: Record<string, unknown> = { updated_at: nowIso };

        if (updates.name !== undefined) dbPatch.name = String(updates.name).slice(0, 120);
        if (updates.serialNumber !== undefined)
          dbPatch.serial_number = String(updates.serialNumber).slice(0, 80);
        if (updates.category !== undefined) dbPatch.category = String(updates.category);
        if (updates.purchasePrice !== undefined)
          dbPatch.purchase_price = Number(updates.purchasePrice);
        if (updates.currentValuation !== undefined)
          dbPatch.current_valuation = Number(updates.currentValuation);
        if (updates.purchaseDate !== undefined)
          dbPatch.purchase_date = String(updates.purchaseDate);
        if (updates.warrantyExpiry !== undefined)
          dbPatch.warranty_expiry = String(updates.warrantyExpiry);
        if (updates.status !== undefined) dbPatch.status = String(updates.status);
        if (updates.department !== undefined)
          dbPatch.department = String(updates.department).slice(0, 80);
        if (updates.location !== undefined)
          dbPatch.location = String(updates.location).slice(0, 120);
        if (updates.assignedTo !== undefined)
          dbPatch.assigned_to = String(updates.assignedTo).slice(0, 100);
        if (updates.notes !== undefined) dbPatch.notes = String(updates.notes).slice(0, 1000);
        if (updates.photoUrl !== undefined) dbPatch.photo_url = String(updates.photoUrl);

        const { data: updatedRow, error: updateErr } = await supabase
          .from('assets')
          .update(dbPatch)
          .eq('asset_id', assetId)
          .eq('owner_id', req.authUser.id)
          .select('*')
          .single();

        if (updateErr) {
          console.error('Supabase update asset error:', updateErr);
          res.status(500).json({ error: 'Failed to update asset in Supabase.' });
          return;
        }

        if (event && event.eventId) {
          await supabase.from('asset_events').upsert(
            {
              event_id: String(event.eventId),
              asset_id: assetId,
              owner_id: req.authUser.id,
              action: String(event.action || 'Details Updated'),
              summary: String(event.summary || 'Updated asset').slice(0, 300),
              actor_email: req.authUser.email.slice(0, 160),
              created_at: event.createdAt || nowIso,
            },
            { onConflict: 'event_id' }
          );
        }

        res.json({ asset: mapRowToAssetDto(updatedRow as DbAssetRow) });
      } catch (err) {
        console.error('Unexpected update asset error:', err);
        res.status(500).json({ error: 'Unable to update asset.' });
      }
    }
  );

  app.delete(
    '/api/assets/:assetId',
    requireSupabaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const supabase = createScopedDbClient(req.accessToken!);
      if (!supabase || !req.authUser) {
        res.status(503).json({ error: 'Database unavailable.' });
        return;
      }

      const assetId = String(req.params.assetId || '');
      try {
        await supabase
          .from('asset_events')
          .delete()
          .eq('asset_id', assetId)
          .eq('owner_id', req.authUser.id);

        const { error } = await supabase
          .from('assets')
          .delete()
          .eq('asset_id', assetId)
          .eq('owner_id', req.authUser.id);

        if (error) {
          console.error('Supabase delete asset error:', error);
          res.status(500).json({ error: 'Failed to delete asset from Supabase.' });
          return;
        }

        res.json({ deleted: true });
      } catch (err) {
        console.error('Unexpected delete asset error:', err);
        res.status(500).json({ error: 'Unable to delete asset.' });
      }
    }
  );

  app.get(
    '/api/assets/:assetId/events',
    requireSupabaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const supabase = createScopedDbClient(req.accessToken!);
      if (!supabase || !req.authUser) {
        res.status(503).json({ error: 'Database unavailable.' });
        return;
      }

      const assetId = String(req.params.assetId || '');
      try {
        const { data, error } = await supabase
          .from('asset_events')
          .select('*')
          .eq('asset_id', assetId)
          .eq('owner_id', req.authUser.id)
          .order('created_at', { ascending: false });

        if (error) {
          res.status(500).json({ error: 'Failed to fetch asset history.' });
          return;
        }

        res.json({ events: ((data as DbEventRow[]) || []).map(mapRowToEventDto) });
      } catch {
        res.status(500).json({ error: 'Unable to query asset history.' });
      }
    }
  );

  // 4. Supabase Storage Upload Endpoint (bucket: asset-photos)
  app.post(
    '/api/storage/upload',
    requireSupabaseAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const env = getSupabaseEnv();
      const supabase = createScopedDbClient(req.accessToken!);
      if (!supabase || !req.authUser) {
        res.status(503).json({ error: 'Storage unavailable.' });
        return;
      }

      const base64Data = String(req.body?.base64Data || '');
      if (!base64Data) {
        res.status(400).json({ error: 'Missing image payload.' });
        return;
      }

      try {
        // Ensure bucket exists when service role key is present
        if (env.serviceRoleKey) {
          const adminClient = createClient(env.url, env.serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          await adminClient.storage.createBucket('asset-photos', { public: true }).catch(() => {
            // Bucket already exists
          });
        }

        const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');
        const objectPath = `${req.authUser.id}/photo_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}.jpg`;

        const { error: uploadErr } = await supabase.storage
          .from('asset-photos')
          .upload(objectPath, buffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadErr) {
          res.status(400).json({ error: uploadErr.message });
          return;
        }

        const { data: pubData } = supabase.storage
          .from('asset-photos')
          .getPublicUrl(objectPath);

        res.json({ publicUrl: pubData.publicUrl });
      } catch {
        res.status(500).json({ error: 'Photo upload to Supabase Storage failed.' });
      }
    }
  );

  // Vite Dev Server vs Production Static Bundle
  const distPath = path.join(__dirname, 'dist');
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (fs.existsSync(distPath) && process.env.npm_lifecycle_event === 'start');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Asset Track server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
