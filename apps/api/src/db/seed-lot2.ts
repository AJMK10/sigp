/**
 * Jeu de démonstration du lot 2 : immobilier, parc automobile, maintenance et contrats, révisions,
 * rapprochement comptable et GED. Les opérations courantes passent par les contrôleurs de l'application.
 */
import type { INestApplicationContext } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import type { Pool } from 'pg';
import type { DB } from './client';
import * as s from './schema';
import type { Ctx } from '../common/context';

type User = typeof s.users.$inferSelect;
type Cat = typeof s.categories.$inferSelect;
type Loc = typeof s.locations.$inferSelect;
type Unit = typeof s.orgUnits.$inferSelect;

export interface Lot2Refs {
  E: number;
  U: Record<'konan' | 'yao' | 'ouattara' | 'kone' | 'coulibaly' | 'diallo' | 'bamba' | 'traore' | 'kouassi', User>;
  holders: User[];
  cats: { cVeh: Cat; cMot: Cat; cOut: Cat; cCli: Cat; cInf: Cat; cImm: Cat; cTer: Cat };
  locs: { abj: Loc; tb: Loc; parking: Loc; khg: Loc; yam: Loc };
  units: { dg: Unit; daf: Unit; dsi: Unit; drYam: Unit; drKhg: Unit };
  laptops: (typeof s.assets.$inferSelect)[];
  ctx: (u: User) => Ctx;
  approveAll: (type: string, id: number, upTo?: number) => Promise<void>;
  R: () => number;
  log: (...a: unknown[]) => void;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

function pdf(title: string, lines: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font('Helvetica-Bold').fontSize(16).text(title).moveDown();
    doc.font('Helvetica').fontSize(10);
    for (const l of lines) doc.text(l).moveDown(0.4);
    doc.moveDown().fontSize(8).fillColor('#888').text('Document de démonstration SIGP');
    doc.end();
  });
}

export async function seedLot2(app: INestApplicationContext, db: DB, pool: Pool, r: Lot2Refs) {
  const { E, U, holders, cats, locs, units, ctx, approveAll, R, log } = r;
  const today = iso(new Date());
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const between = (a: number, b: number) => a + Math.floor(R() * (b - a + 1));

  const { PropertyController } = await import('../modules/property/property.controller');
  const { FleetController, MissionsController } = await import('../modules/fleet/fleet.controller');
  const { MaintenanceController, ContractsController } = await import('../modules/maintenance/maintenance.controller');
  const { RevaluationController } = await import('../modules/revaluation/revaluation.controller');
  const { ClosingController, registerBalances } = await import('../modules/closing/closing.controller');
  const { DocumentsController } = await import('../modules/documents/documents.controller');
  const { PortalController } = await import('../modules/portal/portal.controller');
  const prop = app.get(PropertyController), fleet = app.get(FleetController), mis = app.get(MissionsController), mnt = app.get(MaintenanceController);
  const ctr = app.get(ContractsController), rev = app.get(RevaluationController), clo = app.get(ClosingController), docs = app.get(DocumentsController), portal = app.get(PortalController);

  // ---------- Exercice 2025 clôturé ----------
  await db.insert(s.fiscalYears).values({ entityId: E, year: 2025, status: 'CLOTURE', closedAt: new Date('2026-03-31T10:00:00Z'), closedBy: U.coulibaly.id,
    summary: { note: "Clôture reprise lors de l'initialisation du système" } });

  // ---------- Immobilier et foncier ----------
  const byCode = async (code: string) => (await db.select().from(s.assets).where(eq(s.assets.code, code)))[0];
  const tourB = await byCode('MEF-IMM-1998-000004');
  const terTB = await byCode('MEF-TER-1998-000001');
  const yam = await byCode('MEF-IMM-2004-000011');
  const [khgTer] = await db.insert(s.assets).values({ entityId: E, code: 'MEF-TER-2009-000001', designation: 'Terrain de Korhogo (lot 214, quartier Résidentiel)', categoryId: cats.cTer.id,
    status: 'EN_SERVICE', condition: 'BON', entryMode: 'REPRISE', acquisitionDate: '2009-05-12', inServiceDate: '2009-05-12', acquisitionValue: 38_000_000, deprMethod: 'NON_AMORTISSABLE', deprYears: 0,
    locationId: locs.khg.id, orgUnitId: units.drKhg.id, labelStatus: 'CONTROLEE' }).returning();
  const [spdTer] = await db.insert(s.assets).values({ entityId: E, code: 'MEF-TER-2016-000001', designation: 'Terrain de San-Pédro (zone portuaire, 1 500 m²)', categoryId: cats.cTer.id,
    status: 'EN_SERVICE', condition: 'BON', entryMode: 'REPRISE', acquisitionDate: '2016-02-01', inServiceDate: '2016-02-01', acquisitionValue: 96_000_000, deprMethod: 'NON_AMORTISSABLE', deprYears: 0,
    locationId: locs.abj.id, orgUnitId: units.dg.id, labelStatus: 'CONTROLEE' }).returning();
  await pool.query(`insert into asset_events (asset_id, type, summary, at) values ($1, 'ENTREE', 'Repris au registre (bilan d''ouverture)', '2009-05-12'), ($2, 'ENTREE', 'Repris au registre (bilan d''ouverture)', '2016-02-01')`, [khgTer.id, spdTer.id]);

  await prop.upsert(ctx(U.yao), String(tourB.id), { kind: 'BATIMENT', address: 'Boulevard Angoulvant, Plateau, Abidjan', lat: '5.3220', lng: '-4.0175', landArea: 2800, builtArea: 9600, floors: 4,
    titleType: 'TITRE_FONCIER', titleRef: 'TF n° 4 512 · circonscription foncière de Bingerville', owner: "État de Côte d'Ivoire", assignmentAct: 'Arrêté d\'affectation n° 214/MEF/DGBF du 12/01/1998',
    easements: 'Servitude de passage des réseaux CIE au nord' });
  await prop.upsert(ctx(U.yao), String(terTB.id), { kind: 'TERRAIN', address: 'Boulevard Angoulvant, Plateau, Abidjan', lat: '5.3218', lng: '-4.0172', landArea: 2800,
    titleType: 'TITRE_FONCIER', titleRef: 'TF n° 4 512 · circonscription foncière de Bingerville', owner: "État de Côte d'Ivoire" });
  await prop.upsert(ctx(U.yao), String(yam.id), { kind: 'BATIMENT', address: 'Avenue Houphouët-Boigny, Yamoussoukro', lat: '6.8206', lng: '-5.2768', landArea: 4200, builtArea: 2100, floors: 2,
    titleType: 'TITRE_FONCIER', titleRef: 'TF n° 1 207 · Yamoussoukro', owner: "État de Côte d'Ivoire", assignmentAct: 'Arrêté n° 087/MEF du 03/05/2004' });
  await prop.upsert(ctx(U.yao), String(khgTer.id), { kind: 'TERRAIN', address: 'Quartier Résidentiel, lot 214, Korhogo', lat: '9.4580', lng: '-5.6296', landArea: 3600,
    titleType: 'AUCUN', owner: "État de Côte d'Ivoire", titleProcedure: "Aucun titre : lettre du préfet de 2009 seulement. Demande d'ACD à déposer, bornage contradictoire à programmer." });
  await prop.upsert(ctx(U.yao), String(spdTer.id), { kind: 'TERRAIN', address: 'Zone portuaire, San-Pédro', lat: '4.7485', lng: '-6.6363', landArea: 1500,
    titleType: 'ACD', titleRef: 'ACD n° 2016-0312 (en cours de mutation en titre foncier)', owner: "État de Côte d'Ivoire",
    titleProcedure: 'ACD délivré le 14/03/2016 ; dossier de titre foncier déposé au guichet unique le 02/09/2026, enquête en cours.' });

  // Composants de la Tour B (approche par composants : total 2,2 milliards)
  for (const [label, value, years, since] of [['Gros œuvre et structure', 1_100_000_000, 50, '1998-01-01'], ['Façades et menuiseries extérieures', 240_000_000, 30, '1998-01-01'],
    ['Toiture et étanchéité', 180_000_000, 20, '1998-01-01'], ['Ascenseurs (2 cabines)', 160_000_000, 20, '1998-01-01'], ['Climatisation centrale', 220_000_000, 15, '1998-01-01'],
    ['Électricité et courants faibles', 180_000_000, 25, '1998-01-01'], ['Plomberie et sanitaires', 120_000_000, 25, '1998-01-01']] as const)
    await prop.addComponent(ctx(U.yao), String(tourB.id), { label, value, durationYears: years, inServiceDate: since });
  const comps = await db.select().from(s.assetComponents).where(eq(s.assetComponents.assetId, tourB.id));
  const clim = comps.find((c) => c.label.startsWith('Climatisation'))!;
  await prop.replaceComponent(ctx(U.yao), String(tourB.id), String(clim.id), { date: '2014-07-01', value: 265_000_000, durationYears: 15 });

  for (const o of [
    { kind: 'AFFECTATION', occupant: 'Direction générale', orgUnitId: units.dg.id, area: 1900, floors: '3e étage' },
    { kind: 'AFFECTATION', occupant: 'Direction administrative et financière', orgUnitId: units.daf.id, area: 2300, floors: '1er étage' },
    { kind: 'AFFECTATION', occupant: "Direction des systèmes d'information", orgUnitId: units.dsi.id, area: 2100, floors: '2e étage' },
    { kind: 'BAIL', occupant: 'Banque Atlantique CI (agence Plateau)', area: 650, floors: 'Rez-de-chaussée', monthlyRent: 2_400_000, startDate: '2022-01-01', endDate: '2027-12-31' },
    { kind: 'BAIL', occupant: 'Cafétéria (concession)', area: 180, floors: 'Rez-de-chaussée', monthlyRent: 350_000, startDate: '2024-04-01', endDate: '2026-12-31' },
    { kind: 'VACANT', occupant: 'Plateau libre (ancien archivage)', area: 1050, floors: 'Rez-de-chaussée' },
  ] as const) await prop.addOccupancy(ctx(U.yao), String(tourB.id), o);
  await prop.addOccupancy(ctx(U.yao), String(yam.id), { kind: 'AFFECTATION', occupant: 'Direction régionale de Yamoussoukro', orgUnitId: units.drYam.id, area: 1800, floors: 'R+1' });
  await prop.addOccupancy(ctx(U.yao), String(yam.id), { kind: 'VACANT', occupant: 'Aile est (non occupée)', area: 300 });

  await prop.addEvent(ctx(U.yao), String(tourB.id), { kind: 'TRAVAUX', title: "Réfection de l'étanchéité de la toiture-terrasse", status: 'EN_COURS', amount: 85_000_000, date: '2026-09-15',
    notes: "Marché n° 2026/014 · entreprise BTP Lagunes · réception prévue en décembre" });
  await prop.addEvent(ctx(U.yao), String(tourB.id), { kind: 'TRAVAUX', title: 'Remplacement des deux cabines d\'ascenseur', status: 'PROGRAMME', amount: 175_000_000, date: '2027-03-01',
    notes: 'Inscrit au plan de renouvellement 2027 (composant en fin de vie)' });
  await prop.addEvent(ctx(U.yao), String(tourB.id), { kind: 'CONTENTIEUX', title: 'Empiètement du mur de clôture par la parcelle voisine (lot 17)', status: 'EN_COURS', date: '2025-06-10',
    notes: 'Constat d\'huissier du 10/06/2025 ; audience au tribunal de première instance du Plateau le 18/11/2026' });
  await prop.addEvent(ctx(U.yao), String(tourB.id), { kind: 'CONTROLE', title: 'Contrôle sécurité incendie (GSPM)', status: 'A_JOUR', date: '2026-02-12', nextDate: '2027-02-12' });
  await prop.addEvent(ctx(U.yao), String(khgTer.id), { kind: 'CONTENTIEUX', title: 'Occupation sans droit d\'une partie du terrain (commerces)', status: 'EN_COURS', date: '2026-04-20',
    notes: 'Sommation de déguerpir adressée le 20/04/2026 ; sécurisation foncière prioritaire' });
  await fleet.addDeadline(ctx(U.yao), String(tourB.id), { kind: 'CONTROLE_ASCENSEUR', dueDate: addDays(today, 12), notes: 'Contrôle semestriel par organisme agréé' });
  await fleet.addDeadline(ctx(U.yao), String(tourB.id), { kind: 'CONTROLE_INCENDIE', dueDate: '2027-02-12' });
  log('Immobilier : 5 biens fonciers renseignés, composants, occupations, travaux et contentieux');

  // ---------- Parc automobile ----------
  const vehs = await db.select().from(s.assets).where(and(eq(s.assets.entityId, E), inArray(s.assets.categoryId, [cats.cVeh.id, cats.cMot.id]), inArray(s.assets.status, ['EN_SERVICE', 'EN_MAINTENANCE'])))
    .orderBy(s.assets.code);
  const letters = ['AB', 'BC', 'CD', 'DE', 'EF', 'FG', 'GH', 'HJ', 'JK', 'KL', 'LM', 'MN', 'NP'];
  const drivers = holders.slice(2, 14);
  const vehicleRows: { a: typeof vehs[number]; mileage: number; plate: string; perKm: number }[] = [];
  for (const [i, a] of vehs.entries()) {
    const isMoto = a.categoryId === cats.cMot.id;
    const age = 2026 - Number(a.acquisitionDate.slice(0, 4));
    const mileage = Math.max(3000, Math.round((isMoto ? 9000 : 21000) * (age + R()) / 100) * 100);
    const plate = `${String(1000 + ((i * 397) % 8999))} ${letters[i % letters.length]} 01`;
    const base = a.designation.includes('Land Cruiser') ? 14 : a.designation.includes('Hiace') ? 12 : a.designation.includes('Accent') ? 7 : isMoto ? 3 : 10;
    vehicleRows.push({ a, mileage, plate, perKm: base });
    await db.insert(s.vehicles).values({ assetId: a.id, plate, vin: isMoto ? null : `JT${Math.floor(R() * 1e12).toString(36).toUpperCase().padEnd(15, 'X')}`, energy: isMoto || a.designation.includes('Accent') ? 'ESSENCE' : 'GASOIL',
      fiscalPower: isMoto ? 2 : a.designation.includes('Land Cruiser') ? 21 : a.designation.includes('Accent') ? 7 : 12, seats: isMoto ? 2 : a.designation.includes('Hiace') ? 15 : 5, mileage,
      driverId: isMoto ? null : drivers[i % drivers.length].id, firstRegistration: a.acquisitionDate, serviceIntervalKm: isMoto ? 5000 : 10000,
      lastServiceKm: Math.max(0, mileage - between(isMoto ? 1000 : 2000, isMoto ? 5600 : 11500)) });
    // Échéances : visites techniques et vignettes (quelques-unes échues ou proches)
    const vt = i % 9 === 0 ? addDays(today, -between(3, 20)) : i % 7 === 0 ? addDays(today, between(5, 25)) : addDays(today, between(40, 330));
    await db.insert(s.deadlines).values([{ assetId: a.id, kind: 'VISITE_TECHNIQUE', dueDate: vt }, { assetId: a.id, kind: 'VIGNETTE', dueDate: i % 11 === 0 ? addDays(today, 18) : '2027-03-31' }]);
  }
  // Historique des pleins (6 mois), saisi en masse comme une reprise des relevés de carte carburant
  const fuel: (typeof s.fuelLogs.$inferInsert)[] = [];
  for (const [i, v] of vehicleRows.entries()) {
    if (v.a.categoryId === cats.cMot.id && i % 2) continue;
    const firstHilux = vehicleRows.find((x) => x.a.designation.includes('Hilux'));
    const overconsumer = v === firstHilux; // consommation anormale à analyser
    const start = fuel.length;
    let km = 0;
    for (let d = 0; d < 180; d += between(9, 16)) {
      const dist = between(450, 900);
      km += dist;
      const liters = Math.round(dist * v.perKm * (overconsumer ? 1.45 : 0.9 + R() * 0.2) / 100);
      fuel.push({ assetId: v.a.id, date: addDays(today, -180 + d), liters, amount: liters * (v.perKm === 7 || v.perKm === 3 ? 875 : 715), mileage: km,
        station: pick(['Total Plateau', 'Petroci Cocody', 'Shell Riviera', 'Oryx Yopougon', 'Total Yamoussoukro']), cardRef: `CC-${String(4000 + i)}`, createdBy: U.yao.id });
    }
    for (const f of fuel.slice(start)) f.mileage = v.mileage - km + (f.mileage as number); // le dernier plein correspond au compteur actuel
  }
  for (let i = 0; i < fuel.length; i += 500) await db.insert(s.fuelLogs).values(fuel.slice(i, i + 500));

  // Missions par le circuit réel : demande, validation, départ, retour
  const cars = vehicleRows.filter((v) => v.a.categoryId === cats.cVeh.id && v.a.status === 'EN_SERVICE');
  const at = (day: string, h: number) => `${day}T${String(h).padStart(2, '0')}:00`;
  const missionSpecs: [User, number, string, string, number, number, number, 'CLOTUREE' | 'EN_COURS' | 'VALIDEE' | 'DEMANDE'][] = [
    [U.traore, 0, 'Yamoussoukro', 'Installation du réseau de la direction régionale', -12, 2, 7, 'CLOTUREE'],
    [U.kouassi, 1, 'Plateau · Trésor public', 'Dépôt du courrier officiel', -6, 0, 9, 'CLOTUREE'],
    [U.bamba, 2, 'Bouaké', "Inventaire de l'antenne de Bouaké", -9, 3, 6, 'CLOTUREE'],
    [holders[3], 3, 'San-Pédro', 'Visite du terrain de la zone portuaire', -3, 1, 6, 'CLOTUREE'],
    [U.traore, 4, 'Cocody · annexe', 'Maintenance des équipements réseau', 0, 0, 8, 'EN_COURS'],
    [U.bamba, 5, 'Abidjan annexe (Cocody)', "Comptage d'inventaire de l'annexe", 0, 0, 13, 'VALIDEE'],
    [holders[4], 6, 'Korhogo', 'Bornage contradictoire du terrain de Korhogo', 2, 2, 6, 'VALIDEE'],
    [U.kouassi, 1, 'Plateau · ministère', 'Navette de courrier', 1, 0, 9, 'DEMANDE'],
    [holders[5], 7, 'Grand-Bassam', 'Atelier régional de formation', 3, 1, 7, 'DEMANDE'],
  ];
  for (const [who, ci, dest, purpose, offset, days, hour, target] of missionSpecs) {
    const car = cars[ci % cars.length];
    const startDay = addDays(today, offset);
    const m = await mis.create(ctx(who), { assetId: car.a.id, driverId: who.id, destination: dest, purpose, startAt: at(startDay, hour), endAt: at(addDays(startDay, days), days ? 18 : hour + 4) });
    if (target === 'DEMANDE') continue;
    await mis.decide(ctx(U.yao), String(m.id), { approve: true });
    if (target === 'VALIDEE') continue;
    const [v] = await db.select().from(s.vehicles).where(eq(s.vehicles.assetId, car.a.id));
    await mis.depart(ctx(who), String(m.id), { startMileage: v.mileage });
    if (target === 'CLOTUREE') await mis.back(ctx(who), String(m.id), { endMileage: v.mileage + (dest.includes('Plateau') || dest.includes('Cocody') ? between(18, 45) : between(480, 1250)) });
  }
  // Sinistre et infraction
  const crashed = cars[cars.length - 1]; // véhicule récent : sa VNC justifie une dépréciation
  await fleet.addIncident(ctx(U.yao), String(crashed.a.id), { kind: 'SINISTRE', date: addDays(today, -21), driverId: drivers[1].id, description: 'Accrochage au carrefour de l\'Indénié : aile avant droite et phare endommagés, constat amiable signé.',
    amount: 1_850_000, insuranceClaim: 'Déclaration SAAR n° 26-09-1184' });
  await fleet.addIncident(ctx(U.yao), String(cars[2].a.id), { kind: 'INFRACTION', date: addDays(today, -40), driverId: drivers[3].id, description: 'Excès de vitesse (radar autoroute du Nord, 128 km/h pour 90).', amount: 25_000 });
  log(`Parc automobile : ${vehicleRows.length} véhicules immatriculés, ${fuel.length} pleins, missions et sinistres`);

  // ---------- Contrats : maintenance, assurances, garanties ----------
  const s811 = await byCode('MEF-INF-2023-000811'), s812 = await byCode('MEF-INF-2023-000812');
  const gens = await db.select().from(s.assets).where(and(eq(s.assets.categoryId, cats.cOut.id), eq(s.assets.entityId, E), sql`${s.assets.status} <> 'SORTI'`));
  const insuredFleet = vehicleRows.map((v) => v.a.id);
  const fleetValue = vehicleRows.reduce((t, v) => t + v.a.acquisitionValue, 0);
  await ctr.create(ctx(U.yao), { kind: 'MAINTENANCE', title: 'Support Dell ProSupport Plus · serveurs du centre de données', provider: 'Dell Technologies (partenaire Inova Informatique)',
    startDate: '2026-07-01', endDate: '2029-06-30', annualAmount: 4_800_000, slaHours: 4, notes: 'Intervention sur site sous 4 h, pièces incluses', assetIds: [s811.id, s812.id] });
  await ctr.create(ctx(U.yao), { kind: 'MAINTENANCE', title: 'Maintenance des groupes électrogènes', provider: 'Groupe Énergie Services', startDate: '2026-01-01', endDate: '2026-12-31',
    annualAmount: 9_600_000, slaHours: 24, notes: 'Visite préventive semestrielle et dépannage 24 h', assetIds: gens.map((g) => g.id) });
  await ctr.create(ctx(U.coulibaly), { kind: 'ASSURANCE', title: 'Assurance flotte automobile (tous risques)', provider: 'SAAR Assurances', startDate: '2026-01-01', endDate: '2026-12-31',
    annualAmount: 41_500_000, insuredValue: fleetValue, assetIds: insuredFleet.slice(0, insuredFleet.length - 3) });
  await ctr.create(ctx(U.coulibaly), { kind: 'ASSURANCE', title: 'Multirisque immeuble · Tour administrative B', provider: 'Allianz Côte d\'Ivoire', startDate: '2026-01-01', endDate: '2026-12-31',
    annualAmount: 12_800_000, insuredValue: 2_600_000_000, assetIds: [tourB.id] });
  await ctr.create(ctx(U.yao), { kind: 'GARANTIE', title: 'Garantie constructeur · ordinateurs portables Lenovo (lot octobre 2026)', provider: 'Lenovo (via Inova Informatique)', startDate: '2026-10-20', endDate: '2029-10-19',
    assetIds: r.laptops.map((l) => l.id) });
  const clims = await db.select().from(s.assets).where(and(eq(s.assets.categoryId, cats.cCli.id), eq(s.assets.entityId, E), eq(s.assets.status, 'EN_SERVICE'))).limit(120);
  await ctr.create(ctx(U.yao), { kind: 'MAINTENANCE', title: 'Entretien des climatiseurs du siège', provider: 'Froid Industriel CI', startDate: '2025-11-01', endDate: addDays(today, 45),
    annualAmount: 6_200_000, slaHours: 48, notes: 'Contrat à renouveler : appel d\'offres en préparation', assetIds: clims.map((c) => c.id) });
  log('Contrats : maintenance, assurances et garanties');

  // ---------- Maintenance : ordres de travail et plans préventifs ----------
  await db.update(s.assets).set({ status: 'EN_SERVICE' }).where(eq(s.assets.id, s811.id));
  const ot = async (assetId: number, o: { kind: 'CORRECTIF' | 'PREVENTIF'; title: string; description?: string; priority?: 'BASSE' | 'NORMALE' | 'HAUTE' | 'URGENTE'; plannedDate?: string; assignee?: string; requestId?: number },
    steps: ('PLANIFIE' | 'EN_COURS' | 'ATTENTE_PIECES' | 'TERMINE')[] = [], close?: { labor: number; parts: number; report: string; daysAgo: number; hours: number }) => {
    const w = await mnt.create(ctx(U.yao), { assetId, ...o });
    for (const st of steps) {
      if (st === 'TERMINE') await mnt.update(ctx(U.yao), String(w.id), { status: 'TERMINE', laborCost: close!.labor, partsCost: close!.parts, report: close!.report });
      else await mnt.update(ctx(U.yao), String(w.id), { status: st, ...(st === 'PLANIFIE' && !o.plannedDate ? { plannedDate: addDays(today, 3) } : {}) });
    }
    if (close) {
      const done = new Date(Date.now() - close.daysAgo * 86400000);
      await db.update(s.workOrders).set({ createdAt: new Date(done.getTime() - (close.hours + 20) * 3600000), startedAt: new Date(done.getTime() - close.hours * 3600000), doneAt: done }).where(eq(s.workOrders.id, w.id));
    }
    return w;
  };
  // OT de la maquette : serveur 811 en panne, attente de pièces sous contrat Dell
  await ot(s811.id, { kind: 'CORRECTIF', title: 'Panne de la carte RAID · redémarrages intempestifs', description: 'Alerte iDRAC : contrôleur PERC H755 en défaut, volume dégradé.', priority: 'URGENTE' },
    ['EN_COURS', 'ATTENTE_PIECES']);
  const closed: [number, string, string, number, number, number, number][] = [];
  const pool2 = [...cars.slice(0, 10).map((c) => c.a), ...clims.slice(0, 10), ...gens.slice(0, 4)];
  for (const [i, a] of pool2.entries()) {
    const isVeh = a.categoryId === cats.cVeh.id, isGen = a.categoryId === cats.cOut.id;
    const kind = i % 3 === 0 ? 'CORRECTIF' : 'PREVENTIF';
    const title = isVeh ? (kind === 'PREVENTIF' ? 'Vidange et révision des 10 000 km' : pick(['Remplacement des plaquettes de frein', 'Batterie hors service', 'Climatisation du véhicule en panne']))
      : isGen ? (kind === 'PREVENTIF' ? 'Visite semestrielle du groupe' : 'Défaut de démarrage automatique') : (kind === 'PREVENTIF' ? 'Nettoyage des filtres et contrôle de charge' : 'Fuite de gaz, recharge du circuit');
    const labor = isGen ? between(150, 600) * 1000 : between(25, 120) * 1000, parts = isGen ? between(200, 1500) * 1000 : between(15, 280) * 1000;
    closed.push([a.id, kind, title, labor, parts, between(4, 150), between(2, 70)]);
  }
  for (const [assetId, kind, title, labor, parts, daysAgo, hours] of closed)
    await ot(assetId, { kind: kind as 'CORRECTIF', title }, ['EN_COURS', 'TERMINE'], { labor, parts, report: 'Intervention réalisée, essais concluants.', daysAgo, hours });
  // Un bien dont le coût de maintenance dépasse 30 % de sa valeur : proposé à la réforme
  const costly = clims[15];
  if (costly) await ot(costly.id, { kind: 'CORRECTIF', title: 'Remplacement du compresseur', priority: 'HAUTE' }, ['EN_COURS', 'TERMINE'],
    { labor: 120_000, parts: Math.round(costly.acquisitionValue * 0.34), report: 'Compresseur remplacé ; appareil ancien, remplacement conseillé.', daysAgo: 30, hours: 26 });
  await ot(cars[3].a.id, { kind: 'CORRECTIF', title: 'Bruit anormal du train avant', priority: 'NORMALE', plannedDate: addDays(today, 2), assignee: 'Garage CFAO Motors' }, ['PLANIFIE']);
  await ot(crashed.a.id, { kind: 'CORRECTIF', title: 'Réparation carrosserie après sinistre', description: 'Prise en charge assureur en attente (expertise du 22/10).', priority: 'HAUTE', assignee: 'Carrosserie Ivoire Auto' }, ['EN_COURS']);
  await ot(clims[20]?.id ?? clims[0].id, { kind: 'CORRECTIF', title: 'Climatiseur ne refroidit plus · salle de réunion', priority: 'NORMALE' });
  await ot(gens[0].id, { kind: 'PREVENTIF', title: 'Remplacement des batteries de démarrage', priority: 'BASSE', plannedDate: addDays(today, 9) }, ['PLANIFIE']);
  // Demande du portail prise en charge par un ordre de travail (le portable de Traoré M. reste à traiter depuis l'écran)
  const req = await portal.request(ctx(U.traore), { type: 'PANNE', assetId: r.laptops[1].id, description: 'Le clavier ne répond plus sur plusieurs touches.' });
  await ot(r.laptops[1].id, { kind: 'CORRECTIF', title: 'Clavier défectueux (sous garantie)', requestId: req.id, assignee: 'Lenovo (via Inova Informatique)' });

  const [ctrGen] = await db.select().from(s.contracts).where(sql`${s.contracts.title} like 'Maintenance des groupes%'`);
  const [ctrClim] = await db.select().from(s.contracts).where(sql`${s.contracts.title} like 'Entretien des climatiseurs%'`);
  await mnt.createPlan(ctx(U.yao), { label: 'Visite semestrielle des groupes électrogènes', categoryId: cats.cOut.id, frequencyMonths: 6, nextDate: addDays(today, 6), contractId: ctrGen.id });
  await mnt.createPlan(ctx(U.yao), { label: 'Entretien trimestriel des climatiseurs', categoryId: cats.cCli.id, frequencyMonths: 3, nextDate: addDays(today, 24), contractId: ctrClim.id });
  await mnt.createPlan(ctx(U.yao), { label: 'Révision annuelle de la Tour B (ascenseurs, sécurité)', assetId: tourB.id, frequencyMonths: 12, nextDate: addDays(today, 12), assignee: 'Otis CI' });
  await mnt.createPlan(ctx(U.yao), { label: 'Contrôle des serveurs (firmware, batteries RAID)', assetId: s812.id, frequencyMonths: 6, nextDate: addDays(today, 40) });
  log('Maintenance : ordres de travail, plans préventifs');

  // ---------- Révisions : changement de durée (en attente) et dépréciation (appliquée) ----------
  const r1 = await rev.create(ctx(U.yao), { kind: 'REVISION_DUREE', title: 'Groupes électrogènes · allongement de la durée d\'utilisation', newYears: 12, effectiveDate: '2026-10-01',
    reason: 'Rapport d\'expertise de Groupe Énergie Services du 18/09/2026 : état mécanique satisfaisant, durée d\'utilisation probable portée de 10 à 12 ans.', items: gens.filter((g) => g.inServiceDate).map((g) => ({ assetId: g.id })) });
  await rev.submit(ctx(U.yao), String(r1.id));
  const [veh] = await db.select().from(s.assets).where(eq(s.assets.id, crashed.a.id));
  const { valuesAt } = await import('../modules/assets/assets.util');
  const nbv = valuesAt(veh, '2026-10-15').nbv;
  if (nbv > 1_000_000) {
    const r2 = await rev.create(ctx(U.yao), { kind: 'DEPRECIATION', title: 'Véhicule accidenté · perte de valeur', effectiveDate: '2026-10-15',
      reason: 'Sinistre du ' + addDays(today, -21).split('-').reverse().join('/') + ' : valeur de marché estimée par l\'expert inférieure à la VNC.', items: [{ assetId: veh.id, amount: Math.round(nbv * 0.25 / 1000) * 1000 }] });
    await rev.submit(ctx(U.yao), String(r2.id));
    await approveAll('REVISION', r2.id);
  }
  log('Révisions : durée des groupes (à valider), dépréciation d\'un véhicule (appliquée)');

  // ---------- Rapprochement avec la comptabilité générale (balance au 30/09) ----------
  const reg = await db.transaction((tx) => registerBalances(tx, E, '2026-09-30'));
  const gap: Record<string, number> = { '2442': 1_950_000, '2451': -18_500_000, '2844': 312_450 };
  await clo.importBalances(ctx(U.coulibaly), { date: '2026-09-30', balances: reg.map((x) => ({ account: x.account, label: x.label, balance: x.amount + (gap[x.account] ?? 0) })) });
  await clo.addNote(ctx(U.kone), { date: '2026-09-30', account: '2442', amount: 1_950_000, status: 'A_CORRIGER',
    label: 'Facture F-26-0711 (3 écrans) imputée en immobilisation alors que les biens, sous le seuil, relèvent des charges : écriture de correction à passer.' });
  await clo.addNote(ctx(U.kone), { date: '2026-09-30', account: '2451', amount: -18_500_000, status: 'JUSTIFIE',
    label: 'Toyota Hilux réceptionné le 28/09 (PV visé), facture fournisseur non encore comptabilisée : décalage de période.' });
  log('Rapprochement : balance au 30/09 importée, écarts expliqués');

  // ---------- GED : pièces justificatives ----------
  const up = async (who: User, objectType: string, objectId: number, category: string, name: string, title: string, lines: string[]) => {
    const buffer = await pdf(title, lines);
    await docs.upload(ctx(who), { originalname: Buffer.from(name, 'utf8').toString('latin1'), mimetype: 'application/pdf', size: buffer.length, buffer } as Express.Multer.File, { objectType, objectId, category });
  };
  await up(U.yao, 'BIEN', tourB.id, 'TITRE', 'TF-4512-Tour-B.pdf', 'Titre foncier n° 4 512', ['Circonscription foncière de Bingerville', 'Propriétaire : État de Côte d\'Ivoire', 'Contenance : 2 800 m²']);
  await up(U.yao, 'BIEN', tourB.id, 'PV', 'Arrete-affectation-214.pdf', 'Arrêté d\'affectation n° 214/MEF/DGBF', ['Affectation de la Tour administrative B au ministère', 'Date : 12/01/1998']);
  await up(U.yao, 'BIEN', spdTer.id, 'TITRE', 'ACD-2016-0312.pdf', 'Arrêté de concession définitive n° 2016-0312', ['Terrain de San-Pédro, zone portuaire, 1 500 m²']);
  await up(U.yao, 'BIEN', s811.id, 'FACTURE', 'Facture-F-23-0412.pdf', 'Facture F-23-0412 · Inova Informatique', ['2 serveurs Dell PowerEdge R650', 'Montant : 24 800 000 FCFA']);
  const [c1] = await db.select().from(s.contracts).where(sql`${s.contracts.title} like 'Support Dell%'`);
  await up(U.yao, 'CONTRAT', c1.id, 'CONTRAT', 'Contrat-Dell-ProSupport.pdf', 'Contrat de support Dell ProSupport Plus', ['Durée : 3 ans à compter du 01/07/2026', 'Délai d\'intervention : 4 heures']);
  await up(U.yao, 'BIEN', crashed.a.id, 'EXPERTISE', 'Rapport-expertise-sinistre.pdf', 'Rapport d\'expertise automobile', ['Véhicule ' + crashed.plate, 'Dommages : aile avant droite, optique', 'Valeur de marché estimée après sinistre']);
  log('GED : pièces justificatives déposées');
}
