const nf = new Intl.NumberFormat('fr-FR');
export const fcfa = (n: number | null | undefined) => (n == null ? '—' : nf.format(Math.round(n)));
export const pct = (x: number, d = 1) => `${(x * 100).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
/** Milliards / millions abrégés : 18,45 Md, 14,0 M. */
export const big = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} Md`;
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  return nf.format(n);
};
export const date = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d : d.toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
export const dateTime = (d: string | null | undefined) => {
  if (!d) return '—';
  const x = new Date(d);
  return `${date(d)} · ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'grey' | 'navy';
export const ASSET_STATUS: Record<string, [string, Tone]> = {
  EN_SERVICE: ['En service', 'ok'], EN_STOCK: ['En stock', 'grey'], EN_MAINTENANCE: ['En maintenance', 'warn'], EN_PRET: ['En prêt', 'info'], EN_TRANSIT: ['En transit', 'info'],
  MANQUANT: ['Manquant', 'bad'], PROPOSE_REFORME: ['Proposé à la réforme', 'navy'], SORTI: ['Sorti', 'grey'],
};
export const CONDITION: Record<string, string> = { NEUF: 'Neuf', BON: 'Bon', MOYEN: 'Moyen', MAUVAIS: 'Mauvais', HORS_USAGE: "Hors d'usage" };
export const LABEL_STATUS: Record<string, [string, Tone]> = { GENEREE: ['Générée', 'grey'], IMPRIMEE: ['Imprimée', 'info'], POSEE: ['Posée', 'warn'], CONTROLEE: ['Contrôlée', 'ok'] };
export const ENTRY_MODE: Record<string, string> = { ACHAT: 'Achat', DON: 'Don ou legs', TRANSFERT_ENTRANT: 'Transfert entrant', PRODUCTION: 'Production interne', REGULARISATION: "Régularisation d'inventaire", REPRISE: "Reprise de l'existant" };
export const RECEPTION_STATUS: Record<string, [string, Tone]> = { BROUILLON: ['Brouillon', 'grey'], A_VALIDER: ['À viser', 'warn'], VALIDEE: ['Validée', 'ok'], REJETEE: ['Rejetée', 'bad'] };
export const MOVEMENT_STATUS: Record<string, [string, Tone]> = { A_VALIDER: ['En validation', 'warn'], EN_TRANSIT: ['En transit', 'info'], EXECUTE: ['Exécuté', 'ok'], REJETE: ['Rejeté', 'bad'] };
export const MOVEMENT_TYPE: Record<string, string> = { AFFECTATION: 'Affectation', TRANSFERT: 'Transfert', PRET: 'Prêt temporaire', RESTITUTION: 'Restitution' };
export const CAMPAIGN_STATUS: Record<string, [string, Tone]> = { PREPARATION: ['En préparation', 'grey'], EN_COURS: ['En cours', 'info'], CLOTUREE: ['Clôturée', 'ok'] };
export const CAMPAIGN_TYPE: Record<string, string> = { GENERAL: 'Général annuel', TOURNANT: 'Tournant par site', CIBLE: 'Ciblé', PASSATION: 'Contradictoire de passation' };
export const GAP_TYPE: Record<string, string> = { MANQUANT: 'Manquants', EXCEDENT: 'Excédents', MAL_LOCALISE: 'Mal localisés', ECART_ETAT: "Écarts d'état" };
export const GAP_STATUS: Record<string, [string, Tone]> = { A_TRAITER: ['À traiter', 'bad'], DECIDE: ['En cours', 'warn'], REGULARISE: ['Régularisé', 'ok'] };
export const DISPOSAL_STATUS: Record<string, [string, Tone]> = { BROUILLON: ['Brouillon', 'grey'], EN_COURS: ['En circuit', 'warn'], APPROUVE: ['Sortie décidée', 'info'], SORTI: ['Sortie exécutée', 'ok'], REJETE: ['Rejeté', 'bad'] };
export const EXIT_MODE: Record<string, string> = { VENTE: 'Vente aux enchères', DESTRUCTION: 'Destruction', DON: 'Don ou cession gratuite', RECYCLAGE: 'Recyclage DEEE', PERTE: 'Perte ou vol constaté' };
export const JOURNAL_STATUS: Record<string, [string, Tone]> = { A_ENVOYER: ['À envoyer', 'grey'], INTEGRE: ['Intégré', 'ok'], REJETE: ['Rejeté', 'bad'], ANNULE: ['Annulé', 'grey'] };
export const STEP_STATUS: Record<string, [string, Tone]> = { ATTENTE: ['À venir', 'grey'], EN_COURS: ['En cours', 'warn'], APPROUVE: ['Validé', 'ok'], REJETE: ['Rejeté', 'bad'], ANNULE: ['Annulé', 'grey'] };
export const REQUEST_STATUS: Record<string, [string, Tone]> = { OUVERTE: ['Ouverte', 'warn'], EN_COURS: ['En cours', 'info'], TRAITEE: ['Traitée', 'ok'], REJETEE: ['Rejetée', 'bad'] };
export const ACTION_LABELS: Record<string, string> = {
  CONNEXION: 'Connexion', CONNEXION_ECHEC: 'Échec de connexion', CREATION: 'Création', MODIFICATION: 'Modification', SOUMISSION: 'Soumission', VALIDATION: 'Validation', REJET: 'Rejet',
  EXECUTION: 'Exécution', IMMATRICULATION: 'Immatriculation', ETIQUETTE: 'Étiquetage', DOTATION_DEFINITIVE: 'Dotations comptabilisées', DOTATION_SIMULATION: 'Simulation de dotations',
  ANNULATION_DOTATION: 'Annulation de dotations', CLOTURE_PERIODE: 'Clôture de période', ECRITURE: 'Écriture générée', ACCUSE_ERP: 'Accusé ERP', SORTIE: 'Sortie du patrimoine',
  LANCEMENT: "Lancement d'inventaire", RAPPROCHEMENT: "Rapprochement d'inventaire", DECISION_ECART: "Décision sur écart", CLOTURE: 'Clôture', CLOTURE_ZONE: 'Clôture de zone',
  ATTESTATION: 'Attestation de détention', DEMANDE: 'Demande du portail', REPONSE_DEMANDE: 'Réponse à une demande', RECEPTION_TRANSFERT: 'Réception de transfert',
};
// ---------------------------------------------------------------- Lot 2
export const TITLE_TYPE: Record<string, [string, Tone]> = { TITRE_FONCIER: ['Titre foncier', 'ok'], ACD: ['ACD', 'info'], LETTRE_ATTRIBUTION: ["Lettre d'attribution", 'warn'], AUCUN: ['Sans titre', 'bad'] };
export const OCCUPANCY_KIND: Record<string, [string, Tone]> = { AFFECTATION: ['Service occupant', 'navy'], BAIL: ['Bail consenti', 'info'], VACANT: ['Vacant', 'warn'] };
export const PROPERTY_EVENT: Record<string, string> = { TRAVAUX: 'Travaux', CONTENTIEUX: 'Contentieux', CONTROLE: 'Contrôle réglementaire' };
export const PROPERTY_EVENT_STATUS: Record<string, [string, Tone]> = { PROGRAMME: ['Programmé', 'grey'], EN_COURS: ['En cours', 'warn'], CLOS: ['Clos', 'ok'], A_JOUR: ['À jour', 'ok'] };
export const MISSION_STATUS: Record<string, [string, Tone]> = { DEMANDE: ['À valider', 'warn'], VALIDEE: ['Validée', 'info'], EN_COURS: ['En cours', 'navy'], CLOTUREE: ['Clôturée', 'ok'], REJETEE: ['Refusée', 'bad'], ANNULEE: ['Annulée', 'grey'] };
export const ENERGY: Record<string, string> = { ESSENCE: 'Essence', GASOIL: 'Gasoil', HYBRIDE: 'Hybride', ELECTRIQUE: 'Électrique' };
export const INCIDENT_STATUS: Record<string, [string, Tone]> = { OUVERT: ['Ouvert', 'warn'], EXPERTISE: ['En expertise', 'info'], CLOS: ['Clos', 'ok'] };
export const WO_STATUS: Record<string, [string, Tone]> = { A_PLANIFIER: ['À planifier', 'grey'], PLANIFIE: ['Planifié', 'info'], EN_COURS: ['En cours', 'navy'], ATTENTE_PIECES: ['Attente de pièces', 'warn'], TERMINE: ['Terminé', 'ok'], ANNULE: ['Annulé', 'grey'] };
export const WO_PRIORITY: Record<string, [string, Tone]> = { BASSE: ['Basse', 'grey'], NORMALE: ['Normale', 'info'], HAUTE: ['Haute', 'warn'], URGENTE: ['Urgente', 'bad'] };
export const CONTRACT_KIND: Record<string, string> = { MAINTENANCE: 'Maintenance', ASSURANCE: 'Assurance', GARANTIE: 'Garantie', LOCATION: 'Location' };
export const CONTRACT_STATE: Record<string, [string, Tone]> = { ACTIF: ['Actif', 'ok'], ECHEANCE_90: ['Échéance < 90 j', 'info'], ECHEANCE_30: ['Échéance < 30 j', 'warn'], EXPIRE: ['Expiré', 'bad'], RESILIE: ['Résilié', 'grey'] };
export const REVAL_STATUS: Record<string, [string, Tone]> = { BROUILLON: ['Brouillon', 'grey'], EN_COURS: ['En validation', 'warn'], APPLIQUE: ['Appliquée', 'ok'], REJETE: ['Rejetée', 'bad'] };
export const REVAL_KIND: Record<string, string> = { REVISION_DUREE: "Révision de la durée d'utilité", DEPRECIATION: 'Dépréciation', REPRISE_DEPRECIATION: 'Reprise de dépréciation' };
export const NOTE_STATUS: Record<string, [string, Tone]> = { A_CORRIGER: ['À corriger', 'bad'], CORRIGE: ['Corrigé', 'ok'], JUSTIFIE: ['Justifié', 'info'] };
export const DOC_CATEGORY: Record<string, string> = { FACTURE: 'Facture', PV: 'Procès-verbal', TITRE: 'Titre ou acte', CONTRAT: 'Contrat ou police', PHOTO: 'Photo', DECHARGE: 'Décharge signée', EXPERTISE: "Rapport d'expertise", AUTRE: 'Autre' };
export const DOC_OBJECT: Record<string, string> = { BIEN: 'Bien', RECEPTION: 'Réception', MOUVEMENT: 'Mouvement', REFORME: 'Réforme', CONTRAT: 'Contrat', MISSION: 'Mission', OT: 'Ordre de travail', INVENTAIRE: 'Inventaire', REVISION: 'Révision' };
export const fmtKm = (n: number | null | undefined) => (n == null ? '—' : `${nf.format(n)} km`);
