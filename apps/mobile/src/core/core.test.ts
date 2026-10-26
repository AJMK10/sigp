import { normalizeCode, recognize, upsertCount, validateCount, zoneStats } from './inventory';
import { AuthError, synchronize, SyncApi, unsent } from './sync';
import { AppData, LocalCount, Pack, emptyData } from './types';

const pack: Pack = {
  generatedAt: '2026-10-26T08:00:00Z', user: { id: 9, fullName: 'Bamba S.' }, blindCampaigns: [],
  campaigns: [{ id: 1, number: 'INV-2026-01', label: 'Siège', blind: false, endDate: '2026-10-31', zones: [
    { id: 10, campaignId: 1, name: 'Bât. A · Salle serveurs', status: 'EN_COURS', expectedCount: 3, leader: 'Bamba S.', locations: [{ id: 5, path: 'Salle serveurs' }] },
    { id: 11, campaignId: 1, name: 'Bât. A · 2e étage', status: 'A_FAIRE', expectedCount: 1, leader: 'Bamba S.', locations: [] },
  ] }],
  assets: [
    { id: 1, code: 'MEF-INF-2023-000811', designation: 'Serveur Dell', category: 'Informatique', condition: 'BON', serial: null, holder: null, lastSeenAt: null, expectedLocation: 'Salle serveurs' },
    { id: 2, code: 'MEF-INF-2023-000812', designation: 'Serveur Dell', category: 'Informatique', condition: 'BON', serial: null, holder: null, lastSeenAt: null, expectedLocation: 'Salle serveurs' },
    { id: 3, code: 'MEF-INF-2020-000455', designation: 'Baie Synology', category: 'Informatique', condition: 'BON', serial: null, holder: null, lastSeenAt: null, expectedLocation: 'Salle serveurs' },
    { id: 4, code: 'MEF-MOB-2019-000100', designation: 'Bureau', category: 'Mobilier', condition: 'BON', serial: null, holder: null, lastSeenAt: null, expectedLocation: '2e étage' },
  ],
  expected: { '10': [1, 2, 3], '11': [4] },
  counted: [{ zoneId: 10, code: 'MEF-INF-2023-000812', condition: 'BON', countedAt: '2026-10-25T10:00:00Z', clientId: null, known: true }],
};
let n = 0;
const count = (p: Partial<LocalCount>): LocalCount => ({ clientId: `id-${++n}`, campaignId: 1, zoneId: 10, code: 'MEF-INF-2023-000811', condition: 'BON', locationId: null, comment: '',
  countedAt: '2026-10-26T09:00:00Z', lat: null, lng: null, assetId: 1, designation: 'Serveur Dell', state: 'PENDING', photoIds: [], ...p });
const base = (): AppData => ({ ...emptyData('dev-1', '/api'), pack });

describe('reconnaissance hors ligne', () => {
  it('normalise les lectures et extrait le code d\'une URL d\'étiquette', () => {
    expect(normalizeCode(' mef-inf-2023-000811 ')).toBe('MEF-INF-2023-000811');
    expect(normalizeCode('https://sigp.ci/b/MEF-INF-2023-000811')).toBe('MEF-INF-2023-000811');
  });
  it('distingue conforme, autre localisation, déjà constaté ailleurs et inconnu', () => {
    const d = base();
    expect(recognize(d, 10, 'MEF-INF-2023-000811').kind).toBe('CONFORME');
    expect(recognize(d, 10, 'MEF-MOB-2019-000100').kind).toBe('AUTRE_LOCALISATION');
    expect(recognize(d, 11, 'MEF-INF-2023-000812').kind).toBe('DEJA_AILLEURS');
    expect(recognize(d, 10, '0048-77120').kind).toBe('INCONNU');
    const blind = { ...d, pack: { ...pack, campaigns: [{ ...pack.campaigns[0], blind: true }], expected: {} } };
    expect(recognize(blind, 10, 'MEF-MOB-2019-000100').kind).toBe('RECONNU');
  });
});

describe('constats', () => {
  it('exige commentaire et photo pour un mauvais état', () => {
    expect(validateCount({ condition: 'MAUVAIS', comment: '', photoIds: [] })).toMatch(/Commentaire/);
    expect(validateCount({ condition: 'MAUVAIS', comment: 'HS', photoIds: [] })).toMatch(/Photo/);
    expect(validateCount({ condition: 'BON', comment: '', photoIds: [] })).toBeNull();
  });
  it('remplace un constat non transmis, en crée un nouveau après transmission', () => {
    const a = count({});
    let list = upsertCount([], a);
    list = upsertCount(list, count({ condition: 'MOYEN' }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ clientId: a.clientId, condition: 'MOYEN' });
    list = upsertCount([{ ...list[0], state: 'SYNCED' }], count({ condition: 'BON' }));
    expect(list).toHaveLength(2);
  });
  it('fait le bilan d\'une zone en comptant chaque bien une fois', () => {
    const d = { ...base(), counts: [count({}), count({ code: 'MEF-INF-2023-000812' }), count({ code: '0048-77120', assetId: null, designation: '' }), count({ code: 'MEF-INF-2020-000455', assetId: 3, condition: 'MAUVAIS', comment: 'HS' })] };
    const s = zoneStats(d, 10);
    expect(s).toMatchObject({ expected: 3, counted: 3, conform: 2, bad: 1, missing: 0, surplus: 1, pending: 4 });
  });
});

describe('synchronisation', () => {
  const api = (over: Partial<SyncApi> = {}): SyncApi & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return {
      calls,
      sync: async (b) => { calls.push(b.counts); return { results: (b.counts as { clientId: string; code: string }[]).map((k) => (k.code === 'REFUS' ? { clientId: k.clientId, ok: false, status: 'REFUSE', message: 'Zone déjà clôturée', retry: false } : { clientId: k.clientId, ok: true, status: 'RECONNU' })) }; },
      uploadPhoto: async () => { calls.push(['photo']); },
      ...over,
    };
  };
  it('transmet, garde les refus avec leur motif et envoie les photos des constats acceptés', async () => {
    const k1 = count({ photoIds: ['ph-1'] }), k2 = count({ code: 'REFUS', photoIds: ['ph-2'] });
    const d = { ...base(), counts: [k1, k2], photos: [{ photoId: 'ph-1', clientId: k1.clientId, uri: 'file://1', state: 'PENDING' as const }, { photoId: 'ph-2', clientId: k2.clientId, uri: 'file://2', state: 'PENDING' as const }] };
    const a = api();
    const { data, report } = await synchronize(d, a, () => 'T');
    expect(report).toMatchObject({ sent: 2, accepted: 1, refused: 1, photos: 1 });
    expect(data.counts.map((k) => k.state)).toEqual(['SYNCED', 'REFUSE']);
    expect(data.counts[1].message).toBe('Zone déjà clôturée');
    expect(data.photos.map((p) => p.state)).toEqual(['SENT', 'PENDING']);
    expect(unsent(data)).toBe(1);
  });
  it('conserve la file intacte après une coupure ou une session expirée', async () => {
    const d = { ...base(), counts: [count({}), count({ code: 'MEF-INF-2020-000455' })] };
    const cut = await synchronize(d, api({ sync: async () => { throw new TypeError('Network request failed'); } }));
    expect(cut.report.error).toMatch(/Network/);
    expect(cut.data.counts.every((k) => k.state === 'PENDING')).toBe(true);
    const exp = await synchronize(d, api({ sync: async () => { throw new AuthError('Session expirée'); } }));
    expect(exp.report.authExpired).toBe(true);
    expect(unsent(exp.data)).toBe(2);
  });
  it('envoie par lots de 200', async () => {
    const d = { ...base(), counts: Array.from({ length: 450 }, (_, i) => count({ code: `C-${i}` })) };
    const a = api();
    await synchronize(d, a);
    expect(a.calls.map((c) => c.length)).toEqual([200, 200, 50]);
  });
});
