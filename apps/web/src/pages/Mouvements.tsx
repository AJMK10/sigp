import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post } from '../api';
import { MOVEMENT_STATUS, MOVEMENT_TYPE, date, fcfa, today } from '../format';
import { useLocations, useOrgUnits, usePeople } from '../refs';
import { useAuth } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { Card, Empty, ErrorBox, Field, Loading, Mono, Note, PageHead, RadioCards, Steps, StatusPill, useAction } from '../components/ui';
import type { Row } from '../types';

export function Mouvements() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const type = sp.get('type') ?? '';
  const status = sp.get('status') ?? '';
  const q = useQuery({ queryKey: ['movements', type, status], queryFn: () => api<Row[]>(`/mouvements?${new URLSearchParams({ ...(type ? { type } : {}), ...(status ? { status } : {}) })}`) });
  const overdue = useQuery({ queryKey: ['movements', 'overdue'], queryFn: () => api<Row[]>('/mouvements/alertes/prets-echus') });
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  return (
    <>
      <PageHead title="Mouvements" sub="Affectations, transferts, prêts et restitutions : chaque mouvement suit un circuit de validation et laisse une pièce."
        actions={can('movements.write') && <Link to="/mouvements/nouveau" className="btn primary">Nouveau mouvement</Link>} />
      {!!overdue.data?.length && <Note tone="bad">{overdue.data.length} prêt(s) échu(s) non restitué(s) : {overdue.data.map((o) => <Link key={o.id} to={`/mouvements/${o.id}`} style={{ marginRight: 8 }}>{o.number} ({o.holder}, retour prévu le {date(o.dueDate)})</Link>)}</Note>}
      <Card pad={false} title="Pièces de mouvement" extra={<div className="actions">
        <select aria-label="Type" className="input" style={{ width: 180, height: 36 }} value={type} onChange={(e) => set('type', e.target.value)}><option value="">Tous les types</option>{Object.entries(MOVEMENT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select aria-label="Statut" className="input" style={{ width: 180, height: 36 }} value={status} onChange={(e) => set('status', e.target.value)}><option value="">Tous les statuts</option>{Object.entries(MOVEMENT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>}>
        {q.error && <ErrorBox error={q.error} />}
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Aucun mouvement.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 760 }}>
            <thead><tr><th>Pièce</th><th>Type</th><th className="num">Biens</th><th>Demandé par</th><th>Date</th><th>Motif</th><th>Statut</th></tr></thead>
            <tbody>{q.data.map((m) => <tr key={m.id} className="click" onClick={() => nav(`/mouvements/${m.id}`)}><td><Mono>{m.number}</Mono></td><td>{m.typeLabel}</td><td className="num">{m.count}</td><td>{m.requester}</td><td>{date(m.createdAt)}</td><td className="small">{m.reason ?? '—'}</td><td><StatusPill map={MOVEMENT_STATUS} value={m.status} /></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

const ELIGIBLE: Record<string, string> = { AFFECTATION: 'EN_STOCK,EN_SERVICE', TRANSFERT: 'EN_STOCK,EN_SERVICE', PRET: 'EN_STOCK,EN_SERVICE', RESTITUTION: 'EN_SERVICE,EN_PRET' };
const HELP: Record<string, string> = {
  AFFECTATION: "Met le bien à disposition d'un service ou d'un détenteur. Circuit : visa du comptable-matières, visa du directeur au-delà de 5 M FCFA, signature de la décharge par le détenteur.",
  TRANSFERT: "Déplace le bien vers une autre localisation. Après validation du directeur, le bien est « en transit » jusqu'à la confirmation de réception sur le site d'arrivée.",
  PRET: "Mise à disposition temporaire avec date de retour. Validation du directeur, puis prise en charge par l'emprunteur. Un prêt échu est signalé au tableau de bord.",
  RESTITUTION: 'Retour du bien au magasin : le détenteur est déchargé après visa du comptable-matières.',
};

export function NouveauMouvement() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const locs = useLocations(); const units = useOrgUnits(); const people = usePeople();
  const [type, setType] = useState('AFFECTATION');
  const [assets, setAssets] = useState<Row[]>([]);
  const [f, setF] = useState({ toLocationId: '', toOrgUnitId: '', toHolderId: '', dueDate: '', reason: '' });
  const initial = sp.get('assets')?.split(',').map(Number).filter(Boolean);
  const save = useAction(() => post<Row>('/mouvements', {
    type, assetIds: assets.map((a) => a.id), toLocationId: f.toLocationId ? Number(f.toLocationId) : null, toOrgUnitId: f.toOrgUnitId ? Number(f.toOrgUnitId) : null,
    toHolderId: f.toHolderId ? Number(f.toHolderId) : null, dueDate: f.dueDate || null, reason: f.reason || undefined,
  }), { success: (m) => `Mouvement ${m.number} créé et transmis au circuit de validation`, invalidate: [['movements'], ['validations']], onDone: (m) => nav(`/mouvements/${m.id}`) });
  const value = assets.reduce((s, a) => s + a.acquisitionValue, 0);
  return (
    <>
      <PageHead title="Nouveau mouvement" sub="Choisissez le type de mouvement, les biens concernés et la destination." />
      <Card title="Type de mouvement">
        <RadioCards label="Type de mouvement" value={type} onChange={(v) => { setType(v); setAssets([]); }} items={Object.entries(MOVEMENT_TYPE) as [string, string][]} />
        <span className="small muted">{HELP[type]}</span>
      </Card>
      <div className="split">
        <div className="wide"><Card title="Biens concernés"><AssetPicker value={assets} onChange={setAssets} statuses={ELIGIBLE[type]} initialIds={initial} /></Card></div>
        <div className="narrow">
          <Card title="Destination">
            {(type === 'AFFECTATION') && <Field label="Service bénéficiaire" htmlFor="ou"><select id="ou" className="input" value={f.toOrgUnitId} onChange={(e) => setF({ ...f, toOrgUnitId: e.target.value })}><option value="">Choisir…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>}
            {(type === 'AFFECTATION' || type === 'PRET') && <Field label={type === 'PRET' ? 'Emprunteur' : 'Détenteur (signe la décharge)'} htmlFor="h"><select id="h" className="input" value={f.toHolderId} onChange={(e) => setF({ ...f, toHolderId: e.target.value })}><option value="">{type === 'PRET' ? 'Choisir…' : 'Aucun (affectation collective)'}</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.title ? ` · ${p.title}` : ''}</option>)}</select></Field>}
            <Field label={type === 'RESTITUTION' ? 'Lieu de restitution' : type === 'TRANSFERT' ? 'Localisation de destination' : 'Localisation (facultatif)'} htmlFor="l">
              <select id="l" className="input" value={f.toLocationId} onChange={(e) => setF({ ...f, toLocationId: e.target.value })}><option value="">{type === 'TRANSFERT' || type === 'RESTITUTION' ? 'Choisir…' : 'Inchangée'}</option>{locs.data?.map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}</select></Field>
            {type === 'PRET' && <Field label="Date de retour prévue" htmlFor="dd"><input id="dd" type="date" className="input" min={today()} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>}
            <Field label="Motif" htmlFor="r"><textarea id="r" className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            {type === 'AFFECTATION' && value > 5_000_000 && <Note tone="warn">Valeur supérieure à 5 M FCFA : le visa du directeur du patrimoine sera requis.</Note>}
            <button className="btn primary" disabled={!assets.length || save.isPending} onClick={() => save.mutate(undefined)}>Soumettre au circuit ({assets.length} bien{assets.length > 1 ? 's' : ''})</button>
          </Card>
        </div>
      </div>
    </>
  );
}

export function MouvementDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['movement', id], queryFn: () => api<Row>(`/mouvements/${id}`) });
  const receive = useAction(() => post(`/mouvements/${id}/reception`), { success: 'Réception du transfert confirmée', invalidate: [['movement', id!], ['movements']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const m = q.data!;
  return (
    <>
      <nav className="crumbs"><Link to="/mouvements">Mouvements</Link><span aria-hidden="true">/</span><span>{m.number}</span></nav>
      <PageHead title={`${m.typeLabel} · ${m.number}`} sub={`Demandé par ${m.requester} le ${date(m.createdAt)}${m.reason ? ` · ${m.reason}` : ''}`}
        actions={m.status === 'EN_TRANSIT' && can('movements.write', 'movements.validate') && <button className="btn primary" onClick={() => receive.mutate(undefined)} disabled={receive.isPending}>Confirmer la réception sur site</button>} />
      <div className="actions"><StatusPill map={MOVEMENT_STATUS} value={m.status} />{m.executedAt && <span className="muted">Exécuté le {date(m.executedAt)}</span>}</div>
      <Card title="Circuit de validation"><Steps steps={m.steps} /></Card>
      <div className="split">
        <div className="wide">
          <Card pad={false} title={`Biens · ${m.items.length}`} foot={<><span /><strong>{fcfa(m.items.reduce((s: number, i: Row) => s + i.value, 0))} FCFA</strong></>}>
            <div className="table-wrap"><table className="t" style={{ minWidth: 600 }}><thead><tr><th>Code</th><th>Désignation</th><th>Provenance</th><th className="num">Valeur</th></tr></thead>
              <tbody>{m.items.map((i: Row) => <tr key={i.id}><td><Link to={`/biens/${i.id}`}><Mono>{i.code}</Mono></Link></td><td>{i.designation}</td><td className="small">{i.fromLocation ?? '—'}</td><td className="num">{fcfa(i.value)}</td></tr>)}</tbody></table></div>
          </Card>
        </div>
        <div className="narrow">
          <Card title="Destination">
            <dl className="kv" style={{ margin: 0 }}>
              {m.toOrgUnit && <div><dt>Service</dt><dd>{m.toOrgUnit}</dd></div>}
              {m.toHolder && <div><dt>{m.type === 'PRET' ? 'Emprunteur' : 'Détenteur'}</dt><dd>{m.toHolder}</dd></div>}
              {m.toLocation && <div><dt>Localisation</dt><dd>{m.toLocation}</dd></div>}
              {m.dueDate && <div><dt>Retour prévu</dt><dd>{date(m.dueDate)}</dd></div>}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
