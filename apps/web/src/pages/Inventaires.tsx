import { FormEvent, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, post } from '../api';
import { CAMPAIGN_STATUS, CAMPAIGN_TYPE, CONDITION, GAP_STATUS, GAP_TYPE, date, dateTime, fcfa, pct, today } from '../format';
import { useLocations, usePeople } from '../refs';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Mono, Note, PageHead, Pill, RadioCards, StatusPill, SubNav, Tabs, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

const sub = (id?: number | string): [string, string][] => id ? [[`/inventaires/${id}`, 'Suivi de la campagne'], [`/inventaires/${id}/ecarts`, 'Traitement des écarts']] : [['/inventaires', 'Campagnes'], ['/inventaires/nouvelle', 'Nouvelle campagne']];

export function Inventaires() {
  const nav = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api<Row[]>('/inventaires') });
  return (
    <>
      {can('inventory.manage') && <SubNav items={sub()} current="/inventaires" />}
      <PageHead title="Inventaires physiques" sub="Campagnes de comptage, rapprochement avec le registre et traitement des écarts jusqu'à la signature du PV." />
      {q.error && <ErrorBox error={q.error} />}
      <Card pad={false} title="Campagnes">
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Aucune campagne. {can('inventory.manage') && <Link to="/inventaires/nouvelle">Créer la première</Link>}</Empty> : (
          <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
            <thead><tr><th>Référence</th><th>Intitulé</th><th>Type</th><th>Période</th><th className="num">Attendus</th><th>Couverture</th><th className="num">Écarts ouverts</th><th>Statut</th></tr></thead>
            <tbody>{q.data.map((c) => {
              const cov = c.expectedCount ? c.found / c.expectedCount : 0;
              return <tr key={c.id} className="click" onClick={() => nav(`/inventaires/${c.id}`)}><td><Mono>{c.number}</Mono></td><td>{c.label}</td><td className="small">{CAMPAIGN_TYPE[c.type]}</td>
                <td className="small">{date(c.startDate)} → {date(c.endDate)}</td><td className="num">{fcfa(c.expectedCount)}</td>
                <td style={{ minWidth: 160 }}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="bar"><span style={{ width: `${cov * 100}%`, background: cov >= 0.98 ? '#2E8B57' : undefined }} /></span><span className="small">{pct(cov, 0)}</span></span></td>
                <td className="num">{c.gaps.open}</td><td><StatusPill map={CAMPAIGN_STATUS} value={c.status} /></td></tr>;
            })}</tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

export function NouvelleCampagne() {
  const nav = useNavigate();
  const locs = useLocations(); const people = usePeople();
  const [f, setF] = useState({ label: '', type: 'GENERAL', startDate: today(), endDate: '', blind: true, freezeMovements: true });
  const [zones, setZones] = useState<{ locationId: string; leaderId: string }[]>([{ locationId: '', leaderId: '' }]);
  const save = useAction(() => post<Row>('/inventaires', { ...f, zones: zones.filter((z) => z.locationId).map((z) => ({ locationId: Number(z.locationId), leaderId: z.leaderId ? Number(z.leaderId) : null })) }),
    { success: (c) => `Campagne ${c.number} créée`, invalidate: [['campaigns']], onDone: (c) => nav(`/inventaires/${c.id}`) });
  const NOTES: Record<string, string> = { GENERAL: "Tous les biens du périmètre, au moins une fois par an : c'est l'inventaire exigé pour la clôture des comptes.", TOURNANT: 'Un site différent chaque mois : tout le patrimoine est couvert sur l\'année.',
    CIBLE: 'Biens sensibles, de valeur ou à fort risque de perte.', PASSATION: "À la prise ou cessation de fonctions d'un comptable-matières : le sortant et l'entrant signent le PV." };
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(undefined); };
  return (
    <>
      <SubNav items={sub()} current="/inventaires/nouvelle" />
      <PageHead title="Nouvelle campagne d'inventaire" sub="Définissez le périmètre, les équipes et les règles de contrôle ; le lancement fige la liste des biens attendus." />
      <form className="split" onSubmit={submit}>
        <div className="wide">
          <Card title="Paramètres">
            <div className="grid" style={{ ['--min' as string]: '200px' }}>
              <Field label="Intitulé" htmlFor="l"><input id="l" className="input" required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Inventaire général de fin d'exercice" /></Field>
              <Field label="Début" htmlFor="s"><input id="s" type="date" className="input" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              <Field label="Clôture" htmlFor="e"><input id="e" type="date" className="input" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
            </div>
            <RadioCards label="Type de campagne" value={f.type} onChange={(v) => setF({ ...f, type: v })} items={Object.entries(CAMPAIGN_TYPE) as [string, string][]} min={150} />
            <span className="small muted">{NOTES[f.type]}</span>
          </Card>
          <Card title="Zones et chefs d'équipe" extra={<button type="button" className="btn small" onClick={() => setZones([...zones, { locationId: '', leaderId: '' }])}>Ajouter une zone</button>}>
            {zones.map((z, i) => (
              <div key={i} className="grid" style={{ ['--min' as string]: '220px', alignItems: 'end' }}>
                <Field label={`Zone ${i + 1} (le sous-arbre est inclus)`} htmlFor={`z${i}`}><select id={`z${i}`} className="input" required={i === 0} value={z.locationId} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, locationId: e.target.value } : x)))}>
                  <option value="">Choisir…</option>{locs.data?.filter((l) => l.kind !== 'LOCAL').map((l) => <option key={l.id} value={l.id}>{l.path} ({l.kind.toLowerCase()})</option>)}</select></Field>
                <Field label="Chef d'équipe" htmlFor={`k${i}`}><select id={`k${i}`} className="input" value={z.leaderId} onChange={(e) => setZones(zones.map((x, j) => (j === i ? { ...x, leaderId: e.target.value } : x)))}>
                  <option value="">À désigner</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
                {zones.length > 1 && <button type="button" className="btn small danger" onClick={() => setZones(zones.filter((_, j) => j !== i))}>Retirer</button>}
              </div>
            ))}
          </Card>
        </div>
        <div className="narrow">
          <Card title="Règles de contrôle">
            <label className="check"><input type="checkbox" checked={f.blind} onChange={(e) => setF({ ...f, blind: e.target.checked })} />Comptage à l'aveugle : les compteurs ne voient pas la liste des biens attendus</label>
            <label className="check"><input type="checkbox" checked={f.freezeMovements} onChange={(e) => setF({ ...f, freezeMovements: e.target.checked })} />Gel des mouvements sur le périmètre pendant le comptage</label>
            <Note>Le comptage à l'aveugle et la séparation entre compteurs et décideurs sont les deux garanties attendues par les organes de contrôle.</Note>
            <button className="btn primary" disabled={save.isPending}>Créer la campagne</button>
          </Card>
        </div>
      </form>
    </>
  );
}

export function Campagne() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api<Row>(`/inventaires/${id}`) });
  const inv = [['campaign', id!], ['campaigns'], ['gaps', id!], ['dashboard']];
  const launch = useAction(() => post<Row>(`/inventaires/${id}/lancer`), { success: (r) => `Campagne lancée : ${fcfa(r.expected)} biens attendus`, invalidate: inv });
  const reconcile = useAction(() => post<Row>(`/inventaires/${id}/rapprocher`), { success: (r) => `Rapprochement effectué : ${r.gaps.total} écarts au total`, invalidate: inv });
  const close = useAction(() => post(`/inventaires/${id}/cloturer`), { success: 'Campagne clôturée : PV prêt à signer', invalidate: inv });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const cov = c.expectedCount ? c.found / c.expectedCount : 0;
  return (
    <>
      <nav className="crumbs"><Link to="/inventaires">Inventaires</Link><span aria-hidden="true">/</span><span>{c.number}</span></nav>
      {c.status !== 'PREPARATION' && can('inventory.manage', 'inventory.decide') && <SubNav items={sub(id)} current={`/inventaires/${id}`} />}
      <PageHead title={c.label} sub={<><Mono>{c.number}</Mono> · {CAMPAIGN_TYPE[c.type]} · du {date(c.startDate)} au {date(c.endDate)} · {c.blind ? 'comptage à l\'aveugle' : 'liste attendue visible'}{c.freezeMovements ? ' · mouvements gelés' : ''}</>}
        actions={<>
          {c.status === 'PREPARATION' && can('inventory.manage') && <button className="btn primary" disabled={launch.isPending} onClick={() => launch.mutate(undefined)}>Lancer la campagne</button>}
          {c.status === 'EN_COURS' && can('inventory.manage', 'inventory.decide') && <button className="btn" disabled={reconcile.isPending} onClick={() => reconcile.mutate(undefined)}>Rapprocher avec le registre</button>}
          {c.status !== 'PREPARATION' && <button className="btn" onClick={() => download(`/etats/ecarts/${c.id}.xlsx`, `ecarts-${c.number}.xlsx`).catch((e) => toast(e.message, 'bad'))}>État des écarts</button>}
          {c.status === 'EN_COURS' && can('inventory.manage') && <button className="btn primary" disabled={close.isPending} onClick={() => close.mutate(undefined)}>Clôturer et signer le PV</button>}
        </>} />
      <StatusPill map={CAMPAIGN_STATUS} value={c.status} />
      <section className="kpis">
        <Kpi label="Biens attendus" value={fcfa(c.expectedCount)} note={`${c.zones.length} zone(s)`} />
        <Kpi label="Biens constatés" value={fcfa(c.found)} note={`couverture ${pct(cov)}`} />
        <Kpi label="Écarts" value={fcfa(c.gaps.total)} note={Object.entries(c.gaps.byType).map(([k, n]) => `${GAP_TYPE[k].toLowerCase()} ${n}`).join(' · ') || 'rapprochement non lancé'} />
        <Kpi label="Écarts sans décision finale" value={fcfa(c.gaps.open)} note="bloquent la clôture" tone={c.gaps.open ? 'warn' : undefined} to={`/inventaires/${c.id}/ecarts`} />
      </section>
      <Card pad={false} title="Zones de comptage">
        <div className="table-wrap"><table className="t" style={{ minWidth: 760 }}>
          <thead><tr><th>Zone</th><th>Chef d'équipe</th><th className="num">Attendus</th><th className="num">Constats</th><th>Avancement</th><th>Statut</th><th /></tr></thead>
          <tbody>{c.zones.map((z: Row) => {
            const p = z.expectedCount ? Math.min(1, z.counted / z.expectedCount) : 0;
            return <tr key={z.id}><td>{z.location}</td><td>{z.leader ?? '—'}</td><td className="num">{fcfa(z.expectedCount)}</td><td className="num">{fcfa(z.counted)}</td>
              <td style={{ minWidth: 150 }}><span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="bar"><span style={{ width: `${p * 100}%` }} /></span><span className="small">{pct(p, 0)}</span></span></td>
              <td><Pill tone={z.status === 'TERMINEE' ? 'ok' : z.status === 'EN_COURS' ? 'info' : 'grey'}>{z.status === 'TERMINEE' ? 'Terminée' : z.status === 'EN_COURS' ? 'En cours' : 'À faire'}</Pill></td>
              <td>{c.status === 'EN_COURS' && can('inventory.count', 'inventory.manage') && <Link to={`/inventaires/${c.id}/zones/${z.id}`} className="btn small">Compter</Link>}</td></tr>;
          })}</tbody>
        </table></div>
      </Card>
      {c.status === 'CLOTUREE' && <Note tone="ok">Campagne clôturée le {date(c.closedAt)} : tous les écarts ont reçu une décision, les dates de dernier contrôle des biens sont à jour.</Note>}
    </>
  );
}

export function Comptage() {
  const { id, zoneId } = useParams();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['zone', id, zoneId], queryFn: () => api<Row>(`/inventaires/${id}/zones/${zoneId}`) });
  const [code, setCode] = useState('');
  const [condition, setCondition] = useState('BON');
  const [locationId, setLocationId] = useState('');
  const [comment, setComment] = useState('');
  const [last, setLast] = useState<Row | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const count = useAction(() => post<Row>(`/inventaires/${id}/constats`, { zoneId: Number(zoneId), code, condition, locationId: locationId ? Number(locationId) : null, comment: comment || undefined }),
    { invalidate: [['zone', id!, zoneId!], ['campaign', id!]], onDone: (r) => { setLast(r); setCode(''); setComment(''); setCondition('BON'); input.current?.focus(); } });
  const done = useAction(() => post(`/inventaires/${id}/zones/${zoneId}/terminer`), { success: 'Zone clôturée', invalidate: [['zone', id!, zoneId!], ['campaign', id!]] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const z = q.data!;
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) count.mutate(undefined); };
  const tone = last?.status === 'RECONNU' || last?.status === 'MIS_A_JOUR' ? 'ok' : 'warn';
  return (
    <>
      <nav className="crumbs"><Link to="/inventaires">Inventaires</Link><span aria-hidden="true">/</span><Link to={`/inventaires/${id}`}>{z.campaign.number}</Link><span aria-hidden="true">/</span><span>Comptage</span></nav>
      <PageHead title={z.zone.location} sub={`${z.campaign.label} · ${fcfa(z.counts.length)} constat(s)${z.campaign.blind && !z.expected ? ' · comptage à l\'aveugle' : ''}`}
        actions={z.zone.status !== 'TERMINEE' && can('inventory.count', 'inventory.manage') && <button className="btn" onClick={() => done.mutate(undefined)} disabled={done.isPending}>Clôturer la zone</button>} />
      {z.zone.status === 'TERMINEE' ? <Note tone="ok">Zone clôturée.</Note> : (
        <Card title="Constater un bien">
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="grid" style={{ ['--min' as string]: '200px', alignItems: 'end' }}>
              <Field label="Code scanné ou saisi" htmlFor="code" hint="Une douchette se comporte comme un clavier : scannez directement dans ce champ."><input id="code" ref={input} autoFocus className="input mono" style={{ fontSize: 16 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="MEF-INF-2023-000811" /></Field>
              <Field label="État constaté" htmlFor="cond"><select id="cond" className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>{Object.entries(CONDITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Local exact" htmlFor="loc"><select id="loc" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Zone entière</option>{z.locations.map((l: Row) => <option key={l.id} value={l.id}>{l.path}</option>)}</select></Field>
            </div>
            {['MAUVAIS', 'HORS_USAGE'].includes(condition) && <Field label="Commentaire (obligatoire pour ce constat)" htmlFor="cm"><input id="cm" className="input" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>}
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={count.isPending || !code.trim()}>Enregistrer le constat</button>
          </form>
          {last && <div className={`note ${tone}`} role="status"><strong>{last.status === 'EXCEDENT' ? 'Excédent' : last.status === 'DEJA_SIGNALE' ? 'Déjà signalé' : 'Bien reconnu'} · {last.code}</strong> — {last.designation}</div>}
        </Card>
      )}
      <div className="split">
        <div className="wide">
          <Card pad={false} title={`Constats · ${z.counts.length}`}>
            {!z.counts.length ? <Empty>Aucun constat pour l'instant.</Empty> : <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}><table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>Code</th><th>Désignation</th><th>État</th><th>Local</th><th>Par</th><th>Heure</th></tr></thead>
              <tbody>{z.counts.map((k: Row) => <tr key={k.id}><td><Mono>{k.code}</Mono></td><td style={{ color: k.assetId ? undefined : 'var(--bad)' }}>{k.designation}</td><td>{CONDITION[k.condition]}</td><td className="small">{k.location ?? '—'}</td><td className="small">{k.by}</td><td className="small">{dateTime(k.countedAt)}</td></tr>)}</tbody>
            </table></div>}
          </Card>
        </div>
        {z.expected && <div className="narrow">
          <Card pad={false} title={`Biens attendus · ${z.expected.filter((e: Row) => !e.counted).length} restants`}>
            <ul className="list" style={{ padding: '0 20px', maxHeight: 520, overflowY: 'auto' }}>
              {z.expected.filter((e: Row) => !e.counted).slice(0, 300).map((e: Row) => <li key={e.id}><span className="grow"><Mono>{e.code}</Mono><span className="small muted">{e.designation} · {e.location}</span></span><button className="btn small" onClick={() => setCode(e.code)}>Saisir</button></li>)}
            </ul>
          </Card>
        </div>}
      </div>
    </>
  );
}

export function Ecarts() {
  const { id } = useParams();
  const { can } = useAuth();
  const [type, setType] = useState('MANQUANT');
  const [sel, setSel] = useState<number[]>([]);
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');
  const camp = useQuery({ queryKey: ['campaign', id], queryFn: () => api<Row>(`/inventaires/${id}`) });
  const decisions = useQuery({ queryKey: ['decisions'], queryFn: () => api<Record<string, Record<string, { label: string; final: boolean }>>>('/inventaires/decisions'), staleTime: Infinity });
  const gaps = useQuery({ queryKey: ['gaps', id, type], queryFn: () => api<Row[]>(`/inventaires/${id}/ecarts?type=${type}`) });
  const decide = useAction(() => post<Row>(`/inventaires/${id}/ecarts/decision`, { gapIds: sel, decision, comment: comment || undefined }),
    { success: (r) => `${r.updated} écart(s) traité(s)`, invalidate: [['gaps', id!], ['campaign', id!], ['campaigns'], ['dashboard']], onDone: () => { setSel([]); setComment(''); } });
  const rows = gaps.data ?? [];
  const open = rows.filter((g) => g.status !== 'REGULARISE');
  const opts = decisions.data?.[type] ?? {};
  const HELP: Record<string, string> = {
    MANQUANT: "Second passage, puis enquête auprès du détenteur. Sans résultat : constat de perte (statut Manquant) et, le cas échéant, mise en débet et dossier de sortie.",
    EXCEDENT: "Recherche d'une fiche existante ; à défaut, immatriculation par entrée manuelle « régularisation d'inventaire » avec une valeur estimée.",
    MAL_LOCALISE: "Transfert de régularisation : la localisation du registre est corrigée selon le constat, l'historique garde la trace.",
    ECART_ETAT: "Mise à jour de l'état, envoi en maintenance ou proposition de réforme selon le constat.",
  };
  const c = camp.data;
  return (
    <>
      <nav className="crumbs"><Link to="/inventaires">Inventaires</Link><span aria-hidden="true">/</span><Link to={`/inventaires/${id}`}>{c?.number}</Link><span aria-hidden="true">/</span><span>Écarts</span></nav>
      <SubNav items={sub(id)} current={`/inventaires/${id}/ecarts`} />
      <PageHead title={`Traitement des écarts · ${c?.number ?? ''}`} sub="Chaque écart reçoit une décision motivée avant la signature du PV d'inventaire." />
      {c && <section className="kpis">
        <Kpi label="Biens constatés" value={fcfa(c.found)} note={`sur ${fcfa(c.expectedCount)} attendus`} />
        <Kpi label="Écarts" value={fcfa(c.gaps.total)} note={`${pct(c.found ? c.gaps.total / c.found : 0)} des biens constatés`} />
        <Kpi label="Sans décision finale" value={fcfa(c.gaps.open)} tone={c.gaps.open ? 'warn' : undefined} note="bloquent la clôture" />
      </section>}
      <Card pad={false}>
        <div style={{ padding: '6px 20px 0' }}><Tabs label="Types d'écarts" value={type} onChange={(v) => { setType(v); setSel([]); setDecision(''); }} items={Object.entries(GAP_TYPE).map(([k, l]) => [k, `${l} · ${c?.gaps.byType[k] ?? 0}`]) as [string, string][]} /></div>
        <div style={{ padding: '12px 20px' }} className="small muted">{HELP[type]}</div>
        {gaps.isLoading ? <Loading /> : !rows.length ? <Empty>Aucun écart de ce type.</Empty> : (
          <div className="table-wrap" style={{ maxHeight: 560, overflowY: 'auto' }}><table className="t" style={{ minWidth: 900 }}>
            <thead><tr><th><input type="checkbox" aria-label="Tout sélectionner" checked={open.length > 0 && sel.length === open.length} onChange={() => setSel(sel.length === open.length ? [] : open.map((g) => g.id))} /></th>
              <th>Code</th><th>Désignation</th><th>Constat</th><th className="num">Valeur</th><th>Décision</th><th>Statut</th></tr></thead>
            <tbody>{rows.map((g) => (
              <tr key={g.id} className={sel.includes(g.id) ? 'sel' : ''}>
                <td>{g.status !== 'REGULARISE' && <input type="checkbox" aria-label={`Sélectionner ${g.code}`} checked={sel.includes(g.id)} onChange={() => setSel(sel.includes(g.id) ? sel.filter((x) => x !== g.id) : [...sel, g.id])} />}</td>
                <td>{g.assetId ? <Link to={`/biens/${g.assetId}`}><Mono>{g.code}</Mono></Link> : <Mono>{g.code}</Mono>}</td><td>{g.designation ?? '—'}</td><td className="small">{g.detail}</td>
                <td className="num">{g.value ? fcfa(g.value) : '—'}</td><td className="small">{g.decisionLabel ?? '—'}{g.decisionComment && <div className="muted">« {g.decisionComment} »</div>}</td><td><StatusPill map={GAP_STATUS} value={g.status} /></td>
              </tr>))}</tbody>
          </table></div>
        )}
        {can('inventory.decide') && c?.status === 'EN_COURS' && (
          <div className="card-foot" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ minWidth: 260 }}><label htmlFor="dec">Décision pour {sel.length} écart(s)</label><select id="dec" className="input" value={decision} onChange={(e) => setDecision(e.target.value)}>
              <option value="">Choisir…</option>{Object.entries(opts).map(([k, o]) => <option key={k} value={k}>{o.label}{o.final ? '' : ' (non définitive)'}</option>)}</select></div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}><label htmlFor="com">Commentaire</label><input id="com" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={decision === 'CONSTAT_PERTE' ? 'Obligatoire : circonstances, enquête' : 'Facultatif'} /></div>
            <button className="btn primary" disabled={!sel.length || !decision || decide.isPending} onClick={() => decide.mutate(undefined)}>Appliquer</button>
          </div>
        )}
      </Card>
    </>
  );
}
