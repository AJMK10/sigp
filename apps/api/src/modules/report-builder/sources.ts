import type { Permission } from '../../common/permissions';

/**
 * Catalogue des sources du générateur d'états. Seuls les champs déclarés ici peuvent être interrogés :
 * les expressions SQL sont des constantes du code, les valeurs saisies par l'utilisateur passent en paramètres.
 */
export type FieldType = 'text' | 'enum' | 'number' | 'money' | 'date' | 'percent';
export interface FieldDef {
  label: string;
  type: FieldType;
  /** Expression SQL (constante). Absente pour un champ calculé après lecture. */
  sql?: string;
  /** Champ calculé par le moteur d'amortissement (biens uniquement). */
  computed?: 'cumulative' | 'nbv' | 'wear';
  options?: Record<string, string>;
  /** Proposé par défaut à la création d'un état sur cette source. */
  default?: boolean;
}
export interface SourceDef {
  label: string;
  description: string;
  perms: Permission[];
  from: string;
  entity: string;
  /** Identifiant du bien, requis pour les champs calculés. */
  assetId?: string;
  fields: Record<string, FieldDef>;
}

const ASSET_STATUS = { EN_SERVICE: 'En service', EN_STOCK: 'En stock', EN_MAINTENANCE: 'En maintenance', EN_PRET: 'En prêt', EN_TRANSIT: 'En transit', MANQUANT: 'Manquant', PROPOSE_REFORME: 'Proposé à la réforme', SORTI: 'Sorti' };
const CONDITION = { NEUF: 'Neuf', BON: 'Bon', MOYEN: 'Moyen', MAUVAIS: 'Mauvais', HORS_USAGE: "Hors d'usage" };
const ENTRY = { ACHAT: 'Achat', DON: 'Don ou legs', TRANSFERT_ENTRANT: 'Transfert entrant', PRODUCTION: 'Production interne', REGULARISATION: "Régularisation d'inventaire", REPRISE: "Reprise de l'existant" };
const LABEL = { GENEREE: 'Générée', IMPRIMEE: 'Imprimée', POSEE: 'Posée', CONTROLEE: 'Contrôlée' };
const METHOD = { LINEAIRE: 'Linéaire', DEGRESSIF: 'Dégressif', NON_AMORTISSABLE: 'Non amortissable' };
const MV_TYPE = { AFFECTATION: 'Affectation', TRANSFERT: 'Transfert', PRET: 'Prêt temporaire', RESTITUTION: 'Restitution' };
const MV_STATUS = { A_VALIDER: 'En validation', EN_TRANSIT: 'En transit', EXECUTE: 'Exécuté', REJETE: 'Rejeté' };
const DISP_STATUS = { BROUILLON: 'Brouillon', EN_COURS: 'En circuit', APPROUVE: 'Sortie décidée', SORTI: 'Sortie exécutée', REJETE: 'Rejeté' };
const EXIT = { VENTE: 'Vente aux enchères', DESTRUCTION: 'Destruction', DON: 'Don ou cession gratuite', RECYCLAGE: 'Recyclage DEEE', PERTE: 'Perte ou vol constaté' };
const WO_KIND = { CORRECTIF: 'Correctif', PREVENTIF: 'Préventif' };
const WO_PRIO = { BASSE: 'Basse', NORMALE: 'Normale', HAUTE: 'Haute', URGENTE: 'Urgente' };
const WO_STATUS = { A_PLANIFIER: 'À planifier', PLANIFIE: 'Planifié', EN_COURS: 'En cours', ATTENTE_PIECES: 'Attente de pièces', TERMINE: 'Terminé', ANNULE: 'Annulé' };
const YESNO = { OUI: 'Oui', NON: 'Non' };
const MISSION = { DEMANDE: 'À valider', VALIDEE: 'Validée', EN_COURS: 'En cours', CLOTUREE: 'Clôturée', REJETEE: 'Refusée', ANNULEE: 'Annulée' };
const CT_KIND = { MAINTENANCE: 'Maintenance', ASSURANCE: 'Assurance', GARANTIE: 'Garantie', LOCATION: 'Location' };
const J_STATUS = { A_ENVOYER: 'À envoyer', INTEGRE: 'Intégré', REJETE: 'Rejeté', ANNULE: 'Annulé' };
const J_ORIGIN = { DOTATION: 'Dotations', RECEPTION: 'Entrée en patrimoine', SORTIE: 'Sortie du patrimoine', REVISION: 'Révision ou dépréciation' };
const GAP_TYPE = { MANQUANT: 'Manquant', EXCEDENT: 'Excédent', MAL_LOCALISE: 'Mal localisé', ECART_ETAT: "Écart d'état" };
const GAP_STATUS = { A_TRAITER: 'À traiter', DECIDE: 'En cours', REGULARISE: 'Régularisé' };

export const SOURCES: Record<string, SourceDef> = {
  biens: {
    label: 'Registre des biens', description: 'Une ligne par bien, avec ses valeurs comptables à la date du jour.', perms: ['assets.read', 'reports.read'],
    from: `assets a JOIN categories c ON c.id = a.category_id LEFT JOIN org_units ou ON ou.id = a.org_unit_id LEFT JOIN users h ON h.id = a.holder_id
      LEFT JOIN locations l1 ON l1.id = a.location_id LEFT JOIN locations l2 ON l2.id = l1.parent_id LEFT JOIN locations l3 ON l3.id = l2.parent_id LEFT JOIN locations l4 ON l4.id = l3.parent_id`,
    entity: 'a.entity_id', assetId: 'a.id',
    fields: {
      code: { label: 'Code', type: 'text', sql: 'a.code', default: true },
      designation: { label: 'Désignation', type: 'text', sql: 'a.designation', default: true },
      categorie: { label: 'Catégorie', type: 'text', sql: 'c.label', default: true },
      compte: { label: 'Compte', type: 'text', sql: 'c.asset_account' },
      statut: { label: 'Statut', type: 'enum', sql: 'a.status::text', options: ASSET_STATUS, default: true },
      etat: { label: 'État', type: 'enum', sql: 'a.condition::text', options: CONDITION },
      mode_entree: { label: "Mode d'entrée", type: 'enum', sql: 'a.entry_mode::text', options: ENTRY },
      site: { label: 'Site', type: 'text', sql: 'COALESCE(l4.name, l3.name, l2.name, l1.name)' },
      localisation: { label: 'Local', type: 'text', sql: 'l1.name' },
      service: { label: 'Service', type: 'text', sql: 'ou.name' },
      detenteur: { label: 'Détenteur', type: 'text', sql: 'h.full_name' },
      fournisseur: { label: 'Fournisseur', type: 'text', sql: 'a.supplier' },
      marque: { label: 'Marque', type: 'text', sql: 'a.brand' },
      numero_serie: { label: 'N° de série', type: 'text', sql: 'a.serial_number' },
      date_acquisition: { label: "Date d'acquisition", type: 'date', sql: "to_char(a.acquisition_date, 'YYYY-MM-DD')" },
      annee_acquisition: { label: "Année d'acquisition", type: 'number', sql: 'extract(year from a.acquisition_date)::int' },
      date_mise_service: { label: 'Mise en service', type: 'date', sql: "to_char(a.in_service_date, 'YYYY-MM-DD')" },
      fin_garantie: { label: 'Fin de garantie', type: 'date', sql: "to_char(a.warranty_end, 'YYYY-MM-DD')" },
      etiquette: { label: 'Étiquette', type: 'enum', sql: 'a.label_status::text', options: LABEL },
      methode: { label: "Méthode d'amortissement", type: 'enum', sql: 'a.depr_method::text', options: METHOD },
      duree: { label: "Durée d'amortissement (ans)", type: 'number', sql: 'a.depr_years' },
      valeur_origine: { label: "Valeur d'origine", type: 'money', sql: 'a.acquisition_value', default: true },
      depreciation: { label: 'Dépréciation', type: 'money', sql: 'a.impairment' },
      cumul: { label: 'Cumul des amortissements', type: 'money', computed: 'cumulative' },
      vnc: { label: 'Valeur nette comptable', type: 'money', computed: 'nbv', default: true },
      vetuste: { label: 'Taux de vétusté', type: 'percent', computed: 'wear' },
    },
  },
  mouvements: {
    label: 'Mouvements', description: 'Affectations, transferts, prêts et restitutions.', perms: ['reports.read'],
    from: `movements m LEFT JOIN users u ON u.id = m.requested_by LEFT JOIN users th ON th.id = m.to_holder_id LEFT JOIN org_units tou ON tou.id = m.to_org_unit_id LEFT JOIN locations tl ON tl.id = m.to_location_id`,
    entity: 'm.entity_id',
    fields: {
      numero: { label: 'Numéro', type: 'text', sql: 'm.number', default: true },
      type: { label: 'Type', type: 'enum', sql: 'm.type', options: MV_TYPE, default: true },
      statut: { label: 'Statut', type: 'enum', sql: 'm.status', options: MV_STATUS, default: true },
      demandeur: { label: 'Demandeur', type: 'text', sql: 'u.full_name' },
      destinataire: { label: 'Destinataire', type: 'text', sql: 'COALESCE(th.full_name, tou.name, tl.name)', default: true },
      date: { label: 'Date de la demande', type: 'date', sql: "to_char(m.created_at, 'YYYY-MM-DD')", default: true },
      date_execution: { label: "Date d'exécution", type: 'date', sql: "to_char(m.executed_at, 'YYYY-MM-DD')" },
      motif: { label: 'Motif', type: 'text', sql: 'm.reason' },
      nb_biens: { label: 'Nombre de biens', type: 'number', sql: '(SELECT count(*) FROM movement_items mi WHERE mi.movement_id = m.id)::int', default: true },
      valeur: { label: "Valeur d'origine", type: 'money', sql: '(SELECT COALESCE(sum(x.acquisition_value), 0) FROM movement_items mi JOIN assets x ON x.id = mi.asset_id WHERE mi.movement_id = m.id)::bigint', default: true },
    },
  },
  reformes: {
    label: 'Réformes et sorties', description: 'Dossiers de réforme, mode et produit de sortie.', perms: ['reports.read'],
    from: 'disposals d LEFT JOIN users u ON u.id = d.created_by', entity: 'd.entity_id',
    fields: {
      numero: { label: 'Dossier', type: 'text', sql: 'd.number', default: true },
      objet: { label: 'Objet', type: 'text', sql: 'd.title', default: true },
      mode: { label: 'Mode de sortie', type: 'enum', sql: 'd.exit_mode', options: EXIT, default: true },
      statut: { label: 'Statut', type: 'enum', sql: 'd.status', options: DISP_STATUS, default: true },
      auteur: { label: 'Initié par', type: 'text', sql: 'u.full_name' },
      date: { label: 'Date de création', type: 'date', sql: "to_char(d.created_at, 'YYYY-MM-DD')" },
      date_commission: { label: 'Date de commission', type: 'date', sql: "to_char(d.commission_date, 'YYYY-MM-DD')" },
      date_sortie: { label: 'Date de sortie', type: 'date', sql: "to_char(d.executed_at, 'YYYY-MM-DD')" },
      nb_biens: { label: 'Nombre de biens', type: 'number', sql: '(SELECT count(*) FROM disposal_items di WHERE di.disposal_id = d.id)::int', default: true },
      vnc: { label: 'VNC à la proposition', type: 'money', sql: '(SELECT COALESCE(sum(di.nbv_at_proposal), 0) FROM disposal_items di WHERE di.disposal_id = d.id)::bigint', default: true },
      produit: { label: 'Produit de cession', type: 'money', sql: 'd.proceeds', default: true },
    },
  },
  maintenance: {
    label: 'Ordres de travail', description: 'Interventions de maintenance, délais et coûts.', perms: ['maintenance.manage', 'reports.read'],
    from: 'work_orders w JOIN assets a ON a.id = w.asset_id JOIN categories c ON c.id = a.category_id', entity: 'w.entity_id',
    fields: {
      numero: { label: 'Ordre', type: 'text', sql: 'w.number', default: true },
      nature: { label: 'Nature', type: 'enum', sql: 'w.kind', options: WO_KIND, default: true },
      priorite: { label: 'Priorité', type: 'enum', sql: 'w.priority', options: WO_PRIO },
      statut: { label: 'Statut', type: 'enum', sql: 'w.status', options: WO_STATUS, default: true },
      objet: { label: 'Objet', type: 'text', sql: 'w.title', default: true },
      bien_code: { label: 'Code du bien', type: 'text', sql: 'a.code' },
      bien: { label: 'Bien', type: 'text', sql: 'a.designation', default: true },
      categorie: { label: 'Catégorie', type: 'text', sql: 'c.label' },
      intervenant: { label: 'Intervenant', type: 'text', sql: 'w.assignee' },
      sous_contrat: { label: 'Sous contrat ou garantie', type: 'enum', sql: "CASE WHEN w.contract_id IS NULL THEN 'NON' ELSE 'OUI' END", options: YESNO },
      date_creation: { label: 'Date de création', type: 'date', sql: "to_char(w.created_at, 'YYYY-MM-DD')" },
      date_fin: { label: 'Date de fin', type: 'date', sql: "to_char(w.done_at, 'YYYY-MM-DD')" },
      mois_fin: { label: 'Mois de fin', type: 'text', sql: "to_char(w.done_at, 'YYYY-MM')" },
      duree_jours: { label: "Durée d'intervention (jours)", type: 'number', sql: 'round((extract(epoch from (w.done_at - w.started_at)) / 86400)::numeric, 1)::float' },
      main_oeuvre: { label: "Main-d'œuvre", type: 'money', sql: 'w.labor_cost' },
      pieces: { label: 'Pièces', type: 'money', sql: 'w.parts_cost' },
      cout: { label: 'Coût total', type: 'money', sql: '(w.labor_cost + w.parts_cost)', default: true },
    },
  },
  missions: {
    label: 'Ordres de mission', description: 'Missions des véhicules et kilomètres parcourus.', perms: ['fleet.manage', 'reports.read'],
    from: 'missions mi JOIN vehicles v ON v.asset_id = mi.asset_id JOIN assets a ON a.id = mi.asset_id LEFT JOIN users d ON d.id = mi.driver_id', entity: 'mi.entity_id',
    fields: {
      numero: { label: 'Ordre', type: 'text', sql: 'mi.number', default: true },
      immatriculation: { label: 'Immatriculation', type: 'text', sql: 'v.plate', default: true },
      vehicule: { label: 'Véhicule', type: 'text', sql: 'a.designation' },
      conducteur: { label: 'Conducteur', type: 'text', sql: 'd.full_name', default: true },
      destination: { label: 'Destination', type: 'text', sql: 'mi.destination', default: true },
      objet: { label: 'Objet', type: 'text', sql: 'mi.purpose' },
      statut: { label: 'Statut', type: 'enum', sql: 'mi.status', options: MISSION, default: true },
      depart: { label: 'Départ', type: 'date', sql: "to_char(mi.start_at, 'YYYY-MM-DD')", default: true },
      mois: { label: 'Mois', type: 'text', sql: "to_char(mi.start_at, 'YYYY-MM')" },
      km: { label: 'Kilomètres', type: 'number', sql: '(mi.end_mileage - mi.start_mileage)', default: true },
    },
  },
  carburant: {
    label: 'Carburant', description: 'Pleins des véhicules (cartes carburant).', perms: ['fleet.manage', 'reports.read'],
    from: 'fuel_logs f JOIN vehicles v ON v.asset_id = f.asset_id JOIN assets a ON a.id = f.asset_id', entity: 'a.entity_id',
    fields: {
      date: { label: 'Date', type: 'date', sql: "to_char(f.date, 'YYYY-MM-DD')", default: true },
      mois: { label: 'Mois', type: 'text', sql: "to_char(f.date, 'YYYY-MM')" },
      immatriculation: { label: 'Immatriculation', type: 'text', sql: 'v.plate', default: true },
      vehicule: { label: 'Véhicule', type: 'text', sql: 'a.designation', default: true },
      energie: { label: 'Énergie', type: 'enum', sql: 'v.energy', options: { ESSENCE: 'Essence', GASOIL: 'Gasoil', HYBRIDE: 'Hybride', ELECTRIQUE: 'Électrique' } },
      station: { label: 'Station', type: 'text', sql: 'f.station' },
      carte: { label: 'Carte', type: 'text', sql: 'f.card_ref' },
      compteur: { label: 'Compteur (km)', type: 'number', sql: 'f.mileage' },
      litres: { label: 'Litres', type: 'number', sql: 'f.liters', default: true },
      montant: { label: 'Montant', type: 'money', sql: 'f.amount', default: true },
    },
  },
  contrats: {
    label: 'Contrats et assurances', description: 'Contrats de maintenance, polices, garanties et locations.', perms: ['contracts.manage', 'reports.read'],
    from: 'contracts k', entity: 'k.entity_id',
    fields: {
      numero: { label: 'Contrat', type: 'text', sql: 'k.number', default: true },
      nature: { label: 'Nature', type: 'enum', sql: 'k.kind', options: CT_KIND, default: true },
      objet: { label: 'Objet', type: 'text', sql: 'k.title', default: true },
      prestataire: { label: 'Prestataire', type: 'text', sql: 'k.provider', default: true },
      debut: { label: 'Début', type: 'date', sql: "to_char(k.start_date, 'YYYY-MM-DD')" },
      fin: { label: 'Fin', type: 'date', sql: "to_char(k.end_date, 'YYYY-MM-DD')", default: true },
      actif: { label: 'Actif', type: 'enum', sql: "CASE WHEN k.active THEN 'OUI' ELSE 'NON' END", options: YESNO },
      montant_annuel: { label: 'Montant annuel', type: 'money', sql: 'k.annual_amount', default: true },
      valeur_assuree: { label: 'Valeur assurée', type: 'money', sql: 'k.insured_value' },
      nb_biens: { label: 'Biens couverts', type: 'number', sql: '(SELECT count(*) FROM contract_assets ca WHERE ca.contract_id = k.id)::int', default: true },
    },
  },
  ecritures: {
    label: 'Écritures comptables', description: 'Lignes des lots d\'écritures transmis à la comptabilité générale.', perms: ['journal.read'],
    from: 'journal_lines jl JOIN journal_batches jb ON jb.id = jl.batch_id', entity: 'jb.entity_id',
    fields: {
      date: { label: 'Date', type: 'date', sql: "to_char(jb.date, 'YYYY-MM-DD')", default: true },
      mois: { label: 'Mois', type: 'text', sql: "to_char(jb.date, 'YYYY-MM')" },
      lot: { label: 'Lot', type: 'text', sql: 'jb.number', default: true },
      origine: { label: 'Origine', type: 'enum', sql: 'jb.origin_type', options: J_ORIGIN },
      reference: { label: 'Pièce d\'origine', type: 'text', sql: 'jb.origin_ref' },
      statut: { label: 'Statut ERP', type: 'enum', sql: 'jb.status', options: J_STATUS },
      compte: { label: 'Compte', type: 'text', sql: 'jl.account', default: true },
      classe: { label: 'Classe de compte', type: 'text', sql: 'left(jl.account, 2)' },
      libelle: { label: 'Libellé', type: 'text', sql: 'jl.label', default: true },
      debit: { label: 'Débit', type: 'money', sql: 'jl.debit', default: true },
      credit: { label: 'Crédit', type: 'money', sql: 'jl.credit', default: true },
    },
  },
  ecarts: {
    label: "Écarts d'inventaire", description: 'Écarts constatés lors des campagnes et décisions prises.', perms: ['inventory.decide', 'inventory.manage', 'reports.read'],
    from: 'inventory_gaps g JOIN inventory_campaigns ic ON ic.id = g.campaign_id LEFT JOIN assets a ON a.id = g.asset_id', entity: 'ic.entity_id',
    fields: {
      campagne: { label: 'Campagne', type: 'text', sql: 'ic.number', default: true },
      type: { label: "Type d'écart", type: 'enum', sql: 'g.type', options: GAP_TYPE, default: true },
      statut: { label: 'Statut', type: 'enum', sql: 'g.status', options: GAP_STATUS, default: true },
      decision: { label: 'Décision', type: 'text', sql: 'g.decision' },
      bien_code: { label: 'Code du bien', type: 'text', sql: 'COALESCE(a.code, g.scanned_code)', default: true },
      bien: { label: 'Bien', type: 'text', sql: 'a.designation', default: true },
      detail: { label: 'Détail', type: 'text', sql: 'g.detail' },
      valeur: { label: "Valeur d'origine", type: 'money', sql: 'a.acquisition_value', default: true },
    },
  },
};
