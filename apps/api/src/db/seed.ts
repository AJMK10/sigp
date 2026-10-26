/**
 * Jeu de données de démonstration.
 * 1) Référentiels, utilisateurs et biens historiques insérés directement (reprise de l'existant).
 * 2) Les opérations de 2026 passent par les vrais services de l'application (circuits, écritures, audit),
 *    pour que la démonstration montre des données produites par les règles métier.
 * Usage : npm run db:seed  (base vide, migrations appliquées)  — ou SEED_RESET=1 pour repartir de zéro.
 */
import 'dotenv/config';
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { NestFactory } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { createDb, createPool } from './client';
import { runMigrations } from './migrate';
import * as s from './schema';
import type { Ctx } from '../common/context';
import type { Role } from '../common/permissions';

export const DEMO_PASSWORD = 'Sigp2026!';

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function seed(opts: { url?: string; reset?: boolean; scale?: number; quiet?: boolean } = {}) {
  const log = (...a: unknown[]) => { if (!opts.quiet) console.log(...a); };
  const url = opts.url ?? process.env.DATABASE_URL;
  if (opts.reset) {
    const p = createPool(url);
    await p.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
    await p.end();
  }
  await runMigrations(url);
  const pool = createPool(url);
  const db = createDb(pool);
  const [{ n }] = (await pool.query('select count(*)::int as n from entities')).rows;
  if (n > 0) { log('Base déjà initialisée : rien à faire (SEED_RESET=1 pour repartir de zéro).'); await pool.end(); return; }
  const R = rng(20261026);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const between = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));
  const scale = opts.scale ?? 1;

  // ---------- Entité, structures, localisations ----------
  const [ent] = await db.insert(s.entities).values({ code: 'MEF', shortCode: 'ENT01', name: 'Administration de démonstration' }).returning();
  const E = ent.id;
  const ou = async (code: string, name: string, parentId: number | null = null) => (await db.insert(s.orgUnits).values({ entityId: E, code, name, parentId }).returning())[0];
  const dg = await ou('DG', 'Direction générale');
  const daf = await ou('DAF', 'Direction administrative et financière', dg.id);
  const sPat = await ou('DAF-PAT', 'Service du patrimoine', daf.id);
  const sCpt = await ou('DAF-CPT', 'Service de la comptabilité', daf.id);
  const dsi = await ou('DSI', "Direction des systèmes d'information", dg.id);
  const log2 = await ou('LOG', 'Logistique et moyens généraux', daf.id);
  const courrier = await ou('COUR', 'Service du courrier', log2.id);
  const drs = [await ou('DR-YAM', 'Direction régionale de Yamoussoukro', dg.id), await ou('DR-BKE', 'Direction régionale de Bouaké', dg.id),
    await ou('DR-SPD', 'Antenne de San-Pédro', dg.id), await ou('DR-KHG', 'Antenne de Korhogo', dg.id)];
  const units = [dg, daf, sPat, sCpt, dsi, log2, courrier, ...drs];

  const loc = async (kind: 'SITE' | 'BATIMENT' | 'NIVEAU' | 'LOCAL', code: string, name: string, parentId: number | null = null) =>
    (await db.insert(s.locations).values({ entityId: E, kind, code, name, parentId }).returning())[0];
  const abj = await loc('SITE', 'ABJ', 'Abidjan siège (Plateau)');
  const tb = await loc('BATIMENT', 'ABJ-TB', 'Tour administrative B', abj.id);
  const offices: (typeof s.locations.$inferSelect)[] = [];
  const rdc = await loc('NIVEAU', 'ABJ-TB-00', 'Rez-de-chaussée', tb.id);
  const accueil = await loc('LOCAL', 'ABJ-TB-00-01', 'Accueil', rdc.id); offices.push(accueil);
  const lcour = await loc('LOCAL', 'ABJ-TB-00-04', 'Bureau 04 · courrier', rdc.id); offices.push(lcour);
  for (const lvl of [1, 2, 3]) {
    const nv = await loc('NIVEAU', `ABJ-TB-0${lvl}`, `${lvl === 1 ? '1er' : lvl + 'e'} étage`, tb.id);
    for (let i = 1; i <= (lvl === 3 ? 10 : 6); i++) offices.push(await loc('LOCAL', `ABJ-TB-0${lvl}-${lvl}${String(i).padStart(2, '0')}`, `Bureau ${lvl}${String(i).padStart(2, '0')}`, nv.id));
  }
  const ba = await loc('BATIMENT', 'ABJ-BA', 'Bâtiment A', abj.id);
  const servers = await loc('LOCAL', 'ABJ-BA-SS', 'Salle serveurs', ba.id);
  const servers2 = await loc('LOCAL', 'ABJ-BA-SS2', 'Salle serveurs 2', ba.id);
  const store = await loc('LOCAL', 'ABJ-BA-MAG', 'Magasin central', ba.id);
  const meeting = await loc('LOCAL', 'ABJ-BA-SR3', 'Salle de réunion 3', ba.id);
  const parking = await loc('LOCAL', 'ABJ-PK', 'Parc automobile', abj.id);
  offices.push(meeting);
  const regional: { site: typeof abj; offices: (typeof s.locations.$inferSelect)[]; unit: typeof dg }[] = [];
  for (const [code, name, bname, n, unit] of [['COC', 'Abidjan annexe (Cocody)', 'Bâtiment principal', 6, daf], ['YAM', 'Yamoussoukro', 'Direction régionale', 8, drs[0]],
    ['BKE', 'Bouaké', 'Direction régionale', 6, drs[1]], ['SPD', 'San-Pédro', 'Antenne portuaire', 4, drs[2]], ['KHG', 'Korhogo', 'Antenne régionale', 4, drs[3]]] as const) {
    const site = await loc('SITE', code, name);
    const b = await loc('BATIMENT', `${code}-B1`, bname, site.id);
    const os: (typeof s.locations.$inferSelect)[] = [];
    for (let i = 1; i <= n; i++) os.push(await loc('LOCAL', `${code}-B1-${String(i).padStart(2, '0')}`, `Bureau ${String(i).padStart(2, '0')}`, b.id));
    regional.push({ site, offices: os, unit });
  }

  // ---------- Utilisateurs ----------
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = async (email: string, fullName: string, role: Role, title: string, orgUnitId: number) =>
    (await db.insert(s.users).values({ entityId: E, email, fullName, role, title, orgUnitId, passwordHash: hash }).returning())[0];
  const U = {
    admin: await user('admin@sigp.ci', 'Administrateur SIGP', 'ADMIN', 'Administrateur fonctionnel', dsi.id),
    konan: await user('konan.a@sigp.ci', 'Konan A.', 'DIRECTEUR', 'Directeur du patrimoine', daf.id),
    nguessan: await user('nguessan.b@sigp.ci', "N'Guessan B.", 'DIRECTEUR', 'Directeur administratif et financier', daf.id),
    yao: await user('yao.k@sigp.ci', 'Yao K.', 'GESTIONNAIRE', 'Gestionnaire du patrimoine', sPat.id),
    ouattara: await user('ouattara.i@sigp.ci', 'Ouattara I.', 'GESTIONNAIRE', 'Expert technique', dsi.id),
    kone: await user('kone.d@sigp.ci', 'Koné D.', 'COMPTABLE_MATIERES', 'Comptable-matières', sCpt.id),
    coulibaly: await user('coulibaly.n@sigp.ci', 'Coulibaly N.', 'FINANCES', 'Direction financière', daf.id),
    diallo: await user('diallo.f@sigp.ci', 'Diallo F.', 'CONTROLEUR', 'Contrôleur financier', daf.id),
    bamba: await user('bamba.s@sigp.ci', 'Bamba S.', 'CHEF_EQUIPE', "Chef d'équipe d'inventaire", log2.id),
    traore: await user('traore.m@sigp.ci', 'Traoré M.', 'DETENTEUR', 'Chef du service informatique', dsi.id),
    kouassi: await user('kouassi.e@sigp.ci', 'Kouassi E.', 'DETENTEUR', 'Agent du courrier', courrier.id),
  };
  const first = ['Adjoua', 'Aya', 'Brou', 'Cissé', 'Dosso', 'Fofana', 'Gnagne', 'Kacou', 'Kanga', 'Kobenan', 'Koffi', 'Konaté', 'Kouadio', 'Kouamé', 'Lago', 'Méité', 'Sanogo', 'Soro', 'Touré', 'Zadi'];
  const holders = [U.traore, U.kouassi];
  for (let i = 0; i < 38; i++) holders.push(await user(`agent${i + 1}@sigp.ci`, `${first[i % first.length]} ${String.fromCharCode(65 + (i * 7) % 26)}.`, 'DETENTEUR', pick(['Chargé d\'études', 'Assistant', 'Comptable', 'Chef de bureau', 'Technicien', 'Secrétaire']), pick(units).id));

  // ---------- Nomenclature (plan SYSCOHADA révisé) ----------
  const cat = async (code: string, label: string, parentId: number | null, o: Partial<typeof s.categories.$inferInsert> = {}) =>
    (await db.insert(s.categories).values({ entityId: E, code, label, parentId, ...o }).returning())[0];
  const c2 = await cat('2', 'Immobilisations', null, { method: 'NON_AMORTISSABLE', durationYears: 0 });
  const c21 = await cat('21', 'Immobilisations incorporelles', c2.id);
  const cLog = await cat('2130', 'Logiciels', c21.id, { prefix: 'LOG', assetAccount: '2130', deprAccount: '2813', expenseAccount: '6812', method: 'LINEAIRE', durationYears: 3, threshold: 500_000 });
  const c22 = await cat('22', 'Terrains', c2.id, { method: 'NON_AMORTISSABLE', durationYears: 0 });
  const cTer = await cat('2210', 'Terrains bâtis et nus', c22.id, { prefix: 'TER', assetAccount: '2210', method: 'NON_AMORTISSABLE', durationYears: 0 });
  const c23 = await cat('23', 'Bâtiments, installations techniques et agencements', c2.id);
  const cImm = await cat('2311', 'Bâtiments administratifs', c23.id, { prefix: 'IMM', assetAccount: '2311', deprAccount: '2831', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 25 });
  const cCli = await cat('2341', 'Installations techniques (climatisation)', c23.id, { prefix: 'CLI', assetAccount: '2341', deprAccount: '2834', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 8, threshold: 300_000 });
  const c24 = await cat('24', 'Matériel, mobilier et actifs biologiques', c2.id);
  const cOut = await cat('2411', 'Matériel et outillage (groupes électrogènes)', c24.id, { prefix: 'GEL', assetAccount: '2411', deprAccount: '2841', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 10, threshold: 300_000 });
  const c244 = await cat('244', 'Matériel et mobilier', c24.id);
  const cBur = await cat('2441', 'Matériel de bureau', c244.id, { prefix: 'BUR', assetAccount: '2441', deprAccount: '2844', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 5, threshold: 300_000 });
  const cInf = await cat('2442', 'Matériel informatique', c244.id, { prefix: 'INF', assetAccount: '2442', deprAccount: '2844', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 4, threshold: 300_000 });
  const cTel = await cat('2443', 'Matériel bureautique et téléphonie', c244.id, { prefix: 'TEL', assetAccount: '2443', deprAccount: '2844', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 5, threshold: 300_000 });
  const cMob = await cat('2444', 'Mobilier de bureau', c244.id, { prefix: 'MOB', assetAccount: '2444', deprAccount: '2844', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 10, threshold: 150_000 });
  const c245 = await cat('245', 'Matériel de transport', c24.id);
  const cVeh = await cat('2451', 'Véhicules de service', c245.id, { prefix: 'VEH', assetAccount: '2451', deprAccount: '2845', expenseAccount: '6813', method: 'LINEAIRE', durationYears: 5 });
  const cMot = await cat('2452', 'Motocyclettes', c245.id, { prefix: 'MOT', assetAccount: '2452', deprAccount: '2845', expenseAccount: '6813', method: 'DEGRESSIF', durationYears: 4 });
  void cTer;

  // ---------- Biens historiques (reprise de l'existant) ----------
  const seq = new Map<string, number>();
  const codeOf = (prefix: string, year: number) => { const k = `${prefix}-${year}`; const v = (seq.get(k) ?? 0) + 1; seq.set(k, v); return `MEF-${prefix}-${year}-${String(v).padStart(6, '0')}`; };
  type NewAsset = typeof s.assets.$inferInsert;
  const batch: NewAsset[] = [];
  const models: [typeof cInf, string[], [number, number], number][] = [
    [cInf, ['Ordinateur portable HP ProBook 450', 'Ordinateur portable Lenovo ThinkPad E14', 'Ordinateur de bureau Dell OptiPlex 7090', 'Écran Dell 24 pouces P2423', 'Imprimante laser HP LaserJet M404', 'Onduleur APC 1500 VA', 'Commutateur réseau Cisco 24 ports'], [320_000, 1_100_000], 900],
    [cMob, ['Bureau direction 180 cm', 'Bureau opérateur 140 cm', 'Fauteuil de bureau ergonomique', 'Armoire métallique 2 portes', 'Table de réunion 10 places', 'Caisson mobile 3 tiroirs', 'Rayonnage métallique'], [160_000, 950_000], 900],
    [cBur, ['Photocopieur Canon imageRUNNER', 'Destructeur de documents', 'Coffre-fort ignifugé', 'Vidéoprojecteur Epson EB-W51', 'Massicot professionnel'], [320_000, 4_800_000], 160],
    [cTel, ['Téléphone IP Yealink T54W', 'Autocommutateur IP', 'Visioconférence Logitech Rally', 'Smartphone Samsung Galaxy A54'], [310_000, 6_500_000], 200],
    [cCli, ['Climatiseur split 18 000 BTU', 'Climatiseur split 24 000 BTU', 'Armoire de climatisation 5 CV'], [380_000, 2_600_000], 260],
    [cOut, ['Groupe électrogène 250 kVA', 'Groupe électrogène 60 kVA', 'Pompe de surpression'], [4_500_000, 48_000_000], 14],
    [cVeh, ['Toyota Hilux 2.4 D double cabine', 'Toyota Land Cruiser 4.5 V8', 'Hyundai Accent', 'Mitsubishi L200', 'Toyota Hiace 15 places'], [14_000_000, 62_000_000], 46],
    [cMot, ['Moto Yamaha AG 125', 'Moto Honda XR 150'], [900_000, 1_800_000], 20],
    [cLog, ['Licence progiciel de gestion comptable', 'Licence suite bureautique (lot)', 'Logiciel de gestion du courrier'], [800_000, 24_000_000], 12],
  ];
  const allOffices = [...offices, ...regional.flatMap((r) => r.offices)];
  const unitForLoc = (locId: number) => regional.find((r) => r.offices.some((o) => o.id === locId))?.unit.id ?? pick([dg, daf, sPat, sCpt, dsi, log2]).id;
  for (const [c, names, [lo, hi], count] of models) {
    for (let i = 0; i < Math.round(count * scale); i++) {
      const year = between(2015, 2025);
      const month = between(1, 12), day = between(1, 28);
      const acq = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const val = Math.round((lo + R() * (hi - lo)) / 5000) * 5000;
      const isVeh = c.id === cVeh.id || c.id === cMot.id;
      const location = isVeh ? parking : c.id === cOut.id ? pick([ba, ...regional.map((r) => r.site)]) as typeof parking : pick(allOffices);
      const r = R();
      const status = r < 0.025 ? 'EN_MAINTENANCE' : r < 0.04 ? 'EN_STOCK' : r < 0.045 ? 'MANQUANT' : 'EN_SERVICE';
      const holder = (c.id === cInf.id || c.id === cTel.id) && R() < 0.55 ? pick(holders).id : isVeh && R() < 0.5 ? pick(holders).id : null;
      const age = 2026 - year;
      batch.push({
        entityId: E, code: codeOf(c.prefix!, year), designation: pick(names), categoryId: c.id, status, condition: age > 8 ? pick(['MOYEN', 'MAUVAIS', 'BON']) : age > 4 ? pick(['BON', 'MOYEN']) : 'BON',
        serialNumber: c.id === cInf.id || c.id === cTel.id ? `SN${Math.floor(R() * 1e9).toString(36).toUpperCase()}` : null, entryMode: year < 2024 ? 'REPRISE' : 'ACHAT',
        acquisitionDate: acq, inServiceDate: status === 'EN_STOCK' ? null : acq, acquisitionValue: val, deprMethod: c.method, deprYears: c.durationYears,
        locationId: location.id, orgUnitId: status === 'EN_STOCK' ? null : unitForLoc(location.id), holderId: status === 'EN_STOCK' ? null : holder,
        labelStatus: year < 2025 ? 'CONTROLEE' : pick(['CONTROLEE', 'POSEE']), supplier: pick(['Sotra Équipements', 'Bureau Vallée CI', 'Inova Informatique', 'CFAO Motors', 'Mobilier Pro', 'Groupe Énergie Services']),
        warrantyEnd: c.id === cInf.id && year >= 2023 ? `${year + 3}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
        createdAt: new Date(acq),
      });
    }
  }
  // Biens nommés (cohérents avec la maquette)
  batch.push({ entityId: E, code: 'MEF-INF-2023-000811', designation: 'Serveur Dell PowerEdge R650', categoryId: cInf.id, status: 'EN_MAINTENANCE', condition: 'MOYEN', serialNumber: 'CN-7XK2Q93',
    brand: 'Dell', model: 'PowerEdge R650', entryMode: 'ACHAT', acquisitionDate: '2023-03-13', inServiceDate: '2023-03-13', acquisitionValue: 12_400_000, deprMethod: 'LINEAIRE', deprYears: 5,
    locationId: servers.id, orgUnitId: dsi.id, holderId: null, labelStatus: 'CONTROLEE', supplier: 'Inova Informatique', invoiceRef: 'F-23-0412', warrantyEnd: '2026-06-30' });
  batch.push({ entityId: E, code: 'MEF-INF-2023-000812', designation: 'Serveur Dell PowerEdge R650', categoryId: cInf.id, status: 'EN_SERVICE', condition: 'BON', serialNumber: 'CN-7XK2Q94',
    brand: 'Dell', model: 'PowerEdge R650', entryMode: 'ACHAT', acquisitionDate: '2023-03-13', inServiceDate: '2023-03-13', acquisitionValue: 12_400_000, deprMethod: 'LINEAIRE', deprYears: 5,
    locationId: servers.id, orgUnitId: dsi.id, labelStatus: 'CONTROLEE', supplier: 'Inova Informatique', invoiceRef: 'F-23-0412', warrantyEnd: '2026-06-30' });
  batch.push({ entityId: E, code: 'MEF-IMM-1998-000004', designation: 'Tour administrative B', categoryId: cImm.id, status: 'EN_SERVICE', condition: 'BON', entryMode: 'REPRISE',
    acquisitionDate: '1998-01-01', inServiceDate: '1998-01-01', acquisitionValue: 2_200_000_000, deprMethod: 'LINEAIRE', deprYears: 50, locationId: tb.id, orgUnitId: dg.id, labelStatus: 'CONTROLEE' });
  batch.push({ entityId: E, code: 'MEF-TER-1998-000001', designation: 'Terrain de la Tour B (2 800 m²)', categoryId: cTer.id, status: 'EN_SERVICE', condition: 'BON', entryMode: 'REPRISE',
    acquisitionDate: '1998-01-01', inServiceDate: '1998-01-01', acquisitionValue: 1_420_000_000, deprMethod: 'NON_AMORTISSABLE', deprYears: 0, locationId: abj.id, orgUnitId: dg.id, labelStatus: 'CONTROLEE' });
  batch.push({ entityId: E, code: 'MEF-IMM-2004-000011', designation: 'Direction régionale de Yamoussoukro', categoryId: cImm.id, status: 'EN_SERVICE', condition: 'BON', entryMode: 'REPRISE',
    acquisitionDate: '2004-06-01', inServiceDate: '2004-06-01', acquisitionValue: 520_000_000, deprMethod: 'LINEAIRE', deprYears: 40, locationId: regional[1].site.id, orgUnitId: drs[0].id, labelStatus: 'CONTROLEE' });
  // Anomalies volontaires : biens en service sans date de mise en service (à corriger avant les dotations)
  for (let i = 0; i < 4; i++) batch.push({ entityId: E, code: codeOf('MOB', 2025), designation: 'Bureau opérateur 140 cm', categoryId: cMob.id, status: 'EN_SERVICE', entryMode: 'ACHAT',
    acquisitionDate: '2025-11-12', inServiceDate: null, acquisitionValue: 285_000, deprMethod: 'LINEAIRE', deprYears: 10, locationId: pick(offices).id, orgUnitId: daf.id, labelStatus: 'POSEE' });
  for (let i = 0; i < batch.length; i += 500) await db.insert(s.assets).values(batch.slice(i, i + 500));
  // Séquences de codification alignées sur les codes repris (811, 812 réservés)
  seq.set('INF-2023', Math.max(seq.get('INF-2023') ?? 0, 812));
  for (const [k, v] of seq) { const [prefix, y] = k.split('-'); await db.insert(s.sequences).values({ entityId: E, key: `BIEN-${prefix}`, year: Number(y), value: v }).onConflictDoUpdate({ target: [s.sequences.entityId, s.sequences.key, s.sequences.year], set: { value: v } }); }
  await pool.query(`insert into asset_events (asset_id, type, summary, at) select id, 'ENTREE', 'Repris au registre (bilan d''ouverture)', acquisition_date::timestamptz from assets`);
  await pool.query(`update assets set last_seen_at = timestamptz '2025-11-21 10:00:00+00' + (id % 12) * interval '1 day' where label_status = 'CONTROLEE' and acquisition_date < '2025-11-01'`);
  log(`Biens repris : ${batch.length}`);

  // ---------- Opérations 2026 par les services de l'application ----------
  const { AppModule } = await import('../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.init();
  const ctx = (u: typeof U.yao): Ctx => ({ user: { id: u.id, entityId: E, role: u.role as Role, fullName: u.fullName, email: u.email }, ip: 'seed' });
  const { ReceptionsController } = await import('../modules/receptions/receptions.controller');
  const { WorkflowService } = await import('../modules/workflow/workflow.service');
  const { MovementsController } = await import('../modules/movements/movements.controller');
  const { DepreciationController } = await import('../modules/depreciation/depreciation.controller');
  const { DisposalsController } = await import('../modules/disposals/disposals.controller');
  const { InventoryController } = await import('../modules/inventory/inventory.controller');
  const { LabelsController } = await import('../modules/assets/assets.controller');
  const { PortalController } = await import('../modules/portal/portal.controller');
  const { JournalController } = await import('../modules/journal/journal.controller');
  const rec = app.get(ReceptionsController), wf = app.get(WorkflowService), mv = app.get(MovementsController), dep = app.get(DepreciationController);
  const disp = app.get(DisposalsController), inv = app.get(InventoryController), labels = app.get(LabelsController), portal = app.get(PortalController), jr = app.get(JournalController);
  const approveAll = async (type: string, id: number, upTo = 99) => {
    for (let i = 0; i < upTo; i++) {
      const [a] = await db.select().from(s.approvals).where(sql`${s.approvals.objectType} = ${type} and ${s.approvals.objectId} = ${id} and ${s.approvals.status} = 'EN_COURS'`);
      if (!a) return;
      const actor = a.userId ? Object.values(U).concat(holders).find((u) => u.id === a.userId)! : ({ COMPTABLE_MATIERES: U.kone, DIRECTEUR: U.konan, FINANCES: U.coulibaly, CONTROLEUR: U.diallo } as Record<string, typeof U.yao>)[a.role!];
      await wf.decide(ctx(actor), a.id, true, 'Conforme');
    }
  };

  // Dotations définitives de janvier à septembre 2026, puis simulation d'octobre
  for (let m = 1; m <= 9; m++) {
    await dep.run(ctx(U.coulibaly), { period: `2026-${String(m).padStart(2, '0')}`, mode: 'DEFINITIF' });
    if (m <= 8) await dep.closePeriod(ctx(U.coulibaly), `2026-${String(m).padStart(2, '0')}`);
  }
  const batches = await db.select().from(s.journalBatches);
  for (const b of batches) await jr.ack(ctx(U.coulibaly), String(b.id), { status: 'INTEGRE' });
  await dep.run(ctx(U.coulibaly), { period: '2026-10', mode: 'SIMULATION' });
  log('Dotations 2026 : janvier à septembre comptabilisées, octobre simulé');

  // Réception validée : 40 ordinateurs portables
  const r1 = await rec.create(ctx(U.yao), { entryMode: 'ACHAT', supplier: 'Inova Informatique', orderRef: 'BC-2026-0412', deliveryNote: 'BL 2026-1102', invoiceRef: 'F-26-0870',
    deliveryDate: '2026-10-20', locationId: store.id, lines: [{ designation: 'Ordinateur portable Lenovo ThinkPad T14', categoryId: cInf.id, brand: 'Lenovo', model: 'ThinkPad T14 Gen 4', qtyOrdered: 40, qtyDelivered: 40, qtyAccepted: 40, unitValue: 650_000,
      serials: Array.from({ length: 40 }, (_, i) => `PF4K2A${String(i + 1).padStart(2, '0')}`) }] });
  await rec.submit(ctx(U.yao), String(r1.id));
  await approveAll('RECEPTION', r1.id);
  const laptops = await db.select().from(s.assets).where(eq(s.assets.receptionId, r1.id)).orderBy(s.assets.code);
  await labels.setStatus(ctx(U.yao), { assetIds: laptops.slice(0, 34).map((a) => a.id), status: 'IMPRIMEE' });
  await labels.setStatus(ctx(U.yao), { assetIds: laptops.slice(0, 24).map((a) => a.id), status: 'POSEE' });
  await labels.setStatus(ctx(U.bamba), { assetIds: laptops.slice(0, 20).map((a) => a.id), status: 'CONTROLEE' });

  // Affectation exécutée : 10 portables à Traoré M. (visa comptable, visa directeur > 5 M, signature du détenteur)
  const office305 = offices.find((o) => o.code === 'ABJ-TB-03-305')!;
  const m1 = await mv.create(ctx(U.yao), { type: 'AFFECTATION', assetIds: laptops.slice(0, 10).map((a) => a.id), toOrgUnitId: dsi.id, toHolderId: U.traore.id, toLocationId: office305.id, reason: 'Équipement de la DSI' });
  await approveAll('MOUVEMENT', m1.id);
  // Affectation en attente de signature : 3 biens au service Courrier
  const m2 = await mv.create(ctx(U.yao), { type: 'AFFECTATION', assetIds: laptops.slice(10, 13).map((a) => a.id), toOrgUnitId: courrier.id, toHolderId: U.kouassi.id, toLocationId: lcour.id, reason: 'Dotation du service Courrier' });
  await approveAll('MOUVEMENT', m2.id, 1);
  // Transfert en attente du directeur
  const toMove = await db.select().from(s.assets).where(sql`${s.assets.categoryId} = ${cMob.id} and ${s.assets.status} = 'EN_SERVICE' and ${s.assets.locationId} in (select id from locations where code like 'ABJ-TB-01%')`).limit(6);
  await mv.create(ctx(U.yao), { type: 'TRANSFERT', assetIds: toMove.map((a) => a.id), toLocationId: regional[2].offices[0].id, reason: 'Équipement du nouveau bureau de Bouaké' });
  // Prêt exécuté puis échu
  const [proj] = await db.select().from(s.assets).where(sql`${s.assets.designation} like 'Vidéoprojecteur%' and ${s.assets.status} = 'EN_SERVICE'`).limit(1);
  if (proj) {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const m3 = await mv.create(ctx(U.yao), { type: 'PRET', assetIds: [proj.id], toHolderId: U.traore.id, dueDate: tomorrow, reason: 'Atelier de formation' });
    await approveAll('MOUVEMENT', m3.id);
    await db.update(s.movements).set({ dueDate: '2026-10-23' }).where(eq(s.movements.id, m3.id));
  }

  // Réception à viser : climatiseurs et onduleurs (une réserve)
  const r2 = await rec.create(ctx(U.yao), { entryMode: 'ACHAT', supplier: 'Sotra Équipements', orderRef: 'BC-2026-0457', deliveryNote: 'BL 2026-1184', invoiceRef: 'F-26-0932', deliveryDate: '2026-10-24', locationId: store.id,
    lines: [{ designation: 'Climatiseur split 18 000 BTU', categoryId: cCli.id, brand: 'LG', qtyOrdered: 25, qtyDelivered: 25, qtyAccepted: 24, unitValue: 680_000, reserve: '1 carrosserie endommagée' },
      { designation: 'Onduleur 3 kVA en ligne', categoryId: cInf.id, brand: 'APC', qtyOrdered: 10, qtyDelivered: 10, qtyAccepted: 10, unitValue: 740_000 }] });
  await rec.submit(ctx(U.yao), String(r2.id));
  await rec.create(ctx(U.yao), { entryMode: 'DON', supplier: 'Partenaire technique (convention du 12/09/2026)', orderRef: 'DON-2026-0003', deliveryDate: '2026-10-25', locationId: parking.id,
    lines: [{ designation: 'Moto tout-terrain Yamaha AG 200', categoryId: cMot.id, qtyOrdered: 12, qtyDelivered: 12, qtyAccepted: 12, unitValue: 1_450_000 }] });

  // Réforme exécutée (vente) et réforme en commission
  const old = await db.select().from(s.assets).where(sql`${s.assets.categoryId} = ${cInf.id} and ${s.assets.acquisitionDate} < '2018-01-01' and ${s.assets.status} = 'EN_SERVICE'`).limit(17);
  const d1 = await disp.create(ctx(U.yao), { title: 'Matériel informatique obsolète (lot 1)', exitMode: 'VENTE', reason: 'Matériel hors d\'usage ou obsolète', items: old.slice(0, 5).map((a) => ({ assetId: a.id, motive: 'Obsolète, non réparable' })) });
  await disp.submit(ctx(U.yao), String(d1.id));
  await approveAll('REFORME', d1.id);
  await disp.execute(ctx(U.kone), String(d1.id), { exitDate: '2026-10-05', proceeds: 350_000, reference: "PV d'adjudication n° 14/2026" });
  const d2 = await disp.create(ctx(U.yao), { title: 'Matériel informatique obsolète (lot 2)', exitMode: 'VENTE', reason: 'Expertise technique du 09/10/2026', commissionDate: '2026-10-29',
    items: old.slice(5).map((a) => ({ assetId: a.id, motive: pick(["Hors d'usage", 'Coût de réparation excessif', 'Obsolète']) })) });
  await disp.submit(ctx(U.yao), String(d2.id));
  await approveAll('REFORME', d2.id, 1);

  // Campagne d'inventaire en cours sur le siège : lancement, comptage, rapprochement, décisions
  const c1 = await inv.create(ctx(U.konan), { label: "Inventaire du siège · fin d'exercice 2026", type: 'GENERAL', startDate: '2026-10-12', endDate: '2026-10-31', blind: true, freezeMovements: false,
    zones: [{ locationId: tb.id, leaderId: U.bamba.id }, { locationId: ba.id, leaderId: U.bamba.id }, { locationId: parking.id, leaderId: U.bamba.id }] });
  await inv.launch(ctx(U.konan), String(c1.id));
  const zones = await db.select().from(s.inventoryZones).where(eq(s.inventoryZones.campaignId, c1.id));
  for (const z of zones) {
    const exp = await db.select({ a: s.assets, e: s.inventoryExpected }).from(s.inventoryExpected).innerJoin(s.assets, eq(s.assets.id, s.inventoryExpected.assetId)).where(eq(s.inventoryExpected.zoneId, z.id));
    const sub = (await pool.query(`with recursive t as (select id from locations where id = $1 union select l.id from locations l join t on l.parent_id = t.id) select id from t`, [z.locationId])).rows.map((r) => Number(r.id));
    for (const { a } of exp) {
      if (a.code === 'MEF-INF-2023-000811') { await inv.count(ctx(U.bamba), String(c1.id), { zoneId: z.id, code: a.code, condition: 'MOYEN', locationId: servers2.id }); continue; }
      if (R() < 0.08 && a.status !== 'MANQUANT') continue; // non trouvé
      if (a.status === 'MANQUANT') continue;
      const misplaced = R() < 0.03;
      const bad = R() < 0.025;
      await inv.count(ctx(U.bamba), String(c1.id), { zoneId: z.id, code: a.code, condition: bad ? pick(['MAUVAIS', 'HORS_USAGE']) : a.condition === 'NEUF' ? 'BON' : a.condition,
        locationId: misplaced ? pick(sub) : a.locationId, comment: bad ? pick(['Ne démarre plus', 'Écran fissuré', 'Pied cassé', 'Fuite de gaz', 'Batterie hors service']) : ['MAUVAIS', 'HORS_USAGE'].includes(a.condition) ? 'État déjà signalé' : undefined });
    }
  }
  for (const code of ['0048-77120', 'ETQ-ILLISIBLE-01', '0048-77311', 'ANCIEN-2011-0042', '0048-77125', 'SANS-ETIQUETTE-07'])
    await inv.count(ctx(U.bamba), String(c1.id), { zoneId: zones[1].id, code, condition: 'BON', comment: 'Trouvé sans fiche au registre' });
  await inv.reconcile(ctx(U.konan), String(c1.id));
  const gaps = await db.select().from(s.inventoryGaps).where(eq(s.inventoryGaps.campaignId, c1.id));
  const mal = gaps.filter((g) => g.type === 'MAL_LOCALISE');
  if (mal.length) await inv.decide(ctx(U.kone), String(c1.id), { gapIds: mal.slice(0, Math.ceil(mal.length * 0.7)).map((g) => g.id), decision: 'TRANSFERT_REGULARISATION' });
  const miss = gaps.filter((g) => g.type === 'MANQUANT');
  if (miss.length) await inv.decide(ctx(U.kone), String(c1.id), { gapIds: miss.slice(0, Math.ceil(miss.length * 0.4)).map((g) => g.id), decision: 'ENQUETE', comment: 'Second passage le 28/10' });
  const etat = gaps.filter((g) => g.type === 'ECART_ETAT');
  if (etat.length) await inv.decide(ctx(U.kone), String(c1.id), { gapIds: etat.slice(0, Math.ceil(etat.length / 2)).map((g) => g.id), decision: 'METTRE_A_JOUR' });
  await portal.attest(ctx(U.traore), { campaignId: c1.id, disputed: false });

  // Demandes du portail
  const myLaptop = laptops[0];
  await portal.request(ctx(U.traore), { type: 'PANNE', assetId: myLaptop.id, description: "L'écran reste noir au démarrage depuis ce matin." });
  await portal.request(ctx(U.traore), { type: 'EQUIPEMENT', description: "Besoin d'un second écran pour le poste de supervision réseau." });

  const { seedLot2 } = await import('./seed-lot2');
  await seedLot2(app, db, pool, { E, U, holders, cats: { cVeh, cMot, cOut, cCli, cInf, cImm, cTer }, locs: { abj, tb, parking, khg: regional[4].site, yam: regional[1].site },
    units: { dg, daf, dsi, drYam: drs[0], drKhg: drs[3] }, laptops, ctx, approveAll, R, log });

  await app.close();
  await pool.end();
  log(`Données de démonstration prêtes. Mot de passe de tous les comptes : ${DEMO_PASSWORD}`);
}

if (require.main === module) {
  seed({ reset: process.env.SEED_RESET === '1' }).catch((e) => { console.error(e); process.exit(1); });
}
