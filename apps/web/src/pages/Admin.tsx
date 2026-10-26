import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, download, patch, post } from '../api';
import { ACTION_LABELS, date, dateTime, today } from '../format';
import { useCategories, useLocations, useOrgUnits } from '../refs';
import { Card, Empty, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pager, Pill, SubNav, Tabs, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

/* ---------------- États et rapports ---------------- */
export function Etats() {
  const toast = useToast();
  const [d, setD] = useState(today());
  const [y, setY] = useState(new Date().getFullYear());
  const dl = (path: string, name: string) => download(path, name).catch((e) => toast(e.message, 'bad'));
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api<Row[]>('/inventaires') });
  const item = (t: string, desc: string, fmt: string, onClick: () => void) => (
    <li><span className="grow"><strong>{t}</strong><span className="small muted">{desc}</span><span className="small muted">{fmt}</span></span><button className="btn small" onClick={onClick}>Générer</button></li>
  );
  return (
    <>
      <PageHead title="États et rapports" sub="États réglementaires et de gestion, produits à une date d'arrêté et exportables. Chaque génération est tracée." />
      <Card title="Filtres communs">
        <div className="grid" style={{ ['--min' as string]: '200px' }}>
          <Field label="Date d'arrêté" htmlFor="d"><input id="d" type="date" className="input" value={d} max={today()} onChange={(e) => setD(e.target.value)} /></Field>
          <Field label="Exercice" htmlFor="y"><select id="y" className="input" value={y} onChange={(e) => setY(Number(e.target.value))}>{[0, 1, 2].map((i) => <option key={i}>{new Date().getFullYear() - i}</option>)}</select></Field>
        </div>
      </Card>
      <div className="grid" style={{ ['--min' as string]: '420px' }}>
        <Card title="Patrimoine"><ul className="list">
          {item('Registre des immobilisations', 'Liste exhaustive des biens à la date d\'arrêté, avec valeurs et localisation', 'Excel', () => dl(`/etats/registre.xlsx?date=${d}`, `registre-${d}.xlsx`))}
        </ul></Card>
        <Card title="Comptabilité et valorisation"><ul className="list">
          {item('Tableau des immobilisations et des amortissements', 'Note annexe SYSCOHADA : valeurs brutes, acquisitions, sorties, dotations, reprises, VNC par compte', 'Excel', () => dl(`/etats/amortissements.xlsx?year=${y}`, `tableau-amortissements-${y}.xlsx`))}
        </ul></Card>
        <Card title="Comptabilité-matières"><ul className="list">
          {item('Livre-journal des matières', "Entrées (ordres d'entrée) et sorties (ordres de sortie) de l'exercice, numérotées", 'Excel', () => dl(`/etats/livre-journal.xlsx?year=${y}`, `livre-journal-${y}.xlsx`))}
        </ul></Card>
        <Card title="Inventaire et contrôle"><ul className="list">
          {(campaigns.data ?? []).filter((c) => c.status !== 'PREPARATION').map((c) => <li key={c.id}><span className="grow"><strong>État des écarts · {c.number}</strong><span className="small muted">{c.label}</span></span><button className="btn small" onClick={() => dl(`/etats/ecarts/${c.id}.xlsx`, `ecarts-${c.number}.xlsx`)}>Générer</button></li>)}
          {item("Journal d'audit", "Toutes les actions de l'exercice avec leurs empreintes chaînées", 'Excel', () => dl(`/etats/audit.xlsx?from=${y}-01-01&to=${y}-12-31`, `audit-${y}.xlsx`))}
        </ul></Card>
      </div>
      <Note>La fiche d'immobilisation (PDF) s'édite depuis la fiche de chaque bien, le PV de réception depuis chaque réception, les étiquettes depuis l'écran Étiquettes.</Note>
    </>
  );
}

/* ---------------- Paramétrage ---------------- */
const PARAM: [string, string][] = [['/parametrage', 'Nomenclature'], ['/parametrage/structures', 'Structure et localisations']];
export function Parametrage() {
  const cats = useCategories();
  const [edit, setEdit] = useState<Row | null>(null);
  const rows = cats.data ?? [];
  const depth = (c: Row): number => { let d = 0; let p = rows.find((x) => x.id === c.parentId); while (p) { d++; p = rows.find((x) => x.id === p!.parentId); } return d; };
  const ordered = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <>
      <SubNav items={PARAM} current="/parametrage" />
      <PageHead title="Nomenclature des biens" sub="Plan de classement aligné sur SYSCOHADA : chaque catégorie porte ses comptes, sa méthode et sa durée d'amortissement."
        actions={<button className="btn primary" onClick={() => setEdit({})}>Nouvelle catégorie</button>} />
      <Card pad={false}>
        {cats.isLoading ? <Loading /> : <div className="table-wrap"><table className="t" style={{ minWidth: 960 }}>
          <thead><tr><th>Code · libellé</th><th>Préfixe</th><th>Compte</th><th>Amort.</th><th>Dotation</th><th>Méthode</th><th className="num">Durée</th><th className="num">Seuil</th><th className="num">Biens</th><th /></tr></thead>
          <tbody>{ordered.map((c) => <tr key={c.id}><td style={{ paddingLeft: 14 + depth(c) * 18, fontWeight: c.prefix ? 400 : 600 }}>{c.code} · {c.label}{!c.active && <Pill tone="grey">inactive</Pill>}</td>
            <td>{c.prefix ? <Mono>{c.prefix}</Mono> : ''}</td><td><Mono>{c.assetAccount ?? ''}</Mono></td><td><Mono>{c.deprAccount ?? ''}</Mono></td><td><Mono>{c.expenseAccount ?? ''}</Mono></td>
            <td className="small">{c.prefix ? c.method.toLowerCase().replace('_', ' ') : ''}</td><td className="num">{c.prefix && c.method !== 'NON_AMORTISSABLE' ? `${c.durationYears} ans` : ''}</td>
            <td className="num">{c.threshold ? c.threshold.toLocaleString('fr-FR') : ''}</td><td className="num">{c.assetCount || ''}</td><td><button className="btn small" onClick={() => setEdit(c)}>Modifier</button></td></tr>)}</tbody>
        </table></div>}
      </Card>
      <Note tone="warn">Modifier la durée ou la méthode d'une catégorie ne recalcule pas les biens existants : elle s'applique aux biens qui entreront ensuite.</Note>
      {edit && <CategoryForm c={edit} all={rows} onClose={() => setEdit(null)} />}
    </>
  );
}
function CategoryForm({ c, all, onClose }: { c: Row; all: Row[]; onClose: () => void }) {
  const [f, setF] = useState({ code: c.code ?? '', label: c.label ?? '', parentId: c.parentId ? String(c.parentId) : '', prefix: c.prefix ?? '', assetAccount: c.assetAccount ?? '', deprAccount: c.deprAccount ?? '',
    expenseAccount: c.expenseAccount ?? '', method: c.method ?? 'LINEAIRE', durationYears: String(c.durationYears ?? 5), threshold: String(c.threshold ?? 0), active: c.active ?? true });
  const body = { ...f, parentId: f.parentId ? Number(f.parentId) : null, prefix: f.prefix || null, assetAccount: f.assetAccount || null, deprAccount: f.deprAccount || null, expenseAccount: f.expenseAccount || null,
    durationYears: Number(f.durationYears), threshold: Number(f.threshold) };
  const save = useAction(() => (c.id ? patch(`/referentiels/categories/${c.id}`, body) : post('/referentiels/categories', body)), { success: 'Catégorie enregistrée', invalidate: [['refs', 'categories']], onDone: onClose });
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={c.id ? `Modifier ${c.code}` : 'Nouvelle catégorie'} onClose={onClose} width={680}>
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Code" htmlFor="c"><input id="c" className="input" value={f.code} onChange={s('code')} /></Field>
        <Field label="Libellé" htmlFor="l"><input id="l" className="input" value={f.label} onChange={s('label')} /></Field>
        <Field label="Catégorie parente" htmlFor="p"><select id="p" className="input" value={f.parentId} onChange={s('parentId')}><option value="">Aucune</option>{all.filter((x) => x.id !== c.id && !x.prefix).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.label}</option>)}</select></Field>
        <Field label="Préfixe de codification" htmlFor="pf" hint="Seules les catégories avec préfixe reçoivent des biens"><input id="pf" className="input mono" maxLength={6} value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} /></Field>
        <Field label="Compte d'immobilisation" htmlFor="a1"><input id="a1" className="input mono" value={f.assetAccount} onChange={s('assetAccount')} /></Field>
        <Field label="Compte d'amortissement" htmlFor="a2"><input id="a2" className="input mono" value={f.deprAccount} onChange={s('deprAccount')} /></Field>
        <Field label="Compte de dotation" htmlFor="a3"><input id="a3" className="input mono" value={f.expenseAccount} onChange={s('expenseAccount')} /></Field>
        <Field label="Méthode" htmlFor="m"><select id="m" className="input" value={f.method} onChange={s('method')}><option value="LINEAIRE">Linéaire</option><option value="DEGRESSIF">Dégressif</option><option value="NON_AMORTISSABLE">Non amortissable</option></select></Field>
        <Field label="Durée (ans)" htmlFor="du"><input id="du" type="number" min="0" className="input" value={f.durationYears} onChange={s('durationYears')} /></Field>
        <Field label="Seuil d'immobilisation (FCFA)" htmlFor="th"><input id="th" type="number" min="0" className="input" value={f.threshold} onChange={s('threshold')} /></Field>
      </div>
      <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Catégorie active</label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

export function Structures() {
  const units = useOrgUnits(); const locs = useLocations();
  const [addLoc, setAddLoc] = useState(false); const [addUnit, setAddUnit] = useState(false);
  const depthOf = (rows: Row[], r: Row) => { let d = 0; let p = rows.find((x) => x.id === r.parentId); while (p) { d++; p = rows.find((x) => x.id === p!.parentId); } return d; };
  return (
    <>
      <SubNav items={PARAM} current="/parametrage/structures" />
      <PageHead title="Structure et localisations" sub="Deux axes distincts : un bien relève d'un service (responsabilité) et se trouve dans un local (position physique). Les deux sont historisés." />
      <div className="grid" style={{ ['--min' as string]: '420px' }}>
        <Card pad={false} title="Structure organisationnelle" extra={<button className="btn small" onClick={() => setAddUnit(true)}>Ajouter</button>}>
          <ul className="list" style={{ padding: '0 20px' }}>{(units.data ?? []).map((u) => <li key={u.id} style={{ paddingLeft: depthOf(units.data!, u) * 18 }}><span className="grow">{u.name}<span className="small muted">{u.code}</span></span><span className="small muted">{u.assetCount} biens</span></li>)}</ul>
        </Card>
        <Card pad={false} title={`Localisations · ${locs.data?.length ?? 0}`} extra={<button className="btn small" onClick={() => setAddLoc(true)}>Ajouter</button>}>
          <ul className="list" style={{ padding: '0 20px', maxHeight: 640, overflowY: 'auto' }}>{(locs.data ?? []).sort((a, b) => a.path.localeCompare(b.path)).map((l) => <li key={l.id} style={{ paddingLeft: depthOf(locs.data!, l) * 18 }}>
            <span className="grow">{l.name}<span className="small muted"><Mono>{l.code}</Mono> · {l.kind.toLowerCase()}</span></span><span className="small muted">{l.assetCount ? `${l.assetCount} biens` : ''}</span></li>)}</ul>
        </Card>
      </div>
      {addLoc && <SimpleForm title="Nouvelle localisation" onClose={() => setAddLoc(false)} path="/referentiels/localisations" inv="locations" parents={locs.data ?? []} kinds />}
      {addUnit && <SimpleForm title="Nouveau service" onClose={() => setAddUnit(false)} path="/referentiels/structures" inv="orgUnits" parents={units.data ?? []} />}
    </>
  );
}
function SimpleForm({ title, onClose, path, inv, parents, kinds }: { title: string; onClose: () => void; path: string; inv: string; parents: Row[]; kinds?: boolean }) {
  const [f, setF] = useState({ code: '', name: '', parentId: '', kind: 'LOCAL' });
  const save = useAction(() => post(path, { code: f.code, name: f.name, parentId: f.parentId ? Number(f.parentId) : null, ...(kinds ? { kind: f.kind } : {}) }), { success: 'Enregistré', invalidate: [['refs', inv]], onDone: onClose });
  return (
    <Modal title={title} onClose={onClose}>
      <Field label="Code" htmlFor="c"><input id="c" className="input mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label="Nom" htmlFor="n"><input id="n" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      {kinds && <Field label="Niveau" htmlFor="k"><select id="k" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="SITE">Site</option><option value="BATIMENT">Bâtiment</option><option value="NIVEAU">Niveau</option><option value="LOCAL">Local</option></select></Field>}
      <Field label="Rattachement" htmlFor="p"><select id="p" className="input" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}><option value="">Aucun (racine)</option>{parents.map((p) => <option key={p.id} value={p.id}>{p.path ?? p.name}</option>)}</select></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!f.code || !f.name || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

/* ---------------- Utilisateurs et droits ---------------- */
const ROLES: [string, string][] = [['ADMIN', 'Administrateur'], ['DIRECTEUR', 'Directeur du patrimoine'], ['GESTIONNAIRE', 'Gestionnaire du patrimoine'], ['COMPTABLE_MATIERES', 'Comptable-matières'],
  ['FINANCES', 'Direction financière'], ['CONTROLEUR', 'Contrôleur financier'], ['CHEF_EQUIPE', "Chef d'équipe d'inventaire"], ['DETENTEUR', 'Détenteur']];
const PERM_LABELS: Record<string, string> = {
  'dashboard.read': 'Tableau de bord', 'assets.read': 'Consulter le registre', 'assets.write': 'Créer ou modifier un bien', 'labels.manage': 'Gérer les étiquettes', 'receptions.write': 'Saisir une réception',
  'receptions.validate': 'Viser une réception', 'movements.write': 'Demander un mouvement', 'movements.validate': 'Valider un mouvement', 'inventory.manage': 'Organiser un inventaire', 'inventory.count': 'Compter',
  'inventory.decide': 'Décider des écarts', 'depreciation.run': 'Lancer les dotations', 'depreciation.read': 'Consulter les dotations', 'periods.close': 'Clôturer une période', 'journal.read': 'Consulter les écritures',
  'journal.manage': 'Gérer les écritures', 'disposals.write': 'Proposer une réforme', 'disposals.validate': 'Valider ou exécuter une sortie', 'reports.read': 'Éditer les états', 'settings.manage': 'Paramétrer',
  'users.manage': 'Gérer les utilisateurs', 'audit.read': "Consulter l'audit", 'portal.use': 'Portail détenteur',
};
export function Utilisateurs() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [add, setAdd] = useState(false);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<Row[]>('/referentiels/utilisateurs') });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<Row>('/referentiels/profils') });
  const toggle = useAction((u: Row) => patch(`/referentiels/utilisateurs/${u.id}`, { active: !u.active }), { success: 'Compte mis à jour', invalidate: [['users']] });
  const role = useAction((v: { id: number; role: string }) => patch(`/referentiels/utilisateurs/${v.id}`, { role: v.role }), { success: 'Profil modifié', invalidate: [['users']] });
  const rows = users.data ?? [];
  return (
    <>
      <PageHead title="Utilisateurs et droits" sub="Qui peut faire quoi. La séparation des tâches est contrôlée dans chaque circuit : nul ne valide une pièce qu'il a créée." actions={<button className="btn primary" onClick={() => setAdd(true)}>Inviter un utilisateur</button>} />
      <section className="kpis"><Kpi label="Comptes actifs" value={rows.filter((u) => u.active).length} note={`${rows.filter((u) => u.role === 'DETENTEUR').length} détenteurs`} /><Kpi label="Profils" value={ROLES.length} note="modèles de droits" /><Kpi label="Comptes désactivés" value={rows.filter((u) => !u.active).length} /></section>
      <Card pad={false}>
        <div style={{ padding: '0 16px' }}><Tabs label="Rubriques" value={tab} onChange={setTab} items={[['users', 'Utilisateurs'], ['roles', 'Profils et droits']]} /></div>
        {tab === 'users' ? (users.isLoading ? <Loading /> : <div className="table-wrap"><table className="t" style={{ minWidth: 900 }}>
          <thead><tr><th>Utilisateur</th><th>Fonction</th><th>Service</th><th>Profil</th><th>Dernière connexion</th><th>Statut</th><th /></tr></thead>
          <tbody>{rows.map((u) => <tr key={u.id}><td><strong>{u.fullName}</strong><div className="small muted">{u.email}</div></td><td className="small">{u.title ?? '—'}</td><td className="small">{u.orgUnit ?? '—'}</td>
            <td><select aria-label={`Profil de ${u.fullName}`} className="input" style={{ height: 34 }} value={u.role} onChange={(e) => role.mutate({ id: u.id, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
            <td className="small">{u.lastLoginAt ? dateTime(u.lastLoginAt) : 'jamais'}</td><td><Pill tone={u.active ? 'ok' : 'grey'}>{u.active ? 'Actif' : 'Désactivé'}</Pill></td>
            <td><button className="btn small" onClick={() => toggle.mutate(u)}>{u.active ? 'Désactiver' : 'Réactiver'}</button></td></tr>)}</tbody>
        </table></div>) : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 980 }}>
            <thead><tr><th>Droit</th>{profiles.data?.roles.map((r: Row) => <th key={r.code} style={{ whiteSpace: 'normal', minWidth: 90 }}>{r.label}</th>)}</tr></thead>
            <tbody>{profiles.data?.permissions.map((p: string) => <tr key={p}><td>{PERM_LABELS[p] ?? p}</td>{profiles.data!.roles.map((r: Row) => <td key={r.code} style={{ textAlign: 'center' }}>{r.perms.includes(p) ? <span style={{ color: 'var(--ok)', fontWeight: 700 }} aria-label="oui">✓</span> : <span className="muted" aria-label="non">—</span>}</td>)}</tr>)}</tbody>
          </table></div>
        )}
      </Card>
      {add && <AddUser onClose={() => setAdd(false)} />}
    </>
  );
}
function AddUser({ onClose }: { onClose: () => void }) {
  const units = useOrgUnits();
  const [f, setF] = useState({ email: '', fullName: '', title: '', role: 'DETENTEUR', orgUnitId: '', password: '' });
  const save = useAction(() => post('/referentiels/utilisateurs', { ...f, orgUnitId: f.orgUnitId ? Number(f.orgUnitId) : null, title: f.title || undefined }), { success: 'Utilisateur créé', invalidate: [['users'], ['refs', 'people']], onDone: onClose });
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Inviter un utilisateur" onClose={onClose}>
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="Nom complet" htmlFor="n"><input id="n" className="input" value={f.fullName} onChange={s('fullName')} /></Field>
        <Field label="Adresse e-mail" htmlFor="e"><input id="e" type="email" className="input" value={f.email} onChange={s('email')} /></Field>
        <Field label="Fonction" htmlFor="t"><input id="t" className="input" value={f.title} onChange={s('title')} /></Field>
        <Field label="Service" htmlFor="o"><select id="o" className="input" value={f.orgUnitId} onChange={s('orgUnitId')}><option value="">—</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Profil" htmlFor="r"><select id="r" className="input" value={f.role} onChange={s('role')}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Mot de passe initial" htmlFor="p" hint="10 caractères au moins ; à changer à la première connexion"><input id="p" type="password" className="input" value={f.password} onChange={s('password')} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Créer le compte</button></div>
    </Modal>
  );
}

/* ---------------- Journal d'audit ---------------- */
export function Audit() {
  const toast = useToast();
  const [f, setF] = useState({ q: '', action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<Row | null>(null);
  const qs = new URLSearchParams({ page: String(page), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }).toString();
  const q = useQuery({ queryKey: ['audit', qs], queryFn: () => api<{ total: number; items: Row[] }>(`/audit?${qs}`) });
  const integ = useQuery({ queryKey: ['audit', 'integrity'], queryFn: () => api<Row>('/audit/integrite') });
  return (
    <>
      <PageHead title="Journal d'audit" sub="Toutes les actions sur le patrimoine, horodatées et chaînées par empreintes : aucune ligne ne peut être modifiée ni supprimée."
        actions={<button className="btn" onClick={() => download(`/etats/audit.xlsx?${f.from ? `from=${f.from}&` : ''}${f.to ? `to=${f.to}` : ''}`, 'journal-audit.xlsx').catch((e) => toast(e.message, 'bad'))}>Exporter pour un organe de contrôle</button>} />
      {integ.data && <Note tone={integ.data.ok ? 'ok' : 'bad'}>{integ.data.ok ? `Intégrité vérifiée : ${integ.data.count.toLocaleString('fr-FR')} événements, chaîne d'empreintes SHA-256 intacte.` : `Rupture de la chaîne détectée à l'événement n° ${integ.data.brokenAt}.`}</Note>}
      <Card>
        <div className="grid" style={{ ['--min' as string]: '180px' }}>
          <Field label="Référence ou utilisateur" htmlFor="q"><input id="q" className="input" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setPage(1); }} /></Field>
          <Field label="Action" htmlFor="a"><select id="a" className="input" value={f.action} onChange={(e) => { setF({ ...f, action: e.target.value }); setPage(1); }}><option value="">Toutes</option>{Object.entries(ACTION_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Du" htmlFor="f"><input id="f" type="date" className="input" value={f.from} onChange={(e) => { setF({ ...f, from: e.target.value }); setPage(1); }} /></Field>
          <Field label="Au" htmlFor="t"><input id="t" type="date" className="input" value={f.to} onChange={(e) => { setF({ ...f, to: e.target.value }); setPage(1); }} /></Field>
        </div>
      </Card>
      <div className="split">
        <div className="wide">
          <Card pad={false} title="Événements" foot={q.data && <><span>{q.data.total.toLocaleString('fr-FR')} événement(s)</span><Pager page={page} pageSize={50} total={q.data.total} onPage={setPage} /></>}>
            {q.isLoading ? <Loading /> : !q.data?.items.length ? <Empty>Aucun événement.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
              <thead><tr><th>N°</th><th>Horodatage</th><th>Utilisateur</th><th>Action</th><th>Référence</th></tr></thead>
              <tbody>{q.data.items.map((r) => <tr key={r.id} className={`click ${sel?.id === r.id ? 'sel' : ''}`} onClick={() => setSel(r)}><td className="num">{r.id}</td><td className="small">{dateTime(r.at)}</td><td>{r.userName}</td><td>{ACTION_LABELS[r.action] ?? r.action}</td><td><Mono>{r.objectRef ?? '—'}</Mono></td></tr>)}</tbody>
            </table></div>}
          </Card>
        </div>
        <div className="narrow">
          <Card title="Détail">
            {!sel ? <span className="muted">Sélectionnez un événement.</span> : <>
              <dl className="kv" style={{ margin: 0 }}><div><dt>Horodatage</dt><dd>{new Date(sel.at).toLocaleString('fr-FR')}</dd></div><div><dt>Utilisateur</dt><dd>{sel.userName}</dd></div>
                <div><dt>Objet</dt><dd>{sel.objectType} · {sel.objectRef}</dd></div><div><dt>Adresse</dt><dd>{sel.ip ?? '—'}</dd></div></dl>
              <pre style={{ background: 'var(--subtle)', padding: 12, borderRadius: 8, fontSize: 12, overflowX: 'auto', margin: 0 }}>{JSON.stringify(sel.detail, null, 2)}</pre>
              <span className="small muted" style={{ overflowWrap: 'anywhere' }}>Empreinte : <Mono>{sel.hash.slice(0, 32)}…</Mono></span>
            </>}
          </Card>
        </div>
      </div>
      <span className="small muted">Conservation : 10 ans. Dernière vérification : {date(new Date().toISOString())}.</span>
    </>
  );
}
