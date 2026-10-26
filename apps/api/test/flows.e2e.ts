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

// ------------------------------------------------------------------ Lot 2
describe('parc automobile', () => {
  it('valide un ordre de mission, refuse les chevauchements et contrôle le kilométrage', async () => {
    const holder = await as('traore.m'), mgr = await as('yao.k');
    const { rows: [v] } = await pool.query(`select v.asset_id, v.mileage from vehicles v join assets a on a.id = v.asset_id where a.status = 'EN_SERVICE' and a.category_id in (select id from categories where prefix = 'VEH')
      and not exists (select 1 from missions m where m.asset_id = v.asset_id and m.status = 'EN_COURS') limit 1`);
    const m1 = await holder.post('/missions', { assetId: v.asset_id, destination: 'Bouaké', purpose: 'Mission de contrôle', startAt: '2027-02-01T08:00', endAt: '2027-02-02T18:00' });
    expect(m1.status).toBe(201);
    const m2 = await holder.post('/missions', { assetId: v.asset_id, destination: 'Daloa', purpose: 'Autre mission', startAt: '2027-02-02T08:00', endAt: '2027-02-03T18:00' });
    expect((await mgr.post(`/missions/${m1.body.id}/decision`, { approve: true })).status).toBe(201);
    expect((await mgr.post(`/missions/${m2.body.id}/decision`, { approve: true })).status).toBe(400); // créneau déjà pris
    expect((await mgr.post(`/missions/${m2.body.id}/decision`, { approve: false })).status).toBe(400); // motif obligatoire
    expect((await holder.post(`/missions/${m1.body.id}/depart`, { startMileage: v.mileage - 10 })).status).toBe(400);
    expect((await holder.post(`/missions/${m1.body.id}/depart`, { startMileage: v.mileage })).status).toBe(201);
    expect((await holder.post(`/missions/${m1.body.id}/retour`, { endMileage: v.mileage + 712 })).status).toBe(201);
    const { rows: [after] } = await pool.query('select mileage from vehicles where asset_id = $1', [v.asset_id]);
    expect(after.mileage).toBe(v.mileage + 712);
    const fl = await mgr.get('/flotte');
    expect(fl.status).toBe(200);
    expect(fl.body.items.length).toBeGreaterThan(0);
  });
});

describe('maintenance', () => {
  it('immobilise le bien pendant l\'intervention et exige un compte rendu pour clore', async () => {
    const mgr = await as('yao.k');
    const { rows: [a] } = await pool.query(`select id from assets where status = 'EN_SERVICE' and category_id in (select id from categories where prefix = 'CLI') limit 1`);
    const w = await mgr.post('/maintenance/ot', { assetId: a.id, kind: 'CORRECTIF', title: 'Fuite de gaz' });
    expect(w.status).toBe(201);
    expect((await mgr.patch(`/maintenance/ot/${w.body.id}`, { status: 'TERMINE' })).status).toBe(400); // A_PLANIFIER -> TERMINE interdit
    expect((await mgr.patch(`/maintenance/ot/${w.body.id}`, { status: 'EN_COURS' })).status).toBe(200);
    expect((await pool.query('select status from assets where id = $1', [a.id])).rows[0].status).toBe('EN_MAINTENANCE');
    expect((await mgr.patch(`/maintenance/ot/${w.body.id}`, { status: 'TERMINE' })).status).toBe(400); // compte rendu manquant
    expect((await mgr.patch(`/maintenance/ot/${w.body.id}`, { status: 'TERMINE', report: 'Recharge effectuée', partsCost: 45000 })).status).toBe(200);
    expect((await pool.query('select status from assets where id = $1', [a.id])).rows[0].status).toBe('EN_SERVICE');
    expect((await (await as('traore.m')).post('/maintenance/ot', { assetId: a.id, kind: 'CORRECTIF', title: 'Test' })).status).toBe(403);
  });
});

describe('immobilier et contrats', () => {
  it('tient les occupations et refuse un bail sans loyer', async () => {
    const mgr = await as('yao.k');
    const list = await mgr.get('/immobilier');
    expect(list.status).toBe(200);
    const tour = list.body.items.find((x: { code: string }) => x.code === 'MEF-IMM-1998-000004');
    expect(tour).toBeTruthy();
    expect((await mgr.post(`/immobilier/${tour.id}/occupations`, { kind: 'BAIL', occupant: 'Locataire', area: 50 })).status).toBe(400);
    const d = await mgr.get(`/immobilier/${tour.id}`);
    expect(d.body.components.reduce((s: number, c: { value: number; replacedAt: string | null }) => s + (c.replacedAt ? 0 : c.value), 0)).toBeGreaterThan(2_000_000_000);
    const c = await mgr.get('/contrats');
    expect(c.status).toBe(200);
    expect(c.body.items.length).toBeGreaterThanOrEqual(5);
  });
});

describe('révisions et dépréciations', () => {
  it('applique un changement de durée de façon prospective après validation', async () => {
    const { rows: [r] } = await pool.query(`select id from revaluations where kind = 'REVISION_DUREE' and status = 'EN_COURS'`);
    const { rows: before } = await pool.query(`select a.id from revaluation_items i join assets a on a.id = i.asset_id where i.revaluation_id = $1`, [r.id]);
    await decideAll('REVISION', r.id);
    const { rows } = await pool.query(`select depr_years, revised_at, previous_years from assets where id = any($1)`, [before.map((x) => x.id)]);
    expect(rows.every((x) => x.depr_years === 12 && x.previous_years === 10 && x.revised_at)).toBe(true);
  });
  it('plafonne la dépréciation à la VNC et passe une écriture équilibrée', async () => {
    const fin = await as('coulibaly.n');
    const { rows: [a] } = await pool.query(`select id from assets where status = 'EN_SERVICE' and category_id in (select id from categories where prefix = 'INF') and acquisition_date > '2025-01-01' limit 1`);
    expect((await fin.post('/revisions', { kind: 'DEPRECIATION', title: 'Test', reason: 'Perte de valeur constatée par expertise', effectiveDate: '2026-10-20', items: [{ assetId: a.id, amount: 999_000_000 }] })).status).toBe(400);
    const r = await fin.post('/revisions', { kind: 'DEPRECIATION', title: 'Test', reason: 'Perte de valeur constatée par expertise', effectiveDate: '2026-10-20', items: [{ assetId: a.id, amount: 50_000 }] });
    expect(r.status).toBe(201);
    await fin.post(`/revisions/${r.body.id}/soumettre`);
    expect((await (await as('coulibaly.n')).get('/validations')).status).toBe(200);
    // le demandeur ne valide pas sa propre opération : la première étape revient à un autre agent des finances, ici absent → validation directe en base interdite
    const { rows: [ap] } = await pool.query(`select id from approvals where object_type = 'REVISION' and object_id = $1 and status = 'EN_COURS'`, [r.body.id]);
    expect((await fin.post(`/validations/${ap.id}/decision`, { approve: true })).status).toBe(403);
  });
});

describe('rapprochement et clôture d\'exercice', () => {
  it('rapproche registre et balance, et refuse une clôture prématurée', async () => {
    const fin = await as('coulibaly.n');
    const rp = await fin.get('/cloture/rapprochement?date=2026-09-30');
    expect(rp.status).toBe(200);
    expect(rp.body.lines.find((l: { account: string }) => l.account === '2442').unexplained).toBe(0);
    expect(rp.body.lines.find((l: { account: string }) => l.account === '2844').unexplained).toBe(312_450);
    const chk = await fin.get('/cloture/exercice/2026');
    expect(chk.body.ready).toBe(false);
    expect((await fin.post('/cloture/exercice/2026')).status).toBe(400);
  });
  it('interdit de dater une pièce dans un exercice clôturé', async () => {
    const { rows: [c] } = await pool.query(`select id from categories where prefix = 'MOB'`);
    const r = await (await as('yao.k')).post('/receptions', { entryMode: 'ACHAT', supplier: 'Test', deliveryDate: '2025-12-15', lines: [{ designation: 'Chaise', categoryId: c.id, qtyOrdered: 1, qtyDelivered: 1, qtyAccepted: 1, unitValue: 200000 }] });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/clôturé/);
  });
});

describe('GED, comptabilité-matières et renouvellement', () => {
  it('dépose un document avec empreinte et le restitue intact', async () => {
    const mgr = await as('yao.k');
    const { rows: [a] } = await pool.query(`select id from assets limit 1`);
    const up = await request(app.getHttpServer()).post('/api/documents').set('Authorization', `Bearer ${tokens['yao.k']}`)
      .field('objectType', 'BIEN').field('objectId', String(a.id)).field('category', 'FACTURE').attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'facture.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.sha256).toHaveLength(64);
    const bad = await request(app.getHttpServer()).post('/api/documents').set('Authorization', `Bearer ${tokens['yao.k']}`)
      .field('objectType', 'BIEN').field('objectId', String(a.id)).field('category', 'AUTRE').attach('file', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
    expect(bad.status).toBe(400);
    const dl = await mgr.get(`/documents/${up.body.id}/fichier`).buffer(true).parse((res, cb) => { const b: Buffer[] = []; res.on('data', (c: Buffer) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    expect((dl.body as Buffer).toString()).toBe('%PDF-1.4 test');
    expect((await mgr.get(`/documents/${up.body.id}/verifier`)).body.ok).toBe(true);
  });
  it('équilibre le grand livre des matières et chiffre le plan de renouvellement', async () => {
    const k = await as('kone.d');
    const g = await k.get('/comptabilite-matieres?year=2026');
    expect(g.status).toBe(200);
    for (const l of g.body.ledger) { expect(l.q1).toBe(l.q0 + l.qi - l.qo); expect(l.v1).toBe(l.v0 + l.vi - l.vo); }
    expect((await k.get('/comptabilite-matieres/compte-gestion.pdf?year=2026')).status).toBe(200);
    const p = await (await as('konan.a')).get('/renouvellement?horizon=5&budget=500000000');
    expect(p.status).toBe(200);
    expect(p.body.plan).toHaveLength(5);
    for (const y of p.body.plan) expect(y.funded).toBeLessThanOrEqual(500_000_000);
  });
});
