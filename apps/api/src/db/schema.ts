/**
 * Schéma de données du SIGP — lot 1.
 * Montants en FCFA entiers (bigint, mode number : < 2^53, largement suffisant).
 * Toutes les tables métier portent entity_id (cloisonnement multi-entités).
 */
import {
  pgTable, serial, integer, bigint, bigserial, text, varchar, boolean, timestamp, date, jsonb, pgEnum, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core';

const money = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const assetStatus = pgEnum('asset_status', ['EN_STOCK', 'EN_SERVICE', 'EN_MAINTENANCE', 'EN_PRET', 'EN_TRANSIT', 'MANQUANT', 'PROPOSE_REFORME', 'SORTI']);
export const labelStatus = pgEnum('label_status', ['GENEREE', 'IMPRIMEE', 'POSEE', 'CONTROLEE']);
export const assetCondition = pgEnum('asset_condition', ['NEUF', 'BON', 'MOYEN', 'MAUVAIS', 'HORS_USAGE']);
export const deprMethod = pgEnum('depr_method', ['LINEAIRE', 'DEGRESSIF', 'NON_AMORTISSABLE']);
export const entryMode = pgEnum('entry_mode', ['ACHAT', 'DON', 'TRANSFERT_ENTRANT', 'PRODUCTION', 'REGULARISATION', 'REPRISE']);
export const locationKind = pgEnum('location_kind', ['SITE', 'BATIMENT', 'NIVEAU', 'LOCAL']);
export const roleCode = pgEnum('role_code', ['ADMIN', 'DIRECTEUR', 'GESTIONNAIRE', 'COMPTABLE_MATIERES', 'FINANCES', 'CONTROLEUR', 'CHEF_EQUIPE', 'DETENTEUR']);

export const entities = pgTable('entities', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 12 }).notNull().unique(),
  shortCode: varchar('short_code', { length: 12 }).notNull(), // ENT01 dans les numéros de pièces
  name: text('name').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('XOF'),
  createdAt: createdAt(),
});

export const orgUnits = pgTable('org_units', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  parentId: integer('parent_id'),
  code: varchar('code', { length: 30 }).notNull(),
  name: text('name').notNull(),
  createdAt: createdAt(),
}, (t) => ({ uq: uniqueIndex('org_units_code_uq').on(t.entityId, t.code) }));

export const locations = pgTable('locations', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  parentId: integer('parent_id'),
  kind: locationKind('kind').notNull(),
  code: varchar('code', { length: 40 }).notNull(),
  name: text('name').notNull(),
  createdAt: createdAt(),
}, (t) => ({ uq: uniqueIndex('locations_code_uq').on(t.entityId, t.code) }));

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  email: varchar('email', { length: 160 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  title: text('title'),
  role: roleCode('role').notNull(),
  orgUnitId: integer('org_unit_id').references(() => orgUnits.id),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  parentId: integer('parent_id'),
  code: varchar('code', { length: 20 }).notNull(),
  label: text('label').notNull(),
  prefix: varchar('prefix', { length: 6 }), // préfixe de codification (INF, MOB…) — catégories feuilles
  assetAccount: varchar('asset_account', { length: 12 }),
  deprAccount: varchar('depr_account', { length: 12 }),
  expenseAccount: varchar('expense_account', { length: 12 }),
  method: deprMethod('method').notNull().default('LINEAIRE'),
  durationYears: integer('duration_years').notNull().default(5),
  threshold: money('threshold').notNull().default(0),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
}, (t) => ({ uq: uniqueIndex('categories_code_uq').on(t.entityId, t.code) }));

export const assets = pgTable('assets', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  code: varchar('code', { length: 40 }).notNull(),
  designation: text('designation').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  status: assetStatus('status').notNull().default('EN_STOCK'),
  condition: assetCondition('condition').notNull().default('BON'),
  serialNumber: varchar('serial_number', { length: 80 }),
  brand: text('brand'),
  model: text('model'),
  entryMode: entryMode('entry_mode').notNull().default('ACHAT'),
  acquisitionDate: date('acquisition_date', { mode: 'string' }).notNull(),
  inServiceDate: date('in_service_date', { mode: 'string' }),
  acquisitionValue: money('acquisition_value').notNull(),
  residualValue: money('residual_value').notNull().default(0),
  openingDepreciation: money('opening_depreciation').notNull().default(0), // amortissements reconstitués à la reprise
  deprMethod: deprMethod('depr_method').notNull(),
  deprYears: integer('depr_years').notNull(),
  locationId: integer('location_id').references(() => locations.id),
  orgUnitId: integer('org_unit_id').references(() => orgUnits.id),
  holderId: integer('holder_id').references(() => users.id),
  labelStatus: labelStatus('label_status').notNull().default('GENEREE'),
  supplier: text('supplier'),
  invoiceRef: text('invoice_ref'),
  receptionId: integer('reception_id'),
  entryOrderNo: varchar('entry_order_no', { length: 40 }),
  warrantyEnd: date('warranty_end', { mode: 'string' }),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
  revisedAt: date('revised_at', { mode: 'string' }), // date d'effet de la dernière révision de durée
  revisedCumulative: money('revised_cumulative'),     // cumul figé à la veille de la révision
  previousYears: integer('previous_years'),            // durée applicable avant la révision
  impairment: money('impairment').notNull().default(0), // dépréciation (comptes 29x), distincte des amortissements
  exitDate: date('exit_date', { mode: 'string' }),
  exitReason: text('exit_reason'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  code: uniqueIndex('assets_code_uq').on(t.entityId, t.code),
  status: index('assets_status_idx').on(t.entityId, t.status),
  cat: index('assets_cat_idx').on(t.categoryId),
  loc: index('assets_loc_idx').on(t.locationId),
  holder: index('assets_holder_idx').on(t.holderId),
}));

/** Historique de la fiche bien : chaque opération y laisse une ligne. */
export const assetEvents = pgTable('asset_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  type: varchar('type', { length: 40 }).notNull(),
  documentNo: varchar('document_no', { length: 40 }),
  summary: text('summary').notNull(),
  actorId: integer('actor_id').references(() => users.id),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ asset: index('asset_events_asset_idx').on(t.assetId) }));

export const sequences = pgTable('sequences', {
  entityId: integer('entity_id').notNull(),
  key: varchar('key', { length: 40 }).notNull(),
  year: integer('year').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.entityId, t.key, t.year] }) }));

/** Circuit de validation générique : une ligne par étape. */
export const approvals = pgTable('approvals', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  objectType: varchar('object_type', { length: 30 }).notNull(), // MOUVEMENT, RECEPTION, REFORME, REVISION
  objectId: integer('object_id').notNull(),
  step: integer('step').notNull(),
  label: text('label').notNull(),
  role: roleCode('role'),
  userId: integer('user_id').references(() => users.id), // étape nominative (signature du détenteur)
  status: varchar('status', { length: 12 }).notNull().default('ATTENTE'), // ATTENTE, EN_COURS, APPROUVE, REJETE
  decidedBy: integer('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  comment: text('comment'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({ obj: index('approvals_obj_idx').on(t.objectType, t.objectId) }));

export const receptions = pgTable('receptions', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  status: varchar('status', { length: 16 }).notNull().default('BROUILLON'), // BROUILLON, A_VALIDER, VALIDEE, REJETEE
  entryMode: entryMode('entry_mode').notNull().default('ACHAT'),
  supplier: text('supplier').notNull(),
  orderRef: text('order_ref'),
  deliveryNote: text('delivery_note'),
  invoiceRef: text('invoice_ref'),
  deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
  locationId: integer('location_id').references(() => locations.id),
  notes: text('notes'),
  createdBy: integer('created_by').notNull().references(() => users.id),
  validatedAt: timestamp('validated_at', { withTimezone: true }),
  entryOrderNo: varchar('entry_order_no', { length: 40 }),
  createdAt: createdAt(),
});

export const receptionLines = pgTable('reception_lines', {
  id: serial('id').primaryKey(),
  receptionId: integer('reception_id').notNull().references(() => receptions.id, { onDelete: 'cascade' }),
  designation: text('designation').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  brand: text('brand'),
  model: text('model'),
  qtyOrdered: integer('qty_ordered').notNull(),
  qtyDelivered: integer('qty_delivered').notNull(),
  qtyAccepted: integer('qty_accepted').notNull(),
  unitValue: money('unit_value').notNull(),
  reserve: text('reserve'),
  serials: jsonb('serials').$type<string[]>().notNull().default([]),
});

export const movements = pgTable('movements', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  type: varchar('type', { length: 16 }).notNull(), // AFFECTATION, TRANSFERT, PRET, RESTITUTION
  status: varchar('status', { length: 16 }).notNull().default('A_VALIDER'), // A_VALIDER, EN_TRANSIT, EXECUTE, REJETE, RETOURNE
  toLocationId: integer('to_location_id').references(() => locations.id),
  toOrgUnitId: integer('to_org_unit_id').references(() => orgUnits.id),
  toHolderId: integer('to_holder_id').references(() => users.id),
  dueDate: date('due_date', { mode: 'string' }),
  reason: text('reason'),
  requestedBy: integer('requested_by').notNull().references(() => users.id),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const movementItems = pgTable('movement_items', {
  movementId: integer('movement_id').notNull().references(() => movements.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  fromLocationId: integer('from_location_id'),
  fromOrgUnitId: integer('from_org_unit_id'),
  fromHolderId: integer('from_holder_id'),
  fromStatus: assetStatus('from_status'),
}, (t) => ({ pk: primaryKey({ columns: [t.movementId, t.assetId] }) }));

export const inventoryCampaigns = pgTable('inventory_campaigns', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  label: text('label').notNull(),
  type: varchar('type', { length: 20 }).notNull().default('GENERAL'), // GENERAL, TOURNANT, CIBLE, PASSATION
  status: varchar('status', { length: 16 }).notNull().default('PREPARATION'), // PREPARATION, EN_COURS, CLOTUREE
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  blind: boolean('blind').notNull().default(true),
  freezeMovements: boolean('freeze_movements').notNull().default(true),
  expectedCount: integer('expected_count').notNull().default(0),
  createdBy: integer('created_by').notNull().references(() => users.id),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const inventoryZones = pgTable('inventory_zones', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => inventoryCampaigns.id, { onDelete: 'cascade' }),
  locationId: integer('location_id').notNull().references(() => locations.id),
  leaderId: integer('leader_id').references(() => users.id),
  status: varchar('status', { length: 12 }).notNull().default('A_FAIRE'), // A_FAIRE, EN_COURS, TERMINEE
  expectedCount: integer('expected_count').notNull().default(0),
});

/** Photo du registre au lancement : la liste des biens attendus, figée. */
export const inventoryExpected = pgTable('inventory_expected', {
  campaignId: integer('campaign_id').notNull().references(() => inventoryCampaigns.id, { onDelete: 'cascade' }),
  zoneId: integer('zone_id').notNull().references(() => inventoryZones.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  expectedLocationId: integer('expected_location_id'),
  expectedCondition: assetCondition('expected_condition'),
}, (t) => ({ pk: primaryKey({ columns: [t.campaignId, t.assetId] }) }));

export const inventoryCounts = pgTable('inventory_counts', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => inventoryCampaigns.id, { onDelete: 'cascade' }),
  zoneId: integer('zone_id').notNull().references(() => inventoryZones.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').references(() => assets.id),
  scannedCode: varchar('scanned_code', { length: 60 }).notNull(),
  locationId: integer('location_id').references(() => locations.id),
  condition: assetCondition('condition').notNull(),
  comment: text('comment'),
  countedBy: integer('counted_by').notNull().references(() => users.id),
  countedAt: timestamp('counted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ camp: index('inv_counts_campaign_idx').on(t.campaignId) }));

export const inventoryGaps = pgTable('inventory_gaps', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => inventoryCampaigns.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 16 }).notNull(), // MANQUANT, EXCEDENT, MAL_LOCALISE, ECART_ETAT
  assetId: integer('asset_id').references(() => assets.id),
  scannedCode: varchar('scanned_code', { length: 60 }),
  detail: text('detail').notNull(),
  decision: varchar('decision', { length: 30 }), // voir InventoryService.DECISIONS
  decisionComment: text('decision_comment'),
  status: varchar('status', { length: 12 }).notNull().default('A_TRAITER'), // A_TRAITER, DECIDE, REGULARISE
  decidedBy: integer('decided_by').references(() => users.id),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
});

export const depreciationRuns = pgTable('depreciation_runs', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull(),
  period: varchar('period', { length: 7 }).notNull(), // AAAA-MM
  mode: varchar('mode', { length: 12 }).notNull(), // SIMULATION, DEFINITIF, ANNULE
  assetCount: integer('asset_count').notNull().default(0),
  total: money('total').notNull().default(0),
  anomalies: jsonb('anomalies').$type<{ assetId: number; code: string; reason: string }[]>().notNull().default([]),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ per: index('depr_runs_period_idx').on(t.entityId, t.period) }));

export const depreciationLines = pgTable('depreciation_lines', {
  runId: integer('run_id').notNull().references(() => depreciationRuns.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  amount: money('amount').notNull(),
  cumulativeAfter: money('cumulative_after').notNull(),
  deprAccount: varchar('depr_account', { length: 12 }),
  expenseAccount: varchar('expense_account', { length: 12 }),
}, (t) => ({ pk: primaryKey({ columns: [t.runId, t.assetId] }) }));

export const fiscalPeriods = pgTable('fiscal_periods', {
  entityId: integer('entity_id').notNull(),
  period: varchar('period', { length: 7 }).notNull(),
  closed: boolean('closed').notNull().default(false),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: integer('closed_by'),
}, (t) => ({ pk: primaryKey({ columns: [t.entityId, t.period] }) }));

export const journalBatches = pgTable('journal_batches', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  originType: varchar('origin_type', { length: 20 }).notNull(), // DOTATION, RECEPTION, SORTIE
  originRef: varchar('origin_ref', { length: 40 }).notNull(),
  label: text('label').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('A_ENVOYER'), // A_ENVOYER, INTEGRE, REJETE
  total: money('total').notNull(),
  rejectReason: text('reject_reason'),
  createdAt: createdAt(),
});

export const journalLines = pgTable('journal_lines', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').notNull().references(() => journalBatches.id, { onDelete: 'cascade' }),
  account: varchar('account', { length: 12 }).notNull(),
  label: text('label').notNull(),
  debit: money('debit').notNull().default(0),
  credit: money('credit').notNull().default(0),
});

export const disposals = pgTable('disposals', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  title: text('title').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('BROUILLON'), // BROUILLON, EN_COURS, APPROUVE, SORTI, REJETE
  exitMode: varchar('exit_mode', { length: 20 }).notNull().default('VENTE'), // VENTE, DESTRUCTION, DON, RECYCLAGE, PERTE
  reason: text('reason'),
  commissionDate: date('commission_date', { mode: 'string' }),
  proceeds: money('proceeds').notNull().default(0),
  exitOrderNo: varchar('exit_order_no', { length: 40 }),
  createdBy: integer('created_by').notNull().references(() => users.id),
  executedAt: timestamp('executed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const disposalItems = pgTable('disposal_items', {
  disposalId: integer('disposal_id').notNull().references(() => disposals.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  motive: text('motive').notNull(),
  nbvAtProposal: money('nbv_at_proposal').notNull(),
  previousStatus: assetStatus('previous_status').notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.disposalId, t.assetId] }) }));

/** Demandes du portail détenteur. */
export const holderRequests = pgTable('holder_requests', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  type: varchar('type', { length: 16 }).notNull(), // PANNE, PERTE, EQUIPEMENT, RESTITUTION
  assetId: integer('asset_id').references(() => assets.id),
  description: text('description').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('OUVERTE'), // OUVERTE, EN_COURS, TRAITEE, REJETEE
  response: text('response'),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const attestations = pgTable('attestations', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id').notNull().references(() => inventoryCampaigns.id),
  holderId: integer('holder_id').notNull().references(() => users.id),
  assetCount: integer('asset_count').notNull(),
  disputed: boolean('disputed').notNull().default(false),
  comment: text('comment'),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex('attestations_uq').on(t.campaignId, t.holderId) }));

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  kind: varchar('kind', { length: 12 }).notNull().default('info'), // info, warn, bad, ok
  title: text('title').notNull(),
  body: text('body').notNull(),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({ user: index('notifications_user_idx').on(t.userId) }));

/** Journal d'audit en ajout seul, chaîné par empreintes SHA-256 (triggers dans la migration). */
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  entityId: integer('entity_id'),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  userId: integer('user_id'),
  userName: text('user_name'),
  action: varchar('action', { length: 40 }).notNull(),
  objectType: varchar('object_type', { length: 30 }),
  objectRef: varchar('object_ref', { length: 60 }),
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  ip: varchar('ip', { length: 64 }),
  prevHash: varchar('prev_hash', { length: 64 }).notNull(),
  hash: varchar('hash', { length: 64 }).notNull(),
});

/* ====================================================================================
 * LOT 2 — immobilier, parc automobile, maintenance, contrats, révisions de valeur,
 * rapprochement et clôture d'exercice, documents (GED).
 * ==================================================================================== */

export const titleType = pgEnum('title_type', ['TITRE_FONCIER', 'ACD', 'LETTRE_ATTRIBUTION', 'AUCUN']);

/** Données propres aux biens immobiliers (terrain ou bâtiment), en complément de la fiche bien. */
export const properties = pgTable('properties', {
  assetId: integer('asset_id').primaryKey().references(() => assets.id),
  kind: varchar('kind', { length: 12 }).notNull(), // TERRAIN, BATIMENT
  address: text('address'),
  lat: text('lat'),
  lng: text('lng'),
  landArea: integer('land_area'), // m²
  builtArea: integer('built_area'),
  floors: integer('floors'),
  titleType: titleType('title_type').notNull().default('AUCUN'),
  titleRef: text('title_ref'),
  owner: text('owner'),
  assignmentAct: text('assignment_act'),
  easements: text('easements'),
  titleProcedure: text('title_procedure'), // avancement de la procédure de sécurisation
});

/** Composants d'un bien (approche par composants). */
export const assetComponents = pgTable('asset_components', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  label: text('label').notNull(),
  value: money('value').notNull(),
  durationYears: integer('duration_years').notNull(),
  inServiceDate: date('in_service_date', { mode: 'string' }).notNull(),
  replacedAt: date('replaced_at', { mode: 'string' }),
});

/** Occupation : services occupants et baux consentis à des tiers. */
export const occupancies = pgTable('occupancies', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  kind: varchar('kind', { length: 16 }).notNull(), // AFFECTATION, BAIL, VACANT
  occupant: text('occupant').notNull(),
  orgUnitId: integer('org_unit_id').references(() => orgUnits.id),
  area: integer('area').notNull(),
  floors: text('floors'),
  monthlyRent: money('monthly_rent').notNull().default(0),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
});

/** Travaux, contentieux et contrôles réglementaires d'un bien immobilier. */
export const propertyEvents = pgTable('property_events', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  kind: varchar('kind', { length: 16 }).notNull(), // TRAVAUX, CONTENTIEUX, CONTROLE
  title: text('title').notNull(),
  status: varchar('status', { length: 16 }).notNull(), // PROGRAMME, EN_COURS, CLOS, A_JOUR
  amount: money('amount').notNull().default(0),
  date: date('date', { mode: 'string' }),
  nextDate: date('next_date', { mode: 'string' }),
  notes: text('notes'),
});

export const vehicles = pgTable('vehicles', {
  assetId: integer('asset_id').primaryKey().references(() => assets.id),
  plate: varchar('plate', { length: 20 }).notNull(),
  vin: varchar('vin', { length: 40 }),
  energy: varchar('energy', { length: 12 }).notNull().default('GASOIL'),
  fiscalPower: integer('fiscal_power'),
  seats: integer('seats'),
  mileage: integer('mileage').notNull().default(0),
  driverId: integer('driver_id').references(() => users.id),
  firstRegistration: date('first_registration', { mode: 'string' }),
  serviceIntervalKm: integer('service_interval_km').notNull().default(10000),
  lastServiceKm: integer('last_service_km').notNull().default(0),
}, (t) => ({ plate: uniqueIndex('vehicles_plate_uq').on(t.plate) }));

/** Échéances réglementaires : visite technique, vignette, carte grise, contrôle incendie… */
export const deadlines = pgTable('deadlines', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  kind: varchar('kind', { length: 30 }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  doneAt: date('done_at', { mode: 'string' }),
  notes: text('notes'),
});

export const fuelLogs = pgTable('fuel_logs', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  date: date('date', { mode: 'string' }).notNull(),
  liters: integer('liters').notNull(),
  amount: money('amount').notNull(),
  mileage: integer('mileage').notNull(),
  station: text('station'),
  cardRef: text('card_ref'),
  createdBy: integer('created_by').notNull().references(() => users.id),
}, (t) => ({ veh: index('fuel_logs_asset_idx').on(t.assetId) }));

export const missions = pgTable('missions', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  driverId: integer('driver_id').references(() => users.id),
  requesterId: integer('requester_id').notNull().references(() => users.id),
  destination: text('destination').notNull(),
  purpose: text('purpose').notNull(),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('DEMANDE'), // DEMANDE, VALIDEE, EN_COURS, CLOTUREE, REJETEE, ANNULEE
  startMileage: integer('start_mileage'),
  endMileage: integer('end_mileage'),
  createdAt: createdAt(),
});

export const vehicleIncidents = pgTable('vehicle_incidents', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  kind: varchar('kind', { length: 12 }).notNull(), // SINISTRE, INFRACTION
  date: date('date', { mode: 'string' }).notNull(),
  driverId: integer('driver_id').references(() => users.id),
  description: text('description').notNull(),
  amount: money('amount').notNull().default(0),
  insuranceClaim: text('insurance_claim'),
  status: varchar('status', { length: 12 }).notNull().default('OUVERT'), // OUVERT, EXPERTISE, CLOS
});

export const contracts = pgTable('contracts', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  kind: varchar('kind', { length: 16 }).notNull(), // MAINTENANCE, ASSURANCE, GARANTIE, LOCATION
  title: text('title').notNull(),
  provider: text('provider').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  annualAmount: money('annual_amount').notNull().default(0),
  insuredValue: money('insured_value').notNull().default(0),
  slaHours: integer('sla_hours'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});
export const contractAssets = pgTable('contract_assets', {
  contractId: integer('contract_id').notNull().references(() => contracts.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
}, (t) => ({ pk: primaryKey({ columns: [t.contractId, t.assetId] }) }));

export const workOrders = pgTable('work_orders', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  kind: varchar('kind', { length: 12 }).notNull(), // CORRECTIF, PREVENTIF
  title: text('title').notNull(),
  description: text('description'),
  priority: varchar('priority', { length: 8 }).notNull().default('NORMALE'), // BASSE, NORMALE, HAUTE, URGENTE
  status: varchar('status', { length: 16 }).notNull().default('A_PLANIFIER'), // A_PLANIFIER, PLANIFIE, EN_COURS, ATTENTE_PIECES, TERMINE, ANNULE
  assignee: text('assignee'),
  contractId: integer('contract_id').references(() => contracts.id),
  requestId: integer('request_id'),
  planId: integer('plan_id'),
  plannedDate: date('planned_date', { mode: 'string' }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
  laborCost: money('labor_cost').notNull().default(0),
  partsCost: money('parts_cost').notNull().default(0),
  report: text('report'),
  previousStatus: assetStatus('previous_status'),
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => ({ asset: index('work_orders_asset_idx').on(t.assetId) }));

/** Plans de maintenance préventive : par bien ou par catégorie. */
export const maintenancePlans = pgTable('maintenance_plans', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  label: text('label').notNull(),
  assetId: integer('asset_id').references(() => assets.id),
  categoryId: integer('category_id').references(() => categories.id),
  frequencyMonths: integer('frequency_months').notNull(),
  nextDate: date('next_date', { mode: 'string' }).notNull(),
  contractId: integer('contract_id').references(() => contracts.id),
  assignee: text('assignee'),
  active: boolean('active').notNull().default(true),
});

/** Opérations de valorisation : révision de durée, dépréciation, reprise de dépréciation. */
export const revaluations = pgTable('revaluations', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  number: varchar('number', { length: 40 }).notNull().unique(),
  kind: varchar('kind', { length: 20 }).notNull(), // REVISION_DUREE, DEPRECIATION, REPRISE_DEPRECIATION
  title: text('title').notNull(),
  reason: text('reason').notNull(),
  effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  newYears: integer('new_years'),
  status: varchar('status', { length: 12 }).notNull().default('BROUILLON'), // BROUILLON, EN_COURS, APPLIQUE, REJETE
  createdBy: integer('created_by').notNull().references(() => users.id),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: createdAt(),
});
export const revaluationItems = pgTable('revaluation_items', {
  revaluationId: integer('revaluation_id').notNull().references(() => revaluations.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id').notNull().references(() => assets.id),
  amount: money('amount').notNull().default(0), // montant de dépréciation ou de reprise
  annualBefore: money('annual_before').notNull().default(0),
  annualAfter: money('annual_after').notNull().default(0),
}, (t) => ({ pk: primaryKey({ columns: [t.revaluationId, t.assetId] }) }));

/** Soldes de la comptabilité générale importés de l'ERP (rapprochement). */
export const ledgerBalances = pgTable('ledger_balances', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  account: varchar('account', { length: 12 }).notNull(),
  label: text('label'),
  balance: money('balance').notNull(), // solde débiteur positif ; créditeur (28x) en valeur absolue
  importedBy: integer('imported_by').notNull().references(() => users.id),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: uniqueIndex('ledger_balances_uq').on(t.entityId, t.date, t.account) }));

/** Explications des écarts de rapprochement. */
export const reconciliationNotes = pgTable('reconciliation_notes', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  account: varchar('account', { length: 12 }).notNull(),
  amount: money('amount').notNull(),
  label: text('label').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('A_CORRIGER'), // A_CORRIGER, CORRIGE, JUSTIFIE
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const fiscalYears = pgTable('fiscal_years', {
  entityId: integer('entity_id').notNull(),
  year: integer('year').notNull(),
  status: varchar('status', { length: 10 }).notNull().default('OUVERT'), // OUVERT, CLOTURE
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: integer('closed_by'),
  summary: jsonb('summary').$type<Record<string, unknown>>(),
}, (t) => ({ pk: primaryKey({ columns: [t.entityId, t.year] }) }));

/** Gestion électronique des documents : pièces rattachées à un objet métier. */
export const documents = pgTable('documents', {
  id: serial('id').primaryKey(),
  entityId: integer('entity_id').notNull(),
  objectType: varchar('object_type', { length: 20 }).notNull(), // BIEN, RECEPTION, MOUVEMENT, REFORME, CONTRAT, MISSION, OT, INVENTAIRE
  objectId: integer('object_id').notNull(),
  category: varchar('category', { length: 30 }).notNull(), // FACTURE, PV, TITRE, CONTRAT, PHOTO, DECHARGE, AUTRE
  filename: text('filename').notNull(),
  mime: varchar('mime', { length: 120 }).notNull(),
  size: integer('size').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  storageKey: text('storage_key').notNull(),
  uploadedBy: integer('uploaded_by').notNull().references(() => users.id),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ obj: index('documents_obj_idx').on(t.objectType, t.objectId) }));
