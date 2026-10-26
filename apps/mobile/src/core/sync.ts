import { AppData, LocalCount } from './types';

/** Interface minimale du serveur, injectée pour tester la synchronisation sans réseau. */
export interface SyncApi {
  sync(body: { deviceId: string; counts: unknown[] }): Promise<{ results: { clientId: string; ok: boolean; status: string; message?: string; retry?: boolean; designation?: string }[] }>;
  uploadPhoto(p: { clientId: string; photoId: string; uri: string }): Promise<void>;
}
export class AuthError extends Error {}
export const BATCH = 200;

export interface SyncReport { sent: number; accepted: number; refused: number; photos: number; error: string | null; authExpired: boolean }

/**
 * Synchronisation : constats en attente par lots, puis photos des constats acceptés.
 * Un lot interrompu (coupure réseau) est renvoyé tel quel : l'identifiant de chaque constat évite tout doublon côté serveur.
 * Les constats refusés (règle métier) restent sur l'appareil, avec le motif, pour correction.
 */
export async function synchronize(data: AppData, api: SyncApi, now = () => new Date().toISOString()): Promise<{ data: AppData; report: SyncReport }> {
  let counts = [...data.counts];
  let photos = [...data.photos];
  const report: SyncReport = { sent: 0, accepted: 0, refused: 0, photos: 0, error: null, authExpired: false };
  const pending = counts.filter((k) => k.state === 'PENDING');
  try {
    for (let i = 0; i < pending.length; i += BATCH) {
      const lot = pending.slice(i, i + BATCH);
      const res = await api.sync({ deviceId: data.deviceId, counts: lot.map(toWire) });
      report.sent += lot.length;
      const byId = new Map(res.results.map((r) => [r.clientId, r]));
      counts = counts.map((k) => {
        const r = byId.get(k.clientId);
        if (!r) return k;
        if (r.ok) { report.accepted++; return { ...k, state: 'SYNCED', serverStatus: r.status, message: undefined, designation: k.designation || r.designation || k.designation }; }
        if (r.retry) return { ...k, message: r.message };
        report.refused++;
        return { ...k, state: r.status === 'CONFLIT' ? 'CONFLIT' : 'REFUSE', serverStatus: r.status, message: r.message };
      });
    }
    const synced = new Set(counts.filter((k) => k.state === 'SYNCED').map((k) => k.clientId));
    for (const p of photos.filter((x) => x.state === 'PENDING' && synced.has(x.clientId))) {
      await api.uploadPhoto(p);
      photos = photos.map((x) => (x.photoId === p.photoId ? { ...x, state: 'SENT' } : x));
      report.photos++;
    }
  } catch (e) {
    if (e instanceof AuthError) report.authExpired = true;
    report.error = e instanceof Error ? e.message : String(e);
  }
  return { data: { ...data, counts, photos, lastSyncAt: report.sent || report.photos ? now() : data.lastSyncAt }, report };
}

function toWire(k: LocalCount) {
  return { clientId: k.clientId, campaignId: k.campaignId, zoneId: k.zoneId, code: k.code, condition: k.condition, locationId: k.locationId ?? null,
    comment: k.comment.trim() || undefined, countedAt: k.countedAt, lat: k.lat, lng: k.lng };
}

/** Un constat refusé corrigé repart avec un nouvel identifiant (le précédent a été refusé, pas enregistré). */
export function resubmit(k: LocalCount, newId: string, patch: Partial<LocalCount>): LocalCount {
  return { ...k, ...patch, clientId: newId, state: 'PENDING', serverStatus: undefined, message: undefined };
}

/** Données encore à transmettre : la déconnexion ne doit pas les perdre. */
export const unsent = (d: AppData) => d.counts.filter((k) => k.state === 'PENDING').length + d.photos.filter((p) => p.state === 'PENDING').length;
