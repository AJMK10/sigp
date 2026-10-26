import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, patch, post } from '../api';
import { useAuth } from '../auth';
import { OCCUPANCY_KIND, PROPERTY_EVENT, PROPERTY_EVENT_STATUS, TITLE_TYPE, big, date, fcfa, pct, today } from '../format';
import { useOrgUnits } from '../refs';
import { Documents } from '../components/Documents';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pill, RadioCards, StatusPill, Tabs, useAction } from '../components/ui';
import type { Row } from '../types';

/* Contour simplifié de la Côte d'Ivoire (longitude, latitude) : carte schématique sans service de tuiles. */
const CI: [number, number][] = [[-7.53, 4.35], [-6.6, 4.7], [-6.08, 4.95], [-5.57, 5.08], [-5.0, 5.13], [-4.0, 5.25], [-3.74, 5.2], [-3.3, 5.13], [-2.95, 5.1], [-3.1, 5.6], [-3.25, 6.6],
  [-2.95, 7.3], [-2.75, 8.0], [-2.6, 8.8], [-2.7, 9.5], [-3.6, 9.9], [-4.3, 9.6], [-4.8, 10.2], [-5.5, 10.45], [-6.2, 10.3], [-6.9, 10.2], [-7.6, 10.4], [-8.0, 10.2], [-8.2, 9.5], [-7.8, 8.6],
  [-8.2, 8.2], [-8.5, 7.6], [-8.3, 7.0], [-7.9, 6.3], [-7.5, 5.6], [-7.6, 4.9]];
const W = 520, H = 540;
const px = (lng: number, lat: number) => [((lng + 8.8) / 6.5) * W, ((10.9 - lat) / 6.8) * H] as const;
const TITLE_COLOR: Record<string, string> = { TITRE_FONCIER: '#1E7B4F', ACD: '#1F5FAE', LETTRE_ATTRIBUTION: '#D68A1C', AUCUN: '#B3261E' };
const CITIES: [string, number, number][] = [['Abidjan', -4.01, 5.33], ['Yamoussoukro', -5.28, 6.82], ['Bouaké', -5.03, 7.69], ['Korhogo', -5.63, 9.46], ['San-Pédro', -6.64, 4.75], ['Man', -7.55, 7.41], ['Daloa', -6.45, 6.88]];

function PropertyMap({ items, onPick }: { items: Row[]; onPick: (id: number) => void }) {
  const pts = items.filter((i) => i.property?.lat && i.property?.lng);
  // Les biens d'un même site sont légèrement décalés pour rester distincts.
  const seen = new Map<string, number>();
  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Carte schématique des biens immobiliers">
        <polygon points={CI.map(([x, y]) => px(x, y).join(',')).join(' ')} fill="#FFFFFF" stroke="#9FB3CC" strokeWidth="2" />
        {CITIES.map(([n, lng, lat]) => { const [x, y] = px(lng, lat); return <g key={n}><circle cx={x} cy={y} r="2.5" fill="#93A7C1" /><text x={x + 13} y={y + 4} fontSize="12" fill="#5B6775">{n}</text></g>; })}
        {pts.map((i) => {
          const key = `${Number(i.property.lat).toFixed(1)}:${Number(i.property.lng).toFixed(1)}`;
          const k = seen.get(key) ?? 0; seen.set(key, k + 1);
          const [x, y] = px(Number(i.property.lng), Number(i.property.lat));
          return (
            <g key={i.id} transform={`translate(${x + k * 14},${y - k * 4})`} style={{ cursor: 'pointer' }} onClick={() => onPick(i.id)} tabIndex={0} role="link" aria-label={i.designation}
              onKeyDown={(e) => e.key === 'Enter' && onPick(i.id)}>
              <circle r="9" fill={TITLE_COLOR[i.property.titleType]} stroke="#fff" strokeWidth="2.5" />
              <title>{`${i.designation} · ${TITLE_TYPE[i.property.titleType][0]}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ padding: '10px 14px', background: '#fff', borderTop: '1px solid var(--line)' }}>
        {Object.entries(TITLE_TYPE).map(([k, [l]]) => <span key={k}><i style={{ background: TITLE_COLOR[k], borderRadius: 5 }} />{l}</span>)}
      </div>
    </div>
  );
}

export function Immobilier() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['properties'], queryFn: () => api<{ items: Row[]; summary: Row }>('/immobilier') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { items, summary: s } = q.data!;
  const unsecured = items.filter((i) => i.property.titleType !== 'TITRE_FONCIER');
  return (
    <>
      <PageHead title="Immobilier et foncier" sub="Terrains et bâtiments : sécurisation foncière, composants, occupation, baux, travaux et contentieux." />
      <section className="kpis">
        <Kpi label="Biens immobiliers" value={s.count} note={`${s.buildings} bâtiment(s) · ${s.lands} terrain(s)`} />
        <Kpi label="Surface bâtie" value={`${fcfa(s.builtArea)} m²`} note={`taux d'occupation ${pct(s.occupancyRate, 0)}`} />
        <Kpi label="Valeur nette comptable" value={big(s.nbv)} note="FCFA, terrains compris" />
        <Kpi label="Loyers perçus (an)" value={big(s.rentYear)} note="baux consentis à des tiers" />
        <Kpi label="Sécurisation foncière" value={`${s.byTitle.TITRE_FONCIER} / ${s.count}`} note={`${s.count - s.byTitle.TITRE_FONCIER} bien(s) sans titre foncier`} tone={s.byTitle.AUCUN ? 'warn' : undefined} />
      </section>
          <Card pad={false} title="Portefeuille immobilier">
            <div className="table-wrap"><table className="t" style={{ minWidth: 820 }}>
              <thead><tr><th>Bien</th><th>Nature</th><th>Titre</th><th className="num">Surface</th><th className="num">Occupation</th><th className="num">VNC</th><th className="num">Loyers / an</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id} className="click" onClick={() => nav(`/immobilier/${i.id}`)}>
                  <td><strong>{i.designation}</strong><br /><Mono>{i.code}</Mono></td>
                  <td>{i.property.kind === 'TERRAIN' ? 'Terrain' : 'Bâtiment'}</td>
                  <td><StatusPill map={TITLE_TYPE} value={i.property.titleType} /></td>
                  <td className="num">{fcfa(i.property.builtArea ?? i.property.landArea)} m²</td>
                  <td className="num">{i.property.kind === 'TERRAIN' ? '—' : pct(i.occupancyRate, 0)}</td>
                  <td className="num">{fcfa(i.nbv)}</td>
                  <td className="num">{i.rentYear ? fcfa(i.rentYear) : '—'}</td>
                </tr>))}</tbody>
            </table></div>
          </Card>
      <div className="split">
        <div className="wide">
          {unsecured.length > 0 && <Card title="Sécurisation foncière à conduire">
            <ul className="list">{unsecured.map((i) => (
              <li key={i.id}><span className="grow"><Link to={`/immobilier/${i.id}`}><strong>{i.designation}</strong></Link><span className="small muted">{i.property.titleProcedure ?? i.property.titleRef ?? 'Aucune procédure engagée'}</span></span>
                <StatusPill map={TITLE_TYPE} value={i.property.titleType} /></li>))}</ul>
          </Card>}
        </div>
        <div className="narrow">
          <Card title="Carte des implantations"><PropertyMap items={items} onPick={(id) => nav(`/immobilier/${id}`)} /></Card>
        </div>
      </div>
    </>
  );
}

export function ImmoFiche() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'foncier' | 'comp' | 'occ' | 'evt' | 'ech'>('foncier');
  const [modal, setModal] = useState<'' | 'edit' | 'comp' | 'occ' | 'evt' | 'ech'>('');
  const [replace, setReplace] = useState<Row | null>(null);
  const q = useQuery({ queryKey: ['property', id], queryFn: () => api<Row>(`/immobilier/${id}`) });
  const inval = [['property', String(id)], ['properties']];
  const delOcc = useAction((oid: number) => api(`/immobilier/${id}/occupations/${oid}`, { method: 'DELETE' }), { success: 'Occupation retirée', invalidate: inval });
  const evtStatus = useAction((v: { eid: number; status: string }) => patch(`/immobilier/${id}/evenements/${v.eid}`, { status: v.status }), { success: 'Statut mis à jour', invalidate: inval });
  const done = useAction((did: number) => patch(`/flotte/echeances/${did}`, { doneAt: today() }), { success: 'Échéance réalisée', invalidate: inval });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!;
  const p = a.property;
  const isLand = p.kind === 'TERRAIN';
  const manage = can('property.manage');
  const totalArea = a.occupancies.reduce((s: number, o: Row) => s + o.area, 0);
  return (
    <>
      <nav className="crumbs"><Link to="/immobilier">Immobilier et foncier</Link><span aria-hidden="true">/</span><span>{a.code}</span></nav>
      <section className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="actions"><Mono>{a.code}</Mono><StatusPill map={TITLE_TYPE} value={p.titleType} /><Pill tone="grey">{isLand ? 'Terrain' : 'Bâtiment'}</Pill></div>
        <h1>{a.designation}</h1>
        <dl className="kv" style={{ margin: 0 }}>
          <div><dt>Adresse</dt><dd>{p.address ?? '—'}</dd></div>
          <div><dt>Localisation au registre</dt><dd>{a.location ?? '—'}</dd></div>
          <div><dt>Coordonnées</dt><dd>{p.lat ? <Mono>{p.lat}, {p.lng}</Mono> : '—'}</dd></div>
          <div><dt>Propriétaire</dt><dd>{p.owner ?? '—'}</dd></div>
        </dl>
        <div className="actions" style={{ marginTop: 6 }}>
          <Link to={`/biens/${a.id}`} className="btn">Fiche au registre</Link>
          {manage && <button className="btn" onClick={() => setModal('edit')}>Modifier les données foncières</button>}
        </div>
      </section>
      <section className="kpis">
        <Kpi label="Valeur d'origine" value={big(a.acquisitionValue)} note="FCFA" />
        <Kpi label="Valeur nette comptable" value={big(a.nbv)} note={isLand ? 'terrain non amortissable' : `vétusté ${pct(a.wear, 0)}`} />
        <Kpi label={isLand ? 'Superficie' : 'Surface bâtie'} value={`${fcfa(isLand ? p.landArea : p.builtArea)} m²`} note={isLand ? '' : `${p.floors ?? '—'} niveau(x) · terrain ${fcfa(p.landArea)} m²`} />
        {!isLand && <Kpi label="Taux d'occupation" value={pct(a.occupancyRate, 0)} note={`loyers ${fcfa(a.rentYear)} FCFA / an`} tone={a.occupancyRate < 0.8 ? 'warn' : undefined} />}
      </section>
      {p.titleType !== 'TITRE_FONCIER' && <Note tone={p.titleType === 'AUCUN' ? 'bad' : 'warn'}><strong>Sécurisation foncière : </strong>{p.titleProcedure ?? 'aucune procédure renseignée.'}</Note>}
      <Card pad={false}>
        <div style={{ padding: '0 16px' }}><Tabs label="Rubriques" value={tab} onChange={setTab} items={[['foncier', 'Situation foncière'], ...(isLand ? [] : [['comp', `Composants (${a.components.length})`] as ['comp', string], ['occ', `Occupation (${a.occupancies.length})`] as ['occ', string]]),
          ['evt', `Travaux et contentieux (${a.events.length})`], ['ech', `Échéances (${a.deadlines.length})`]]} /></div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'foncier' && <dl className="kv" style={{ margin: 0 }}>
            <div><dt>Nature du titre</dt><dd>{TITLE_TYPE[p.titleType][0]}</dd></div><div><dt>Référence</dt><dd>{p.titleRef ?? '—'}</dd></div>
            <div><dt>Acte d'affectation</dt><dd>{p.assignmentAct ?? '—'}</dd></div><div><dt>Servitudes</dt><dd>{p.easements ?? '—'}</dd></div>
            <div><dt>Superficie du terrain</dt><dd>{p.landArea ? `${fcfa(p.landArea)} m²` : '—'}</dd></div><div><dt>Procédure en cours</dt><dd>{p.titleProcedure ?? '—'}</dd></div>
          </dl>}
          {tab === 'comp' && <>
            <Note>Approche par composants : chaque composant s'amortit sur sa propre durée et peut être remplacé sans toucher au gros œuvre.</Note>
            <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
              <thead><tr><th>Composant</th><th>Mise en service</th><th className="num">Durée</th><th className="num">Valeur</th><th className="num">VNC</th><th /></tr></thead>
              <tbody>{a.components.map((c: Row) => (
                <tr key={c.id} style={{ opacity: c.replacedAt ? 0.55 : 1 }}>
                  <td>{c.label}{c.replacedAt && <span className="small muted"> · remplacé le {date(c.replacedAt)}</span>}</td><td>{date(c.inServiceDate)}</td><td className="num">{c.durationYears} ans</td>
                  <td className="num">{fcfa(c.value)}</td><td className="num">{c.replacedAt ? '—' : fcfa(c.nbv)}</td>
                  <td className="right">{manage && !c.replacedAt && <button className="btn small" onClick={() => setReplace(c)}>Remplacer</button>}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={3}>Composants en service</td><td className="num">{fcfa(a.componentsTotal.value)}</td><td className="num">{fcfa(a.componentsTotal.nbv)}</td><td /></tr></tfoot>
            </table></div>
            {manage && <div><button className="btn" onClick={() => setModal('comp')}>Ajouter un composant</button></div>}
          </>}
          {tab === 'occ' && <>
            {totalArea > 0 && <div className="stack" aria-label="Répartition des surfaces">
              {a.occupancies.map((o: Row) => <span key={o.id} title={`${o.occupant} · ${o.area} m²`} style={{ width: `${(o.area / totalArea) * 100}%`, background: o.kind === 'VACANT' ? '#F0C98A' : o.kind === 'BAIL' ? '#4C86C6' : '#24477A', borderRight: '2px solid #fff' }} />)}
            </div>}
            <div className="table-wrap"><table className="t" style={{ minWidth: 720 }}>
              <thead><tr><th>Occupant</th><th>Nature</th><th>Niveaux</th><th className="num">Surface</th><th className="num">Loyer mensuel</th><th>Échéance du bail</th><th /></tr></thead>
              <tbody>{a.occupancies.map((o: Row) => (
                <tr key={o.id}><td>{o.occupant}</td><td><StatusPill map={OCCUPANCY_KIND} value={o.kind} /></td><td>{o.floors ?? '—'}</td><td className="num">{fcfa(o.area)} m²</td>
                  <td className="num">{o.monthlyRent ? fcfa(o.monthlyRent) : '—'}</td><td>{date(o.endDate)}</td>
                  <td className="right">{manage && <button className="btn small" disabled={delOcc.isPending} onClick={() => delOcc.mutate(o.id)}>Retirer</button>}</td></tr>))}</tbody>
            </table></div>
            {manage && <div><button className="btn" onClick={() => setModal('occ')}>Ajouter une occupation</button></div>}
          </>}
          {tab === 'evt' && <>
            {!a.events.length ? <Empty>Aucun dossier.</Empty> : <ul className="list">{a.events.map((e: Row) => (
              <li key={e.id}><Pill tone={e.kind === 'CONTENTIEUX' ? 'bad' : e.kind === 'TRAVAUX' ? 'info' : 'grey'}>{PROPERTY_EVENT[e.kind]}</Pill>
                <span className="grow"><strong>{e.title}</strong><span className="small muted">{date(e.date)}{e.amount ? ` · ${fcfa(e.amount)} FCFA` : ''}{e.nextDate ? ` · prochaine échéance ${date(e.nextDate)}` : ''}</span>{e.notes && <span className="small">{e.notes}</span>}</span>
                <StatusPill map={PROPERTY_EVENT_STATUS} value={e.status} />
                {manage && e.status !== 'CLOS' && e.status !== 'A_JOUR' && <button className="btn small" onClick={() => evtStatus.mutate({ eid: e.id, status: 'CLOS' })}>Clore</button>}
              </li>))}</ul>}
            {manage && <div><button className="btn" onClick={() => setModal('evt')}>Nouveau dossier</button></div>}
          </>}
          {tab === 'ech' && <>
            {!a.deadlines.length ? <Empty>Aucune échéance réglementaire.</Empty> : <ul className="list">{a.deadlines.map((d: Row) => (
              <li key={d.id}><span className="grow"><strong>{d.label ?? DEADLINE_LABELS[d.kind]}</strong><span className="small muted">{d.doneAt ? `réalisée le ${date(d.doneAt)}` : `due le ${date(d.dueDate)}`}{d.notes ? ` · ${d.notes}` : ''}</span></span>
                {!d.doneAt && <Pill tone={d.dueDate < today() ? 'bad' : 'warn'}>{d.dueDate < today() ? 'Échue' : 'À venir'}</Pill>}
                {manage && !d.doneAt && <button className="btn small" onClick={() => done.mutate(d.id)}>Marquer réalisée</button>}</li>))}</ul>}
            {manage && <div><button className="btn" onClick={() => setModal('ech')}>Ajouter une échéance</button></div>}
          </>}
        </div>
      </Card>
      <Documents objectType="BIEN" objectId={a.id} title="Titres, actes et pièces" defaultCategory="TITRE" />
      {modal === 'edit' && <EditProperty a={a} onClose={() => setModal('')} />}
      {modal === 'comp' && <ComponentForm id={a.id} onClose={() => setModal('')} />}
      {replace && <ComponentForm id={a.id} replace={replace} onClose={() => setReplace(null)} />}
      {modal === 'occ' && <OccupancyForm id={a.id} onClose={() => setModal('')} />}
      {modal === 'evt' && <EventForm id={a.id} onClose={() => setModal('')} />}
      {modal === 'ech' && <DeadlineForm assetId={a.id} kinds={['CONTROLE_INCENDIE', 'CONTROLE_ASCENSEUR', 'AUTRE']} invalidate={inval} onClose={() => setModal('')} />}
    </>
  );
}

function EditProperty({ a, onClose }: { a: Row; onClose: () => void }) {
  const p = a.property;
  const [f, setF] = useState({ kind: p.kind, address: p.address ?? '', lat: p.lat ?? '', lng: p.lng ?? '', landArea: p.landArea ?? '', builtArea: p.builtArea ?? '', floors: p.floors ?? '',
    titleType: p.titleType, titleRef: p.titleRef ?? '', owner: p.owner ?? '', assignmentAct: p.assignmentAct ?? '', easements: p.easements ?? '', titleProcedure: p.titleProcedure ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const num = (v: string | number) => (v === '' ? undefined : Number(v));
  const save = useAction(() => post(`/immobilier/${a.id}`, { ...f, landArea: num(f.landArea), builtArea: num(f.builtArea), floors: num(f.floors),
    ...Object.fromEntries(['address', 'lat', 'lng', 'titleRef', 'owner', 'assignmentAct', 'easements', 'titleProcedure'].map((k) => [k, (f as Record<string, string>)[k] || undefined])) }),
  { success: 'Données foncières enregistrées', invalidate: [['property', String(a.id)], ['properties']], onDone: onClose });
  return (
    <Modal title="Données foncières" onClose={onClose} width={720}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>Nature du titre</span>
      <RadioCards label="Nature du titre" value={f.titleType} onChange={(v) => setF({ ...f, titleType: v })} items={Object.entries(TITLE_TYPE).map(([k, [l]]) => [k, l])} min={140} />
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="Référence du titre" htmlFor="tr"><input id="tr" className="input" value={f.titleRef} onChange={set('titleRef')} /></Field>
        <Field label="Propriétaire" htmlFor="ow"><input id="ow" className="input" value={f.owner} onChange={set('owner')} /></Field>
        <Field label="Adresse" htmlFor="ad"><input id="ad" className="input" value={f.address} onChange={set('address')} /></Field>
        <Field label="Acte d'affectation" htmlFor="aa"><input id="aa" className="input" value={f.assignmentAct} onChange={set('assignmentAct')} /></Field>
        <Field label="Latitude" htmlFor="la"><input id="la" className="input" value={f.lat} onChange={set('lat')} placeholder="5.3220" /></Field>
        <Field label="Longitude" htmlFor="lo"><input id="lo" className="input" value={f.lng} onChange={set('lng')} placeholder="-4.0175" /></Field>
        <Field label="Superficie du terrain (m²)" htmlFor="ls"><input id="ls" type="number" className="input" value={f.landArea} onChange={set('landArea')} /></Field>
        {f.kind === 'BATIMENT' && <><Field label="Surface bâtie (m²)" htmlFor="bs"><input id="bs" type="number" className="input" value={f.builtArea} onChange={set('builtArea')} /></Field>
          <Field label="Niveaux" htmlFor="fl"><input id="fl" type="number" className="input" value={f.floors} onChange={set('floors')} /></Field></>}
      </div>
      <Field label="Servitudes" htmlFor="se"><input id="se" className="input" value={f.easements} onChange={set('easements')} /></Field>
      <Field label="Procédure de sécurisation en cours" htmlFor="tp"><textarea id="tp" className="input" rows={2} value={f.titleProcedure} onChange={set('titleProcedure')} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

function ComponentForm({ id, replace, onClose }: { id: number; replace?: Row; onClose: () => void }) {
  const [f, setF] = useState({ label: '', value: '', durationYears: replace ? String(replace.durationYears) : '', inServiceDate: today() });
  const save = useAction(() => replace
    ? post(`/immobilier/${id}/composants/${replace.id}/remplacer`, { date: f.inServiceDate, value: Number(f.value), durationYears: Number(f.durationYears) })
    : post(`/immobilier/${id}/composants`, { label: f.label, value: Number(f.value), durationYears: Number(f.durationYears), inServiceDate: f.inServiceDate }),
  { success: replace ? 'Composant remplacé' : 'Composant ajouté', invalidate: [['property', String(id)]], onDone: onClose });
  return (
    <Modal title={replace ? `Remplacer : ${replace.label}` : 'Nouveau composant'} onClose={onClose}>
      {replace && <Note>L'ancien composant sort de la base amortissable à la date de remplacement ; le nouveau s'amortit sur sa propre durée.</Note>}
      {!replace && <Field label="Libellé" htmlFor="cl"><input id="cl" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>}
      <div className="grid" style={{ ['--min' as string]: '160px' }}>
        <Field label="Valeur (FCFA)" htmlFor="cv"><input id="cv" type="number" className="input" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
        <Field label="Durée (ans)" htmlFor="cd"><input id="cd" type="number" className="input" value={f.durationYears} onChange={(e) => setF({ ...f, durationYears: e.target.value })} /></Field>
        <Field label={replace ? 'Date de remplacement' : 'Mise en service'} htmlFor="cs"><input id="cs" type="date" className="input" value={f.inServiceDate} onChange={(e) => setF({ ...f, inServiceDate: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={!f.value || !f.durationYears || (!replace && f.label.length < 2) || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

function OccupancyForm({ id, onClose }: { id: number; onClose: () => void }) {
  const units = useOrgUnits();
  const [f, setF] = useState({ kind: 'AFFECTATION', occupant: '', orgUnitId: '', area: '', floors: '', monthlyRent: '', startDate: '', endDate: '' });
  const save = useAction(() => post(`/immobilier/${id}/occupations`, { kind: f.kind, occupant: f.occupant, orgUnitId: f.orgUnitId ? Number(f.orgUnitId) : null, area: Number(f.area), floors: f.floors || undefined,
    monthlyRent: Number(f.monthlyRent || 0), startDate: f.startDate || null, endDate: f.endDate || null }), { success: 'Occupation enregistrée', invalidate: [['property', String(id)], ['properties']], onDone: onClose });
  return (
    <Modal title="Nouvelle occupation" onClose={onClose}>
      <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={Object.entries(OCCUPANCY_KIND).map(([k, [l]]) => [k, l])} min={130} />
      {f.kind === 'AFFECTATION'
        ? <Field label="Service occupant" htmlFor="ou"><select id="ou" className="input" value={f.orgUnitId} onChange={(e) => setF({ ...f, orgUnitId: e.target.value, occupant: units.data?.find((u) => String(u.id) === e.target.value)?.name ?? '' })}>
          <option value="">Choisir…</option>{units.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        : <Field label={f.kind === 'BAIL' ? 'Preneur' : 'Description de la surface'} htmlFor="oc"><input id="oc" className="input" value={f.occupant} onChange={(e) => setF({ ...f, occupant: e.target.value })} /></Field>}
      <div className="grid" style={{ ['--min' as string]: '160px' }}>
        <Field label="Surface (m²)" htmlFor="oa"><input id="oa" type="number" className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} /></Field>
        <Field label="Niveaux" htmlFor="of"><input id="of" className="input" value={f.floors} onChange={(e) => setF({ ...f, floors: e.target.value })} /></Field>
        {f.kind === 'BAIL' && <><Field label="Loyer mensuel (FCFA)" htmlFor="or"><input id="or" type="number" className="input" value={f.monthlyRent} onChange={(e) => setF({ ...f, monthlyRent: e.target.value })} /></Field>
          <Field label="Début du bail" htmlFor="os"><input id="os" type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Fin du bail" htmlFor="oe"><input id="oe" type="date" className="input" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field></>}
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={f.occupant.length < 2 || !f.area || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

function EventForm({ id, onClose }: { id: number; onClose: () => void }) {
  const [f, setF] = useState({ kind: 'TRAVAUX', title: '', status: 'PROGRAMME', amount: '', date: today(), nextDate: '', notes: '' });
  const save = useAction(() => post(`/immobilier/${id}/evenements`, { ...f, amount: Number(f.amount || 0), nextDate: f.nextDate || null, notes: f.notes || undefined }),
    { success: 'Dossier enregistré', invalidate: [['property', String(id)]], onDone: onClose });
  return (
    <Modal title="Travaux, contentieux ou contrôle" onClose={onClose}>
      <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={Object.entries(PROPERTY_EVENT) as [string, string][]} min={130} />
      <Field label="Objet" htmlFor="et"><input id="et" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="grid" style={{ ['--min' as string]: '160px' }}>
        <Field label="Statut" htmlFor="es"><select id="es" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(PROPERTY_EVENT_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Montant (FCFA)" htmlFor="ea"><input id="ea" type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date" htmlFor="ed"><input id="ed" type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Prochaine échéance" htmlFor="en"><input id="en" type="date" className="input" value={f.nextDate} onChange={(e) => setF({ ...f, nextDate: e.target.value })} /></Field>
      </div>
      <Field label="Observations" htmlFor="eo"><textarea id="eo" className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={f.title.length < 2 || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

export const DEADLINE_LABELS: Record<string, string> = { VISITE_TECHNIQUE: 'Visite technique', VIGNETTE: 'Vignette', CARTE_GRISE: 'Carte grise', CONTROLE_INCENDIE: 'Contrôle sécurité incendie', CONTROLE_ASCENSEUR: 'Contrôle des ascenseurs', AUTRE: 'Autre échéance' };
export function DeadlineForm({ assetId, kinds, invalidate, onClose }: { assetId: number; kinds: string[]; invalidate: string[][]; onClose: () => void }) {
  const [f, setF] = useState({ kind: kinds[0], dueDate: '', notes: '' });
  const save = useAction(() => post(`/flotte/${assetId}/echeances`, { kind: f.kind, dueDate: f.dueDate, notes: f.notes || undefined }), { success: 'Échéance enregistrée', invalidate, onDone: onClose });
  return (
    <Modal title="Nouvelle échéance réglementaire" onClose={onClose}>
      <Field label="Nature" htmlFor="dk"><select id="dk" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k} value={k}>{DEADLINE_LABELS[k]}</option>)}</select></Field>
      <Field label="Date d'échéance" htmlFor="dd"><input id="dd" type="date" className="input" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
      <Field label="Observations" htmlFor="dn"><input id="dn" className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!f.dueDate || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}
