import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, patch, post } from '../api';
import { useAuth } from '../auth';
import { DOC_CATEGORY, DOC_OBJECT, NOTE_STATUS, REVAL_KIND, REVAL_STATUS, big, date, fcfa, pct, today } from '../format';
import { AssetPicker } from '../components/AssetPicker';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pill, RadioCards, Steps, StatusPill, Tabs, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

/* ------------------------------------------------------------------ Révisions de valeur */
export function Revisions() {
  const nav = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['revaluations'], queryFn: () => api<Row[]>('/revisions') });
  const rows = q.data ?? [];
  return (
    <>
      <PageHead title="Révisions et dépréciations" sub="Changements d'estimation de durée (prospectifs), dépréciations pour perte de valeur et reprises, soumis à la direction financière puis au directeur."
        actions={can('revaluation.write') && <Link to="/revisions/nouvelle" className="btn primary">Nouvelle opération</Link>} />
      <section className="kpis">
        <Kpi label="En validation" value={rows.filter((r) => r.status === 'EN_COURS').length} tone={rows.some((r) => r.status === 'EN_COURS') ? 'warn' : undefined} note="circuit finances puis directeur" />
        <Kpi label="Dépréciations appliquées" value={big(rows.filter((r) => r.status === 'APPLIQUE' && r.kind === 'DEPRECIATION').reduce((s, r) => s + r.amount, 0))} note="FCFA, cumul" />
        <Kpi label="Révisions de durée appliquées" value={rows.filter((r) => r.status === 'APPLIQUE' && r.kind === 'REVISION_DUREE').length} note="effet sur les dotations futures" />
      </section>
      <Card pad={false} title="Opérations">
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Aucune opération.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
          <thead><tr><th>Pièce</th><th>Nature</th><th>Objet</th><th className="num">Biens</th><th className="num">Montant ou impact annuel</th><th>Date d'effet</th><th>Statut</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="click" onClick={() => nav(`/revisions/${r.id}`)}><td><Mono>{r.number}</Mono></td><td>{r.kindLabel}</td><td>{r.title}<br /><span className="small muted">{r.author}</span></td>
            <td className="num">{r.count}</td><td className="num">{r.kind === 'REVISION_DUREE' ? `${r.annualImpact > 0 ? '+' : ''}${fcfa(r.annualImpact)} / an` : fcfa(r.amount)}</td><td>{date(r.effectiveDate)}</td><td><StatusPill map={REVAL_STATUS} value={r.status} /></td></tr>)}</tbody>
        </table></div>}
      </Card>
    </>
  );
}

export function NouvelleRevision() {
  const nav = useNavigate();
  const [assets, setAssets] = useState<Row[]>([]);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [f, setF] = useState({ kind: 'REVISION_DUREE', title: '', reason: '', effectiveDate: today(), newYears: '' });
  const withAmount = f.kind !== 'REVISION_DUREE';
  const save = useAction(async (submit: boolean) => {
    const r = await post<Row>('/revisions', { kind: f.kind, title: f.title, reason: f.reason, effectiveDate: f.effectiveDate, newYears: f.newYears ? Number(f.newYears) : undefined,
      items: assets.map((a) => ({ assetId: a.id, amount: withAmount ? Number(amounts[a.id] || 0) : 0 })) });
    if (submit) await post(`/revisions/${r.id}/soumettre`);
    return r;
  }, { success: (r) => `Opération ${r.number} enregistrée`, invalidate: [['revaluations'], ['validations']], onDone: (r) => nav(`/revisions/${r.id}`) });
  return (
    <>
      <PageHead title="Nouvelle opération de valorisation" sub="Toute opération est motivée (rapport d'expertise, indice de perte de valeur) et validée avant de modifier les valeurs." />
      <div className="split">
        <div className="wide">
          <Card title="Biens concernés"><AssetPicker value={assets} onChange={setAssets} statuses="EN_SERVICE,EN_STOCK,EN_MAINTENANCE,EN_PRET" /></Card>
          {withAmount && assets.length > 0 && <Card pad={false} title={f.kind === 'DEPRECIATION' ? 'Montant de la dépréciation par bien' : 'Montant de la reprise par bien'}>
            <div className="table-wrap"><table className="t" style={{ minWidth: 560 }}><thead><tr><th>Code</th><th>Désignation</th><th className="num">VNC</th><th className="num">Montant (FCFA)</th></tr></thead>
              <tbody>{assets.map((a) => <tr key={a.id}><td><Mono>{a.code}</Mono></td><td>{a.designation}</td><td className="num">{fcfa(a.nbv)}</td>
                <td className="num"><input aria-label={`Montant ${a.code}`} type="number" className="input" style={{ height: 36, maxWidth: 160, textAlign: 'right' }} value={amounts[a.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [a.id]: e.target.value })} /></td></tr>)}</tbody></table></div>
          </Card>}
        </div>
        <div className="narrow">
          <Card title="Opération">
            <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={Object.entries(REVAL_KIND) as [string, string][]} min={150} />
            <Field label="Objet" htmlFor="rt"><input id="rt" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <div className="grid" style={{ ['--min' as string]: '150px' }}>
              <Field label="Date d'effet" htmlFor="rd" hint={f.kind === 'REVISION_DUREE' ? 'Postérieure à la dernière période comptabilisée' : undefined}><input id="rd" type="date" className="input" value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} /></Field>
              {f.kind === 'REVISION_DUREE' && <Field label="Nouvelle durée totale (ans)" htmlFor="ry"><input id="ry" type="number" className="input" value={f.newYears} onChange={(e) => setF({ ...f, newYears: e.target.value })} /></Field>}
            </div>
            <Field label="Motivation" htmlFor="rr"><textarea id="rr" className="input" rows={4} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Rapport d'expertise du…, indice de perte de valeur…" /></Field>
            <Note>{f.kind === 'REVISION_DUREE' ? 'Changement d\'estimation : le cumul déjà constaté est conservé, la valeur restante est étalée sur la durée résiduelle.' : f.kind === 'DEPRECIATION'
              ? 'Écriture : débit 6914 (dotations aux dépréciations), crédit 29xx. La dépréciation est plafonnée à la VNC.' : 'Écriture : débit 29xx, crédit 7914 (reprises). La reprise est plafonnée à la dépréciation constatée.'}</Note>
            <div className="actions">
              <button className="btn" disabled={!assets.length || f.title.length < 3 || f.reason.length < 10 || save.isPending} onClick={() => save.mutate(false)}>Enregistrer le brouillon</button>
              <button className="btn primary" disabled={!assets.length || f.title.length < 3 || f.reason.length < 10 || save.isPending} onClick={() => save.mutate(true)}>Soumettre au circuit</button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function RevisionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['revaluation', id], queryFn: () => api<Row>(`/revisions/${id}`) });
  const submit = useAction(() => post(`/revisions/${id}/soumettre`), { success: 'Opération soumise', invalidate: [['revaluation', String(id)], ['revaluations'], ['validations']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const isRev = r.kind === 'REVISION_DUREE';
  const impact = r.items.reduce((s: number, i: Row) => s + i.annualAfter - i.annualBefore, 0);
  return (
    <>
      <nav className="crumbs"><Link to="/revisions">Révisions et dépréciations</Link><span aria-hidden="true">/</span><span>{r.number}</span></nav>
      <PageHead title={r.title} sub={<><Mono>{r.number}</Mono> · {r.kindLabel} · par {r.author} · effet au {date(r.effectiveDate)}</>}
        actions={<><StatusPill map={REVAL_STATUS} value={r.status} />{['BROUILLON', 'REJETE'].includes(r.status) && can('revaluation.write') && <button className="btn primary" disabled={submit.isPending} onClick={() => submit.mutate(undefined)}>Soumettre</button>}</>} />
      <Note>{r.reason}</Note>
      {r.steps.length > 0 && <Card title="Circuit de validation"><Steps steps={r.steps} />{r.status === 'EN_COURS' && <span className="small muted">La décision se prend depuis <Link to="/validations">Validations</Link>.</span>}</Card>}
      <section className="kpis">
        <Kpi label="Biens" value={r.items.length} />
        {isRev ? <><Kpi label="Nouvelle durée" value={`${r.newYears} ans`} note={r.status === 'APPLIQUE' ? 'appliquée au registre' : `au lieu de ${r.items[0]?.deprYears} ans`} />
          <Kpi label="Impact sur la dotation annuelle" value={`${impact > 0 ? '+' : ''}${big(impact)}`} note="FCFA, exercice suivant" /></>
          : <Kpi label="Montant" value={big(r.items.reduce((s: number, i: Row) => s + i.amount, 0))} note="FCFA" />}
      </section>
      <Card pad={false} title="Détail par bien">
        <div className="table-wrap"><table className="t" style={{ minWidth: 820 }}>
          <thead><tr><th>Code</th><th>Désignation</th><th className="num">Valeur d'origine</th><th className="num">Cumul</th><th className="num">VNC</th>{isRev ? <><th className="num">Dotation avant</th><th className="num">Dotation après</th></> : <th className="num">Montant</th>}</tr></thead>
          <tbody>{r.items.map((i: Row) => <tr key={i.assetId}><td><Link to={`/biens/${i.assetId}`}><Mono>{i.code}</Mono></Link></td><td>{i.designation}</td><td className="num">{fcfa(i.value)}</td><td className="num">{fcfa(i.cumulative)}</td><td className="num">{fcfa(i.nbv)}</td>
            {isRev ? <><td className="num">{fcfa(i.annualBefore)}</td><td className="num">{fcfa(i.annualAfter)}</td></> : <td className="num">{fcfa(i.amount)}</td>}</tr>)}</tbody>
        </table></div>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ Rapprochement et clôture */
export function Cloture() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'rappro' | 'exercice'>('rappro');
  const [date_, setDate] = useState('');
  const [modal, setModal] = useState<'' | 'import' | 'note'>('');
  const [noteFor, setNoteFor] = useState<Row | null>(null);
  const year = new Date().getFullYear();
  const rq = useQuery({ queryKey: ['reconcile', date_], queryFn: () => api<Row>(`/cloture/rapprochement${date_ ? `?date=${date_}` : ''}`) });
  const ex = useQuery({ queryKey: ['closing', year], queryFn: () => api<Row>(`/cloture/exercice/${year}`) });
  const noteStatus = useAction((v: { id: number; status: string }) => patch(`/cloture/explications/${v.id}`, { status: v.status }), { success: 'Explication mise à jour', invalidate: [['reconcile']] });
  const close = useAction(() => post(`/cloture/exercice/${year}`), { success: `Exercice ${year} clôturé`, invalidate: [['closing']] });
  const r = rq.data;
  return (
    <>
      <PageHead title="Rapprochement et clôture" sub="Rapprochement du registre avec la balance de la comptabilité générale, explication des écarts, puis clôture assistée de l'exercice." />
      <Tabs label="Rubrique" value={tab} onChange={setTab} items={[['rappro', 'Rapprochement comptable'], ['exercice', `Clôture de l'exercice ${year}`]]} />
      {tab === 'rappro' && (rq.isLoading ? <Loading /> : rq.error ? <ErrorBox error={rq.error} /> : <>
        <div className="actions" style={{ justifyContent: 'space-between' }}>
          <div className="actions"><span className="small muted">Arrêté au</span>
            <select className="input" style={{ height: 36, width: 170 }} aria-label="Date d'arrêté" value={r!.date} onChange={(e) => setDate(e.target.value)}>
              {[...new Set([r!.date, ...r!.importDates])].map((d: string) => <option key={d} value={d}>{date(d)}</option>)}</select></div>
          {can('closing.manage') && <div className="actions"><button className="btn" onClick={() => setModal('import')}>Importer la balance de l'ERP</button><button className="btn" onClick={() => setModal('note')}>Ajouter une explication</button></div>}
        </div>
        {!r!.imported && <Note tone="warn">Aucune balance importée pour cette date : seuls les soldes du registre sont présentés.</Note>}
        <section className="kpis">
          <Kpi label="Valeurs brutes au registre" value={big(r!.totals.register)} note="comptes 21 à 24" />
          <Kpi label="Valeurs brutes en comptabilité" value={r!.imported ? big(r!.totals.ledger) : '—'} note="balance générale importée" />
          <Kpi label="Comptes concordants" value={`${r!.totals.accountsOk} / ${r!.totals.accounts}`} note={`écart brut ${fcfa(r!.totals.gap)} FCFA`} />
          <Kpi label="Écart non expliqué" value={fcfa(r!.totals.unexplained)} note="FCFA, à justifier avant clôture" tone={r!.totals.unexplained ? 'bad' : undefined} />
        </section>
        <Card pad={false} title={`Rapprochement par compte au ${date(r!.date)}`}>
          <div className="table-wrap"><table className="t" style={{ minWidth: 900 }}>
            <thead><tr><th>Compte</th><th>Libellé</th><th className="num">Biens</th><th className="num">Registre</th><th className="num">Comptabilité</th><th className="num">Écart</th><th className="num">Expliqué</th><th className="num">Reste</th><th /></tr></thead>
            <tbody>{r!.lines.map((l: Row) => (
              <tr key={l.account}><td><Mono>{l.account}</Mono></td><td>{l.label}</td><td className="num">{l.count || '—'}</td><td className="num">{fcfa(l.register)}</td><td className="num">{l.ledger == null ? '—' : fcfa(l.ledger)}</td>
                <td className="num" style={{ color: l.diff ? 'var(--bad)' : undefined, fontWeight: l.diff ? 700 : undefined }}>{l.diff == null ? '—' : fcfa(l.diff)}</td><td className="num">{l.explained ? fcfa(l.explained) : '—'}</td>
                <td className="num">{l.unexplained == null ? '—' : l.unexplained ? <Pill tone="bad">{fcfa(l.unexplained)}</Pill> : <Pill tone="ok">0</Pill>}</td>
                <td className="right">{can('closing.manage') && l.unexplained ? <button className="btn small" onClick={() => setNoteFor(l)}>Expliquer</button> : null}</td></tr>))}</tbody>
          </table></div>
        </Card>
        <Card title={`Explications des écarts (${r!.notes.length})`}>
          {!r!.notes.length ? <Empty>Aucune explication.</Empty> : <ul className="list">{r!.notes.map((n: Row) => (
            <li key={n.id}><Mono>{n.account}</Mono><span className="grow"><strong>{n.label}</strong><span className="small muted">{fcfa(n.amount)} FCFA</span></span><StatusPill map={NOTE_STATUS} value={n.status} />
              {can('closing.manage') && n.status === 'A_CORRIGER' && <button className="btn small" onClick={() => noteStatus.mutate({ id: n.id, status: 'CORRIGE' })}>Marquer corrigé</button>}</li>))}</ul>}
        </Card>
      </>)}
      {tab === 'exercice' && (ex.isLoading ? <Loading /> : ex.error ? <ErrorBox error={ex.error} /> : <>
        {ex.data!.status === 'CLOTURE' ? <Note tone="ok">Exercice {year} clôturé le {date(ex.data!.closedAt)} : aucune pièce ne peut plus y être datée.</Note>
          : <Note tone={ex.data!.ready ? 'ok' : 'warn'}>{ex.data!.ready ? 'Tous les contrôles sont satisfaits : l\'exercice peut être clôturé.' : `${ex.data!.items.filter((i: Row) => !i.ok).length} contrôle(s) restent à lever avant la clôture.`}</Note>}
        <Card title="Liste de contrôle de clôture">
          <div>{ex.data!.items.map((i: Row, n: number) => (
            <div key={i.key} className="check-row"><span className={`check-dot ${i.ok ? 'ok' : 'ko'}`} aria-hidden="true">{i.ok ? '✓' : n + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong>{i.label}</strong><span className="small muted">{i.detail}</span></span>
              <span style={{ marginLeft: 'auto' }}>{i.ok ? <Pill tone="ok">Conforme</Pill> : <Pill tone="warn">À lever</Pill>}</span></div>))}</div>
          {ex.data!.status !== 'CLOTURE' && can('closing.manage') && <div className="actions"><button className="btn primary" disabled={!ex.data!.ready || close.isPending} onClick={() => close.mutate(undefined)}>Clôturer l'exercice {year}</button>
            <span className="small muted">Irréversible : les pièces datées de {year} seront refusées.</span></div>}
        </Card>
      </>)}
      {modal === 'import' && <ImportBalance onClose={() => setModal('')} />}
      {(modal === 'note' || noteFor) && r && <NoteForm date={r.date} line={noteFor} onClose={() => { setModal(''); setNoteFor(null); }} />}
    </>
  );
}

function ImportBalance({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState(today());
  const [text, setText] = useState('');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/[;\t,]/).map((x) => x.trim()))
    .filter((c) => /^2\d+$/.test(c[0])).map((c) => ({ account: c[0], label: c.length > 2 ? c[1] : undefined, balance: Number(String(c[c.length - 1]).replace(/[\s  ]/g, '').replace(',', '.')) }))
    .filter((x) => Number.isFinite(x.balance));
  const act = useAction(() => post('/cloture/soldes', { date: d, balances: lines }), { success: `${lines.length} solde(s) importé(s)`, invalidate: [['reconcile']], onDone: onClose });
  return (
    <Modal title="Importer la balance de la comptabilité générale" onClose={onClose} width={640}>
      <Field label="Date d'arrêté" htmlFor="bd"><input id="bd" type="date" className="input" value={d} onChange={(e) => setD(e.target.value)} /></Field>
      <Field label="Soldes des comptes de classe 2" htmlFor="bt" hint="Une ligne par compte : compte ; libellé ; solde (export CSV de l'ERP). Les amortissements (28x) et dépréciations (29x) en valeur absolue.">
        <textarea id="bt" className="input" rows={8} style={{ fontFamily: 'var(--mono)', fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={'2442;Matériel informatique;1250000000\n2844;Amortissements matériel;640000000'} /></Field>
      <span className="small muted">{lines.length} compte(s) reconnu(s). Un nouvel import à la même date remplace le précédent.</span>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!lines.length || act.isPending} onClick={() => act.mutate(undefined)}>Importer</button></div>
    </Modal>
  );
}

function NoteForm({ date: d, line, onClose }: { date: string; line: Row | null; onClose: () => void }) {
  const [f, setF] = useState({ account: line?.account ?? '', amount: line ? String(line.unexplained) : '', label: '', status: 'A_CORRIGER' });
  const act = useAction(() => post('/cloture/explications', { date: d, account: f.account, amount: Number(f.amount), label: f.label, status: f.status }), { success: 'Explication enregistrée', invalidate: [['reconcile']], onDone: onClose });
  return (
    <Modal title={`Expliquer un écart au ${date(d)}`} onClose={onClose}>
      <div className="grid" style={{ ['--min' as string]: '160px' }}>
        <Field label="Compte" htmlFor="na"><input id="na" className="input" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value })} /></Field>
        <Field label="Montant expliqué (FCFA)" htmlFor="nm" hint="Signé : comptabilité moins registre"><input id="nm" type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      </div>
      <Field label="Explication" htmlFor="nl"><textarea id="nl" className="input" rows={3} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Facture imputée à tort, bien réceptionné non encore comptabilisé…" /></Field>
      <RadioCards label="Suite" value={f.status} onChange={(v) => setF({ ...f, status: v })} items={[['A_CORRIGER', 'Écriture à corriger'], ['JUSTIFIE', 'Décalage justifié']]} />
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!f.account || !f.amount || f.label.length < 5 || act.isPending} onClick={() => act.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Plan de renouvellement */
const CAT_COLORS = ['#13294B', '#1F5FAE', '#4C86C6', '#8FB3DE', '#D68A1C', '#1E7B4F', '#7A4CB0', '#B3261E', '#5B6775', '#C9D6E6'];
export function Renouvellement() {
  const [p, setP] = useState({ horizon: '5', inflation: '3', budget: '' });
  const [applied, setApplied] = useState(p);
  const qs = new URLSearchParams({ horizon: applied.horizon, inflation: String(Number(applied.inflation) / 100), ...(applied.budget ? { budget: String(Number(applied.budget) * 1e6) } : {}) }).toString();
  const q = useQuery({ queryKey: ['renewal', qs], queryFn: () => api<Row>(`/renouvellement?${qs}`) });
  const d = q.data;
  const max = d ? Math.max(...d.plan.map((y: Row) => Math.max(y.need, y.funded)), d.parameters.budget, 1) : 1;
  const PRIO: Record<string, [string, 'bad' | 'warn' | 'grey']> = { HAUTE: ['Haute', 'bad'], MOYENNE: ['Moyenne', 'warn'], BASSE: ['Basse', 'grey'] };
  return (
    <>
      <PageHead title="Plan de renouvellement" sub="Besoins de renouvellement issus de la fin de vie des biens et des coûts de maintenance, confrontés à une enveloppe budgétaire annuelle." />
      <Card>
        <div className="grid" style={{ ['--min' as string]: '170px', alignItems: 'end' }}>
          <Field label="Horizon (années)" htmlFor="ph"><select id="ph" className="input" value={p.horizon} onChange={(e) => setP({ ...p, horizon: e.target.value })}>{[3, 5, 7, 10].map((h) => <option key={h}>{h}</option>)}</select></Field>
          <Field label="Inflation annuelle (%)" htmlFor="pi"><input id="pi" type="number" step="0.5" className="input" value={p.inflation} onChange={(e) => setP({ ...p, inflation: e.target.value })} /></Field>
          <Field label="Enveloppe annuelle (millions FCFA)" htmlFor="pb" hint={d ? `Suggérée : ${fcfa(d.parameters.suggestedBudget / 1e6)} M` : undefined}><input id="pb" type="number" className="input" value={p.budget} placeholder="automatique" onChange={(e) => setP({ ...p, budget: e.target.value })} /></Field>
          <button className="btn primary" onClick={() => setApplied(p)}>Simuler</button>
        </div>
      </Card>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : <>
        <section className="kpis">
          <Kpi label={`Besoin sur ${d!.parameters.horizon} ans`} value={big(d!.summary.total)} note={`${fcfa(d!.summary.assets)} biens à renouveler`} />
          <Kpi label="Année de pointe" value={d!.summary.peakYear} note={`${big(d!.summary.peakAmount)} FCFA`} />
          <Kpi label="Enveloppe annuelle" value={big(d!.parameters.budget)} note="FCFA" />
          <Kpi label="Reste à financer à l'horizon" value={big(d!.summary.backlogAtHorizon)} note="report cumulé" tone={d!.summary.backlogAtHorizon ? 'bad' : undefined} />
          <Kpi label="Biens au-delà de leur durée" value={fcfa(d!.summary.alreadyBeyondLife)} note={`vétusté moyenne ${pct(d!.summary.wear, 0)}`} tone="warn" />
        </section>
        <div className="split">
          <div className="wide">
            <Card title="Besoins et financement par année">
              <div className="timeline" style={{ ['--n' as string]: d!.plan.length }}>{d!.plan.map((y: Row) => (
                <div key={y.year} className="col" title={`Besoin ${fcfa(y.need)} · financé ${fcfa(y.funded)} · report ${fcfa(y.backlog)}`}>
                  <span className="small" style={{ fontWeight: 600 }}>{big(y.need)}</span>
                  <div className="stackbar" style={{ height: `${(y.need / max) * 170}px` }}>
                    {d!.categories.map((c: Row, i: number) => <span key={c.prefix} style={{ height: `${y.need ? ((c.byYear[y.year] ?? 0) / y.need) * 100 : 0}%`, background: CAT_COLORS[i % CAT_COLORS.length] }} />)}
                  </div>
                  <span>{y.year}</span>
                </div>))}</div>
              <div className="legend">{d!.categories.map((c: Row, i: number) => <span key={c.prefix}><i style={{ background: CAT_COLORS[i % CAT_COLORS.length] }} />{c.label}</span>)}</div>
              <div className="table-wrap"><table className="t"><thead><tr><th>Année</th><th className="num">Besoin de l'année</th><th className="num">Avec report</th><th className="num">Financé</th><th className="num">Report</th></tr></thead>
                <tbody>{d!.plan.map((y: Row) => <tr key={y.year}><td>{y.year}</td><td className="num">{fcfa(y.need)}</td><td className="num">{fcfa(y.withBacklog)}</td><td className="num">{fcfa(y.funded)}</td>
                  <td className="num" style={{ color: y.backlog ? 'var(--bad)' : undefined }}>{fcfa(y.backlog)}</td></tr>)}</tbody></table></div>
            </Card>
          </div>
          <div className="narrow">
            <Card title="Priorités par catégorie">
              <ul className="list">{d!.categories.map((c: Row) => (
                <li key={c.prefix}><span className="grow"><strong>{c.label}</strong><span className="small muted">{fcfa(c.count)} biens · {big(c.cost)} FCFA · vétusté {pct(c.wear, 0)}</span></span><StatusPill map={PRIO} value={c.priority} /></li>))}</ul>
              <span className="small muted">Priorité haute : catégorie critique (véhicules, informatique, énergie) dont la vétusté dépasse 70 %. Les biens dont la maintenance a coûté plus de 30 % de leur valeur sont avancés à l'année suivante.</span>
            </Card>
          </div>
        </div>
      </>}
    </>
  );
}

/* ------------------------------------------------------------------ Comptabilité-matières */
export function ComptaMatieres() {
  const toast = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<'gl' | 'journal' | 'holders'>('gl');
  const q = useQuery({ queryKey: ['cmat', year], queryFn: () => api<Row>(`/comptabilite-matieres?year=${year}`) });
  const d = q.data;
  return (
    <>
      <PageHead title="Comptabilité-matières" sub="Livre-journal des entrées et sorties, grand livre par compte, fiches des détenteurs et compte de gestion de l'exercice."
        actions={<>
          <select className="input" style={{ height: 40, width: 120 }} aria-label="Exercice" value={year} onChange={(e) => setYear(Number(e.target.value))}>{[0, 1, 2].map((i) => <option key={i} value={new Date().getFullYear() - i}>{new Date().getFullYear() - i}</option>)}</select>
          <button className="btn" onClick={() => download(`/comptabilite-matieres/grand-livre.xlsx?year=${year}`, `grand-livre-matieres-${year}.xlsx`).catch((e) => toast(e.message, 'bad'))}>Grand livre (Excel)</button>
          <button className="btn primary" onClick={() => download(`/comptabilite-matieres/compte-gestion.pdf?year=${year}`, `compte-gestion-${year}.pdf`, true).catch((e) => toast(e.message, 'bad'))}>Compte de gestion (PDF)</button>
        </>} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : <>
        <section className="kpis">
          <Kpi label="Situation d'entrée" value={big(d!.totals.v0)} note={`${fcfa(d!.totals.q0)} biens au 1er janvier`} />
          <Kpi label="Entrées de l'exercice" value={big(d!.totals.vi)} note={`${fcfa(d!.totals.qi)} biens · ${d!.account.entries} ordre(s) d'entrée`} />
          <Kpi label="Sorties de l'exercice" value={big(d!.totals.vo)} note={`${fcfa(d!.totals.qo)} biens · ${d!.account.exits} ordre(s) de sortie`} />
          <Kpi label="Situation de sortie" value={big(d!.totals.v1)} note={`${fcfa(d!.totals.q1)} biens`} />
        </section>
        <Note tone={d!.account.inventory?.status === 'CLOTUREE' ? 'ok' : 'warn'}>Comptable-matières : {d!.account.accountant ?? '—'} · inventaire de fin d'exercice : {d!.account.inventory ? `${d!.account.inventory.number} (${d!.account.inventory.status === 'CLOTUREE' ? 'clôturé' : 'en cours'})` : 'non réalisé'}.</Note>
        <Card pad={false}>
          <div style={{ padding: '0 16px' }}><Tabs label="Registre" value={tab} onChange={setTab} items={[['gl', 'Grand livre des matières'], ['journal', `Livre-journal (${d!.journal.length})`], ['holders', `Fiches détenteurs (${d!.holders.length})`]]} /></div>
          {tab === 'gl' && <div className="table-wrap"><table className="t" style={{ minWidth: 980 }}>
            <thead><tr><th>Compte</th><th>Catégorie</th><th className="num">Qté entrée</th><th className="num">Valeur entrée</th><th className="num">Entrées</th><th className="num">Valeur</th><th className="num">Sorties</th><th className="num">Valeur</th><th className="num">Qté finale</th><th className="num">Valeur finale</th></tr></thead>
            <tbody>{d!.ledger.map((l: Row) => <tr key={l.account}><td><Mono>{l.account}</Mono></td><td>{l.label}</td><td className="num">{fcfa(l.q0)}</td><td className="num">{fcfa(l.v0)}</td><td className="num">{fcfa(l.qi)}</td><td className="num">{fcfa(l.vi)}</td><td className="num">{fcfa(l.qo)}</td><td className="num">{fcfa(l.vo)}</td><td className="num">{fcfa(l.q1)}</td><td className="num">{fcfa(l.v1)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{fcfa(d!.totals.q0)}</td><td className="num">{fcfa(d!.totals.v0)}</td><td className="num">{fcfa(d!.totals.qi)}</td><td className="num">{fcfa(d!.totals.vi)}</td><td className="num">{fcfa(d!.totals.qo)}</td><td className="num">{fcfa(d!.totals.vo)}</td><td className="num">{fcfa(d!.totals.q1)}</td><td className="num">{fcfa(d!.totals.v1)}</td></tr></tfoot>
          </table></div>}
          {tab === 'journal' && (!d!.journal.length ? <Empty>Aucune opération sur l'exercice.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
            <thead><tr><th>N°</th><th>Date</th><th>Ordre</th><th>Pièce</th><th>Libellé</th><th className="num">Entrées</th><th className="num">Sorties</th><th className="num">Valeur</th></tr></thead>
            <tbody>{d!.journal.map((j: Row) => <tr key={j.no}><td><Mono>{j.no}</Mono></td><td>{date(j.date)}</td><td><Mono>{j.order || '—'}</Mono></td><td><Mono>{j.piece}</Mono></td><td>{j.label}</td><td className="num">{j.qin || ''}</td><td className="num">{j.qout || ''}</td><td className="num">{fcfa(j.value)}</td></tr>)}</tbody>
          </table></div>)}
          {tab === 'holders' && <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th>Détenteur</th><th>Service</th><th className="num">Biens détenus</th><th className="num">Valeur d'origine</th><th>Dernière attestation</th></tr></thead>
            <tbody>{d!.holders.map((h: Row) => <tr key={h.id}><td>{h.name}</td><td>{h.unit ?? '—'}</td><td className="num">{h.n}</td><td className="num">{fcfa(h.v)}</td><td>{h.lastAttestation ? date(h.lastAttestation) : <Pill tone="warn">Non signée</Pill>}</td></tr>)}</tbody>
          </table></div>}
        </Card>
      </>}
    </>
  );
}

/* ------------------------------------------------------------------ GED */
export function Ged() {
  const toast = useToast();
  const [cat, setCat] = useState('');
  const [search, setSearch] = useState('');
  const qs = new URLSearchParams({ ...(cat ? { category: cat } : {}), ...(search ? { q: search } : {}) }).toString();
  const q = useQuery({ queryKey: ['documents', 'all', qs], queryFn: () => api<Row>(`/documents?${qs}`) });
  const verify = useAction((id: number) => api<Row>(`/documents/${id}/verifier`), { onDone: (r) => toast(r.ok ? 'Empreinte vérifiée : le fichier est intact' : `Contrôle en échec : ${r.reason ?? 'empreinte différente'}`, r.ok ? 'ok' : 'bad') });
  const link = (d: Row) => (d.objectType === 'BIEN' ? `/biens/${d.objectId}` : d.objectType === 'CONTRAT' ? `/contrats/${d.objectId}` : d.objectType === 'OT' ? `/maintenance/ot/${d.objectId}`
    : d.objectType === 'REFORME' ? `/reformes/${d.objectId}` : d.objectType === 'RECEPTION' ? `/receptions/${d.objectId}` : d.objectType === 'MOUVEMENT' ? `/mouvements/${d.objectId}` : d.objectType === 'REVISION' ? `/revisions/${d.objectId}` : null);
  const by = q.data?.byCategory ?? {};
  return (
    <>
      <PageHead title="Documents" sub="Gestion électronique des pièces justificatives : chaque fichier est rattaché à une pièce ou à un bien, horodaté et scellé par son empreinte SHA-256." />
      <div className="chips">{[['', `Tous (${Object.values(by).reduce((s: number, n) => s + (n as number), 0)})`], ...Object.entries(DOC_CATEGORY).filter(([k]) => by[k]).map(([k, l]) => [k, `${l} (${by[k]})`])].map(([k, l]) =>
        <button key={k} className={`chip ${cat === k ? 'active' : ''}`} aria-pressed={cat === k} onClick={() => setCat(k)}>{l}</button>)}</div>
      <Card pad={false} title="Pièces" extra={<input className="input" style={{ height: 34, width: 240 }} placeholder="Nom du fichier" aria-label="Rechercher un document" value={search} onChange={(e) => setSearch(e.target.value)} />}>
        {q.isLoading ? <Loading /> : !q.data?.items.length ? <Empty>Aucun document.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 900 }}>
          <thead><tr><th>Fichier</th><th>Nature</th><th>Rattaché à</th><th>Déposé par</th><th>Date</th><th>Empreinte</th><th /></tr></thead>
          <tbody>{q.data.items.map((d: Row) => <tr key={d.id}>
            <td><button className="linkish" onClick={() => download(`/documents/${d.id}/fichier`, d.filename, d.mime === 'application/pdf').catch((e) => toast(e.message, 'bad'))}>{d.filename}</button></td>
            <td>{d.categoryLabel}</td><td>{link(d) ? <Link to={link(d)!}>{DOC_OBJECT[d.objectType]} n° {d.objectId}</Link> : `${DOC_OBJECT[d.objectType]} n° ${d.objectId}`}</td>
            <td>{d.by ?? '—'}</td><td>{date(d.uploadedAt)}</td><td><Mono>{d.sha256.slice(0, 12)}…</Mono></td>
            <td className="right"><button className="btn small" disabled={verify.isPending} onClick={() => verify.mutate(d.id)}>Vérifier</button></td></tr>)}</tbody>
        </table></div>}
      </Card>
    </>
  );
}
