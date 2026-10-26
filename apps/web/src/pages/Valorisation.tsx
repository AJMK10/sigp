import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, post } from '../api';
import { JOURNAL_STATUS, date, dateTime, fcfa, periodLabel } from '../format';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pill, RadioCards, StatusPill, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

function RunSummary({ run }: { run: Row }) {
  return (
    <>
      <section className="kpis">
        <Kpi label="Biens traités" value={fcfa(run.assetCount)} note={run.mode === 'DEFINITIF' ? `comptabilisé · ${run.number}` : `simulation du ${dateTime(run.createdAt)}`} />
        <Kpi label={`Dotation de ${periodLabel(run.period)}`} value={fcfa(run.total)} note="FCFA" />
        <Kpi label="Anomalies" value={run.anomalies.length} note="biens exclus du calcul" tone={run.anomalies.length ? 'warn' : undefined} />
      </section>
      <Card pad={false} title="Dotations par compte" foot={run.journal && <><span>Écriture <Link to={`/ecritures/${run.journal.id}`}><Mono>{run.journal.number}</Mono></Link></span><StatusPill map={JOURNAL_STATUS} value={run.journal.status} /></>}>
        <div className="table-wrap"><table className="t" style={{ minWidth: 620 }}>
          <thead><tr><th>Compte d'amortissement</th><th>Contrepartie</th><th className="num">Biens</th><th className="num">Dotation (FCFA)</th><th className="num">Part</th></tr></thead>
          <tbody>{run.byAccount.map((r: Row) => <tr key={`${r.deprAccount}-${r.expenseAccount}`}><td><Mono>{r.deprAccount}</Mono> · {r.label}</td><td><Mono>{r.expenseAccount}</Mono></td><td className="num">{fcfa(r.assets)}</td><td className="num">{fcfa(r.amount)}</td><td className="num">{run.total ? ((r.amount / run.total) * 100).toFixed(1).replace('.', ',') : 0} %</td></tr>)}</tbody>
          <tfoot><tr><td>Total</td><td /><td className="num">{fcfa(run.assetCount)}</td><td className="num">{fcfa(run.total)}</td><td className="num">100 %</td></tr></tfoot>
        </table></div>
      </Card>
      {run.anomalies.length > 0 && <Card title="Anomalies à corriger">
        <ul className="list">{run.anomalies.slice(0, 20).map((a: Row) => <li key={a.assetId}><span className="grow"><Link to={`/biens/${a.assetId}`}><Mono>{a.code}</Mono></Link><span className="small muted">{a.reason}</span></span><Link to={`/biens/${a.assetId}`} className="btn small">Corriger</Link></li>)}</ul>
        {run.anomalies.length > 20 && <span className="small muted">… et {run.anomalies.length - 20} autres.</span>}
      </Card>}
    </>
  );
}

export function Valorisation() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const year = new Date().getFullYear();
  const [y, setY] = useState(year);
  const periods = useQuery({ queryKey: ['periods', y], queryFn: () => api<Row[]>(`/amortissements/periodes?year=${y}`) });
  const firstOpen = periods.data?.find((p) => !p.definitive)?.period ?? `${y}-12`;
  const [period, setPeriod] = useState('');
  const [mode, setMode] = useState<'SIMULATION' | 'DEFINITIF'>('SIMULATION');
  const [result, setResult] = useState<Row | null>(null);
  const [cancel, setCancel] = useState<Row | null>(null);
  const p = period || firstOpen;
  const inv = [['periods', String(y)], ['runs'], ['journal'], ['dashboard']];
  const run = useAction(() => post<Row>('/amortissements/calcul', { period: p, mode }), { success: (r) => (r.mode === 'DEFINITIF' ? `Dotations de ${periodLabel(r.period)} comptabilisées` : 'Simulation terminée'), invalidate: inv, onDone: setResult });
  const close = useAction((per: string) => post(`/amortissements/periodes/${per}/cloturer`), { success: 'Période clôturée', invalidate: inv });
  const runs = useQuery({ queryKey: ['runs'], queryFn: () => api<Row[]>('/amortissements/calculs') });
  const latestId = runs.data?.find((r) => r.mode !== 'ANNULE')?.id;
  const latest = useQuery({ queryKey: ['run', String(latestId), 1], queryFn: () => api<Row>(`/amortissements/calculs/${latestId}`), enabled: !!latestId && !result });
  const shown = result ?? latest.data;
  return (
    <>
      <PageHead title="Dotations aux amortissements" sub="Calcul de la période, contrôle des anomalies, puis comptabilisation et envoi des écritures à l'ERP. Les périodes se traitent dans l'ordre."
        actions={<><select aria-label="Exercice" className="input" style={{ width: 120 }} value={y} onChange={(e) => { setY(Number(e.target.value)); setPeriod(''); }}>{[year - 1, year].map((x) => <option key={x}>{x}</option>)}</select>
          <button className="btn" onClick={() => download(`/etats/amortissements.xlsx?year=${y}`, `tableau-amortissements-${y}.xlsx`).catch((e) => toast(e.message, 'bad'))}>Tableau des amortissements</button></>} />
      <Card title={`Périodes de l'exercice ${y}`}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))', gap: 6 }}>
          {periods.data?.map((x) => {
            const bg = x.closed ? 'var(--ok-bg)' : x.definitive ? '#D2EADD' : x.period === p ? 'var(--accent)' : 'var(--line-soft)';
            const fg = x.period === p && !x.definitive ? '#fff' : x.closed || x.definitive ? 'var(--ok)' : 'var(--muted-2)';
            return <button key={x.period} type="button" onClick={() => setPeriod(x.period)} title={x.closed ? 'Clôturée' : x.definitive ? 'Comptabilisée' : 'Ouverte'}
              style={{ padding: '8px 0', borderRadius: 6, border: x.period === p ? '2px solid var(--accent)' : 0, background: bg, color: fg, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
              {periodLabel(x.period).split(' ')[0]}<div style={{ fontWeight: 400, fontSize: 10 }}>{x.closed ? 'clôturée' : x.definitive ? 'comptabilisée' : x.simulation ? 'simulée' : 'ouverte'}</div></button>;
          })}
        </div>
        <span className="small muted">Vert foncé : clôturée (verrouillée) · vert : comptabilisée · bleu : période sélectionnée · gris : ouverte.</span>
      </Card>
      <div className="split">
        <div className="narrow" style={{ flex: '1 1 320px' }}>
          <Card title="Traitement">
            <Field label="Période" htmlFor="per"><input id="per" className="input" readOnly value={periodLabel(p)} /></Field>
            {can('depreciation.run') ? <>
              <RadioCards label="Mode" value={mode} onChange={setMode} items={[['SIMULATION', 'Simulation'], ['DEFINITIF', 'Définitif']]} />
              {mode === 'DEFINITIF' && <Note tone="warn">Le traitement définitif fige les dotations et génère l'écriture. Il ne peut être relancé qu'après une annulation tracée, tant que l'écriture n'est pas intégrée.</Note>}
              <button className={`btn ${mode === 'DEFINITIF' ? 'primary' : ''}`} style={{ minHeight: 46 }} disabled={run.isPending} onClick={() => run.mutate(undefined)}>{run.isPending ? 'Calcul en cours…' : mode === 'SIMULATION' ? 'Lancer la simulation' : 'Comptabiliser et générer les écritures'}</button>
            </> : <Note>Votre profil permet de consulter les calculs ; leur lancement relève de la direction financière.</Note>}
            {can('periods.close') && periods.data?.find((x) => x.period === p)?.definitive && !periods.data?.find((x) => x.period === p)?.closed &&
              <button className="btn" onClick={() => close.mutate(p)} disabled={close.isPending}>Clôturer {periodLabel(p)}</button>}
          </Card>
        </div>
        <div className="wide">
          {shown ? <RunSummary run={shown} /> : <Card title="Résultat"><Empty>Aucun calcul pour l'instant : lancez une simulation pour voir les dotations par compte et les anomalies.</Empty></Card>}
        </div>
      </div>
      <Card pad={false} title="Historique des calculs">
        {runs.isLoading ? <Loading /> : !runs.data?.length ? <Empty>Aucun calcul.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th>Référence</th><th>Période</th><th>Mode</th><th className="num">Biens</th><th className="num">Dotation</th><th className="num">Anomalies</th><th>Date</th><th /></tr></thead>
            <tbody>{runs.data.map((r) => <tr key={r.id} className="click" onClick={() => nav(`/valorisation/calculs/${r.id}`)}><td><Mono>{r.number}</Mono></td><td>{periodLabel(r.period)}</td>
              <td><Pill tone={r.mode === 'DEFINITIF' ? 'ok' : r.mode === 'ANNULE' ? 'grey' : 'info'}>{r.mode === 'DEFINITIF' ? 'Comptabilisé' : r.mode === 'ANNULE' ? 'Annulé' : 'Simulation'}</Pill></td>
              <td className="num">{fcfa(r.assetCount)}</td><td className="num">{fcfa(r.total)}</td><td className="num">{r.anomalies.length}</td><td className="small">{dateTime(r.createdAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>{r.mode === 'DEFINITIF' && can('depreciation.run') && <button className="btn small danger" onClick={() => setCancel(r)}>Annuler</button>}</td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
      {cancel && <CancelRun run={cancel} onClose={() => setCancel(null)} />}
    </>
  );
}

function CancelRun({ run, onClose }: { run: Row; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const act = useAction(() => post(`/amortissements/calculs/${run.id}/annuler`, { reason }), { success: 'Calcul annulé', invalidate: [['runs'], ['periods'], ['journal']], onDone: onClose });
  return (
    <Modal title={`Annuler ${run.number}`} onClose={onClose}>
      <Note tone="warn">Possible uniquement si la période est ouverte, s'il s'agit du dernier calcul comptabilisé et si l'écriture n'est pas intégrée dans l'ERP.</Note>
      <Field label="Motif (tracé au journal d'audit)" htmlFor="rs"><textarea id="rs" className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Fermer</button><button className="btn danger" disabled={reason.length < 5 || act.isPending} onClick={() => act.mutate(undefined)}>Annuler le calcul</button></div>
    </Modal>
  );
}

export function CalculDetail() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['run', id, page], queryFn: () => api<Row>(`/amortissements/calculs/${id}?page=${page}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  return (
    <>
      <nav className="crumbs"><Link to="/valorisation">Valorisation</Link><span aria-hidden="true">/</span><span>{r.number}</span></nav>
      <PageHead title={`Dotations de ${periodLabel(r.period)}`} sub={<><Mono>{r.number}</Mono> · calculé le {dateTime(r.createdAt)}</>} />
      <RunSummary run={r} />
      <Card pad={false} title="Détail par bien (plus fortes dotations d'abord)" foot={<><span>Page {page}</span><span className="actions"><button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button><button className="btn small" disabled={r.lines.length < 50} onClick={() => setPage(page + 1)}>Suivant</button></span></>}>
        <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
          <thead><tr><th>Code</th><th>Désignation</th><th className="num">Valeur d'origine</th><th className="num">Dotation</th><th className="num">Cumul après</th><th>Compte</th></tr></thead>
          <tbody>{r.lines.map((l: Row) => <tr key={l.assetId}><td><Link to={`/biens/${l.assetId}`}><Mono>{l.code}</Mono></Link></td><td>{l.designation}</td><td className="num">{fcfa(l.value)}</td><td className="num">{fcfa(l.amount)}</td><td className="num">{fcfa(l.cumulativeAfter)}</td><td><Mono>{l.deprAccount}</Mono></td></tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}

export function Ecritures() {
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['journal', status], queryFn: () => api<Row[]>(`/ecritures${status ? `?status=${status}` : ''}`) });
  const rows = q.data ?? [];
  return (
    <>
      <PageHead title="Écritures comptables" sub="Écritures générées par les pièces du patrimoine (entrées, dotations, sorties) et leur intégration dans l'ERP." />
      <section className="kpis">
        <Kpi label="Lots" value={rows.length} note={status ? 'filtrés' : 'tous statuts'} />
        <Kpi label="À envoyer" value={rows.filter((r) => r.status === 'A_ENVOYER').length} note="en attente de l'ERP" />
        <Kpi label="Rejetés" value={rows.filter((r) => r.status === 'REJETE').length} note="à corriger" tone={rows.some((r) => r.status === 'REJETE') ? 'warn' : undefined} />
      </section>
      <Card pad={false} title="Lots d'écritures" extra={<div className="chips">{[['', 'Tous'], ['A_ENVOYER', 'À envoyer'], ['INTEGRE', 'Intégrés'], ['REJETE', 'Rejetés']].map(([k, l]) => <button key={k} type="button" className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}</div>}>
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Aucune écriture.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 760 }}>
            <thead><tr><th>Lot</th><th>Origine</th><th>Libellé</th><th>Date</th><th className="num">Montant</th><th>Statut</th></tr></thead>
            <tbody>{rows.map((b) => <tr key={b.id} className="click" onClick={() => nav(`/ecritures/${b.id}`)}><td><Mono>{b.number}</Mono></td><td><Mono>{b.originRef}</Mono></td><td>{b.label}</td><td>{date(b.date)}</td><td className="num">{fcfa(b.total)}</td><td><StatusPill map={JOURNAL_STATUS} value={b.status} /></td></tr>)}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

export function EcritureDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['journal', 'batch', id], queryFn: () => api<Row>(`/ecritures/${id}`) });
  const ack = useAction((s: string) => post(`/ecritures/${id}/accuse`, { status: s, reason: reason || undefined }), { success: 'Statut mis à jour', invalidate: [['journal']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const b = q.data!;
  const deb = b.lines.reduce((s: number, l: Row) => s + l.debit, 0), cre = b.lines.reduce((s: number, l: Row) => s + l.credit, 0);
  return (
    <>
      <nav className="crumbs"><Link to="/ecritures">Écritures comptables</Link><span aria-hidden="true">/</span><span>{b.number}</span></nav>
      <PageHead title={b.label} sub={<><Mono>{b.number}</Mono> · pièce d'origine <Mono>{b.originRef}</Mono> · {date(b.date)}</>}
        actions={<button className="btn" onClick={() => download(`/ecritures/${b.id}/export`, `${b.number}.csv`).catch((e) => toast(e.message, 'bad'))}>Exporter (CSV ERP)</button>} />
      <div className="actions"><StatusPill map={JOURNAL_STATUS} value={b.status} />{b.rejectReason && <span className="muted">Motif : {b.rejectReason}</span>}</div>
      <Card pad={false} title="Lignes">
        <div className="table-wrap"><table className="t" style={{ minWidth: 620 }}>
          <thead><tr><th>Compte</th><th>Libellé</th><th className="num">Débit</th><th className="num">Crédit</th></tr></thead>
          <tbody>{b.lines.map((l: Row) => <tr key={l.id}><td><Mono>{l.account}</Mono></td><td>{l.label}</td><td className="num">{l.debit ? fcfa(l.debit) : ''}</td><td className="num">{l.credit ? fcfa(l.credit) : ''}</td></tr>)}</tbody>
          <tfoot><tr><td colSpan={2}>Total {deb === cre ? '(équilibré)' : '(déséquilibré)'}</td><td className="num">{fcfa(deb)}</td><td className="num">{fcfa(cre)}</td></tr></tfoot>
        </table></div>
      </Card>
      {can('journal.manage') && b.status !== 'ANNULE' && <Card title="Accusé de l'ERP">
        <Note>En production, ce statut est alimenté automatiquement par l'interface avec l'ERP comptable. Il peut être saisi ici en l'absence d'interface.</Note>
        <Field label="Motif (en cas de rejet)" htmlFor="rr"><input id="rr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="actions"><button className="btn success" onClick={() => ack.mutate('INTEGRE')} disabled={ack.isPending}>Marquer intégré</button><button className="btn danger" onClick={() => ack.mutate('REJETE')} disabled={ack.isPending || !reason}>Marquer rejeté</button>
          {b.status === 'REJETE' && <button className="btn" onClick={() => ack.mutate('A_ENVOYER')}>Renvoyer</button>}</div>
      </Card>}
    </>
  );
}
