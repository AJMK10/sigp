import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, patch, post } from '../api';
import { useAuth } from '../auth';
import { ASSET_STATUS, CONTRACT_KIND, CONTRACT_STATE, WO_PRIORITY, WO_STATUS, big, date, dateTime, fcfa, pct, today } from '../format';
import { useCategories, leafCategories } from '../refs';
import { AssetPicker } from '../components/AssetPicker';
import { Documents } from '../components/Documents';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pill, RadioCards, StatusPill, Tabs, useAction } from '../components/ui';
import type { Row } from '../types';

const COLUMNS: [string, string][] = [['A_PLANIFIER', 'À planifier'], ['PLANIFIE', 'Planifiés'], ['EN_COURS', 'En cours'], ['ATTENTE_PIECES', 'Attente de pièces'], ['TERMINE', 'Terminés (45 j)']];
const PER_COL = 25, PER_DONE = 6;

export function Maintenance() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState<'board' | 'plans'>('board');
  const [kind, setKind] = useState<'' | 'CORRECTIF' | 'PREVENTIF'>('');
  const [newOt, setNewOt] = useState<{ assetId?: number; requestId?: number } | null>(null);
  const q = useQuery({ queryKey: ['maintenance'], queryFn: () => api<Row>('/maintenance') });
  useEffect(() => {
    const a = sp.get('nouveau');
    if (a) { setNewOt({ assetId: Number(a), requestId: sp.get('demande') ? Number(sp.get('demande')) : undefined }); setSp({}, { replace: true }); }
  }, [sp, setSp]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const items: Row[] = d.items.filter((w: Row) => !kind || w.kind === kind);
  return (
    <>
      <PageHead title="Maintenance" sub="Ordres de travail correctifs et préventifs, couverture par les contrats, coûts d'entretien et plans de maintenance."
        actions={<>{can('contracts.manage', 'assets.read') && <Link to="/contrats" className="btn">Contrats et garanties</Link>}
          {can('maintenance.manage') && <button className="btn primary" onClick={() => setNewOt({})}>Nouvel ordre de travail</button>}</>} />
      <section className="kpis">
        <Kpi label="Ordres ouverts" value={d.kpi.open} note={`${d.kpi.immobilized} bien(s) immobilisé(s)`} />
        <Kpi label="Délai moyen de réparation" value={d.kpi.mttrDays == null ? '—' : `${d.kpi.mttrDays.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} j`} note="correctifs terminés cette année" />
        <Kpi label="Part du préventif" value={d.kpi.preventiveShare == null ? '—' : pct(d.kpi.preventiveShare, 0)} note="objectif : au moins 60 %" tone={d.kpi.preventiveShare != null && d.kpi.preventiveShare < 0.6 ? 'warn' : undefined} />
        <Kpi label="Coût de maintenance (année)" value={big(d.kpi.costYear)} note="main-d'œuvre et pièces" />
      </section>
      <Card pad={false}>
        <div style={{ padding: '0 16px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <Tabs label="Vue" value={tab} onChange={setTab} items={[['board', 'Tableau des interventions'], ['plans', `Plans préventifs (${d.upcoming.length} à échéance)`]]} />
          {tab === 'board' && <div className="seg" role="group" aria-label="Nature">{([['', 'Tous'], ['CORRECTIF', 'Correctif'], ['PREVENTIF', 'Préventif']] as ['' | 'CORRECTIF' | 'PREVENTIF', string][]).map(([k, l]) =>
            <button key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>}
        </div>
        <div style={{ padding: 16 }}>
          {tab === 'board' ? (
            <div className="kanban">{COLUMNS.map(([st, label]) => {
              const col = items.filter((w) => w.status === st);
              return (
                <section key={st} className="kanban-col" aria-label={label}>
                  <h3>{label}<Pill tone="grey">{col.length}</Pill></h3>
                  {col.slice(0, st === 'TERMINE' ? PER_DONE : PER_COL).map((w) => (
                    <Link key={w.id} to={`/maintenance/ot/${w.id}`} className={`kcard ${w.priority === 'URGENTE' ? 'urgent' : w.priority === 'HAUTE' ? 'high' : ''}`}>
                      <span className="actions" style={{ justifyContent: 'space-between', gap: 6 }}><Mono>{w.number}</Mono><Pill tone={w.kind === 'PREVENTIF' ? 'ok' : 'info'}>{w.kind === 'PREVENTIF' ? 'Préventif' : 'Correctif'}</Pill></span>
                      <strong style={{ fontSize: 13 }}>{w.title}</strong>
                      <span className="small muted">{w.designation} · <Mono>{w.code}</Mono></span>
                      <span className="small muted">{w.assignee ?? 'Non affecté'}{w.plannedDate ? ` · ${date(w.plannedDate)}` : ''}{w.cost ? ` · ${fcfa(w.cost)} F` : ''}</span>
                    </Link>))}
                  {col.length > (st === 'TERMINE' ? PER_DONE : PER_COL) && <span className="small muted" style={{ textAlign: 'center' }}>+ {col.length - (st === 'TERMINE' ? PER_DONE : PER_COL)} autre(s)</span>}
                  {!col.length && <span className="small muted" style={{ textAlign: 'center', padding: 8 }}>—</span>}
                </section>
              );
            })}</div>
          ) : <Plans />}
        </div>
      </Card>
      {newOt && <NewWorkOrder initial={newOt} onClose={() => setNewOt(null)} />}
    </>
  );
}

function Plans() {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['plans'], queryFn: () => api<Row[]>('/maintenance/plans') });
  const gen = useAction(() => post<Row>('/maintenance/plans/generer', { days: 15 }), { success: (r) => `${r.created} ordre(s) préventif(s) généré(s) pour ${r.plans} plan(s)`, invalidate: [['plans'], ['maintenance']] });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">Les plans arrivant à échéance dans les 15 jours génèrent leurs ordres de travail planifiés, puis la date suivante est recalculée.</span>
        {can('maintenance.manage') && <div className="actions"><button className="btn" onClick={() => setOpen(true)}>Nouveau plan</button><button className="btn primary" disabled={gen.isPending} onClick={() => gen.mutate(undefined)}>Générer les ordres à 15 jours</button></div>}
      </div>
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Aucun plan de maintenance.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 760 }}>
        <thead><tr><th>Plan</th><th>Périmètre</th><th className="num">Biens</th><th>Fréquence</th><th>Prochaine échéance</th><th>Contrat</th></tr></thead>
        <tbody>{q.data.map((p) => <tr key={p.id}><td><strong>{p.label}</strong>{p.assignee && <><br /><span className="small muted">{p.assignee}</span></>}</td>
          <td>{p.code ? <><Mono>{p.code}</Mono><br /><span className="small muted">{p.designation}</span></> : p.category}</td><td className="num">{p.assetCount}</td>
          <td>tous les {p.frequencyMonths} mois</td><td><span style={{ color: p.nextDate <= today() ? 'var(--bad)' : undefined }}>{date(p.nextDate)}</span></td><td>{p.contract ? <Mono>{p.contract}</Mono> : '—'}</td></tr>)}</tbody>
      </table></div>}
      {open && <PlanForm onClose={() => setOpen(false)} />}
    </div>
  );
}

function PlanForm({ onClose }: { onClose: () => void }) {
  const cats = useCategories();
  const contracts = useQuery({ queryKey: ['contracts'], queryFn: () => api<Row>('/contrats') });
  const [scope, setScope] = useState<'cat' | 'asset'>('cat');
  const [assets, setAssets] = useState<Row[]>([]);
  const [f, setF] = useState({ label: '', categoryId: '', frequencyMonths: '6', nextDate: today(), contractId: '', assignee: '' });
  const save = useAction(() => post('/maintenance/plans', { label: f.label, categoryId: scope === 'cat' ? Number(f.categoryId) : null, assetId: scope === 'asset' ? assets[0]?.id : null,
    frequencyMonths: Number(f.frequencyMonths), nextDate: f.nextDate, contractId: f.contractId ? Number(f.contractId) : null, assignee: f.assignee || undefined }), { success: 'Plan créé', invalidate: [['plans'], ['maintenance']], onDone: onClose });
  return (
    <Modal title="Nouveau plan de maintenance" onClose={onClose} width={640}>
      <Field label="Libellé" htmlFor="pl"><input id="pl" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Entretien trimestriel des climatiseurs" /></Field>
      <RadioCards label="Périmètre" value={scope} onChange={setScope} items={[['cat', 'Toute une catégorie'], ['asset', 'Un bien précis']]} />
      {scope === 'cat' ? <Field label="Catégorie" htmlFor="pc"><select id="pc" className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">Choisir…</option>{leafCategories(cats.data).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></Field>
        : <AssetPicker value={assets} onChange={(v) => setAssets(v.slice(-1))} statuses="EN_SERVICE,EN_STOCK" />}
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Fréquence (mois)" htmlFor="pf"><input id="pf" type="number" className="input" value={f.frequencyMonths} onChange={(e) => setF({ ...f, frequencyMonths: e.target.value })} /></Field>
        <Field label="Première échéance" htmlFor="pn"><input id="pn" type="date" className="input" value={f.nextDate} onChange={(e) => setF({ ...f, nextDate: e.target.value })} /></Field>
        <Field label="Contrat" htmlFor="pk"><select id="pk" className="input" value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}><option value="">Aucun</option>
          {contracts.data?.items.filter((c: Row) => c.kind === 'MAINTENANCE').map((c: Row) => <option key={c.id} value={c.id}>{c.number} · {c.provider}</option>)}</select></Field>
        <Field label="Intervenant" htmlFor="pa"><input id="pa" className="input" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={f.label.length < 3 || (scope === 'cat' ? !f.categoryId : !assets.length) || save.isPending} onClick={() => save.mutate(undefined)}>Créer le plan</button></div>
    </Modal>
  );
}

function NewWorkOrder({ initial, onClose }: { initial: { assetId?: number; requestId?: number }; onClose: () => void }) {
  const nav = useNavigate();
  const [assets, setAssets] = useState<Row[]>([]);
  const [f, setF] = useState({ kind: 'CORRECTIF', title: '', description: '', priority: 'NORMALE', plannedDate: '', assignee: '' });
  const assetId = assets[0]?.id;
  const cover = useQuery({ queryKey: ['coverage', assetId], enabled: !!assetId, queryFn: () => api<Row | null>(`/maintenance/couverture/${assetId}`) });
  const save = useAction(() => post<Row>('/maintenance/ot', { assetId, kind: f.kind, title: f.title, description: f.description || undefined, priority: f.priority, plannedDate: f.plannedDate || null,
    assignee: f.assignee || undefined, requestId: initial.requestId ?? null }), { success: (w) => `Ordre ${w.number} créé`, invalidate: [['maintenance'], ['requests']], onDone: (w) => { onClose(); nav(`/maintenance/ot/${w.id}`); } });
  return (
    <Modal title={initial.requestId ? "Ordre de travail sur demande d'un détenteur" : 'Nouvel ordre de travail'} onClose={onClose} width={680}>
      <AssetPicker value={assets} onChange={(v) => setAssets(v.slice(-1))} statuses="EN_SERVICE,EN_STOCK,EN_MAINTENANCE,EN_PRET" initialIds={initial.assetId ? [initial.assetId] : undefined} />
      {assetId && cover.data && <Note tone="ok"><strong>Couvert :</strong> {cover.data.label} jusqu'au {date(cover.data.until)} · l'intervenant est proposé automatiquement.</Note>}
      {assetId && cover.data === null && <Note tone="warn">Aucun contrat de maintenance ni garantie ne couvre ce bien : intervention à la charge de l'entité.</Note>}
      <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={[['CORRECTIF', 'Correctif (panne)'], ['PREVENTIF', 'Préventif (entretien)']]} />
      <Field label="Objet de l'intervention" htmlFor="wt"><input id="wt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Description" htmlFor="wd"><textarea id="wd" className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Priorité" htmlFor="wp"><select id="wp" className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{Object.entries(WO_PRIORITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Date planifiée" htmlFor="wdp"><input id="wdp" type="date" className="input" value={f.plannedDate} onChange={(e) => setF({ ...f, plannedDate: e.target.value })} /></Field>
        <Field label="Intervenant" htmlFor="wa" hint={cover.data ? 'Par défaut : le titulaire du contrat' : undefined}><input id="wa" className="input" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={!assetId || f.title.length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>Créer l'ordre</button></div>
    </Modal>
  );
}

export function OtDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [closing, setClosing] = useState(false);
  const q = useQuery({ queryKey: ['wo', id], queryFn: () => api<Row>(`/maintenance/ot/${id}`) });
  const move = useAction((v: Row) => patch(`/maintenance/ot/${id}`, v), { success: 'Ordre mis à jour', invalidate: [['wo', String(id)], ['maintenance']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const w = q.data!;
  const manage = can('maintenance.manage');
  const STEP_LABEL: Record<string, string> = { PLANIFIE: 'Planifier', EN_COURS: w.status === 'ATTENTE_PIECES' ? 'Reprendre' : "Démarrer l'intervention", ATTENTE_PIECES: 'En attente de pièces', A_PLANIFIER: 'Remettre à planifier', ANNULE: 'Annuler' };
  return (
    <>
      <nav className="crumbs"><Link to="/maintenance">Maintenance</Link><span aria-hidden="true">/</span><span>{w.number}</span></nav>
      <PageHead title={w.title} sub={<><Mono>{w.number}</Mono> · {w.kind === 'PREVENTIF' ? 'maintenance préventive' : 'maintenance corrective'} · créé le {date(w.createdAt)}</>}
        actions={<><StatusPill map={WO_STATUS} value={w.status} /><StatusPill map={WO_PRIORITY} value={w.priority} /></>} />
      {w.reformSuggested && <Note tone="warn"><strong>Coût de maintenance élevé :</strong> {fcfa(w.maintenanceTotal)} FCFA cumulés, soit plus de 30 % de la valeur d'origine ({fcfa(w.asset.value)}). La réforme du bien mérite d'être étudiée.
        {can('disposals.write') && <> <Link to={`/reformes/nouvelle?assets=${w.asset.id}`}>Proposer à la réforme</Link></>}</Note>}
      <div className="split">
        <div className="wide">
          <Card title="Intervention">
            <dl className="kv" style={{ margin: 0 }}>
              <div><dt>Bien</dt><dd><Link to={`/biens/${w.asset.id}`}><Mono>{w.asset.code}</Mono></Link><br />{w.asset.designation}</dd></div>
              <div><dt>Statut du bien</dt><dd><StatusPill map={ASSET_STATUS} value={w.asset.status} /></dd></div>
              <div><dt>Localisation</dt><dd>{w.asset.location ?? '—'}</dd></div>
              <div><dt>Intervenant</dt><dd>{w.assignee ?? 'Non affecté'}</dd></div>
              <div><dt>Date planifiée</dt><dd>{date(w.plannedDate)}</dd></div>
              <div><dt>Début · fin</dt><dd>{w.startedAt ? dateTime(w.startedAt) : '—'} · {w.doneAt ? dateTime(w.doneAt) : '—'}</dd></div>
            </dl>
            {w.description && <p style={{ margin: 0 }}>{w.description}</p>}
            {w.report && <Note tone="ok"><strong>Compte rendu : </strong>{w.report}</Note>}
            {manage && w.next.length > 0 && <div className="actions">
              {w.next.filter((s: string) => s !== 'TERMINE').map((s: string) => <button key={s} className={`btn ${s === 'ANNULE' ? 'danger' : s === 'EN_COURS' ? 'primary' : ''}`} disabled={move.isPending}
                onClick={() => move.mutate(s === 'PLANIFIE' && !w.plannedDate ? { status: s, plannedDate: today() } : { status: s })}>{STEP_LABEL[s]}</button>)}
              {w.next.includes('TERMINE') && <button className="btn success" onClick={() => setClosing(true)}>Clore l'intervention</button>}
            </div>}
            {w.status === 'EN_COURS' && <span className="small muted">Le bien est passé « en maintenance » au démarrage ; il retrouvera son statut à la clôture.</span>}
          </Card>
          <Documents objectType="OT" objectId={w.id} title="Devis, bons et rapports" defaultCategory="FACTURE" />
        </div>
        <div className="narrow">
          <Card title="Couverture">
            {w.coverage ? <><span><Pill tone="ok">{w.coverage.type === 'GARANTIE' ? 'Sous garantie' : 'Sous contrat'}</Pill></span><span>{w.coverage.label}</span><span className="small muted">jusqu'au {date(w.coverage.until)}</span>
              {w.contract && <Link to={`/contrats/${w.contract.id}`} className="small">Voir le contrat{w.contract.slaHours ? ` (intervention sous ${w.contract.slaHours} h)` : ''}</Link>}</>
              : <Note tone="warn">Ni contrat ni garantie : intervention à la charge de l'entité.</Note>}
          </Card>
          <Card title="Coûts">
            <dl className="kv" style={{ margin: 0 }}>
              <div><dt>Main-d'œuvre</dt><dd>{fcfa(w.laborCost)} FCFA</dd></div><div><dt>Pièces</dt><dd>{fcfa(w.partsCost)} FCFA</dd></div>
              <div><dt>Cumul des interventions sur le bien</dt><dd>{fcfa(w.maintenanceTotal)} FCFA ({w.asset.value ? pct(w.maintenanceTotal / w.asset.value, 0) : '—'} de la valeur)</dd></div>
            </dl>
          </Card>
        </div>
      </div>
      {closing && <CloseWo w={w} onClose={() => setClosing(false)} />}
    </>
  );
}

function CloseWo({ w, onClose }: { w: Row; onClose: () => void }) {
  const [f, setF] = useState({ report: w.report ?? '', laborCost: String(w.laborCost || ''), partsCost: String(w.partsCost || '') });
  const act = useAction(() => patch(`/maintenance/ot/${w.id}`, { status: 'TERMINE', report: f.report, laborCost: Number(f.laborCost || 0), partsCost: Number(f.partsCost || 0) }),
    { success: "Intervention close : le bien retrouve son statut", invalidate: [['wo', String(w.id)], ['maintenance'], ['requests']], onDone: onClose });
  return (
    <Modal title={`Clore ${w.number}`} onClose={onClose}>
      <Field label="Compte rendu d'intervention" htmlFor="cr"><textarea id="cr" className="input" rows={4} value={f.report} onChange={(e) => setF({ ...f, report: e.target.value })} /></Field>
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Main-d'œuvre (FCFA)" htmlFor="cl"><input id="cl" type="number" className="input" value={f.laborCost} onChange={(e) => setF({ ...f, laborCost: e.target.value })} /></Field>
        <Field label="Pièces (FCFA)" htmlFor="cp"><input id="cp" type="number" className="input" value={f.partsCost} onChange={(e) => setF({ ...f, partsCost: e.target.value })} /></Field>
      </div>
      {w.requestId && <Note>La demande du détenteur à l'origine de l'ordre sera close et le détenteur informé.</Note>}
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn success" disabled={f.report.length < 3 || act.isPending} onClick={() => act.mutate(undefined)}>Clore</button></div>
    </Modal>
  );
}

export function Contrats() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('');
  const q = useQuery({ queryKey: ['contracts'], queryFn: () => api<Row>('/contrats') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const items: Row[] = d.items.filter((c: Row) => !kind || c.kind === kind);
  return (
    <>
      <nav className="crumbs"><Link to="/maintenance">Maintenance</Link><span aria-hidden="true">/</span><span>Contrats et garanties</span></nav>
      <PageHead title="Contrats, assurances et garanties" sub="Contrats de maintenance, polices d'assurance, garanties constructeur et locations, avec les biens qu'ils couvrent."
        actions={can('contracts.manage') && <button className="btn primary" onClick={() => setOpen(true)}>Nouveau contrat</button>} />
      <section className="kpis">
        <Kpi label="Contrats actifs" value={d.summary.active} note={`${fcfa(d.summary.annual)} FCFA par an`} />
        <Kpi label="Valeur assurée" value={big(d.summary.insuredValue)} note={`${d.summary.insurance} police(s) d'assurance`} />
        <Kpi label="Échéances à 30 jours" value={d.summary.expiring} note="contrats et garanties à renouveler" tone={d.summary.expiring ? 'warn' : undefined} />
        <Kpi label="Biens sensibles non assurés" value={d.uninsured} note="véhicules, motos et immeubles" tone={d.uninsured ? 'bad' : undefined} />
      </section>
      <Card pad={false} title="Contrats" extra={<div className="seg" role="group" aria-label="Nature">{[['', 'Tous'], ...Object.entries(CONTRACT_KIND)].map(([k, l]) =>
        <button key={k} className={kind === k ? 'active' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>)}</div>}>
        {!items.length ? <Empty>Aucun contrat.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
          <thead><tr><th>Contrat</th><th>Nature</th><th>Prestataire</th><th>Période</th><th className="num">Biens</th><th className="num">Montant annuel</th><th>État</th></tr></thead>
          <tbody>{items.map((c) => <tr key={c.id} className="click" onClick={() => nav(`/contrats/${c.id}`)}>
            <td><strong>{c.title}</strong><br /><Mono>{c.number}</Mono></td><td>{CONTRACT_KIND[c.kind]}</td><td>{c.provider}</td><td className="small">{date(c.startDate)} → {date(c.endDate)}</td>
            <td className="num">{c.assetCount}</td><td className="num">{c.annualAmount ? fcfa(c.annualAmount) : '—'}</td><td><StatusPill map={CONTRACT_STATE} value={c.state} /></td></tr>)}</tbody>
        </table></div>}
      </Card>
      {d.warranties.length > 0 && <Card pad={false} title={`Garanties constructeur échéant dans les 90 jours (${d.warranties.length})`}>
        <div className="table-wrap"><table className="t" style={{ minWidth: 560 }}><thead><tr><th>Bien</th><th>Désignation</th><th>Fin de garantie</th></tr></thead>
          <tbody>{d.warranties.slice(0, 30).map((w: Row) => <tr key={w.id} className="click" onClick={() => nav(`/biens/${w.id}`)}><td><Mono>{w.code}</Mono></td><td>{w.designation}</td><td>{date(w.warrantyEnd)}</td></tr>)}</tbody></table></div>
      </Card>}
      {open && <ContractForm onClose={() => setOpen(false)} />}
    </>
  );
}

export function ContratDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => api<Row>(`/contrats/${id}`) });
  const toggle = useAction((active: boolean) => patch(`/contrats/${id}`, { active }), { success: 'Contrat mis à jour', invalidate: [['contract', String(id)], ['contracts']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  return (
    <>
      <nav className="crumbs"><Link to="/contrats">Contrats et garanties</Link><span aria-hidden="true">/</span><span>{c.number}</span></nav>
      <PageHead title={c.title} sub={<><Mono>{c.number}</Mono> · {CONTRACT_KIND[c.kind]} · {c.provider}</>}
        actions={<>{!c.active && <Pill tone="grey">Résilié</Pill>}{can('contracts.manage') && <button className="btn" disabled={toggle.isPending} onClick={() => toggle.mutate(!c.active)}>{c.active ? 'Résilier' : 'Réactiver'}</button>}</>} />
      <section className="kpis">
        <Kpi label="Période" value={`${date(c.startDate)}`} note={`jusqu'au ${date(c.endDate)}`} tone={c.endDate < today() ? 'bad' : undefined} />
        <Kpi label="Montant annuel" value={c.annualAmount ? big(c.annualAmount) : '—'} note="FCFA" />
        {c.kind === 'ASSURANCE' && <Kpi label="Valeur assurée" value={big(c.insuredValue)} note="FCFA" />}
        {c.slaHours && <Kpi label="Délai d'intervention" value={`${c.slaHours} h`} note="engagement contractuel" />}
        <Kpi label="Biens couverts" value={c.assets.length} note={`${c.workOrders.length} intervention(s) rattachée(s)`} />
      </section>
      {c.notes && <Note>{c.notes}</Note>}
      <div className="split">
        <div className="wide">
          <Card pad={false} title="Biens couverts">
            {!c.assets.length ? <Empty>Aucun bien rattaché.</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>Code</th><th>Désignation</th><th>Statut</th></tr></thead>
              <tbody>{c.assets.map((a: Row) => <tr key={a.id} className="click" onClick={() => nav(`/biens/${a.id}`)}><td><Mono>{a.code}</Mono></td><td>{a.designation}</td><td><StatusPill map={ASSET_STATUS} value={a.status} /></td></tr>)}</tbody></table></div>}
          </Card>
        </div>
        <div className="narrow">
          <Card title="Interventions sous contrat">
            {!c.workOrders.length ? <Empty>Aucune intervention.</Empty> : <ul className="list">{c.workOrders.map((w: Row) => (
              <li key={w.id}><span className="grow"><Link to={`/maintenance/ot/${w.id}`}><strong>{w.title}</strong></Link><span className="small muted"><Mono>{w.number}</Mono> · {date(w.createdAt)}</span></span><StatusPill map={WO_STATUS} value={w.status} /></li>))}</ul>}
          </Card>
          <Documents objectType="CONTRAT" objectId={c.id} title="Contrat et avenants" defaultCategory="CONTRAT" />
        </div>
      </div>
    </>
  );
}

function ContractForm({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [assets, setAssets] = useState<Row[]>([]);
  const [f, setF] = useState({ kind: 'MAINTENANCE', title: '', provider: '', startDate: today(), endDate: '', annualAmount: '', insuredValue: '', slaHours: '', notes: '' });
  const save = useAction(() => post<Row>('/contrats', { ...f, annualAmount: Number(f.annualAmount || 0), insuredValue: Number(f.insuredValue || 0), slaHours: f.slaHours ? Number(f.slaHours) : null,
    notes: f.notes || undefined, assetIds: assets.map((a) => a.id) }), { success: (c) => `Contrat ${c.number} enregistré`, invalidate: [['contracts']], onDone: (c) => { onClose(); nav(`/contrats/${c.id}`); } });
  return (
    <Modal title="Nouveau contrat" onClose={onClose} width={720}>
      <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={Object.entries(CONTRACT_KIND) as [string, string][]} min={130} />
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="Objet" htmlFor="ct"><input id="ct" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Prestataire ou assureur" htmlFor="cp"><input id="cp" className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} /></Field>
        <Field label="Début" htmlFor="cs"><input id="cs" type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
        <Field label="Fin" htmlFor="ce"><input id="ce" type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
        {f.kind !== 'GARANTIE' && <Field label={f.kind === 'ASSURANCE' ? 'Prime annuelle (FCFA)' : 'Montant annuel (FCFA)'} htmlFor="ca"><input id="ca" type="number" className="input" value={f.annualAmount} onChange={(e) => setF({ ...f, annualAmount: e.target.value })} /></Field>}
        {f.kind === 'ASSURANCE' && <Field label="Valeur assurée (FCFA)" htmlFor="ci"><input id="ci" type="number" className="input" value={f.insuredValue} onChange={(e) => setF({ ...f, insuredValue: e.target.value })} /></Field>}
        {f.kind === 'MAINTENANCE' && <Field label="Délai d'intervention (heures)" htmlFor="ch"><input id="ch" type="number" className="input" value={f.slaHours} onChange={(e) => setF({ ...f, slaHours: e.target.value })} /></Field>}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Biens couverts</span>
      <AssetPicker value={assets} onChange={setAssets} statuses="EN_SERVICE,EN_STOCK,EN_MAINTENANCE,EN_PRET" />
      <Field label="Observations" htmlFor="cn"><input id="cn" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={f.title.length < 3 || f.provider.length < 2 || !f.endDate || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}
