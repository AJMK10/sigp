import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, patch, post } from '../api';
import { ENTRY_MODE, LABEL_STATUS, RECEPTION_STATUS, date, fcfa, today } from '../format';
import { leafCategories, useCategories, useLocations } from '../refs';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Mono, Note, PageHead, RadioCards, Steps, StatusPill, SubNav, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

const SUB: [string, string][] = [['/receptions', 'Réceptions et PV'], ['/etiquettes', 'Immatriculation et étiquettes']];

export function Receptions() {
  const nav = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['receptions'], queryFn: () => api<Row[]>('/receptions') });
  const rows = q.data ?? [];
  return (
    <>
      {can('labels.manage') && <SubNav items={SUB} current="/receptions" />}
      <PageHead title="Entrées en patrimoine" sub="Réception des achats, dons et transferts, puis immatriculation : aucun bien n'entre au registre sans pièce."
        actions={can('receptions.write') && <Link to="/receptions/nouvelle" className="btn primary">Nouvelle réception</Link>} />
      <section className="kpis">
        <Kpi label="À viser" value={rows.filter((r) => r.status === 'A_VALIDER').length} note="en attente du comptable-matières" tone={rows.some((r) => r.status === 'A_VALIDER') ? 'warn' : undefined} />
        <Kpi label="Brouillons" value={rows.filter((r) => r.status === 'BROUILLON' || r.status === 'REJETEE').length} note="à compléter et soumettre" />
        <Kpi label="Validées cette année" value={rows.filter((r) => r.status === 'VALIDEE' && r.deliveryDate.startsWith(String(new Date().getFullYear()))).length} note={`${fcfa(rows.filter((r) => r.status === 'VALIDEE').reduce((s, r) => s + r.accepted, 0))} FCFA entrés`} />
      </section>
      {q.error && <ErrorBox error={q.error} />}
      <Card pad={false} title="Procès-verbaux de réception">
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Aucune réception.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 900 }}>
            <thead><tr><th>Pièce</th><th>Fournisseur / origine</th><th>Mode</th><th>Livraison</th><th className="num">Articles conformes</th><th className="num">Montant conforme</th><th>Réserves</th><th>Statut</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => nav(`/receptions/${r.id}`)}>
                <td><Mono>{r.number}</Mono></td><td>{r.supplier}<div className="small muted">{r.orderRef}</div></td><td className="small">{ENTRY_MODE[r.entryMode]}</td><td>{date(r.deliveryDate)}</td>
                <td className="num">{r.articles}</td><td className="num">{fcfa(r.accepted)}</td><td>{r.reserves ? `${r.reserves} ligne(s)` : '—'}</td><td><StatusPill map={RECEPTION_STATUS} value={r.status} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

type Line = { designation: string; categoryId: string; brand: string; model: string; qtyOrdered: string; qtyDelivered: string; qtyAccepted: string; unitValue: string; reserve: string; serials: string };
const emptyLine = (): Line => ({ designation: '', categoryId: '', brand: '', model: '', qtyOrdered: '1', qtyDelivered: '1', qtyAccepted: '1', unitValue: '', reserve: '', serials: '' });

export function ReceptionForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const cats = useCategories(); const locs = useLocations();
  const existing = useQuery({ queryKey: ['reception', id], queryFn: () => api<Row>(`/receptions/${id}`), enabled: !!id });
  const [head, setHead] = useState({ entryMode: 'ACHAT', supplier: '', orderRef: '', deliveryNote: '', invoiceRef: '', deliveryDate: today(), locationId: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  useEffect(() => {
    const r = existing.data; if (!r) return;
    setHead({ entryMode: r.entryMode, supplier: r.supplier, orderRef: r.orderRef ?? '', deliveryNote: r.deliveryNote ?? '', invoiceRef: r.invoiceRef ?? '', deliveryDate: r.deliveryDate, locationId: r.locationId ? String(r.locationId) : '', notes: r.notes ?? '' });
    setLines(r.lines.map((l: Row) => ({ designation: l.designation, categoryId: String(l.categoryId), brand: l.brand ?? '', model: l.model ?? '', qtyOrdered: String(l.qtyOrdered), qtyDelivered: String(l.qtyDelivered),
      qtyAccepted: String(l.qtyAccepted), unitValue: String(l.unitValue), reserve: l.reserve ?? '', serials: (l.serials ?? []).join('\n') })));
  }, [existing.data]);
  const body = () => ({ ...head, locationId: head.locationId ? Number(head.locationId) : null, orderRef: head.orderRef || undefined, deliveryNote: head.deliveryNote || undefined, invoiceRef: head.invoiceRef || undefined, notes: head.notes || undefined,
    lines: lines.map((l) => ({ designation: l.designation, categoryId: Number(l.categoryId), brand: l.brand || undefined, model: l.model || undefined, qtyOrdered: Number(l.qtyOrdered), qtyDelivered: Number(l.qtyDelivered),
      qtyAccepted: Number(l.qtyAccepted), unitValue: Number(l.unitValue), reserve: l.reserve || undefined, serials: l.serials.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) })) });
  const save = useAction(async (submit: boolean) => {
    const r = id ? (await patch(`/receptions/${id}`, body()), { id: Number(id) }) : await post<Row>('/receptions', body());
    if (submit) await post(`/receptions/${r.id}/soumettre`);
    return r;
  }, { success: 'Réception enregistrée', invalidate: [['receptions'], ['reception', id ?? '']], onDone: (r) => nav(`/receptions/${(r as Row).id}`) });
  const total = lines.reduce((s, l) => s + Number(l.qtyAccepted || 0) * Number(l.unitValue || 0), 0);
  const setL = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(true); };
  const NOTES: Record<string, string> = { ACHAT: "Valeur d'entrée : prix d'achat HT + frais accessoires. Contrepartie 4812 Fournisseurs d'investissements.", DON: 'Valeur vénale à la date du don. Contrepartie en subvention d\'investissement (1441).',
    TRANSFERT_ENTRANT: "Biens reçus d'une autre entité : contrepartie en compte de liaison (1810).", PRODUCTION: 'Coût de production (matières, main-d\'œuvre, quote-part de charges). Contrepartie 7220.' };
  return (
    <>
      <PageHead title={id ? `Modifier ${existing.data?.number ?? ''}` : 'Nouvelle réception'} sub="Procès-verbal de réception : une ligne par article livré, avec les quantités conformes et les réserves." />
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card title="Mode d'entrée">
          <RadioCards label="Mode d'entrée" value={head.entryMode} onChange={(v) => setHead({ ...head, entryMode: v })} items={[['ACHAT', 'Achat'], ['DON', 'Don ou legs'], ['TRANSFERT_ENTRANT', 'Transfert entrant'], ['PRODUCTION', 'Production interne']]} />
          <span className="small muted">{NOTES[head.entryMode]}</span>
        </Card>
        <Card title="Pièces de la livraison">
          <div className="grid" style={{ ['--min' as string]: '200px' }}>
            <Field label="Fournisseur ou origine" htmlFor="s"><input id="s" className="input" required value={head.supplier} onChange={(e) => setHead({ ...head, supplier: e.target.value })} /></Field>
            <Field label="Bon de commande / marché" htmlFor="o"><input id="o" className="input" value={head.orderRef} onChange={(e) => setHead({ ...head, orderRef: e.target.value })} /></Field>
            <Field label="Bon de livraison" htmlFor="bl"><input id="bl" className="input" value={head.deliveryNote} onChange={(e) => setHead({ ...head, deliveryNote: e.target.value })} /></Field>
            <Field label="Facture" htmlFor="f"><input id="f" className="input" value={head.invoiceRef} onChange={(e) => setHead({ ...head, invoiceRef: e.target.value })} /></Field>
            <Field label="Date de livraison" htmlFor="dd"><input id="dd" type="date" className="input" required value={head.deliveryDate} onChange={(e) => setHead({ ...head, deliveryDate: e.target.value })} /></Field>
            <Field label="Lieu de réception" htmlFor="l"><select id="l" className="input" value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}><option value="">Choisir…</option>{locs.data?.map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></Field>
          </div>
        </Card>
        <Card title="Articles" extra={<button type="button" className="btn small" onClick={() => setLines([...lines, emptyLine()])}>Ajouter une ligne</button>}>
          {lines.map((l, i) => (
            <div key={i} style={{ border: '1px solid var(--line-soft)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="grid" style={{ ['--min' as string]: '170px' }}>
                <Field label={`Article ${i + 1}`} htmlFor={`d${i}`}><input id={`d${i}`} className="input" required value={l.designation} onChange={(e) => setL(i, 'designation', e.target.value)} /></Field>
                <Field label="Catégorie" htmlFor={`c${i}`}><select id={`c${i}`} className="input" required value={l.categoryId} onChange={(e) => setL(i, 'categoryId', e.target.value)}><option value="">Choisir…</option>{leafCategories(cats.data).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></Field>
                <Field label="Marque" htmlFor={`b${i}`}><input id={`b${i}`} className="input" value={l.brand} onChange={(e) => setL(i, 'brand', e.target.value)} /></Field>
                <Field label="Prix unitaire HT (FCFA)" htmlFor={`u${i}`}><input id={`u${i}`} type="number" min="0" className="input" required value={l.unitValue} onChange={(e) => setL(i, 'unitValue', e.target.value)} /></Field>
                <Field label="Commandé" htmlFor={`q1${i}`}><input id={`q1${i}`} type="number" min="0" className="input" value={l.qtyOrdered} onChange={(e) => setL(i, 'qtyOrdered', e.target.value)} /></Field>
                <Field label="Livré" htmlFor={`q2${i}`}><input id={`q2${i}`} type="number" min="0" className="input" value={l.qtyDelivered} onChange={(e) => setL(i, 'qtyDelivered', e.target.value)} /></Field>
                <Field label="Conforme" htmlFor={`q3${i}`}><input id={`q3${i}`} type="number" min="0" className="input" value={l.qtyAccepted} onChange={(e) => setL(i, 'qtyAccepted', e.target.value)} /></Field>
                <Field label="Réserve" htmlFor={`r${i}`} hint={Number(l.qtyAccepted) < Number(l.qtyDelivered) ? 'Obligatoire : articles non conformes' : undefined}><input id={`r${i}`} className="input" value={l.reserve} onChange={(e) => setL(i, 'reserve', e.target.value)} /></Field>
              </div>
              <Field label="Numéros de série (un par ligne, dans l'ordre des codes)" htmlFor={`sn${i}`}><textarea id={`sn${i}`} className="input" rows={2} value={l.serials} onChange={(e) => setL(i, 'serials', e.target.value)} /></Field>
              {lines.length > 1 && <button type="button" className="btn small danger" style={{ alignSelf: 'flex-start' }} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Retirer la ligne</button>}
            </div>
          ))}
          <div className="actions" style={{ justifyContent: 'space-between' }}>
            <strong>Montant conforme : {fcfa(total)} FCFA</strong>
            <span className="actions">
              <button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate(false)}>Enregistrer le brouillon</button>
              <button className="btn primary" disabled={save.isPending}>Soumettre au visa</button>
            </span>
          </div>
          {total >= 50_000_000 && <Note tone="warn">Au-delà de 50 M FCFA, le visa du directeur du patrimoine s'ajoute à celui du comptable-matières.</Note>}
        </Card>
      </form>
    </>
  );
}

export function ReceptionDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['reception', id], queryFn: () => api<Row>(`/receptions/${id}`) });
  const submit = useAction(() => post(`/receptions/${id}/soumettre`), { success: 'Réception soumise au visa', invalidate: [['reception', id!], ['receptions']] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const r = q.data!;
  const total = r.lines.reduce((s: number, l: Row) => s + l.qtyAccepted * l.unitValue, 0);
  return (
    <>
      <nav className="crumbs"><Link to="/receptions">Entrées en patrimoine</Link><span aria-hidden="true">/</span><span>{r.number}</span></nav>
      <PageHead title="Procès-verbal de réception" sub={<><Mono>{r.number}</Mono> · {ENTRY_MODE[r.entryMode]} · établi par {r.author}</>}
        actions={<>
          <button className="btn" onClick={() => download(`/etats/pv-reception/${r.id}.pdf`, `${r.number}.pdf`, true).catch((e) => toast(e.message, 'bad'))}>PV en PDF</button>
          {can('receptions.write') && ['BROUILLON', 'REJETEE'].includes(r.status) && <><Link to={`/receptions/${r.id}/modifier`} className="btn">Modifier</Link><button className="btn primary" onClick={() => submit.mutate(undefined)} disabled={submit.isPending}>Soumettre au visa</button></>}
          {r.status === 'VALIDEE' && can('labels.manage') && <Link to="/etiquettes" className="btn primary">Imprimer les étiquettes</Link>}
        </>} />
      <div className="actions"><StatusPill map={RECEPTION_STATUS} value={r.status} />{r.entryOrderNo && <span>Ordre d'entrée <Mono>{r.entryOrderNo}</Mono></span>}</div>
      {r.steps.length > 0 && <Card title="Circuit de validation"><Steps steps={r.steps} /></Card>}
      <div className="split">
        <div className="wide">
          <Card pad={false} title="Articles" foot={<><span>{r.lines.length} ligne(s)</span><strong>Montant conforme : {fcfa(total)} FCFA</strong></>}>
            <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
              <thead><tr><th>Article</th><th>Catégorie</th><th className="num">Cdé</th><th className="num">Livré</th><th className="num">Conforme</th><th className="num">P.U.</th><th>Réserve</th></tr></thead>
              <tbody>{r.lines.map((l: Row) => <tr key={l.id}><td>{l.designation}<div className="small muted">{[l.brand, l.model].filter(Boolean).join(' ')}</div></td><td className="small">{l.category}</td><td className="num">{l.qtyOrdered}</td><td className="num">{l.qtyDelivered}</td><td className="num">{l.qtyAccepted}</td><td className="num">{fcfa(l.unitValue)}</td><td style={{ color: l.reserve ? 'var(--bad)' : undefined }}>{l.reserve ?? '—'}</td></tr>)}</tbody>
            </table></div>
          </Card>
          {r.assets.length > 0 && <Card pad={false} title={`Biens immatriculés · ${r.assets.length}`}>
            <div className="table-wrap"><table className="t"><thead><tr><th>Code</th><th>Désignation</th><th>Étiquette</th></tr></thead>
              <tbody>{r.assets.map((a: Row) => <tr key={a.id}><td><Link to={`/biens/${a.id}`}><Mono>{a.code}</Mono></Link></td><td>{a.designation}</td><td><StatusPill map={LABEL_STATUS} value={a.labelStatus} /></td></tr>)}</tbody></table></div>
          </Card>}
        </div>
        <div className="narrow">
          <Card title="Livraison">
            <dl className="kv" style={{ margin: 0 }}>
              <div><dt>Fournisseur</dt><dd>{r.supplier}</dd></div><div><dt>Commande / marché</dt><dd>{r.orderRef ?? '—'}</dd></div>
              <div><dt>Bon de livraison</dt><dd>{r.deliveryNote ?? '—'}</dd></div><div><dt>Facture</dt><dd>{r.invoiceRef ?? '—'}</dd></div>
              <div><dt>Livré le</dt><dd>{date(r.deliveryDate)}</dd></div><div><dt>Lieu</dt><dd>{r.location ?? '—'}</dd></div>
            </dl>
          </Card>
          {r.status === 'VALIDEE' && <Note tone="ok">Validée le {date(r.validatedAt)} : {r.assets.length} biens immatriculés, ordre d'entrée et écriture d'immobilisation générés.</Note>}
        </div>
      </div>
    </>
  );
}

export function Etiquettes() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const q = useQuery({ queryKey: ['labels', status], queryFn: () => api<{ pending: number; items: Row[] }>(`/etiquettes${status ? `?status=${status}` : ''}`) });
  const act = useAction((s: string) => post<Row>('/etiquettes/statut', { assetIds: sel, status: s }), { success: (r) => `${r.updated} étiquette(s) mises à jour`, invalidate: [['labels']], onDone: () => setSel([]) });
  const items = q.data?.items ?? [];
  const all = items.length > 0 && sel.length === items.length;
  return (
    <>
      <SubNav items={SUB} current="/etiquettes" />
      <PageHead title="Immatriculation et étiquetage" sub="Chaque bien reçoit un code définitif ; la pose de l'étiquette est contrôlée par scan avant d'être considérée comme acquise."
        actions={<button className="btn primary" disabled={!sel.length} onClick={() => download(`/etats/etiquettes.pdf?ids=${sel.join(',')}`, 'etiquettes.pdf', true).catch((e) => toast(e.message, 'bad'))}>Imprimer {sel.length || ''} étiquette(s)</button>} />
      <section className="kpis"><Kpi label="Étiquettes non contrôlées" value={fcfa(q.data?.pending ?? 0)} note="générées, imprimées ou posées" tone={q.data?.pending ? 'warn' : undefined} /></section>
      <Card pad={false} title="File d'étiquetage" extra={<div className="chips">{[['', 'À traiter'], ['GENEREE', 'Générées'], ['IMPRIMEE', 'Imprimées'], ['POSEE', 'Posées']].map(([k, l]) =>
        <button key={k} type="button" className={`chip ${status === k ? 'active' : ''}`} onClick={() => { setStatus(k); setSel([]); }}>{l}</button>)}</div>}
        foot={<><span>{sel.length} sélectionné(s)</span><span className="actions">
          <button className="btn small" disabled={!sel.length || act.isPending} onClick={() => act.mutate('IMPRIMEE')}>Marquer imprimées</button>
          <button className="btn small" disabled={!sel.length || act.isPending} onClick={() => act.mutate('POSEE')}>Marquer posées</button>
          <button className="btn small primary" disabled={!sel.length || act.isPending} onClick={() => act.mutate('CONTROLEE')}>Pose contrôlée par scan</button></span></>}>
        {q.isLoading ? <Loading /> : !items.length ? <Empty>Aucune étiquette à traiter.</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 820 }}>
            <thead><tr><th><input type="checkbox" aria-label="Tout sélectionner" checked={all} onChange={() => setSel(all ? [] : items.map((i) => i.id))} /></th><th>Code</th><th>Désignation</th><th>N° de série</th><th>Localisation</th><th>Ordre d'entrée</th><th>Étiquette</th></tr></thead>
            <tbody>{items.map((a) => (
              <tr key={a.id} className={sel.includes(a.id) ? 'sel' : ''}>
                <td><input type="checkbox" aria-label={`Sélectionner ${a.code}`} checked={sel.includes(a.id)} onChange={() => setSel(sel.includes(a.id) ? sel.filter((x) => x !== a.id) : [...sel, a.id])} /></td>
                <td><Link to={`/biens/${a.id}`}><Mono>{a.code}</Mono></Link></td><td>{a.designation}</td><td>{a.serialNumber ? <Mono>{a.serialNumber}</Mono> : '—'}</td><td className="small">{a.location ?? '—'}</td>
                <td>{a.entryOrderNo ? <Mono>{a.entryOrderNo}</Mono> : '—'}</td><td><StatusPill map={LABEL_STATUS} value={a.labelStatus} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
