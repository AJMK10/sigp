import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, patch, post } from '../api';
import { useAuth } from '../auth';
import { ASSET_STATUS, CONTRACT_KIND, ENERGY, INCIDENT_STATUS, MISSION_STATUS, MONTHS, WO_STATUS, big, date, dateTime, fcfa, fmtKm, pct, today } from '../format';
import { usePeople } from '../refs';
import { Documents } from '../components/Documents';
import { Card, Empty, ErrorBox, Field, Kpi, Loading, Modal, Mono, Note, PageHead, Pill, RadioCards, StatusPill, Tabs, useAction } from '../components/ui';
import { DeadlineForm } from './Immobilier';
import type { Row } from '../types';

type Filter = 'tous' | 'disponibles' | 'mission' | 'alertes';

export function Flotte() {
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('tous');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['fleet'], queryFn: () => api<Row>('/flotte') });
  const rows = useMemo(() => {
    const items: Row[] = q.data?.items ?? [];
    const s = search.trim().toLowerCase();
    return items.filter((v) => (filter === 'disponibles' ? v.available : filter === 'mission' ? v.onMission : filter === 'alertes' ? v.abnormal || v.serviceDue || (v.nextDeadline && v.nextDeadline.dueDate <= today()) : true)
      && (!s || `${v.plate} ${v.designation} ${v.code} ${v.driver ?? ''}`.toLowerCase().includes(s)));
  }, [q.data, filter, search]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const maxFuel = Math.max(1, ...d.fuelByMonth.map((m: Row) => m.amount));
  return (
    <>
      <PageHead title="Parc automobile" sub="Véhicules et engins : disponibilité, ordres de mission, carburant, entretien, échéances réglementaires et sinistres."
        actions={<Link to="/missions" className="btn primary">Ordres de mission</Link>} />
      <section className="kpis">
        <Kpi label="Véhicules et engins" value={d.summary.count} note={`${d.summary.inService} en service`} />
        <Kpi label="Disponibilité" value={pct(d.summary.availability, 0)} note="hors maintenance et mission" />
        <Kpi label="Coût au kilomètre" value={`${fcfa(d.summary.costPerKm)} F`} note="carburant et entretien, 12 mois" />
        <Kpi label="Échéances échues" value={d.alerts.overdue} note={`${d.alerts.deadlines} dans les 30 jours`} tone={d.alerts.overdue ? 'bad' : undefined} />
        <Kpi label="Entretiens dus" value={d.alerts.services} note={`${d.alerts.abnormal} consommation(s) anormale(s)`} tone={d.alerts.services ? 'warn' : undefined} />
      </section>
      <div className="split">
        <div className="wide">
          <Card pad={false} title="Véhicules" extra={<div className="actions">
            <input className="input" style={{ height: 34, width: 200 }} placeholder="Immatriculation, modèle…" aria-label="Rechercher un véhicule" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="seg" role="group" aria-label="Filtre">{([['tous', 'Tous'], ['disponibles', 'Disponibles'], ['mission', 'En mission'], ['alertes', 'Alertes']] as [Filter, string][]).map(([k, l]) =>
              <button key={k} className={filter === k ? 'active' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div></div>}>
            {!rows.length ? <Empty>Aucun véhicule.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
              <thead><tr><th>Immatriculation</th><th>Véhicule</th><th>Conducteur</th><th className="num">Compteur</th><th className="num">L/100 km</th><th>Prochaine échéance</th><th>Situation</th></tr></thead>
              <tbody>{rows.map((v) => (
                <tr key={v.id} className="click" onClick={() => nav(`/flotte/${v.id}`)}>
                  <td><span className="plate">{v.plate}</span></td>
                  <td>{v.designation}<br /><Mono>{v.code}</Mono></td>
                  <td>{v.driver ?? <span className="muted">pool</span>}</td>
                  <td className="num">{fmtKm(v.mileage)}</td>
                  <td className="num">{v.consumption ? <span style={{ color: v.abnormal ? 'var(--bad)' : undefined, fontWeight: v.abnormal ? 700 : undefined }}>{v.consumption.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</span> : '—'}</td>
                  <td className="small">{v.nextDeadline ? <span style={{ color: v.nextDeadline.dueDate < today() ? 'var(--bad)' : undefined }}>{v.nextDeadline.label} · {date(v.nextDeadline.dueDate)}</span> : '—'}</td>
                  <td>{v.onMission ? <Pill tone="navy">En mission</Pill> : v.status !== 'EN_SERVICE' ? <StatusPill map={ASSET_STATUS} value={v.status} /> : v.serviceDue ? <Pill tone="warn">Entretien dû</Pill> : <Pill tone="ok">Disponible</Pill>}</td>
                </tr>))}</tbody>
            </table></div>}
          </Card>
        </div>
        <div className="narrow">
          <Card title="Missions du jour" extra={<Link to="/missions" className="small">Toutes</Link>}>
            {!d.missionsToday.length ? <Empty>Aucune mission aujourd'hui.</Empty> : <ul className="list">{d.missionsToday.map((m: Row) => (
              <li key={m.id}><span className="grow"><strong>{m.destination}</strong><span className="small muted"><span className="plate sm">{m.plate}</span> {m.driver ?? '—'} · {dateTime(m.startAt).split(' · ')[1]}</span></span><StatusPill map={MISSION_STATUS} value={m.status} /></li>))}</ul>}
          </Card>
          <Card title="Dépenses de carburant (6 mois)">
            <div className="hbars">{d.fuelByMonth.map((m: Row) => (
              <div key={m.month} className="hbar"><span>{MONTHS[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(0, 4)}</span><span className="track"><span style={{ width: `${(m.amount / maxFuel) * 100}%` }} /></span><strong className="num">{big(m.amount)}</strong></div>))}</div>
          </Card>
        </div>
      </div>
    </>
  );
}

export function Vehicule() {
  const { id } = useParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'fuel' | 'missions' | 'wo' | 'ech' | 'inc' | 'ctr'>('fuel');
  const [modal, setModal] = useState<'' | 'fuel' | 'inc' | 'ech' | 'edit'>('');
  const q = useQuery({ queryKey: ['vehicle', id], queryFn: () => api<Row>(`/flotte/${id}`) });
  const inval = [['vehicle', String(id)], ['fleet']];
  const done = useAction((did: number) => patch(`/flotte/echeances/${did}`, { doneAt: today() }), { success: 'Échéance réalisée', invalidate: inval });
  const incStatus = useAction((v: { iid: number; status: string }) => patch(`/flotte/incidents/${v.iid}`, { status: v.status }), { success: 'Sinistre mis à jour', invalidate: inval });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!;
  const v = a.vehicle;
  const manage = can('fleet.manage');
  const nextService = v.lastServiceKm + v.serviceIntervalKm;
  return (
    <>
      <nav className="crumbs"><Link to="/flotte">Parc automobile</Link><span aria-hidden="true">/</span><span>{v.plate}</span></nav>
      <section className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="actions"><span className="plate lg">{v.plate}</span><Mono>{a.code}</Mono><StatusPill map={ASSET_STATUS} value={a.status} /></div>
        <h1>{a.designation}</h1>
        <dl className="kv" style={{ margin: 0 }}>
          <div><dt>Conducteur attitré</dt><dd>{a.driver ?? 'Véhicule de pool'}</dd></div>
          <div><dt>Énergie · puissance</dt><dd>{ENERGY[v.energy]} · {v.fiscalPower ?? '—'} CV · {v.seats ?? '—'} places</dd></div>
          <div><dt>Première immatriculation</dt><dd>{date(v.firstRegistration)}</dd></div>
          <div><dt>N° de châssis</dt><dd>{v.vin ? <Mono>{v.vin}</Mono> : '—'}</dd></div>
        </dl>
        <div className="actions" style={{ marginTop: 6 }}>
          <Link to={`/biens/${a.id}`} className="btn">Fiche au registre</Link>
          {manage && <button className="btn primary" onClick={() => setModal('fuel')}>Saisir un plein</button>}
          {can('maintenance.manage') && <Link to={`/maintenance?nouveau=${a.id}`} className="btn">Ordre de travail</Link>}
          {manage && <button className="btn" onClick={() => setModal('inc')}>Déclarer un sinistre</button>}
          {manage && <button className="btn" onClick={() => setModal('edit')}>Modifier</button>}
        </div>
      </section>
      <section className="kpis">
        <Kpi label="Compteur" value={fmtKm(v.mileage)} note={v.mileage >= nextService ? `entretien dû depuis ${fmtKm(v.mileage - nextService)}` : `prochain entretien à ${fmtKm(nextService)}`} tone={v.mileage >= nextService ? 'warn' : undefined} />
        <Kpi label="Consommation" value={a.consumption ? `${a.consumption.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} L` : '—'} note="aux 100 km, d'après les pleins" />
        <Kpi label="Coût de possession (12 mois)" value={big(a.cost.total)} note={`${fcfa(a.cost.km)} km parcourus`} />
        <Kpi label="Coût au kilomètre" value={a.cost.perKm ? `${fcfa(a.cost.perKm)} F` : '—'} note="carburant, entretien, assurance, amortissement" />
        <Kpi label="Valeur nette comptable" value={big(a.nbv)} note={a.impairment ? `après dépréciation de ${fcfa(a.impairment)}` : `vétusté ${pct(a.wear, 0)}`} />
      </section>
      <Card title="Décomposition du coût de possession">
        <div className="stack" aria-hidden="true">{[['fuel', '#24477A'], ['maintenance', '#4C86C6'], ['insurance', '#8FB3DE'], ['depreciation', '#C9D6E6']].map(([k, c]) =>
          <span key={k} style={{ width: `${a.cost.total ? (a.cost[k] / a.cost.total) * 100 : 0}%`, background: c }} />)}</div>
        <div className="legend">{[['fuel', 'Carburant', '#24477A'], ['maintenance', 'Entretien et réparations', '#4C86C6'], ['insurance', 'Assurance (quote-part)', '#8FB3DE'], ['depreciation', 'Amortissement', '#C9D6E6']].map(([k, l, c]) =>
          <span key={k}><i style={{ background: c }} />{l}<strong>{fcfa(a.cost[k])}</strong></span>)}</div>
      </Card>
      <Card pad={false}>
        <div style={{ padding: '0 16px' }}><Tabs label="Rubriques" value={tab} onChange={setTab} items={[['fuel', `Carburant (${a.fuel.length})`], ['missions', `Missions (${a.missions.length})`], ['wo', `Entretien (${a.workOrders.length})`],
          ['ech', `Échéances (${a.deadlines.length})`], ['inc', `Sinistres et infractions (${a.incidents.length})`], ['ctr', `Contrats (${a.contracts.length})`]]} /></div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {tab === 'fuel' && (!a.fuel.length ? <Empty>Aucun plein enregistré.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 620 }}>
            <thead><tr><th>Date</th><th>Station</th><th>Carte</th><th className="num">Compteur</th><th className="num">Litres</th><th className="num">Montant</th></tr></thead>
            <tbody>{a.fuel.map((f: Row) => <tr key={f.id}><td>{date(f.date)}</td><td>{f.station ?? '—'}</td><td>{f.cardRef ? <Mono>{f.cardRef}</Mono> : '—'}</td><td className="num">{fmtKm(f.mileage)}</td><td className="num">{f.liters}</td><td className="num">{fcfa(f.amount)}</td></tr>)}</tbody>
          </table></div>)}
          {tab === 'missions' && (!a.missions.length ? <Empty>Aucune mission.</Empty> : <ul className="list">{a.missions.map((m: Row) => (
            <li key={m.id}><span className="grow"><strong>{m.destination}</strong><span className="small muted"><Mono>{m.number}</Mono> · {m.driver ?? '—'} · {date(m.startAt)} → {date(m.endAt)}{m.endMileage ? ` · ${fmtKm(m.endMileage - m.startMileage)}` : ''}</span></span><StatusPill map={MISSION_STATUS} value={m.status} /></li>))}</ul>)}
          {tab === 'wo' && (!a.workOrders.length ? <Empty>Aucune intervention.</Empty> : <ul className="list">{a.workOrders.map((w: Row) => (
            <li key={w.id}><span className="grow"><Link to={`/maintenance/ot/${w.id}`}><strong>{w.title}</strong></Link><span className="small muted"><Mono>{w.number}</Mono> · {w.kind === 'PREVENTIF' ? 'préventif' : 'correctif'} · {date(w.doneAt ?? w.createdAt)}{w.laborCost + w.partsCost ? ` · ${fcfa(w.laborCost + w.partsCost)} FCFA` : ''}</span></span><StatusPill map={WO_STATUS} value={w.status} /></li>))}</ul>)}
          {tab === 'ech' && <>
            <ul className="list">{a.deadlines.map((d: Row) => (
              <li key={d.id}><span className="grow"><strong>{d.label}</strong><span className="small muted">{d.doneAt ? `réalisée le ${date(d.doneAt)}` : `due le ${date(d.dueDate)}`}</span></span>
                {!d.doneAt && <Pill tone={d.dueDate < today() ? 'bad' : 'warn'}>{d.dueDate < today() ? 'Échue' : 'À venir'}</Pill>}
                {manage && !d.doneAt && <button className="btn small" onClick={() => done.mutate(d.id)}>Marquer réalisée</button>}</li>))}</ul>
            {manage && <div><button className="btn" onClick={() => setModal('ech')}>Ajouter une échéance</button></div>}
          </>}
          {tab === 'inc' && (!a.incidents.length ? <Empty>Aucun sinistre ni infraction.</Empty> : <ul className="list">{a.incidents.map((i: Row) => (
            <li key={i.id}><Pill tone={i.kind === 'SINISTRE' ? 'bad' : 'warn'}>{i.kind === 'SINISTRE' ? 'Sinistre' : 'Infraction'}</Pill>
              <span className="grow"><strong>{i.description}</strong><span className="small muted">{date(i.date)}{i.driver ? ` · ${i.driver}` : ''}{i.amount ? ` · ${fcfa(i.amount)} FCFA` : ''}{i.insuranceClaim ? ` · ${i.insuranceClaim}` : ''}</span></span>
              <StatusPill map={INCIDENT_STATUS} value={i.status} />
              {manage && i.status !== 'CLOS' && <button className="btn small" onClick={() => incStatus.mutate({ iid: i.id, status: i.status === 'OUVERT' && i.kind === 'SINISTRE' ? 'EXPERTISE' : 'CLOS' })}>{i.status === 'OUVERT' && i.kind === 'SINISTRE' ? 'En expertise' : 'Clore'}</button>}</li>))}</ul>)}
          {tab === 'ctr' && (!a.contracts.length ? <Note tone="warn">Aucun contrat d'assurance ou de maintenance ne couvre ce véhicule.</Note> : <ul className="list">{a.contracts.map((c: Row) => (
            <li key={c.id}><span className="grow"><Link to={`/contrats/${c.id}`}><strong>{c.title}</strong></Link><span className="small muted"><Mono>{c.number}</Mono> · {c.provider} · jusqu'au {date(c.endDate)}</span></span><Pill tone="info">{CONTRACT_KIND[c.kind]}</Pill></li>))}</ul>)}
        </div>
      </Card>
      <Documents objectType="BIEN" objectId={a.id} title="Carte grise, assurance et pièces" defaultCategory="CONTRAT" />
      {modal === 'fuel' && <FuelForm id={a.id} mileage={v.mileage} onClose={() => setModal('')} />}
      {modal === 'inc' && <IncidentForm id={a.id} onClose={() => setModal('')} />}
      {modal === 'ech' && <DeadlineForm assetId={a.id} kinds={['VISITE_TECHNIQUE', 'VIGNETTE', 'CARTE_GRISE', 'AUTRE']} invalidate={inval} onClose={() => setModal('')} />}
      {modal === 'edit' && <VehicleForm a={a} onClose={() => setModal('')} />}
    </>
  );
}

function FuelForm({ id, mileage, onClose }: { id: number; mileage: number; onClose: () => void }) {
  const [f, setF] = useState({ date: today(), liters: '', amount: '', mileage: String(mileage), station: '', cardRef: '' });
  const save = useAction(() => post(`/flotte/${id}/carburant`, { date: f.date, liters: Number(f.liters), amount: Number(f.amount), mileage: Number(f.mileage), station: f.station || undefined, cardRef: f.cardRef || undefined }),
    { success: 'Plein enregistré', invalidate: [['vehicle', String(id)], ['fleet']], onDone: onClose });
  return (
    <Modal title="Saisir un plein" onClose={onClose}>
      <Note>Le compteur ne peut pas être inférieur au dernier relevé ({fmtKm(mileage)}).</Note>
      <div className="grid" style={{ ['--min' as string]: '160px' }}>
        <Field label="Date" htmlFor="fd"><input id="fd" type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Compteur (km)" htmlFor="fm"><input id="fm" type="number" className="input" value={f.mileage} onChange={(e) => setF({ ...f, mileage: e.target.value })} /></Field>
        <Field label="Litres" htmlFor="fl"><input id="fl" type="number" className="input" value={f.liters} onChange={(e) => setF({ ...f, liters: e.target.value })} /></Field>
        <Field label="Montant (FCFA)" htmlFor="fa"><input id="fa" type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Station" htmlFor="fs"><input id="fs" className="input" value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })} /></Field>
        <Field label="Carte carburant" htmlFor="fc"><input id="fc" className="input" value={f.cardRef} onChange={(e) => setF({ ...f, cardRef: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={!f.liters || !f.amount || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

function IncidentForm({ id, onClose }: { id: number; onClose: () => void }) {
  const people = usePeople();
  const [f, setF] = useState({ kind: 'SINISTRE', date: today(), driverId: '', description: '', amount: '', insuranceClaim: '' });
  const save = useAction(() => post(`/flotte/${id}/incidents`, { kind: f.kind, date: f.date, driverId: f.driverId ? Number(f.driverId) : null, description: f.description, amount: Number(f.amount || 0), insuranceClaim: f.insuranceClaim || undefined }),
    { success: 'Déclaration enregistrée', invalidate: [['vehicle', String(id)]], onDone: onClose });
  return (
    <Modal title="Sinistre ou infraction" onClose={onClose}>
      <RadioCards label="Nature" value={f.kind} onChange={(v) => setF({ ...f, kind: v })} items={[['SINISTRE', 'Sinistre'], ['INFRACTION', 'Infraction']]} />
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Date" htmlFor="id"><input id="id" type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Conducteur" htmlFor="ic"><select id="ic" className="input" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}><option value="">—</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
        <Field label="Montant estimé (FCFA)" htmlFor="ia"><input id="ia" type="number" className="input" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        {f.kind === 'SINISTRE' && <Field label="Déclaration à l'assureur" htmlFor="ii"><input id="ii" className="input" value={f.insuranceClaim} onChange={(e) => setF({ ...f, insuranceClaim: e.target.value })} /></Field>}
      </div>
      <Field label="Circonstances" htmlFor="ide"><textarea id="ide" className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={f.description.length < 5 || save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

function VehicleForm({ a, onClose }: { a: Row; onClose: () => void }) {
  const people = usePeople();
  const v = a.vehicle;
  const [f, setF] = useState({ plate: v.plate, vin: v.vin ?? '', energy: v.energy, fiscalPower: v.fiscalPower ?? '', seats: v.seats ?? '', mileage: v.mileage, driverId: v.driverId ?? '', serviceIntervalKm: v.serviceIntervalKm, lastServiceKm: v.lastServiceKm });
  const save = useAction(() => post(`/flotte/${a.id}`, { ...f, vin: f.vin || undefined, fiscalPower: f.fiscalPower === '' ? undefined : Number(f.fiscalPower), seats: f.seats === '' ? undefined : Number(f.seats),
    driverId: f.driverId ? Number(f.driverId) : null, mileage: Number(f.mileage), serviceIntervalKm: Number(f.serviceIntervalKm), lastServiceKm: Number(f.lastServiceKm), firstRegistration: v.firstRegistration }),
  { success: 'Véhicule mis à jour', invalidate: [['vehicle', String(a.id)], ['fleet']], onDone: onClose });
  return (
    <Modal title={`Véhicule ${v.plate}`} onClose={onClose} width={640}>
      <div className="grid" style={{ ['--min' as string]: '180px' }}>
        <Field label="Immatriculation" htmlFor="vp"><input id="vp" className="input" value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value })} /></Field>
        <Field label="N° de châssis" htmlFor="vv"><input id="vv" className="input" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value })} /></Field>
        <Field label="Énergie" htmlFor="ve"><select id="ve" className="input" value={f.energy} onChange={(e) => setF({ ...f, energy: e.target.value })}>{Object.entries(ENERGY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Puissance fiscale (CV)" htmlFor="vf"><input id="vf" type="number" className="input" value={f.fiscalPower} onChange={(e) => setF({ ...f, fiscalPower: e.target.value })} /></Field>
        <Field label="Places" htmlFor="vs"><input id="vs" type="number" className="input" value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></Field>
        <Field label="Conducteur attitré" htmlFor="vd"><select id="vd" className="input" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })}><option value="">Véhicule de pool</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
        <Field label="Compteur (km)" htmlFor="vm"><input id="vm" type="number" className="input" value={f.mileage} onChange={(e) => setF({ ...f, mileage: Number(e.target.value) })} /></Field>
        <Field label="Intervalle d'entretien (km)" htmlFor="vi"><input id="vi" type="number" className="input" value={f.serviceIntervalKm} onChange={(e) => setF({ ...f, serviceIntervalKm: Number(e.target.value) })} /></Field>
        <Field label="Dernier entretien (km)" htmlFor="vl"><input id="vl" type="number" className="input" value={f.lastServiceKm} onChange={(e) => setF({ ...f, lastServiceKm: Number(e.target.value) })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}

export function Missions() {
  const { can, me } = useAuth();
  const [tab, setTab] = useState<'DEMANDE' | 'actives' | 'CLOTUREE' | 'toutes'>(can('fleet.manage') ? 'DEMANDE' : 'toutes');
  const [open, setOpen] = useState(false);
  const [act, setAct] = useState<{ m: Row; kind: 'depart' | 'retour' | 'refus' } | null>(null);
  const q = useQuery({ queryKey: ['missions'], queryFn: () => api<Row[]>('/missions') });
  const all = q.data ?? [];
  const rows = all.filter((m) => (tab === 'toutes' ? true : tab === 'actives' ? ['VALIDEE', 'EN_COURS'].includes(m.status) : m.status === tab));
  const inval = [['missions'], ['fleet']];
  const approve = useAction((id: number) => post(`/missions/${id}/decision`, { approve: true }), { success: 'Ordre de mission validé', invalidate: inval });
  const cancel = useAction((id: number) => post(`/missions/${id}/annuler`), { success: 'Ordre annulé', invalidate: inval });
  return (
    <>
      <PageHead title="Ordres de mission" sub="Réservation d'un véhicule, validation par le gestionnaire du parc, départ et retour avec relevé du compteur."
        actions={can('fleet.use', 'fleet.manage') && <button className="btn primary" onClick={() => setOpen(true)}>Demander un véhicule</button>} />
      <section className="kpis">
        <Kpi label="À valider" value={all.filter((m) => m.status === 'DEMANDE').length} tone={all.some((m) => m.status === 'DEMANDE') ? 'warn' : undefined} note="demandes en attente" />
        <Kpi label="Validées ou en cours" value={all.filter((m) => ['VALIDEE', 'EN_COURS'].includes(m.status)).length} note="véhicules engagés" />
        <Kpi label="Kilomètres parcourus" value={fmtKm(all.filter((m) => m.endMileage).reduce((s, m) => s + m.endMileage - m.startMileage, 0))} note="missions clôturées" />
      </section>
      <Card pad={false}>
        <div style={{ padding: '0 16px' }}><Tabs label="Statut" value={tab} onChange={setTab} items={[['DEMANDE', 'À valider'], ['actives', 'Validées et en cours'], ['CLOTUREE', 'Clôturées'], ['toutes', 'Toutes']]} /></div>
        {q.isLoading ? <Loading /> : !rows.length ? <Empty>Aucun ordre de mission.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 960 }}>
          <thead><tr><th>Ordre</th><th>Véhicule</th><th>Destination et objet</th><th>Conducteur</th><th>Départ</th><th>Retour</th><th>Statut</th><th /></tr></thead>
          <tbody>{rows.map((m) => (
            <tr key={m.id}>
              <td><Mono>{m.number}</Mono></td>
              <td><span className="plate sm">{m.plate}</span><br /><span className="small muted">{m.vehicle}</span></td>
              <td><strong>{m.destination}</strong><br /><span className="small muted">{m.purpose}</span></td>
              <td>{m.driver ?? '—'}{m.requester !== m.driver && <><br /><span className="small muted">demandé par {m.requester}</span></>}</td>
              <td className="small">{dateTime(m.startAt)}</td><td className="small">{dateTime(m.endAt)}{m.endMileage ? <><br />{fmtKm(m.endMileage - m.startMileage)}</> : null}</td>
              <td><StatusPill map={MISSION_STATUS} value={m.status} /></td>
              <td className="right"><div className="actions" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                {m.status === 'DEMANDE' && can('fleet.manage') && m.requesterId !== me?.id && <>
                  <button className="btn small success" disabled={approve.isPending} onClick={() => approve.mutate(m.id)}>Valider</button>
                  <button className="btn small danger" onClick={() => setAct({ m, kind: 'refus' })}>Refuser</button></>}
                {m.status === 'VALIDEE' && <button className="btn small" onClick={() => setAct({ m, kind: 'depart' })}>Départ</button>}
                {m.status === 'EN_COURS' && <button className="btn small primary" onClick={() => setAct({ m, kind: 'retour' })}>Retour</button>}
                {['DEMANDE', 'VALIDEE'].includes(m.status) && (m.requesterId === me?.id || can('fleet.manage')) && <button className="btn small" disabled={cancel.isPending} onClick={() => cancel.mutate(m.id)}>Annuler</button>}
              </div></td>
            </tr>))}</tbody>
        </table></div>}
      </Card>
      {open && <NewMission onClose={() => setOpen(false)} />}
      {act && <MissionStep m={act.m} kind={act.kind} onClose={() => setAct(null)} />}
    </>
  );
}

function NewMission({ onClose }: { onClose: () => void }) {
  const { me, can } = useAuth();
  const people = usePeople();
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ startAt: `${tomorrow}T08:00`, endAt: `${tomorrow}T17:00`, assetId: '', driverId: String(me?.id ?? ''), destination: '', purpose: '' });
  const avail = useQuery({ queryKey: ['available', f.startAt, f.endAt], enabled: f.endAt > f.startAt, queryFn: () => api<Row[]>(`/missions/disponibles?start=${encodeURIComponent(f.startAt)}&end=${encodeURIComponent(f.endAt)}`) });
  const save = useAction(() => post<Row>('/missions', { ...f, assetId: Number(f.assetId), driverId: f.driverId ? Number(f.driverId) : null }),
    { success: (m) => `Ordre ${m.number} transmis pour validation`, invalidate: [['missions']], onDone: onClose });
  return (
    <Modal title="Demander un véhicule" onClose={onClose} width={640}>
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="Départ" htmlFor="ms"><input id="ms" type="datetime-local" className="input" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value, assetId: '' })} /></Field>
        <Field label="Retour prévu" htmlFor="me"><input id="me" type="datetime-local" className="input" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value, assetId: '' })} /></Field>
      </div>
      <Field label="Véhicule disponible sur le créneau" htmlFor="mv" hint={avail.data ? `${avail.data.length} véhicule(s) libre(s)` : undefined}>
        <select id="mv" className="input" value={f.assetId} onChange={(e) => setF({ ...f, assetId: e.target.value })}><option value="">Choisir…</option>
          {avail.data?.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.designation}{v.seats ? ` · ${v.seats} places` : ''}</option>)}</select></Field>
      <Field label="Conducteur" htmlFor="md"><select id="md" className="input" value={f.driverId} onChange={(e) => setF({ ...f, driverId: e.target.value })} disabled={!can('fleet.manage')}>
        <option value={me?.id}>{me?.fullName}</option>{can('fleet.manage') && people.data?.filter((p) => p.id !== me?.id).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></Field>
      <Field label="Destination" htmlFor="mde"><input id="mde" className="input" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></Field>
      <Field label="Objet de la mission" htmlFor="mp"><textarea id="mp" className="input" rows={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className="btn primary" disabled={!f.assetId || f.destination.length < 2 || f.purpose.length < 3 || save.isPending} onClick={() => save.mutate(undefined)}>Transmettre</button></div>
    </Modal>
  );
}

function MissionStep({ m, kind, onClose }: { m: Row; kind: 'depart' | 'retour' | 'refus'; onClose: () => void }) {
  const [val, setVal] = useState(kind === 'retour' ? String(m.startMileage ?? '') : '');
  const act = useAction(() => kind === 'refus' ? post(`/missions/${m.id}/decision`, { approve: false, comment: val })
    : post(`/missions/${m.id}/${kind}`, kind === 'depart' ? { startMileage: Number(val) } : { endMileage: Number(val) }),
  { success: kind === 'refus' ? 'Ordre refusé' : kind === 'depart' ? 'Départ enregistré' : 'Retour enregistré, mission clôturée', invalidate: [['missions'], ['fleet']], onDone: onClose });
  return (
    <Modal title={`${kind === 'refus' ? 'Refuser' : kind === 'depart' ? 'Départ' : 'Retour'} · ${m.number}`} onClose={onClose}>
      <Note>{m.plate} · {m.destination}</Note>
      {kind === 'refus'
        ? <Field label="Motif du refus" htmlFor="mr"><textarea id="mr" className="input" rows={3} value={val} onChange={(e) => setVal(e.target.value)} /></Field>
        : <Field label={kind === 'depart' ? 'Compteur au départ (km)' : 'Compteur au retour (km)'} htmlFor="mk" hint={kind === 'retour' ? `Départ : ${fmtKm(m.startMileage)}` : undefined}>
          <input id="mk" type="number" className="input" value={val} onChange={(e) => setVal(e.target.value)} /></Field>}
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button>
        <button className={`btn ${kind === 'refus' ? 'danger' : 'primary'}`} disabled={!val || act.isPending} onClick={() => act.mutate(undefined)}>Confirmer</button></div>
    </Modal>
  );
}
