/** Profils et droits. Un droit = « domaine.action ». La séparation des tâches est vérifiée dans les circuits. */
export type Role = 'ADMIN' | 'DIRECTEUR' | 'GESTIONNAIRE' | 'COMPTABLE_MATIERES' | 'FINANCES' | 'CONTROLEUR' | 'CHEF_EQUIPE' | 'DETENTEUR';

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrateur',
  DIRECTEUR: 'Directeur du patrimoine',
  GESTIONNAIRE: 'Gestionnaire du patrimoine',
  COMPTABLE_MATIERES: 'Comptable-matières',
  FINANCES: 'Direction financière',
  CONTROLEUR: 'Contrôleur financier',
  CHEF_EQUIPE: "Chef d'équipe d'inventaire",
  DETENTEUR: 'Détenteur',
};

export const PERMISSIONS = [
  'dashboard.read', 'assets.read', 'assets.write', 'labels.manage',
  'receptions.write', 'receptions.validate',
  'movements.write', 'movements.validate',
  'inventory.manage', 'inventory.count', 'inventory.decide',
  'depreciation.run', 'depreciation.read', 'periods.close', 'journal.read', 'journal.manage',
  'disposals.write', 'disposals.validate',
  'reports.read', 'settings.manage', 'users.manage', 'audit.read', 'portal.use',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS] as Permission[];
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ALL,
  DIRECTEUR: ['dashboard.read', 'assets.read', 'assets.write', 'labels.manage', 'receptions.write', 'receptions.validate', 'movements.write', 'movements.validate',
    'inventory.manage', 'inventory.decide', 'depreciation.read', 'journal.read', 'disposals.write', 'disposals.validate', 'reports.read', 'settings.manage', 'audit.read', 'portal.use'],
  GESTIONNAIRE: ['dashboard.read', 'assets.read', 'assets.write', 'labels.manage', 'receptions.write', 'movements.write', 'inventory.manage', 'inventory.count',
    'depreciation.read', 'disposals.write', 'reports.read', 'portal.use'],
  COMPTABLE_MATIERES: ['dashboard.read', 'assets.read', 'receptions.validate', 'movements.validate', 'inventory.decide', 'depreciation.read', 'journal.read',
    'disposals.validate', 'reports.read', 'audit.read', 'portal.use'],
  FINANCES: ['dashboard.read', 'assets.read', 'depreciation.run', 'depreciation.read', 'periods.close', 'journal.read', 'journal.manage', 'disposals.validate',
    'reports.read', 'audit.read', 'portal.use'],
  CONTROLEUR: ['dashboard.read', 'assets.read', 'depreciation.read', 'journal.read', 'disposals.validate', 'reports.read', 'audit.read', 'portal.use'],
  CHEF_EQUIPE: ['assets.read', 'inventory.count', 'portal.use'],
  DETENTEUR: ['portal.use'],
};

export function can(role: Role, perm: Permission) {
  return ROLE_PERMISSIONS[role]?.includes(perm) ?? false;
}
