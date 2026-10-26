import { AppData, Condition, LocalCount, Pack, PackAsset, PackZone, needsJustification } from './types';

/**
 * Normalise une lecture : un QR d'étiquette porte le code du bien, éventuellement dans une URL (…/b/MEF-INF-2023-000811).
 */
export function normalizeCode(raw: string): string {
  let s = raw.trim();
  const m = s.match(/[/=#]([A-Za-z0-9][A-Za-z0-9-]{2,59})\/?$/);
  if (/^https?:\/\//i.test(s) && m) s = m[1];
  return s.replace(/\s+/g, '').toUpperCase();
}

export function findZone(pack: Pack | null, zoneId: number): { zone: PackZone; blind: boolean; campaignNumber: string } | null {
  for (const c of pack?.campaigns ?? []) {
    const zone = c.zones.find((z) => z.id === zoneId);
    if (zone) return { zone, blind: c.blind, campaignNumber: c.number };
  }
  return null;
}

export type Recognition =
  | { kind: 'CONFORME'; asset: PackAsset }
  | { kind: 'AUTRE_LOCALISATION'; asset: PackAsset }
  | { kind: 'RECONNU'; asset: PackAsset }
  | { kind: 'DEJA_AILLEURS'; asset: PackAsset | null; zoneName: string }
  | { kind: 'INCONNU' };

/** Reconnaissance d'un code sans réseau, à partir du paquet téléchargé et des constats de l'appareil. */
export function recognize(data: Pick<AppData, 'pack' | 'counts'>, zoneId: number, rawCode: string): Recognition {
  const pack = data.pack;
  const code = normalizeCode(rawCode);
  const asset = pack?.assets.find((a) => a.code === code) ?? null;
  const elsewhere = data.counts.find((k) => k.code === code && k.zoneId !== zoneId && k.state !== 'REFUSE')
    ?? pack?.counted.find((k) => k.code === code && k.zoneId !== zoneId);
  if (elsewhere) return { kind: 'DEJA_AILLEURS', asset, zoneName: findZone(pack, elsewhere.zoneId)?.zone.name ?? `zone ${elsewhere.zoneId}` };
  if (!asset) return { kind: 'INCONNU' };
  const z = findZone(pack, zoneId);
  if (!z || z.blind) return { kind: 'RECONNU', asset };
  const expected = pack!.expected[String(zoneId)] ?? [];
  return expected.includes(asset.id) ? { kind: 'CONFORME', asset } : { kind: 'AUTRE_LOCALISATION', asset };
}

/** Contrôles avant enregistrement, identiques à ceux du serveur (commentaire) plus la photo exigée par la procédure. */
export function validateCount(c: { condition: Condition; comment: string; photoIds: string[] }): string | null {
  if (needsJustification(c.condition) && !c.comment.trim()) return 'Commentaire obligatoire pour un bien en mauvais état ou hors d\'usage';
  if (needsJustification(c.condition) && !c.photoIds.length) return 'Photo obligatoire pour un bien en mauvais état ou hors d\'usage';
  return null;
}

/**
 * Enregistre un constat dans la file locale. Un nouveau scan du même code dans la même zone remplace le constat
 * non encore transmis ; s'il a déjà été transmis, un nouveau constat est créé (le serveur garde le plus récent).
 */
export function upsertCount(counts: LocalCount[], next: LocalCount): LocalCount[] {
  const i = counts.findIndex((k) => k.code === next.code && k.zoneId === next.zoneId && k.state !== 'SYNCED');
  if (i >= 0) { const copy = [...counts]; copy[i] = { ...next, clientId: counts[i].clientId, photoIds: [...new Set([...counts[i].photoIds, ...next.photoIds])] }; return copy; }
  return [...counts, next];
}

export interface ZoneStats { expected: number; counted: number; conform: number; bad: number; missing: number | null; surplus: number; pending: number; refused: number; progress: number }

/** Bilan d'une zone : constats du serveur au téléchargement et constats de l'appareil, chaque code compté une fois. */
export function zoneStats(data: Pick<AppData, 'pack' | 'counts'>, zoneId: number): ZoneStats {
  const z = findZone(data.pack, zoneId);
  const byCode = new Map<string, { condition: Condition; known: boolean }>();
  for (const k of data.pack?.counted ?? []) if (k.zoneId === zoneId) byCode.set(k.code, { condition: k.condition, known: k.known });
  const local = data.counts.filter((k) => k.zoneId === zoneId && k.state !== 'REFUSE');
  for (const k of local) byCode.set(k.code, { condition: k.condition, known: k.assetId != null || (k.serverStatus != null && k.serverStatus !== 'EXCEDENT' && k.serverStatus !== 'DEJA_SIGNALE') });
  const values = [...byCode.values()];
  const recognized = values.filter((v) => v.known);
  const expected = z?.zone.expectedCount ?? 0;
  const bad = recognized.filter((v) => needsJustification(v.condition)).length;
  const missing = z && !z.blind ? Math.max(0, (data.pack!.expected[String(zoneId)] ?? []).filter((id) => {
    const a = data.pack!.assets.find((x) => x.id === id);
    return a && !byCode.has(a.code);
  }).length) : null;
  return {
    expected, counted: recognized.length, conform: recognized.length - bad, bad, missing, surplus: values.length - recognized.length,
    pending: data.counts.filter((k) => k.zoneId === zoneId && k.state === 'PENDING').length,
    refused: data.counts.filter((k) => k.zoneId === zoneId && (k.state === 'REFUSE' || k.state === 'CONFLIT')).length,
    progress: expected ? Math.min(1, recognized.length / expected) : 0,
  };
}

export function totals(data: Pick<AppData, 'pack' | 'counts'>) {
  const zones = data.pack?.campaigns.flatMap((c) => c.zones) ?? [];
  const s = zones.map((z) => zoneStats(data, z.id));
  return { zones: zones.length, expected: s.reduce((t, x) => t + x.expected, 0), counted: s.reduce((t, x) => t + x.counted, 0),
    gaps: s.reduce((t, x) => t + x.bad + x.surplus, 0), pending: data.counts.filter((k) => k.state === 'PENDING').length };
}
