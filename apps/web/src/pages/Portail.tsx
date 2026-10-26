import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, patch, post } from '../api';
import { ASSET_STATUS, CONDITION, REQUEST_STATUS, date } from '../format';
import { useAuth } from '../auth';
import { Card, Empty, Field, Loading, Modal, Mono, Note, PageHead, RadioCards, StatusPill, useAction } from '../components/ui';
import type { Row } from '../types';

const REQ: [string, string][] = [['PANNE', 'Signaler une panne'], ['PERTE', 'Déclarer une perte ou un vol'], ['EQUIPEMENT', 'Demander un équipement'], ['RESTITUTION', 'Restituer un bien']];
const REQ_NOTE: Record<string, string> = { PANNE: 'Le service compétent est notifié. Délai de prise en charge visé : 48 h ouvrées.', PERTE: "Joignez la déclaration de perte ou le récépissé de plainte au gestionnaire. Le bien sera instruit avant tout changement de statut.",
  EQUIPEMENT: 'La demande suit le circuit de validation de votre service puis du gestionnaire du patrimoine.', RESTITUTION: 'Un rendez-vous de restitution vous sera proposé ; un PV de reprise sera signé des deux côtés.' };

export function Portail() {
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['portal'], queryFn: () => api<Row>('/portail') });
  const [type, setType] = useState('PANNE');
  const [assetId, setAssetId] = useState('');
  const [desc, setDesc] = useState('');
  const [dispute, setDispute] = useState(false);
  const send = useAction(() => post('/portail/demandes', { type, assetId: assetId ? Number(assetId) : null, description: desc }), { success: 'Demande envoyée', invalidate: [['portal']], onDone: () => setDesc('') });
  if (q.isLoading) return <Loading />;
  const d = q.data!;
  return (
    <>
      <PageHead title={`Bonjour, ${me?.fullName}`} sub={`${me?.orgUnit ?? ''} · vous êtes responsable de ${d.assets.length} bien(s).`} />
      {d.attestation && (d.attestation.signedAt
        ? <Note tone="ok">Attestation de détention signée le {date(d.attestation.signedAt)} pour la campagne {d.attestation.campaign}{d.attestation.disputed ? ' (avec un écart signalé)' : ''}.</Note>
        : <section className="note warn" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
            <span style={{ flex: '1 1 360px' }}><strong>Attestation de détention à signer</strong><br />Campagne {d.attestation.campaign} : confirmez que les biens ci-dessous sont bien en votre possession avant le {date(d.attestation.endDate)}.</span>
            <button className="btn" onClick={() => setDispute(true)}>Signaler un écart</button><AttestButton campaignId={d.attestation.campaignId} />
          </section>)}
      <div className="split">
        <div className="wide">
          <Card pad={false} title={`Mes biens · ${d.assets.length}`}>
            {!d.assets.length ? <Empty>Aucun bien ne vous est affecté.</Empty> : <ul className="list" style={{ padding: '0 20px' }}>
              {d.assets.map((a: Row) => <li key={a.id}><span className="grow"><strong>{a.designation}</strong><span className="small muted"><Mono>{a.code}</Mono> · {a.location ?? '—'} · état {CONDITION[a.condition].toLowerCase()}</span></span><StatusPill map={ASSET_STATUS} value={a.status} /></li>)}
            </ul>}
          </Card>
          <Card pad={false} title="Mes demandes">
            {!d.requests.length ? <Empty>Aucune demande.</Empty> : <ul className="list" style={{ padding: '0 20px' }}>
              {d.requests.map((r: Row) => <li key={r.id}><span className="grow"><strong>{r.typeLabel} · <Mono>{r.number}</Mono></strong><span className="small muted">{r.description}</span>{r.response && <span className="small">Réponse : {r.response}</span>}</span><StatusPill map={REQUEST_STATUS} value={r.status} /></li>)}
            </ul>}
          </Card>
        </div>
        <div className="narrow">
          <Card title="Nouvelle demande">
            <RadioCards label="Type de demande" value={type} onChange={setType} items={REQ} min={140} />
            {type !== 'EQUIPEMENT' && <Field label="Bien concerné" htmlFor="b"><select id="b" className="input" value={assetId} onChange={(e) => setAssetId(e.target.value)}><option value="">Choisir…</option>{d.assets.map((a: Row) => <option key={a.id} value={a.id}>{a.designation} · {a.code}</option>)}</select></Field>}
            <Field label="Description" htmlFor="ds"><textarea id="ds" className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
            <span className="small muted">{REQ_NOTE[type]}</span>
            <button className="btn primary" disabled={desc.length < 5 || (type !== 'EQUIPEMENT' && !assetId) || send.isPending} onClick={() => send.mutate(undefined)}>Envoyer la demande</button>
          </Card>
        </div>
      </div>
      {dispute && d.attestation && <Dispute campaignId={d.attestation.campaignId} onClose={() => setDispute(false)} />}
    </>
  );
}
function AttestButton({ campaignId }: { campaignId: number }) {
  const act = useAction(() => post('/portail/attestation', { campaignId, disputed: false }), { success: 'Attestation signée', invalidate: [['portal']] });
  return <button className="btn primary" disabled={act.isPending} onClick={() => act.mutate(undefined)}>Signer l'attestation</button>;
}
function Dispute({ campaignId, onClose }: { campaignId: number; onClose: () => void }) {
  const [c, setC] = useState('');
  const act = useAction(() => post('/portail/attestation', { campaignId, disputed: true, comment: c }), { success: 'Écart signalé au gestionnaire', invalidate: [['portal']], onDone: onClose });
  return <Modal title="Signaler un écart" onClose={onClose}><Field label="Décrivez l'écart (bien absent, bien en plus, état différent…)" htmlFor="c"><textarea id="c" className="input" rows={4} value={c} onChange={(e) => setC(e.target.value)} /></Field>
    <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={c.length < 5 || act.isPending} onClick={() => act.mutate(undefined)}>Signer avec réserve</button></div></Modal>;
}

export function Demandes() {
  const q = useQuery({ queryKey: ['requests'], queryFn: () => api<Row[]>('/portail/demandes') });
  const [sel, setSel] = useState<Row | null>(null);
  return (
    <>
      <PageHead title="Demandes des détenteurs" sub="Pannes, pertes, besoins d'équipement et restitutions signalés depuis le portail." />
      <Card pad={false}>
        {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Aucune demande.</Empty> : <div className="table-wrap"><table className="t" style={{ minWidth: 800 }}>
          <thead><tr><th>Demande</th><th>Type</th><th>Détenteur</th><th>Bien</th><th>Description</th><th>Date</th><th>Statut</th><th /></tr></thead>
          <tbody>{q.data.map((r) => <tr key={r.id}><td><Mono>{r.number}</Mono></td><td>{r.typeLabel}</td><td>{r.by}</td><td>{r.code ? <Mono>{r.code}</Mono> : '—'}</td><td className="small">{r.description}</td><td className="small">{date(r.createdAt)}</td>
            <td><StatusPill map={REQUEST_STATUS} value={r.status} /></td><td>{['OUVERTE', 'EN_COURS'].includes(r.status) && <button className="btn small" onClick={() => setSel(r)}>Répondre</button>}</td></tr>)}</tbody>
        </table></div>}
      </Card>
      {sel && <Answer r={sel} onClose={() => setSel(null)} />}
    </>
  );
}
function Answer({ r, onClose }: { r: Row; onClose: () => void }) {
  const [status, setStatus] = useState('TRAITEE');
  const [response, setResponse] = useState('');
  const act = useAction(() => patch(`/portail/demandes/${r.id}`, { status, response }), { success: 'Réponse envoyée au détenteur', invalidate: [['requests']], onDone: onClose });
  return (
    <Modal title={`Répondre à ${r.number}`} onClose={onClose}>
      <Note>{r.typeLabel} · {r.by} : « {r.description} »</Note>
      <RadioCards label="Statut" value={status} onChange={setStatus} items={[['EN_COURS', 'En cours'], ['TRAITEE', 'Traitée'], ['REJETEE', 'Rejetée']]} />
      <Field label="Réponse" htmlFor="rp"><textarea id="rp" className="input" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} /></Field>
      <div className="actions" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Annuler</button><button className="btn primary" disabled={response.length < 2 || act.isPending} onClick={() => act.mutate(undefined)}>Envoyer</button></div>
    </Modal>
  );
}
