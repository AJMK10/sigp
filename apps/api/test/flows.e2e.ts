/**
 * Tests de bout en bout de l'API : base de test réinitialisée et peuplée par le jeu de démonstration,
 * puis parcours métier complets par HTTP, avec les comptes et les droits réels.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { seed, DEMO_PASSWORD } from '../src/db/seed';
import { createApp } from '../src/main';

let app: INestApplication;
let http: ReturnType<typeof request>;
const tokens: Record<string, string> = {};
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function as(user: string) {
  if (!tokens[user]) {
    const r = await request(app.getHttpServer()).post('/api/auth/login').send({ email: `${user}@sigp.ci`, password: DEMO_PASSWORD });
    expect(r.status).toBe(200);
    tokens[user] = r.body.token;
  }
  const t = tokens[user];
  const s = app.getHttpServer();
  return {
    get: (u: string) => request(s).get(`/api${u}`).set('Authorization', `Bearer ${t}`),
    post: (u: string, b: object = {}) => request(s).post(`/api${u}`).set('Authorization', `Bearer ${t}`).send(b),
    patch: (u: string, b: object) => request(s).patch(`/api${u}`).set('Authorization', `Bearer ${t}`).send(b),
  };
}
async function decideAll(type: string, id: number) {
  const actors: Record<string, string> = { COMPTABLE_MATIERES: 'kone.d', DIRECTEUR: 'konan.a', FINANCES: 'coulibaly.n', CONTROLEUR: 'diallo.f' };
  for (let i = 0; i < 6; i++) {
    const { rows } = await pool.query(`select a.*, u.email from approvals a left join users u on u.id = a.user_id where object_type = $1 and object_id = $2 and status = 'EN_COURS'`, [type, id]);
    if (!rows.length) return;
    const who = rows[0].email ? rows[0].email.split('@')[0] : actors[rows[0].role];
    const r = await (await as(who)).post(`/validations/${rows[0].id}/decision`, { approve: true });
    expect(r.status).toBe(201);
  }
}
const balanced = async (originRef: string) => {
  const { rows } = await pool.query(`select sum(l.debit)::bigint d, sum(l.credit)::bigint c from journal_lines l join journal_batches b on b.id = l.batch_id where b.origin_ref = $1`, [originRef]);
  return rows[0].d === rows[0].c && Number(rows[0].d) > 0;
};

beforeAll(async () => {
  await seed({ reset: true, scale: 0.12, quiet: true });
  app = await createApp();
  await app.init();
  http = request(app.getHttpServer());
}, 180000);
afterAll(async () => { await app?.close(); await pool.end(); });

describe('authentification et droits', () => {
  it('refuse un mauvais mot de passe et un appel sans jeton', async () => {
    expect((await http.post('/api/auth/login').send({ email: 'konan.a@sigp.ci', password: 'faux' })).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/api/biens')).status).toBe(401);
  });
  it('applique les profils : un détenteur ne consulte pas le registre', async () => {
    expect((await (await as('traore.m')).get('/biens')).status).toBe(403);
    expect((await (await as('traore.m')).get('/portail')).status).toBe(200);
    expect((await (await as('yao.k')).get('/biens?pageSize=5')).body.items).toHaveLength(5);
  });
});

describe('entrée en patrimoine', () => {
  it('crée, soumet, refuse l\'auto-validation puis immatricule après visa', async () => {
    const yao = await as('yao.k');
    const cats = (await yao.get('/referentiels/categories')).body;
    const inf = cats.find((c: { prefix: string }) => c.prefix === 'INF');
    const r = await yao.post('/receptions', { supplier: 'Test SARL', deliveryDate: '2026-10-26', lines: [{ designation: 'Portable test', categoryId: inf.id, qtyOrdered: 3, qtyDelivered: 3, qtyAccepted: 2, unitValue: 500000, reserve: '1 écran fissuré' }] });
    expect(r.status).toBe(201);
    expect((await yao.post(`/receptions/${r.body.id}/soumettre`)).status).toBe(201);
    const { rows } = await pool.query(`select id from approvals where object_type = 'RECEPTION' and object_id = $1 and status = 'EN_COURS'`, [r.body.id]);
    expect((await (await as('konan.a')).post(`/validations/${rows[0].id}/decision`, { approve: true })).status).toBe(403); // profil non désigné
    await decideAll('RECEPTION', r.body.id);
    const d = (await yao.get(`/receptions/${r.body.id}`)).body;
    expect(d.status).toBe('VALIDEE');
    expect(d.assets).toHaveLength(2);
    expect(d.assets[0].code).toMatch(/^MEF-INF-2026-\d{6}$/);
    expect(d.entryOrderNo).toMatch(/^OE-ENT01-2026-/);
    expect(await balanced(d.number)).toBe(true);
  });
  it('exige une réserve quand des articles ne sont pas conformes', async () => {
    const yao = await as('yao.k');
    const cats = (await yao.get('/referentiels/categories')).body;
    const r = await yao.post('/receptions', { supplier: 'X', deliveryDate: '2026-10-26', lines: [{ designation: 'A', categoryId: cats.find((c: { prefix: string }) => c.prefix === 'MOB').id, qtyOrdered: 2, qtyDelivered: 2, qtyAccepted: 1, unitValue: 1000 }] });
    expect(r.status).toBe(400);
  });
});

describe('mouvements', () => {
  it('affecte avec visa, visa directeur au-delà de 5 M et signature du détenteur', async () => {
    const yao = await as('yao.k');
    const { rows } = await pool.query(`select id from assets where status = 'EN_STOCK' and acquisition_value >= 650000 and not exists (select 1 from movement_items mi join movements m on m.id = mi.movement_id where mi.asset_id = assets.id and m.status in ('A_VALIDER','EN_TRANSIT')) order by acquisition_value desc limit 9`);
    const [{ id: holder }] = (await pool.query(`select id from users where email = 'kouassi.e@sigp.ci'`)).rows;
    const m = await yao.post('/mouvements', { type: 'AFFECTATION', assetIds: rows.map((r) => r.id), toHolderId: holder, reason: 'test' });
    expect(m.status).toBe(201);
    const steps = (await yao.get(`/mouvements/${m.body.id}`)).body.steps;
    expect(steps.map((s: { label: string }) => s.label)).toEqual(expect.arrayContaining(['Visa du comptable-matières', 'Signature de la décharge par le détenteur']));
    await decideAll('MOUVEMENT', m.body.id);
    const after = (await yao.get(`/mouvements/${m.body.id}`)).body;
    expect(after.status).toBe('EXECUTE');
    const a = (await pool.query(`select status, holder_id, in_service_date from assets where id = $1`, [rows[0].id])).rows[0];
    expect(a.status).toBe('EN_SERVICE');
    expect(a.holder_id).toBe(holder);
    expect(a.in_service_date).not.toBeNull();
  });
  it('refuse un bien déjà engagé dans un mouvement en cours', async () => {
    const { rows } = await pool.query(`select mi.asset_id from movement_items mi join movements m on m.id = mi.movement_id where m.status = 'A_VALIDER' limit 1`);
    const r = await (await as('yao.k')).post('/mouvements', { type: 'TRANSFERT', assetIds: [rows[0].asset_id], toLocationId: 1 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/déjà engagé/);
  });
});

describe('amortissements', () => {
  it('traite les périodes dans l\'ordre et verrouille les périodes clôturées', async () => {
    const fin = await as('coulibaly.n');
    expect((await fin.post('/amortissements/calcul', { period: '2026-12', mode: 'DEFINITIF' })).body.message).toMatch(/dans l'ordre/);
    expect((await fin.post('/amortissements/calcul', { period: '2026-03', mode: 'SIMULATION' })).status).toBe(400); // clôturée
    const sim = await fin.post('/amortissements/calcul', { period: '2026-10', mode: 'SIMULATION' });
    expect(sim.status).toBe(201);
    const def = await fin.post('/amortissements/calcul', { period: '2026-10', mode: 'DEFINITIF' });
    expect(def.status).toBe(201);
    expect(def.body.total).toBe(sim.body.total);
    expect(await balanced(def.body.number)).toBe(true);
    expect((await fin.post('/amortissements/calcul', { period: '2026-10', mode: 'DEFINITIF' })).status).toBe(400);
    expect((await (await as('yao.k')).post('/amortissements/calcul', { period: '2026-11', mode: 'SIMULATION' })).status).toBe(403);
  });
});

describe('inventaire', () => {
  it('constate, rapproche, décide et ne clôture qu\'une fois les écarts régularisés', async () => {
    const konan = await as('konan.a');
    const locs = (await konan.get('/referentiels/localisations')).body;
    const site = locs.find((l: { code: string }) => l.code === 'YAM');
    const c = await konan.post('/inventaires', { label: 'Test Yamoussoukro', type: 'CIBLE', startDate: '2026-10-26', endDate: '2026-10-30', blind: true, freezeMovements: true, zones: [{ locationId: site.id }] });
    expect(c.status).toBe(201);
    const l = await konan.post(`/inventaires/${c.body.id}/lancer`);
    expect(l.body.expected).toBeGreaterThan(0);
    const zone = (await konan.get(`/inventaires/${c.body.id}`)).body.zones[0];
    const expected = (await pool.query(`select a.id, a.code from inventory_expected e join assets a on a.id = e.asset_id where e.campaign_id = $1 order by a.id`, [c.body.id])).rows;
    // Gel des mouvements
    const frozen = await (await as('yao.k')).post('/mouvements', { type: 'TRANSFERT', assetIds: [expected[0].id], toLocationId: site.id });
    expect(frozen.body.message).toMatch(/gelés/);
    const bamba = await as('bamba.s');
    // Comptage à l'aveugle : la liste attendue n'est pas communiquée au chef d'équipe
    expect((await bamba.get(`/inventaires/${c.body.id}/zones/${zone.id}`)).body.expected).toBeNull();
    for (const a of expected.slice(1)) expect((await bamba.post(`/inventaires/${c.body.id}/constats`, { zoneId: zone.id, code: a.code, condition: 'BON' })).status).toBe(201);
    expect((await bamba.post(`/inventaires/${c.body.id}/constats`, { zoneId: zone.id, code: 'INCONNU-001', condition: 'BON' })).body.status).toBe('EXCEDENT');
    expect((await bamba.post(`/inventaires/${c.body.id}/constats`, { zoneId: zone.id, code: expected[1].code, condition: 'HORS_USAGE' })).status).toBe(400); // commentaire obligatoire
    const st = (await konan.post(`/inventaires/${c.body.id}/rapprocher`)).body;
    expect(st.gaps.byType.MANQUANT).toBe(1);
    expect(st.gaps.byType.EXCEDENT).toBe(1);
    expect((await konan.post(`/inventaires/${c.body.id}/cloturer`)).status).toBe(400);
    const gaps = (await konan.get(`/inventaires/${c.body.id}/ecarts`)).body;
    const kone = await as('kone.d');
    const missing = gaps.find((g: { type: string }) => g.type === 'MANQUANT');
    expect((await kone.post(`/inventaires/${c.body.id}/ecarts/decision`, { gapIds: [missing.id], decision: 'CONSTAT_PERTE' })).status).toBe(400); // commentaire exigé
    expect((await kone.post(`/inventaires/${c.body.id}/ecarts/decision`, { gapIds: [missing.id], decision: 'CONSTAT_PERTE', comment: 'Introuvable après enquête' })).status).toBe(201);
    expect((await kone.post(`/inventaires/${c.body.id}/ecarts/decision`, { gapIds: [gaps.find((g: { type: string }) => g.type === 'EXCEDENT').id], decision: 'BIEN_TIERS' })).status).toBe(201);
    expect((await pool.query(`select status from assets where id = $1`, [expected[0].id])).rows[0].status).toBe('MANQUANT');
    const closed = await konan.post(`/inventaires/${c.body.id}/cloturer`);
    expect(closed.status).toBe(201);
  });
});

describe('réforme et sortie', () => {
  it('passe le circuit complet et sort les biens avec une écriture équilibrée', async () => {
    const yao = await as('yao.k');
    const { rows } = await pool.query(`select a.id from assets a join categories c on c.id = a.category_id where c.prefix = 'MOB' and a.status = 'EN_SERVICE' and not exists (select 1 from movement_items mi join movements m on m.id = mi.movement_id where mi.asset_id = a.id and m.status = 'A_VALIDER') limit 3`);
    const d = await yao.post('/reformes', { title: 'Mobilier hors d\'usage', exitMode: 'VENTE', items: rows.map((r) => ({ assetId: r.id, motive: 'Vétusté' })) });
    expect(d.status).toBe(201);
    expect((await yao.post(`/reformes/${d.body.id}/soumettre`)).status).toBe(201);
    expect((await pool.query(`select status from assets where id = $1`, [rows[0].id])).rows[0].status).toBe('PROPOSE_REFORME');
    expect((await (await as('kone.d')).post(`/reformes/${d.body.id}/executer`, { exitDate: '2026-10-26' })).status).toBe(400); // pas encore décidé
    await decideAll('REFORME', d.body.id);
    const ex = await (await as('kone.d')).post(`/reformes/${d.body.id}/executer`, { exitDate: '2026-10-26', proceeds: 75000 });
    expect(ex.status).toBe(201);
    expect(ex.body.exitOrderNo).toMatch(/^OS-ENT01-2026-/);
    expect((await pool.query(`select status from assets where id = $1`, [rows[0].id])).rows[0].status).toBe('SORTI');
    const num = (await yao.get(`/reformes/${d.body.id}`)).body.number;
    expect(await balanced(num)).toBe(true);
  });
  it('rétablit le statut des biens quand le dossier est rejeté', async () => {
    const yao = await as('yao.k');
    const { rows } = await pool.query(`select id, status from assets where status = 'EN_SERVICE' and not exists (select 1 from movement_items mi join movements m on m.id = mi.movement_id where mi.asset_id = assets.id and m.status = 'A_VALIDER') limit 1`);
    const d = await yao.post('/reformes', { title: 'Test rejet', exitMode: 'DESTRUCTION', items: [{ assetId: rows[0].id, motive: 'Obsolète' }] });
    await yao.post(`/reformes/${d.body.id}/soumettre`);
    const { rows: ap } = await pool.query(`select id from approvals where object_type = 'REFORME' and object_id = $1 and status = 'EN_COURS'`, [d.body.id]);
    const ctrl = await as('diallo.f');
    expect((await ctrl.post(`/validations/${ap[0].id}/decision`, { approve: false })).status).toBe(400); // motif obligatoire
    expect((await ctrl.post(`/validations/${ap[0].id}/decision`, { approve: false, comment: 'Bien encore utilisable' })).status).toBe(201);
    expect((await pool.query(`select status from assets where id = $1`, [rows[0].id])).rows[0].status).toBe('EN_SERVICE');
  });
});

describe('journal d\'audit et états', () => {
  it('garde une chaîne d\'empreintes intacte et refuse toute modification', async () => {
    const r = await (await as('konan.a')).get('/audit/integrite');
    expect(r.body.ok).toBe(true);
    expect(r.body.count).toBeGreaterThan(20);
    await expect(pool.query(`update audit_log set action = 'X' where id = 1`)).rejects.toThrow(/ajout seul/);
    await expect(pool.query(`delete from assets where id = 1`)).rejects.toThrow(/ne se supprime pas/);
  });
  it('produit les états Excel et PDF', async () => {
    const k = await as('konan.a');
    const x = await k.get('/etats/registre.xlsx');
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toMatch(/spreadsheetml/);
    const p = await k.get('/etats/fiche/1.pdf');
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toBe('application/pdf');
  });
  it('calcule le tableau de bord', async () => {
    const d = (await (await as('konan.a')).get('/tableau-de-bord')).body;
    expect(d.grossValue).toBeGreaterThan(d.nbv);
    expect(d.activeCount).toBeGreaterThan(0);
    expect(d.history).toHaveLength(5);
  });
});
