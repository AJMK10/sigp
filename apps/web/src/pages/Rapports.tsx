import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, downloadPost, post } from '../api';
import { useAuth } from '../auth';
import { date, dateTime, fcfa, pct } from '../format';
import { Card, Empty, ErrorBox, Field, Loading, Modal, Note, PageHead, Pill, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

type FType = 'text' | 'enum' | 'number' | 'money' | 'date' | 'percent';
interface FieldDef { key: string; label: string; type: FType; options: Record<string, string> | null; default: boolean; computed: boolean }
interface Source { key: string; label: string; description: string; fields: FieldDef[] }
interface Filter { field: string; op: string; value?: string | number | string[] | null; value2?: string | number | null }
interface Def { source: string; columns: string[]; filters: Filter[]; groupBy: string[]; aggregates: { fn: string; field?: string | null }[]; sort?: { key: string; dir: 'asc' | 'desc' } | null; limit?: number | null }

const OPS: Record<FType, [string, string][]> = {
  text: [['contains', 'contient'], ['eq', 'est égal à'], ['neq', 'est différent de'], ['empty', 'est vide'], ['notempty', "n'est pas vide"]],
  enum: [['in', 'parmi'], ['nin', 'hors de'], ['eq', 'est'], ['neq', "n'est pas"], ['empty', 'est vide']],
  number: [['gte', '≥'], ['lte', '≤'], ['between', 'entre'], ['eq', '='], ['gt', '>'], ['lt', '<'], ['empty', 'est vide']],
  money: [['gte', '≥'], ['lte', '≤'], ['between', 'entre'], ['eq', '='], ['gt', '>'], ['lt', '<']],
  percent: [['gte', '≥ (%)'], ['lte', '≤ (%)'], ['between', 'entre (%)']],
  date: [['between', 'entre'], ['gte', 'depuis le'], ['lte', "jusqu'au"], ['year', "de l'année"], ['last_days', 'des N derniers jours'], ['empty', 'est vide'], ['notempty', "n'est pas vide"]],
};
const AGGS: [string, string][] = [['count', 'Nombre'], ['sum', 'Somme'], ['avg', 'Moyenne'], ['min', 'Minimum'], ['max', 'Maximum'], ['count_distinct', 'Nombre distinct']];
const numeric = (t: FType) => t === 'number' || t === 'money' || t === 'percent';

export function cell(c: Row, v: unknown) {
  if (v == null || v === '') return '—';
  if (c.type === 'enum') return c.options?.[String(v)] ?? String(v);
  if (c.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? date(String(v)) : String(v);
  if (c.type === 'money') return fcfa(Number(v));
  if (c.type === 'percent') return pct(Number(v), 0);
  if (c.type === 'number') return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return String(v);
}

export function Rapports() {
  const nav = useNavigate();
  const toast = useToast();
  const q = useQuery({ queryKey: ['reports'], queryFn: () => api<Row[]>('/rapports') });
  const sources = useQuery({ queryKey: ['report-sources'], queryFn: () => api<Source[]>('/rapports/sources') });
  const del = useAction((id: number) => api(`/rapports/${id}`, { method: 'DELETE' }), { success: 'État supprimé', invalidate: [['reports']] });
  return (
    <>
      <nav className="crumbs"><Link to="/etats">États et rapports</Link><span aria-hidden="true">/</span><span>États personnalisés</span></nav>
      <PageHead title="États personnalisés" sub="Composez vos propres états à partir des données du patrimoine : colonnes, filtres, regroupements et totaux. Enregistrez-les, partagez-les et exportez-les en Excel, CSV ou PDF."
        actions={<Link to="/rapports/nouveau" className="btn primary">Nouvel état</Link>} />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : !q.data!.length ? <Empty>Aucun état enregistré. Créez le premier à partir d'une source ci-dessous.</Empty> : (
        <div className="grid" style={{ ['--min' as string]: '300px' }}>{q.data!.map((r) => (
          <div key={r.id} className="card pad" style={{ gap: 8 }}>
            <div className="actions" style={{ justifyContent: 'space-between' }}><Pill tone="navy">{r.sourceLabel}</Pill>{r.shared ? <Pill tone="info">Partagé</Pill> : <Pill tone="grey">Personnel</Pill>}</div>
            <Link to={`/rapports/${r.id}`} style={{ fontWeight: 600, fontSize: 16 }}>{r.name}</Link>
            {r.description && <span className="small muted">{r.description}</span>}
            <span className="small muted">{r.mine ? 'Vous' : r.author} · mis à jour le {dateTime(r.updatedAt)}</span>
            <div className="actions">
              <button className="btn small" onClick={() => download(`/rapports/${r.id}/export?format=xlsx`, `${r.name}.xlsx`).catch((e) => toast(e.message, 'bad'))}>Excel</button>
              <button className="btn small" onClick={() => download(`/rapports/${r.id}/export?format=pdf`, `${r.name}.pdf`, true).catch((e) => toast(e.message, 'bad'))}>PDF</button>
              {r.mine && <button className="btn small danger" disabled={del.isPending} onClick={() => { if (window.confirm(`Supprimer l'état « ${r.name} » ?`)) del.mutate(r.id); }}>Supprimer</button>}
            </div>
          </div>))}</div>
      )}
      <Card title="Sources disponibles">
        <div className="grid" style={{ ['--min' as string]: '240px' }}>{sources.data?.map((s) => (
          <button key={s.key} className="tile" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => nav(`/rapports/nouveau?source=${s.key}`)}>
            <span className="k"><strong style={{ color: 'var(--fg)' }}>{s.label}</strong><span>{s.fields.length} champs</span></span><span className="n">{s.description}</span>
          </button>))}</div>
      </Card>
    </>
  );
}

export function RapportEditeur() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { me } = useAuth();
  const sources = useQuery({ queryKey: ['report-sources'], queryFn: () => api<Source[]>('/rapports/sources') });
  const saved = useQuery({ queryKey: ['report', id], enabled: !!id, queryFn: () => api<Row>(`/rapports/${id}`) });
  const [def, setDef] = useState<Def | null>(null);
  const [meta, setMeta] = useState({ name: '', description: '', shared: false });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (def || !sources.data) return;
    if (id) { if (saved.data) { setDef(saved.data.definition as Def); setMeta({ name: saved.data.name, description: saved.data.description ?? '', shared: saved.data.shared }); } return; }
    const s = sources.data.find((x) => x.key === sp.get('source')) ?? sources.data[0];
    if (s) setDef(fresh(s));
  }, [sources.data, saved.data, id, sp, def]);
  const src = sources.data?.find((s) => s.key === def?.source);
  // Exécution automatique, différée pendant la saisie.
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(def ? JSON.stringify(def) : ''), 500); return () => clearTimeout(t); }, [def]);
  const run = useQuery({ queryKey: ['report-run', debounced], enabled: !!debounced && complete(def), queryFn: () => post<Row>('/rapports/executer', { definition: JSON.parse(debounced) }), retry: false });
  if (sources.isLoading || (id && saved.isLoading)) return <Loading />;
  if (sources.error || saved.error) return <ErrorBox error={sources.error ?? saved.error} />;
  if (!def || !src) return <Loading />;
  const f = (k: string) => src.fields.find((x) => x.key === k)!;
  const grouped = def.groupBy.length > 0;
  const upd = (p: Partial<Def>) => setDef({ ...def, ...p });
  const mine = !id || saved.data?.createdBy === me?.id;
  const exp = (format: 'xlsx' | 'csv' | 'pdf') => downloadPost('/rapports/exporter', { definition: def, name: meta.name || 'État personnalisé', format }, `${meta.name || 'etat'}.${format}`, format === 'pdf').catch((e) => toast(e.message, 'bad'));
  const res = run.data;
  const aggCols = grouped && res?.rows.length ? res.columns.filter((c: Row) => c.key.startsWith('agg_') && c.type !== 'date') : [];
  // Le graphique suit la mesure de tri, à défaut la première somme en FCFA, à défaut le premier calcul.
  const chart = aggCols.find((c: Row) => c.key === (def.sort?.key ?? 'agg_0')) ?? aggCols.find((c: Row) => c.type === 'money') ?? aggCols[0] ?? null;
  const max = chart ? Math.max(...res!.rows.map((r: Row) => Number(r[chart.key] ?? 0)), 1) : 1;
  return (
    <>
      <nav className="crumbs"><Link to="/rapports">États personnalisés</Link><span aria-hidden="true">/</span><span>{id ? meta.name : 'Nouvel état'}</span></nav>
      <PageHead title={id ? meta.name : 'Nouvel état'} sub={src.description}
        actions={<>
          <button className="btn" onClick={() => exp('xlsx')}>Excel</button><button className="btn" onClick={() => exp('csv')}>CSV</button><button className="btn" onClick={() => exp('pdf')}>PDF</button>
          <button className="btn primary" onClick={() => setSaving(true)}>{id && mine ? 'Enregistrer' : 'Enregistrer l\'état'}</button>
        </>} />
      <div className="split">
        <div className="narrow" style={{ flex: '1 1 340px', maxWidth: 440 }}>
          <Card title="Source">
            <select className="input" aria-label="Source de données" value={def.source} onChange={(e) => { const s = sources.data!.find((x) => x.key === e.target.value)!; setDef(fresh(s)); }}>
              {sources.data!.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          </Card>
          <Card title="Regroupement et calculs">
            {[0, 1].map((i) => (i === 0 || def.groupBy[0]) && (
              <Field key={i} label={i === 0 ? 'Regrouper par' : 'Puis par'} htmlFor={`g${i}`}>
                <select id={`g${i}`} className="input" value={def.groupBy[i] ?? ''} onChange={(e) => { const g = [...def.groupBy]; if (e.target.value) g[i] = e.target.value; else g.splice(i); upd({ groupBy: g, aggregates: g.length && !def.aggregates.length ? [{ fn: 'count' }] : def.aggregates, sort: null }); }}>
                  <option value="">{i === 0 ? 'Aucun regroupement (liste détaillée)' : '—'}</option>
                  {src.fields.filter((x) => x.type !== 'money' && x.type !== 'percent' && !def.groupBy.slice(0, i).includes(x.key)).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>))}
            {grouped && <>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Calculs</span>
              {def.aggregates.map((a, i) => (
                <div key={i} className="actions" style={{ flexWrap: 'nowrap' }}>
                  <select className="input" aria-label={`Calcul ${i + 1}`} style={{ flex: '0 0 130px' }} value={a.fn} onChange={(e) => { const ag = [...def.aggregates]; ag[i] = { fn: e.target.value, field: e.target.value === 'count' ? null : ag[i].field ?? src.fields.find((x) => numeric(x.type))?.key }; upd({ aggregates: ag }); }}>
                    {AGGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  {a.fn !== 'count' && <select className="input" aria-label={`Champ du calcul ${i + 1}`} value={a.field ?? ''} onChange={(e) => { const ag = [...def.aggregates]; ag[i] = { ...a, field: e.target.value }; upd({ aggregates: ag }); }}>
                    {src.fields.filter((x) => a.fn === 'count_distinct' || numeric(x.type) || ((a.fn === 'min' || a.fn === 'max') && x.type === 'date')).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>}
                  <button className="btn small" aria-label={`Retirer le calcul ${i + 1}`} disabled={def.aggregates.length === 1} onClick={() => upd({ aggregates: def.aggregates.filter((_, j) => j !== i), sort: null })}>×</button>
                </div>))}
              {def.aggregates.length < 6 && <div><button className="btn small" onClick={() => upd({ aggregates: [...def.aggregates, { fn: 'sum', field: src.fields.find((x) => x.type === 'money')?.key ?? src.fields.find((x) => numeric(x.type))?.key }] })}>Ajouter un calcul</button></div>}
            </>}
          </Card>
          {!grouped && <Card title={`Colonnes (${def.columns.length})`}>
            <div className="col-picker">{src.fields.map((x) => (
              <label key={x.key} className="check"><input type="checkbox" checked={def.columns.includes(x.key)} onChange={(e) => upd({ columns: e.target.checked ? [...def.columns, x.key] : def.columns.filter((c) => c !== x.key) })} />
                <span>{x.label}{x.computed && <span className="small muted"> · calculé</span>}</span></label>))}</div>
          </Card>}
          <Card title={`Filtres (${def.filters.length})`}>
            {def.filters.map((fl, i) => <FilterRow key={i} f={fl} fields={src.fields} onChange={(n) => { const fs = [...def.filters]; fs[i] = n; upd({ filters: fs }); }} onRemove={() => upd({ filters: def.filters.filter((_, j) => j !== i) })} />)}
            {def.filters.length < 20 && <div><button className="btn small" onClick={() => { const x = src.fields[0]; upd({ filters: [...def.filters, { field: x.key, op: OPS[x.type][0][0], value: '' }] }); }}>Ajouter un filtre</button></div>}
          </Card>
          <Card title="Tri et limite">
            <div className="grid" style={{ ['--min' as string]: '150px' }}>
              <Field label="Trier par" htmlFor="sk"><select id="sk" className="input" value={def.sort?.key ?? ''} onChange={(e) => upd({ sort: e.target.value ? { key: e.target.value, dir: def.sort?.dir ?? 'desc' } : null })}>
                <option value="">{grouped ? 'Premier calcul' : 'Ordre naturel'}</option>
                {(grouped ? [...def.groupBy.map((g) => [g, f(g).label]), ...def.aggregates.map((a, i) => [`agg_${i}`, a.fn === 'count' ? 'Nombre' : `${AGGS.find(([k]) => k === a.fn)![1]} · ${a.field ? f(a.field)?.label : ''}`])] : src.fields.map((x) => [x.key, x.label]))
                  .map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Ordre" htmlFor="sd"><select id="sd" className="input" value={def.sort?.dir ?? 'desc'} disabled={!def.sort} onChange={(e) => upd({ sort: { key: def.sort!.key, dir: e.target.value as 'asc' | 'desc' } })}>
                <option value="desc">Décroissant</option><option value="asc">Croissant</option></select></Field>
              <Field label="Limiter à" htmlFor="lm"><input id="lm" type="number" min={1} className="input" placeholder="toutes les lignes" value={def.limit ?? ''} onChange={(e) => upd({ limit: e.target.value ? Number(e.target.value) : null })} /></Field>
            </div>
          </Card>
        </div>
        <div className="wide">
          {!complete(def) && <Note tone="warn">Complétez la définition : au moins une colonne, et une valeur pour chaque filtre.</Note>}
          {run.error && <ErrorBox error={run.error} />}
          {run.isFetching && !res && <Loading />}
          {res && <>
            <div className="actions" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{res.grouped ? `${res.rows.length} groupe(s) sur ${fcfa(res.count)} ligne(s) source` : `${fcfa(res.count)} ligne(s)`}{res.truncated ? ' · affichage limité aux 2 000 premières ; l\'export contient tout' : ''}{run.isFetching ? ' · actualisation…' : ''}</span>
            </div>
            {chart && <Card title={chart.label}>
              <div className="hbars">{res.rows.slice(0, 15).map((r: Row, i: number) => (
                <div key={i} className="hbar"><span>{res.columns.filter((c: Row) => !c.key.startsWith('agg_')).map((c: Row) => cell(c, r[c.key])).join(' · ')}</span>
                  <span className="track"><span style={{ width: `${(Number(r[chart.key] ?? 0) / max) * 100}%` }} /></span><strong className="num">{cell(chart, r[chart.key])}</strong></div>))}</div>
              {res.rows.length > 15 && <span className="small muted">15 premiers groupes sur {res.rows.length}.</span>}
            </Card>}
            <Card pad={false} title="Résultat">
              {!res.rows.length ? <Empty>Aucune ligne ne correspond aux filtres.</Empty> : <div className="table-wrap" style={{ maxHeight: 640, overflowY: 'auto' }}><table className="t nowrap" style={{ minWidth: Math.max(520, res.columns.length * 140) }}>
                <thead style={{ position: 'sticky', top: 0 }}><tr>{res.columns.map((c: Row) => <th key={c.key} className={numeric(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>{res.rows.map((r: Row, i: number) => <tr key={i}>{res.columns.map((c: Row) => <td key={c.key} className={numeric(c.type) ? 'num' : ''}>{cell(c, r[c.key])}</td>)}</tr>)}</tbody>
                {res.totals && <tfoot><tr>{res.columns.map((c: Row, i: number) => <td key={c.key} className={numeric(c.type) ? 'num' : ''}>{res.totals[c.key] != null ? cell(c, res.totals[c.key]) : i === 0 ? 'Total' : ''}</td>)}</tr></tfoot>}
              </table></div>}
            </Card>
          </>}
        </div>
      </div>
      {saving && <SaveModal id={id && mine ? id : undefined} def={def} meta={meta} onClose={() => setSaving(false)} onSaved={(r, m) => { setMeta(m); setSaving(false); if (!id || !mine) nav(`/rapports/${r.id}`, { replace: true }); }} />}
    </>
  );
}

function fresh(s: Source): Def {
  return { source: s.key, columns: s.fields.filter((x) => x.default).map((x) => x.key), filters: [], groupBy: [], aggregates: [], sort: null, limit: null };
}
function complete(d: Def | null) {
  if (!d) return false;
  if (!d.groupBy.length && !d.columns.length) return false;
  return d.filters.every((f) => ['empty', 'notempty'].includes(f.op) || (f.value != null && f.value !== '' && !(Array.isArray(f.value) && !f.value.length) && (f.op !== 'between' || (f.value2 != null && f.value2 !== ''))));
}

function FilterRow({ f, fields, onChange, onRemove }: { f: Filter; fields: FieldDef[]; onChange: (f: Filter) => void; onRemove: () => void }) {
  const d = fields.find((x) => x.key === f.field)!;
  const ops = OPS[d.type];
  const needs = !['empty', 'notempty'].includes(f.op);
  const inputType = d.type === 'date' && !['year', 'last_days'].includes(f.op) ? 'date' : numeric(d.type) || f.op === 'year' || f.op === 'last_days' ? 'number' : 'text';
  return (
    <div className="filter-row">
      <div className="actions" style={{ flexWrap: 'nowrap' }}>
        <select className="input" aria-label="Champ filtré" value={f.field} onChange={(e) => { const n = fields.find((x) => x.key === e.target.value)!; onChange({ field: n.key, op: OPS[n.type][0][0], value: n.type === 'enum' ? [] : '' }); }}>
          {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
        <select className="input" aria-label="Opérateur" style={{ flex: '0 0 150px' }} value={f.op} onChange={(e) => onChange({ ...f, op: e.target.value, value: d.type === 'enum' && ['in', 'nin'].includes(e.target.value) ? (Array.isArray(f.value) ? f.value : []) : f.op === e.target.value ? f.value : '' })}>
          {ops.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn small" aria-label="Retirer le filtre" onClick={onRemove}>×</button>
      </div>
      {needs && d.type === 'enum' && ['eq', 'neq'].includes(f.op) ? (
        <select className="input" aria-label="Valeur" value={(f.value as string) ?? ''} onChange={(e) => onChange({ ...f, value: e.target.value })}>
          <option value="">Choisir…</option>{Object.entries(d.options ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      ) : needs && (d.type === 'enum' && ['in', 'nin'].includes(f.op) ? (
        <div className="chips">{Object.entries(d.options ?? {}).map(([k, l]) => { const on = Array.isArray(f.value) && f.value.includes(k); return (
          <button key={k} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} onClick={() => onChange({ ...f, value: on ? (f.value as string[]).filter((x) => x !== k) : [...((f.value as string[]) ?? []), k] })}>{l}</button>); })}</div>
      ) : (
        <div className="actions" style={{ flexWrap: 'nowrap' }}>
          <input className="input" aria-label="Valeur" type={inputType} value={(f.value as string) ?? ''} placeholder={f.op === 'last_days' ? 'jours' : f.op === 'year' ? 'année' : ''} onChange={(e) => onChange({ ...f, value: e.target.value })} />
          {f.op === 'between' && <><span className="small muted">et</span><input className="input" aria-label="Borne haute" type={inputType} value={(f.value2 as string) ?? ''} onChange={(e) => onChange({ ...f, value2: e.target.value })} /></>}
        </div>
      ))}
    </div>
  );
}

function SaveModal({ id, def, meta, onClose, onSaved }: { id?: string; def: Def; meta: { name: string; description: string; shared: boolean }; onClose: () => void; onSaved: (r: Row, m: typeof meta) => void }) {
  const [m, setM] = useState(meta);
  const body = useMemo(() => ({ name: m.name, description: m.description || null, shared: m.shared, definition: def }), [m, def]);
  const save = useAction(() => (id ? api<Row>(`/rapports/${id}`, { method: 'PUT', body }).then(() => ({ id })) : post<Row>('/rapports', body)),
    { success: 'État enregistré', invalidate: [['reports'], ['report', String(id)]], onDone: (r) => onSaved(r, m) });
  return (
    <Modal title={id ? "Enregistrer l'état" : 'Nouvel état enregistré'} onClose={onClose}>
      <Field label="Nom" htmlFor="rn"><input id="rn" className="input" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Biens de plus de 1 M sans détenteur" /></Field>
      <Field label="Description" htmlFor="rd"><textarea id="rd" className="input" rows={2} value={m.description} onChange={(e) => setM({ ...m, description: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={m.shared} onChange={(e) => setM({ ...m, shared: e.target.checked })} /> Partager avec les utilisateurs de l'entité (chacun ne voit que les sources permises par son profil)</label>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={m.name.trim().length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}
