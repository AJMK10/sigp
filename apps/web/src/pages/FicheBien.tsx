import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download, patch } from '../api';
import { ASSET_STATUS, CONDITION, ENTRY_MODE, LABEL_STATUS, MOVEMENT_STATUS, MOVEMENT_TYPE, DISPOSAL_STATUS, date, dateTime, fcfa, pct } from '../format';
import { useAuth } from '../auth';
import { Documents } from '../components/Documents';
import { Card, ErrorBox, Field, Loading, Modal, Mono, Note, Pill, QR, StatusPill, Tabs, useAction, useToast } from '../components/ui';
import type { Row } from '../types';

export function FicheBien() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'ident' | 'acq' | 'val' | 'hist' | 'mv'>('ident');
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['asset', id], queryFn: () => api<Row>(`/biens/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!;
  const out = a.status === 'SORTI';
  return (
    <>
      <nav className="crumbs"><Link to="/biens">Registre des biens</Link><span aria-hidden="true">/</span><span>{a.code}</span></nav>
      <section className="card" style={{ padding: 22, display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        <div style={{ flex: '999 1 380px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="actions"><Mono>{a.code}</Mono><StatusPill map={ASSET_STATUS} value={a.status} /><Pill tone="grey">{a.category.label}</Pill></div>
          <h1>{a.designation}</h1>
          <dl className="kv" style={{ margin: 0 }}>
            <div><dt>Localisation</dt><dd>{a.location ?? '—'}</dd></div>
            <div><dt>Détenteur</dt><dd>{a.holder ?? (a.orgUnit ? `${a.orgUnit} (collectif)` : '—')}</dd></div>
            <div><dt>N° de série</dt><dd>{a.serialNumber ? <Mono>{a.serialNumber}</Mono> : '—'}</dd></div>
            <div><dt>État</dt><dd>{CONDITION[a.condition]}</dd></div>
          </dl>
          <div className="actions" style={{ marginTop: 6 }}>
            {!out && can('movements.write') && <Link to={`/mouvements/nouveau?assets=${a.id}`} className="btn primary">Affecter / transférer</Link>}
            {can('assets.read') && <button className="btn" onClick={() => download(`/etats/fiche/${a.id}.pdf`, `fiche-${a.code}.pdf`, true).catch((e) => toast(e.message, 'bad'))}>Fiche PDF</button>}
            {!out && can('labels.manage') && <button className="btn" onClick={() => download(`/etats/etiquettes.pdf?ids=${a.id}`, 'etiquette.pdf', true).catch((e) => toast(e.message, 'bad'))}>Imprimer l'étiquette</button>}
            {!out && can('disposals.write') && a.status !== 'PROPOSE_REFORME' && <Link to={`/reformes/nouvelle?assets=${a.id}`} className="btn">Proposer à la réforme</Link>}
            {!out && can('assets.write') && <button className="btn" onClick={() => setEdit(true)}>Modifier</button>}
          </div>
        </div>
        <div style={{ flex: '0 0 140px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <QR value={a.code} size={120} />
          <span className="small muted" style={{ textAlign: 'center' }}>Étiquette : <StatusPill map={LABEL_STATUS} value={a.labelStatus} />{a.lastSeenAt && <><br />vu le {date(a.lastSeenAt)}</>}</span>
        </div>
      </section>
      <section className="kpis" aria-label="Valeurs">
        <div className="card kpi"><span className="label">Valeur d'origine</span><span className="value">{fcfa(a.acquisitionValue)}</span><span className="kpi-note">FCFA</span></div>
        <div className="card kpi"><span className="label">Cumul des amortissements</span><span className="value">{fcfa(a.cumulative)}</span><span className="kpi-note">au {date(a.asOf)}</span></div>
        <div className="card kpi"><span className="label">Valeur nette comptable</span><span className="value">{fcfa(a.nbv)}</span><span className="kpi-note">{a.deprMethod.toLowerCase()} sur {a.deprYears} ans</span></div>
        <div className={`card kpi ${a.wear > 0.6 ? 'warn' : ''}`}><span className="label">Taux de vétusté</span><span className="value">{pct(a.wear, 0)}</span><span className="kpi-note">{a.wear > 0.6 ? 'au-dessus du seuil de 60 %' : 'sous le seuil de 60 %'}</span></div>
      </section>
      {!a.inServiceDate && a.status !== 'EN_STOCK' && <Note tone="warn">Ce bien est en service sans date de mise en service : il est exclu du calcul des dotations. Renseignez la date (Modifier).</Note>}
      <Card pad={false}>
        <div style={{ padding: '0 16px' }}><Tabs label="Rubriques de la fiche" value={tab} onChange={setTab} items={[['ident', 'Identification'], ['acq', 'Acquisition'], ['val', "Plan d'amortissement"], ['hist', `Historique (${a.events.length})`], ['mv', 'Mouvements et sorties']]} /></div>
        <div style={{ padding: 20 }}>
          {tab === 'ident' && <dl className="kv" style={{ margin: 0 }}>
            <div><dt>Catégorie</dt><dd>{a.category.code} · {a.category.label}</dd></div><div><dt>Compte d'immobilisation</dt><dd>{a.category.assetAccount ?? '—'}</dd></div>
            <div><dt>Marque / modèle</dt><dd>{[a.brand, a.model].filter(Boolean).join(' ') || '—'}</dd></div><div><dt>Fin de garantie</dt><dd>{date(a.warrantyEnd)}</dd></div>
            <div><dt>Service</dt><dd>{a.orgUnit ?? '—'}</dd></div><div><dt>Dernier contrôle physique</dt><dd>{a.lastSeenAt ? dateTime(a.lastSeenAt) : 'jamais'}</dd></div>
            {out && <><div><dt>Date de sortie</dt><dd>{date(a.exitDate)}</dd></div><div><dt>Motif de sortie</dt><dd>{a.exitReason}</dd></div></>}
          </dl>}
          {tab === 'acq' && <dl className="kv" style={{ margin: 0 }}>
            <div><dt>Mode d'entrée</dt><dd>{ENTRY_MODE[a.entryMode]}</dd></div><div><dt>Date d'acquisition</dt><dd>{date(a.acquisitionDate)}</dd></div>
            <div><dt>Mise en service</dt><dd>{date(a.inServiceDate)}</dd></div><div><dt>Fournisseur</dt><dd>{a.supplier ?? '—'}</dd></div>
            <div><dt>Facture</dt><dd>{a.invoiceRef ?? '—'}</dd></div><div><dt>Ordre d'entrée</dt><dd>{a.entryOrderNo ? <Mono>{a.entryOrderNo}</Mono> : '—'}</dd></div>
            <div><dt>Réception</dt><dd>{a.receptionId ? <Link to={`/receptions/${a.receptionId}`}>Voir le PV de réception</Link> : '—'}</dd></div>
          </dl>}
          {tab === 'val' && (a.schedule.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Exercice</th><th className="num">Dotation</th><th className="num">Cumul</th><th className="num">VNC fin d'exercice</th></tr></thead>
            <tbody>{a.schedule.map((l: Row) => <tr key={l.year} style={{ fontWeight: l.year === new Date().getFullYear() ? 700 : undefined }}><td>{l.year}</td><td className="num">{fcfa(l.dotation)}</td><td className="num">{fcfa(l.cumulative)}</td><td className="num">{fcfa(l.nbv)}</td></tr>)}</tbody></table></div>
            : <Note>Bien non amortissable ou pas encore mis en service.</Note>)}
          {tab === 'hist' && <ul className="list">{a.events.map((e: Row) => <li key={e.id}><span className="grow"><strong>{e.summary}</strong><span className="small muted">{dateTime(e.at)}{e.actor ? ` · ${e.actor}` : ''}</span></span>{e.documentNo && <Mono>{e.documentNo}</Mono>}</li>)}</ul>}
          {tab === 'mv' && (a.movements.length || a.disposals.length ? <ul className="list">
            {a.movements.map((m: Row) => <li key={m.id}><span className="grow"><Link to={`/mouvements/${m.id}`}><Mono>{m.number}</Mono></Link><span className="small muted">{MOVEMENT_TYPE[m.type]} · {date(m.createdAt)}</span></span><StatusPill map={MOVEMENT_STATUS} value={m.status} /></li>)}
            {a.disposals.map((d: Row) => <li key={d.id}><span className="grow"><Link to={`/reformes/${d.id}`}><Mono>{d.number}</Mono></Link><span className="small muted">Dossier de réforme</span></span><StatusPill map={DISPOSAL_STATUS} value={d.status} /></li>)}
          </ul> : <Note>Aucun mouvement enregistré pour ce bien.</Note>)}
        </div>
      </Card>
      <Documents objectType="BIEN" objectId={a.id} />
      {edit && <EditAsset a={a} onClose={() => setEdit(false)} />}
    </>
  );
}

function EditAsset({ a, onClose }: { a: Row; onClose: () => void }) {
  const [f, setF] = useState({ designation: a.designation, serialNumber: a.serialNumber ?? '', brand: a.brand ?? '', model: a.model ?? '', condition: a.condition, warrantyEnd: a.warrantyEnd ?? '', inServiceDate: a.inServiceDate ?? '' });
  const save = useAction(() => patch(`/biens/${a.id}`, {
    designation: f.designation, serialNumber: f.serialNumber || null, brand: f.brand || null, model: f.model || null, condition: f.condition, warrantyEnd: f.warrantyEnd || null,
    ...(!a.inServiceDate && f.inServiceDate ? { inServiceDate: f.inServiceDate } : {}),
  }), { success: 'Fiche mise à jour', invalidate: [['asset', String(a.id)], ['assets']], onDone: onClose });
  return (
    <Modal title={`Modifier ${a.code}`} onClose={onClose}>
      <Note>La localisation, le détenteur et le statut changent uniquement par un mouvement validé.</Note>
      <Field label="Désignation" htmlFor="d"><input id="d" className="input" value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
      <div className="grid" style={{ ['--min' as string]: '200px' }}>
        <Field label="N° de série" htmlFor="sn"><input id="sn" className="input" value={f.serialNumber} onChange={(e) => setF({ ...f, serialNumber: e.target.value })} /></Field>
        <Field label="État" htmlFor="co"><select id="co" className="input" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{Object.entries(CONDITION).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Marque" htmlFor="br"><input id="br" className="input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></Field>
        <Field label="Modèle" htmlFor="mo"><input id="mo" className="input" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
        <Field label="Fin de garantie" htmlFor="wa"><input id="wa" type="date" className="input" value={f.warrantyEnd} onChange={(e) => setF({ ...f, warrantyEnd: e.target.value })} /></Field>
        <Field label="Mise en service" htmlFor="is" hint={a.inServiceDate ? 'Fixée : se modifie par révision de valeur' : 'Point de départ des amortissements'}>
          <input id="is" type="date" className="input" value={f.inServiceDate} disabled={!!a.inServiceDate} onChange={(e) => setF({ ...f, inServiceDate: e.target.value })} /></Field>
      </div>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={save.isPending} onClick={() => save.mutate(undefined)}>Enregistrer</button></div>
    </Modal>
  );
}
