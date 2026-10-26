import type { Role } from '../../common/permissions';

/** Étape d'un modèle de circuit : profil, personne nommée ou bénéficiaire de la pièce ; facultative sous un seuil. */
export interface StepModel {
  label: string;
  assignee: 'ROLE' | 'USER' | 'BENEFICIAIRE';
  role?: Role | null;
  userId?: number | null;
  days: number;
  /** Étape requise seulement si le montant de la pièce dépasse ce seuil (FCFA). */
  minAmount?: number | null;
}

export interface CircuitType {
  label: string;
  /** Variantes : un circuit distinct par nature de pièce. */
  variants: Record<string, string>;
  /** Ce que représente le « montant » des conditions et le « bénéficiaire ». */
  amountLabel: string;
  beneficiaryLabel?: string;
  defaults: Record<string, StepModel[]>;
}

const CM = (label = 'Visa du comptable-matières'): StepModel => ({ label, assignee: 'ROLE', role: 'COMPTABLE_MATIERES', days: 3 });
const DIR = (label = 'Validation du directeur du patrimoine', minAmount?: number): StepModel => ({ label, assignee: 'ROLE', role: 'DIRECTEUR', days: 3, minAmount: minAmount ?? null });

/** Circuits réglementaires intégrés : ils s'appliquent tant que l'entité n'a pas paramétré les siens. */
export const CIRCUIT_TYPES: Record<string, CircuitType> = {
  RECEPTION: {
    label: 'Entrée en patrimoine (PV de réception)', variants: { TOUS: 'Toutes les réceptions' }, amountLabel: 'valeur des articles acceptés',
    defaults: { TOUS: [CM(), DIR('Visa du directeur du patrimoine (plus de 50 M)', 50_000_000)] },
  },
  MOUVEMENT: {
    label: 'Mouvements de biens', amountLabel: 'valeur d\'origine des biens', beneficiaryLabel: 'détenteur ou emprunteur destinataire',
    variants: { AFFECTATION: 'Affectation', TRANSFERT: 'Transfert', PRET: 'Prêt temporaire', RESTITUTION: 'Restitution' },
    defaults: {
      AFFECTATION: [CM(), DIR('Visa du directeur du patrimoine (plus de 5 M)', 5_000_000), { label: 'Signature de la décharge par le détenteur', assignee: 'BENEFICIAIRE', days: 5 }],
      TRANSFERT: [DIR()],
      PRET: [DIR(), { label: "Prise en charge par l'emprunteur", assignee: 'BENEFICIAIRE', days: 5 }],
      RESTITUTION: [CM()],
    },
  },
  REFORME: {
    label: 'Réforme et sortie du patrimoine', variants: { TOUS: 'Tous les dossiers' }, amountLabel: 'valeur nette comptable des biens proposés',
    defaults: { TOUS: [
      { label: 'Avis du contrôle financier', assignee: 'ROLE', role: 'CONTROLEUR', days: 5 },
      { label: 'Commission de réforme', assignee: 'ROLE', role: 'DIRECTEUR', days: 10 },
      { label: "Décision de sortie de l'ordonnateur", assignee: 'ROLE', role: 'FINANCES', days: 5 },
    ] },
  },
  REVISION: {
    label: 'Révisions et dépréciations', amountLabel: 'montant de la dépréciation ou de la reprise',
    variants: { REVISION_DUREE: "Révision de la durée d'utilité", DEPRECIATION: 'Dépréciation', REPRISE_DEPRECIATION: 'Reprise de dépréciation' },
    defaults: Object.fromEntries(['REVISION_DUREE', 'DEPRECIATION', 'REPRISE_DEPRECIATION'].map((k) => [k, [
      { label: 'Analyse de la direction financière', assignee: 'ROLE', role: 'FINANCES', days: 5 },
      { label: 'Validation du directeur du patrimoine', assignee: 'ROLE', role: 'DIRECTEUR', days: 5 },
    ] as StepModel[]])),
  },
};

export function variantOf(type: string, variant: string) {
  const t = CIRCUIT_TYPES[type];
  if (!t) throw new Error(`Circuit inconnu : ${type}`);
  return t.variants[variant] ? variant : Object.keys(t.variants)[0];
}
