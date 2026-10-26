import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, post } from '../api';
import { dateTime, fcfa } from '../format';
import { usePeople } from '../refs';
import { Card, Empty, ErrorBox, Field, Loading, Note, PageHead, Pill, SubNav, useAction } from '../components/ui';
import { PARAM } from './Admin';
import type { Row } from '../types';

type Step = { label: string; assignee: 'ROLE' | 'USER' | 'BENEFICIAIRE'; role?: string | null; userId?: number | null; days: number; minAmount?: number | null };
const ROLES: [string, string][] = [['COMPTABLE_MATIERES', 'Comptable-matières'], ['DIRECTEUR', 'Directeur du patrimoine'], ['FINANCES', 'Direction financière'], ['CONTROLEUR', 'Contrôleur financier'],
  ['GESTIONNAIRE', 'Gestionnaire du patrimoine'], ['CHEF_EQUIPE', "Chef d'équipe"], ['ADMIN', 'Administrateur']];
const roleLabel = (r?: string | null) => ROLES.find(([k]) => k === r)?.[1] ?? r ?? '—';
const clean = (s: Step[]): Step[] => s.map((x) => ({ label: x.label, assignee: x.assignee, role: x.assignee === 'ROLE' ? x.role ?? null : null, userId: x.assignee === 'USER' ? x.userId ?? null : null, days: x.days, minAmount: x.minAmount ?? null }));

export function Circuits() {
  const q = useQuery({ queryKey: ['circuits'], queryFn: () => api<Row[]>('/circuits') });
  const [sel, setSel] = useState<string>('');
  const list = q.data ?? [];
  const current = list.find((c) => `${c.type}/${c.variant}` === sel) ?? list[0];
  const groups = useMemo(() => { const m = new Map<string, Row[]>(); for (const c of list) m.set(c.typeLabel, [...(m.get(c.typeLabel) ?? []), c]); return [...m.entries()]; }, [list]);
  return (
    <>
      <SubNav items={PARAM} current="/parametrage/circuits" />
      <PageHead title="Circuits de validation" sub="Adaptez les circuits intégrés à votre organisation : étapes, valideurs, délais et seuils de montant. Les pièces déjà en circuit conservent leurs étapes ; le nouveau circuit s'applique aux pièces soumises ensuite." />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : (
        <div className="split">
          <div className="narrow" style={{ flex: '1 1 280px', maxWidth: 380 }}>
            <Card pad={false} title="Circuits">
              <div style={{ padding: '4px 12px 12px' }}>{groups.map(([label, items]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 10 }}>
                  <span className="small muted" style={{ fontWeight: 600, padding: '0 8px' }}>{label}</span>
                  {items.map((c) => { const k = `${c.type}/${c.variant}`; const active = current && `${current.type}/${current.variant}` === k; return (
                    <button key={k} className={`circuit-item ${active ? 'active' : ''}`} aria-current={active} onClick={() => setSel(k)}>
                      <span>{c.variantLabel}<br /><span className="small muted">{c.steps.length} étape(s)</span></span>
                      {c.configured ? <Pill tone="info">Personnalisé</Pill> : <Pill tone="grey">Intégré</Pill>}
                    </button>); })}
                </div>))}</div>
            </Card>
          </div>
          <div className="wide">{current && <Editor key={`${current.type}/${current.variant}/${current.version}/${current.configured}`} c={current} />}</div>
        </div>
      )}
    </>
  );
}

function Editor({ c }: { c: Row }) {
  const people = usePeople();
  const [steps, setSteps] = useState<Step[]>(() => clean(c.steps));
  const [active, setActive] = useState(true);
  const [amount, setAmount] = useState('10000000');
  const [benef, setBenef] = useState(true);
  const dirty = JSON.stringify(clean(steps)) !== JSON.stringify(clean(c.steps));
  const sim = useQuery({ queryKey: ['circuit-sim', c.type, c.variant, JSON.stringify(steps), amount, benef], queryFn: () => post<Row>(`/circuits/${c.type}/${c.variant}/simuler`, { amount: Number(amount || 0), beneficiary: benef, steps: clean(steps) }) });
  const inval = [['circuits']];
  const save = useAction(() => api<Row>(`/circuits/${c.type}/${c.variant}`, { method: 'PUT', body: { active, steps: clean(steps) } }), { success: (r) => `Circuit enregistré (version ${r.version})`, invalidate: inval });
  const reset = useAction(() => api(`/circuits/${c.type}/${c.variant}`, { method: 'DELETE' }), { success: 'Circuit intégré rétabli', invalidate: inval });
  const set = (i: number, patch: Partial<Step>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };
  useEffect(() => { if (!c.configured) setActive(true); }, [c.configured]);
  const systematic = steps.some((s) => s.assignee !== 'BENEFICIAIRE' && s.minAmount == null);
  return (
    <>
      <Card title={`${c.typeLabel} · ${c.variantLabel}`} extra={c.configured ? <Pill tone="info">Personnalisé · version {c.version}</Pill> : <Pill tone="grey">Circuit intégré</Pill>}>
        {c.configured && <span className="small muted">Modifié le {dateTime(c.updatedAt)} par {c.updatedBy}. Chaque modification est tracée au journal d'audit.</span>}
        {c.pending > 0 && <Note>{c.pending} étape(s) de ce type de pièce sont en cours : elles poursuivent leur circuit d'origine.</Note>}
        <ol className="circuit-steps">
          {steps.map((s, i) => (
            <li key={i} className="circuit-step">
              <span className="step-dot cur" aria-hidden="true">{i + 1}</span>
              <div className="circuit-fields">
                <Field label="Libellé de l'étape" htmlFor={`l${i}`}><input id={`l${i}`} className="input" value={s.label} onChange={(e) => set(i, { label: e.target.value })} /></Field>
                <div className="grid" style={{ ['--min' as string]: '170px' }}>
                  <Field label="Valideur" htmlFor={`a${i}`}><select id={`a${i}`} className="input" value={s.assignee} onChange={(e) => set(i, { assignee: e.target.value as Step['assignee'] })}>
                    <option value="ROLE">Un profil</option><option value="USER">Une personne nommée</option>{c.beneficiaryLabel && <option value="BENEFICIAIRE">Le bénéficiaire</option>}</select></Field>
                  {s.assignee === 'ROLE' && <Field label="Profil" htmlFor={`r${i}`}><select id={`r${i}`} className="input" value={s.role ?? ''} onChange={(e) => set(i, { role: e.target.value })}>
                    <option value="">Choisir…</option>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
                  {s.assignee === 'USER' && <Field label="Personne" htmlFor={`u${i}`}><select id={`u${i}`} className="input" value={s.userId ?? ''} onChange={(e) => set(i, { userId: Number(e.target.value) || null })}>
                    <option value="">Choisir…</option>{people.data?.filter((p) => p.role !== 'DETENTEUR').map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.title ? ` · ${p.title}` : ''}</option>)}</select></Field>}
                  {s.assignee === 'BENEFICIAIRE' && <Field label="Bénéficiaire" htmlFor={`b${i}`}><input id={`b${i}`} className="input" disabled value={c.beneficiaryLabel} /></Field>}
                  <Field label="Délai (jours)" htmlFor={`d${i}`}><input id={`d${i}`} type="number" min={1} max={60} className="input" value={s.days} onChange={(e) => set(i, { days: Number(e.target.value) || 1 })} /></Field>
                  <Field label="Seulement au-delà de (FCFA)" htmlFor={`m${i}`} hint={`Selon la ${c.amountLabel}`}>
                    <input id={`m${i}`} type="number" min={0} className="input" placeholder="toujours" value={s.minAmount ?? ''} onChange={(e) => set(i, { minAmount: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
                </div>
              </div>
              <div className="circuit-tools">
                <button className="btn small" aria-label={`Monter l'étape ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="btn small" aria-label={`Descendre l'étape ${i + 1}`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button className="btn small danger" aria-label={`Retirer l'étape ${i + 1}`} disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</button>
              </div>
            </li>))}
        </ol>
        <div className="actions">
          <button className="btn" disabled={steps.length >= 10} onClick={() => setSteps([...steps, { label: 'Nouvelle étape', assignee: 'ROLE', role: 'DIRECTEUR', days: 3, minAmount: null }])}>Ajouter une étape</button>
        </div>
        {!systematic && <Note tone="bad">Contrôle interne : gardez au moins une étape sans seuil, confiée à un profil ou à une personne.</Note>}
        <div className="actions" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line-soft)', paddingTop: 14 }}>
          <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Circuit actif (sinon le circuit intégré s'applique)</label>
          <div className="actions">
            {c.exists && <button className="btn" disabled={reset.isPending} onClick={() => reset.mutate(undefined)}>Rétablir le circuit intégré</button>}
            <button className="btn" disabled={!dirty} onClick={() => setSteps(clean(c.steps))}>Annuler les modifications</button>
            <button className="btn primary" disabled={!systematic || save.isPending || (!dirty && c.configured && active)} onClick={() => save.mutate(undefined)}>Enregistrer le circuit</button>
          </div>
        </div>
      </Card>
      <Card title="Simulation">
        <div className="grid" style={{ ['--min' as string]: '200px', alignItems: 'end' }}>
          <Field label={`Montant de la pièce (${c.amountLabel})`} htmlFor="sa"><input id="sa" type="number" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          {c.beneficiaryLabel && <label className="check" style={{ paddingBottom: 10 }}><input type="checkbox" checked={benef} onChange={(e) => setBenef(e.target.checked)} /> Avec un {c.beneficiaryLabel}</label>}
        </div>
        {sim.data && (sim.data.ok ? (
          <ol className="steps" aria-label="Étapes simulées">{sim.data.steps.map((s: Row, i: number) => (
            <li key={i}><span className="step-dot" aria-hidden="true">{i + 1}</span><span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><strong style={{ fontSize: 14 }}>{s.label}</strong><span className="small muted">{s.who} · {s.days} j</span></span></li>))}</ol>
        ) : <Note tone="bad">{sim.data.error}</Note>)}
        <span className="small muted">Pour une pièce de {fcfa(Number(amount || 0))} FCFA, avec le circuit tel qu'il est saisi ci-dessus (même non enregistré).</span>
      </Card>
      {!c.configured && <Card title="Pourquoi ce circuit intégré ?"><Empty>Il reprend le circuit réglementaire décrit au cahier des charges ({c.defaults.map((d: Row) => d.role ? roleLabel(d.role) : d.label).join(' → ')}).</Empty></Card>}
    </>
  );
}
