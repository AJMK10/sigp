import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post } from '../api';
import { CONDITION, DISPOSAL_STATUS, EXIT_MODE, date, fcfa, today } from '../format';
import { useAuth } from '../auth';
import { AssetPicker } from '../components/AssetPicker';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, RadioCards, Steps, StatusPill, useAction } from '../components/ui';
import type { Row } from '../types';

const PIECES: Record<string, string> = {
  VENTE: "PV de commission, avis de vente, PV d'adjudication, quittance du Trésor", DESTRUCTION: 'PV de commission, PV de destruction, photos horodatées',
  DON: 'PV de commission, décision de cession, PV de remise signé du bénéficiaire', RECYCLAGE: "PV de commission, certificat d'effacement des données, bordereau de prise en charge",
  PERTE: 'PV de commission, déclaration de perte ou récépissé de plainte',
};

export function Reformes() {
  const nav = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['disposals'], queryFn: () => api<Row[]>('/reformes') });
  const rows = q.data ?? [];
  return (
    <>
      <PageHead title="Réformes et sorties" sub="Proposition, avis du contrôle financier, commission de réforme, décision de l'ordonnateur, puis sortie comptable."
        actions={can('disposals.write') && <Link to="/reformes/nouvelle" className="btn primary">Nouveau dossier de réforme</Link>} />
      <section className="kpis">
        <Kpi label="Dossiers en circuit" value={rows.filter((r) => r.status === 'EN_COURS').length} note={`${fcfa(rows.filter((r) => r.status === 'EN_COURS').reduce((s, r) => s + r.count, 0))} biens`} />
        <Kpi label="Sorties à exécuter" value={rows.filter((r) => r.status === 'APPROUVE').length} note="décision de l'ordonnateur obtenue" tone={rows.some((r) => r.status === 'APPROUVE') ? 'warn' : undefined} />
        <Kpi label="Sorties exécutées" value={rows.filter((r) => r.status === 'SORTI').length} note={`produits de cession : ${fcfa(rows.reduce((s, r) => s + r.proceeds, 0))} FCFA`} />
      </section>
      {q.error && <ErrorBox error={q.error} />}
      <Card pad={false} title="Dossiers">
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Aucun dossier de réforme.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 820 }}>
            <thead><tr><th>Dossier</th><th>Objet</th><th>Mode de sortie</th><th className="num">Biens</th><th className="num">VNC</th><th>Initié par</th><th>Statut</th></tr></thead>
            <tbody>{rows.map((d) => <tr key={d.id} className="click" onClick={() => nav(`/reformes/${d.id}`)}><td><Mono>{d.number}</Mono></td><td>{d.title}</td><td className="small">{d.exitModeLabel}</td><td className="num">{d.count}</td><td className="num">{fcfa(d.nbv)}</td><td>{d.author}</td><td><StatusPill map={DISPOSAL_STATUS} value={d.status} /></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

export function NouvelleReforme() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [assets, setAssets] = useState<Row[]>([]);
  const [motives, setMotives] = useState<Record<number, string>>({});
  const [f, setF] = useState({ title: '', exitMode: 'VENTE', reason: '', commissionDate: '' });
  const save = useAction(async (submit: boolean) => {
    const d = await post<Row>('/reformes', { ...f, commissionDate: f.commissionDate || null, reason: f.reason || undefined, items: assets.map((a) => ({ assetId: a.id, motive: motives[a.id] || "Hors d'usage" })) });
    if (submit) await post(`/reformes/${d.id}/soumettre`);
    return d;
  }, { success: (d) => `Dossier ${d.number} créé`, invalidate: [['disposals'], ['validations']], onDone: (d) => nav(`/reformes/${d.id}`) });
  return (
    <>
      <PageHead title="Nouveau dossier de réforme" sub="Les biens proposés passent au statut « Proposé à la réforme » dès la soumission ; ils retrouvent leur statut si le dossier est rejeté." />
      <div className="split">
        <div className="wide">
          <Card title="Biens proposés"><AssetPicker value={assets} onChange={setAssets} statuses="EN_SERVICE,EN_STOCK,EN_MAINTENANCE,MANQUANT" initialIds={sp.get('assets')?.split(',').map(Number).filter(Boolean)} /></Card>
          {assets.length > 0 && <Card pad={false} title="Motif par bien">
            <div className="table-wrap"><table className="t" style={{ minWidth: 640 }}><thead><tr><th>Code</th><th>Désignation</th><th>État</th><th>Motif</th></tr></thead>
              <tbody>{assets.map((a) => <tr key={a.id}><td><Mono>{a.code}</Mono></td><td>{a.designation}</td><td>{CONDITION[a.condition]}</td>
                <td><select aria-label={`Motif ${a.code}`} className="input" style={{ height: 36 }} value={motives[a.id] ?? "Hors d'usage"} onChange={(e) => setMotives({ ...motives, [a.id]: e.target.value })}>
                  {["Hors d'usage", 'Coût de réparation excessif', 'Obsolète', 'Vétusté', 'Perte ou vol constaté', 'Excédentaire'].map((m) => <option key={m}>{m}</option>)}</select></td></tr>)}</tbody></table></div>
          </Card>}
        </div>
        <div className="narrow">
          <Card title="Dossier">
            <Field label="Objet du dossier" htmlFor="t"><input id="t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Matériel informatique obsolète" /></Field>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Mode de sortie proposé</span>
            <RadioCards label="Mode de sortie" value={f.exitMode} onChange={(v) => setF({ ...f, exitMode: v })} items={Object.entries(EXIT_MODE) as [string, string][]} min={130} />
            <span className="small muted">Pièces exigées : {PIECES[f.exitMode]}</span>
            <Field label="Date prévue de la commission" htmlFor="cd"><input id="cd" type="date" className="input" value={f.commissionDate} onChange={(e) => setF({ ...f, commissionDate: e.target.value })} /></Field>
            <Field label="Exposé des motifs" htmlFor="r"><textarea id="r" className="input" rows={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <div className="actions">
              <button className="btn" disabled={!assets.length || f.title.length < 3 || save.isPending} onClick={() => save.mutate(false)}>Enregistrer le brouillon</button>
              <button className="btn primary" disabled={!assets.length || f.title.length < 3 || save.isPending} onClick={() => save.mutate(true)}>Soumettre au circuit</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function ReformeDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [exec, setExec] = useState(false);
  const q = useQuery({ queryKey: ['disposal', id], queryFn: () => api<Row>(`/reformes/${id}`) });
  const submit = useAction(() => post(`/reformes/${id}/soumettre`), { success: 'Dossier soumis : avis du contrôle financier demandé', invalidate: [['disposal', id!], ['disposals']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  return (
    <>
      <nav className="crumbs"><Link to="/reformes">Réformes et sorties</Link><span aria-hidden="true">/</span><span>{d.number}</span></nav>
      <PageHead title="Dossier de réforme" sub={<><Mono>{d.number}</Mono> · {d.title} · initié par {d.author} le {date(d.createdAt)}</>}
        actions={<>
          {['BROUILLON', 'REJETE'].includes(d.status) && can('disposals.write') && <button className="btn primary" onClick={() => submit.mutate(undefined)} disabled={submit.isPending}>Soumettre au circuit</button>}
          {d.status === 'APPROUVE' && can('disposals.validate') && <button className="btn primary" onClick={() => setExec(true)}>Exécuter la sortie</button>}
        </>} />
      <div className="actions"><StatusPill map={DISPOSAL_STATUS} value={d.status} />{d.exitOrderNo && <span>Ordre de sortie <Mono>{d.exitOrderNo}</Mono></span>}</div>
      {d.steps.length > 0 && <Card title="Circuit"><Steps steps={d.steps} /></Card>}
      <section className="kpis">
        <Kpi label="Biens proposés" value={d.items.length} />
        <Kpi label="Valeur d'origine" value={fcfa(d.totals.value)} note="FCFA" />
        <Kpi label="VNC à la proposition" value={fcfa(d.totals.nbv)} note="moins-value potentielle" />
        {d.status === 'SORTI' && <Kpi label="Produit de cession" value={fcfa(d.proceeds)} note="FCFA" />}
      </section>
      <div className="split">
        <div className="wide">
          <Card pad={false} title={`Biens · ${d.items.length}`}>
            <div className="table-wrap"><table className="t" style={{ minWidth: 700 }}><thead><tr><th>Code</th><th>Désignation</th><th>État</th><th>Motif</th><th className="num">VNC</th></tr></thead>
              <tbody>{d.items.map((i: Row) => <tr key={i.assetId}><td><Link to={`/biens/${i.assetId}`}><Mono>{i.code}</Mono></Link></td><td>{i.designation}</td><td>{CONDITION[i.condition]}</td><td>{i.motive}</td><td className="num">{fcfa(i.nbvAtProposal)}</td></tr>)}</tbody></table></div>
          </Card>
        </div>
        <div className="narrow">
          <Card title="Mode de sortie">
            <strong>{d.exitModeLabel}</strong>
            <span className="small muted">Pièces exigées : {PIECES[d.exitMode]}</span>
            {d.commissionDate && <span>Commission : {date(d.commissionDate)}</span>}
            {d.reason && <span className="small">{d.reason}</span>}
          </Card>
          {d.status === 'SORTI' && <Note tone="ok">Sortie exécutée le {date(d.executedAt)} : biens sortis du registre, ordre de sortie et écriture de sortie générés.</Note>}
        </div>
      </div>
      {exec && <Execute d={d} onClose={() => setExec(false)} />}
    </>
  );
}

function Execute({ d, onClose }: { d: Row; onClose: () => void }) {
  const [f, setF] = useState({ exitDate: today(), proceeds: '0', reference: '' });
  const act = useAction(() => post<Row>(`/reformes/${d.id}/executer`, { exitDate: f.exitDate, proceeds: Number(f.proceeds || 0), reference: f.reference || undefined }),
    { success: (r) => `Sortie exécutée : ordre de sortie ${r.exitOrderNo}`, invalidate: [['disposal', String(d.id)], ['disposals'], ['assets'], ['dashboard']], onDone: onClose });
  return (
    <Modal title={`Exécuter la sortie · ${d.number}`} onClose={onClose}>
      <Note tone="warn">Les {d.items.length} biens passent au statut « Sorti », définitivement. Une écriture de sortie (amortissements, valeur comptable des cessions, immobilisations) est générée.</Note>
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="Date de sortie" htmlFor="ed"><input id="ed" type="date" className="input" max={today()} value={f.exitDate} onChange={(e) => setF({ ...f, exitDate: e.target.value })} /></Field>
        {d.exitMode === 'VENTE' && <Field label="Produit de cession (FCFA)" htmlFor="pr"><input id="pr" type="number" min="0" className="input" value={f.proceeds} onChange={(e) => setF({ ...f, proceeds: e.target.value })} /></Field>}
      </div>
      <Field label="Référence de la pièce justificative" htmlFor="rf"><input id="rf" className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="PV d'adjudication n° …" /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={act.isPending} onClick={() => act.mutate(undefined)}>Exécuter la sortie</button></div>
    </Modal>
  );
}
