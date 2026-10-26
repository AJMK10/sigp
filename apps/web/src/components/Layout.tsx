import { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';

type Item = { to: string; label: string; perms?: string[]; badge?: 'validations' | 'notifications'; lot2?: boolean; match?: string[] };
const NAV: [string, Item[]][] = [
  ['Pilotage', [
    { to: '/', label: 'Tableau de bord', perms: ['dashboard.read'] },
    { to: '/validations', label: 'Validations', badge: 'validations' },
    { to: '/notifications', label: 'Notifications', badge: 'notifications' },
    { to: '/etats', label: 'États et rapports', perms: ['reports.read'] },
    { to: '#', label: 'Plan de renouvellement', lot2: true },
  ]],
  ['Patrimoine', [
    { to: '/biens', label: 'Registre des biens', perms: ['assets.read'] },
    { to: '/receptions', label: 'Entrées en patrimoine', perms: ['receptions.write', 'receptions.validate'] },
    { to: '/etiquettes', label: 'Étiquettes', perms: ['labels.manage'] },
    { to: '/mouvements', label: 'Mouvements', perms: ['movements.write', 'movements.validate'] },
    { to: '/inventaires', label: 'Inventaires', perms: ['inventory.manage', 'inventory.count', 'inventory.decide'] },
    { to: '/reformes', label: 'Réformes et sorties', perms: ['disposals.write', 'disposals.validate'] },
  ]],
  ['Domaines spécialisés', [
    { to: '#', label: 'Immobilier et foncier', lot2: true },
    { to: '#', label: 'Parc automobile', lot2: true },
    { to: '#', label: 'Maintenance', lot2: true },
  ]],
  ['Finances', [
    { to: '/valorisation', label: 'Valorisation', perms: ['depreciation.read'] },
    { to: '/ecritures', label: 'Écritures comptables', perms: ['journal.read'] },
    { to: '#', label: 'Rapprochement et clôture', lot2: true },
  ]],
  ['Administration', [
    { to: '/parametrage', label: 'Paramétrage', perms: ['settings.manage'] },
    { to: '/utilisateurs', label: 'Utilisateurs et droits', perms: ['users.manage'] },
    { to: '/audit', label: "Journal d'audit", perms: ['audit.read'] },
    { to: '/demandes', label: 'Demandes des détenteurs', perms: ['assets.write'] },
  ]],
  ['Libre-service', [{ to: '/portail', label: 'Portail détenteur', perms: ['portal.use'] }]],
];
const CRUMBS: Record<string, string> = {
  validations: 'Validations', notifications: 'Notifications', etats: 'États et rapports', biens: 'Registre des biens', receptions: 'Entrées en patrimoine', etiquettes: 'Étiquettes',
  mouvements: 'Mouvements', inventaires: 'Inventaires', reformes: 'Réformes et sorties', valorisation: 'Valorisation', ecritures: 'Écritures comptables', parametrage: 'Paramétrage',
  utilisateurs: 'Utilisateurs et droits', audit: "Journal d'audit", demandes: 'Demandes des détenteurs', portail: 'Portail détenteur',
};

export function Layout({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAuth();
  const loc = useLocation();
  const validations = useQuery({ queryKey: ['validations'], queryFn: () => api<unknown[]>('/validations'), refetchInterval: 60_000 });
  const notifs = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications'), refetchInterval: 60_000 });
  const badge = (b?: Item['badge']) => (b === 'validations' ? validations.data?.length : b === 'notifications' ? notifs.data?.unread : 0) || 0;
  const seg = loc.pathname.split('/')[1];
  const initials = me?.fullName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand"><span className="brand-mark">SI</span><span><strong>SIGP</strong><small>Gestion du patrimoine</small></span></Link>
        <nav aria-label="Navigation principale" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {NAV.map(([group, items]) => {
            // Les modules du lot 2 ne sont montrés qu'aux profils de pilotage, à titre d'information.
            const visible = items.filter((i) => (i.lot2 ? can('dashboard.read') : !i.perms || can(...i.perms)));
            if (!visible.length) return null;
            return (
              <div key={group} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span className="nav-group">{group}</span>
                {visible.map((i) => i.lot2 ? (
                  <span key={i.label} className="nav-link disabled" title="Prévu au lot 2">{i.label}<span className="nav-lot">Lot 2</span></span>
                ) : (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    {i.label}
                    {badge(i.badge) > 0 && <span className={`nav-badge ${i.badge === 'notifications' ? 'blue' : ''}`}>{badge(i.badge)}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span>Entité</span>
          <strong>{me?.entity.name}</strong>
          <span>Exercice {new Date().getFullYear()} · ouvert</span>
          <button type="button" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <nav aria-label="Fil d'Ariane" className="crumbs">
            <Link to="/">Accueil</Link>
            {seg && <><span aria-hidden="true">/</span><span style={{ color: 'var(--fg)' }}>{CRUMBS[seg] ?? seg}</span></>}
          </nav>
          <div className="topbar-right">
            <Link to="/notifications" className="bell" aria-label={`Notifications, ${notifs.data?.unread ?? 0} non lues`}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21h4" /></svg>
              {!!notifs.data?.unread && <span className="bell-count">{notifs.data.unread}</span>}
            </Link>
            <span className="avatar" aria-hidden="true">{initials}</span>
            <span className="who"><strong>{me?.fullName}</strong><span>{me?.roleLabel}</span></span>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
