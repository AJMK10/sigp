import { Platform } from 'react-native';
import type { Pack, Session } from './types';
import { AuthError, SyncApi } from './sync';

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Adresse de l'API : saisie à la première connexion (ex. https://sigp.monentite.ci/api). */
export function normalizeServer(s: string) {
  let x = s.trim().replace(/\/+$/, '');
  if (!x) return Platform.OS === 'web' ? '/api' : '';
  if (!/^https?:\/\//i.test(x) && !x.startsWith('/')) x = `https://${x}`;
  if (!/\/api$/.test(x)) x += '/api';
  return x;
}

async function call<T>(server: string, path: string, init: { method?: string; token?: string; body?: unknown; form?: FormData; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${server}${path}`, { method: init.method ?? 'GET', headers, body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined), signal: ctrl.signal });
    if (res.status === 401 && !path.startsWith('/auth/login')) throw new AuthError('Session expirée : reconnectez-vous (vos constats restent sur l\'appareil)');
    if (!res.ok) {
      let msg = `Erreur ${res.status}`;
      try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join(' ; ') : j.message ?? msg; } catch { /* corps non JSON */ }
      throw new ApiError(res.status, msg);
    }
    return (await res.json()) as T;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('Le serveur ne répond pas (délai dépassé)');
    if (e instanceof TypeError) throw new Error('Serveur injoignable : vérifiez le réseau');
    throw e;
  } finally { clearTimeout(t); }
}

export async function login(server: string, email: string, password: string): Promise<Session> {
  const r = await call<{ token: string; user: Session['user'] & { permissions: string[] } }>(server, '/auth/login', { method: 'POST', body: { email, password } });
  if (!r.user.permissions.includes('inventory.count') && !r.user.permissions.includes('inventory.manage'))
    throw new Error("Votre profil n'est pas habilité au comptage d'inventaire");
  return { token: r.token, server, user: { id: r.user.id, fullName: r.user.fullName, role: r.user.role, email: r.user.email } };
}

export const downloadPack = (s: Session) => call<Pack>(s.server, '/mobile/paquet', { token: s.token, timeoutMs: 120_000 });

export function syncApi(s: Session): SyncApi {
  return {
    sync: (body) => call(s.server, '/mobile/synchroniser', { method: 'POST', token: s.token, body, timeoutMs: 120_000 }),
    uploadPhoto: async (p) => {
      const form = new FormData();
      form.append('clientId', p.clientId);
      form.append('photoId', p.photoId);
      if (Platform.OS === 'web') form.append('file', await (await fetch(p.uri)).blob(), `${p.photoId}.jpg`);
      else form.append('file', { uri: p.uri, name: `${p.photoId}.jpg`, type: 'image/jpeg' } as unknown as Blob);
      await call(s.server, '/mobile/photos', { method: 'POST', token: s.token, form, timeoutMs: 120_000 });
    },
  };
}

export const closeZone = (s: Session, zoneId: number, signature: string) =>
  call<{ ok: boolean }>(s.server, `/mobile/zones/${zoneId}/cloturer`, { method: 'POST', token: s.token, body: { signature, pending: 0 } });
