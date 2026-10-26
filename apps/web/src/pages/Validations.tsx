import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post } from '../api';
import { dateTime } from '../format';
import { Card, Empty, ErrorBox, Loading, Mono, PageHead, Pill, Tabs, useAction } from '../components/ui';
import type { Row } from '../types';

const TYPES: Record<string, string> = { MOUVEMENT: 'Mouvement', RECEPTION: 'Réception', REFORME: 'Réforme' };

export function Validations() {
  const [tab, setTab] = useState<'inbox' | 'history'>('inbox');
  const [sel, setSel] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('');
  const inbox = useQuery({ queryKey: ['validations'], queryFn: () => api<Row[]>('/validations') });
  const hist = useQuery({ queryKey: ['validations', 'history'], queryFn: () => api<Row[]>('/validations/historique'), enabled: tab === 'history' });
  const decide = useAction((v: { id: number; approve: boolean }) => post<Row>(`/validations/${v.id}/decision`, { approve: v.approve, comment: comment || undefined }), {
    success: (r) => (r.status === 'REJETE' ? 'Pièce rejetée' : r.status === 'APPROUVE' ? 'Validé : circuit terminé, la pièce est exécutée' : `Validé : transmis à l'étape « ${r.nextStep} »`),
    invalidate: [['validations'], ['dashboard'], ['notifications']], onDone: () => { setSel(null); setComment(''); },
  });
  const rows = (tab === 'inbox' ? inbox.data : hist.data) ?? [];
  const shown = rows.filter((r) => !filter || r.objectType === filter);
  const cur = shown.find((r) => r.id === sel) ?? (tab === 'inbox' ? shown[0] : undefined);
  return (
    <>
      <PageHead title="Validations" sub="Les pièces qui attendent votre décision dans les circuits de validation." />
      <Tabs label="Vues" value={tab} onChange={(v) => { setTab(v); setSel(null); }} items={[['inbox', `À valider (${inbox.data?.length ?? 0})`], ['history', 'Mes décisions']]} />
      {(inbox.error || hist.error) && <ErrorBox error={inbox.error ?? hist.error} />}
      <div className="split">
        <div className="wide">
          <Card pad={false} title={tab === 'inbox' ? 'Pièces à traiter' : 'Historique'} extra={
            <div className="chips">{[['', 'Tous types'], ['MOUVEMENT', 'Mouvements'], ['RECEPTION', 'Réceptions'], ['REFORME', 'Réformes']].map(([k, l]) =>
              <button key={k} type="button" className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>{l}</button>)}</div>}>
            {(tab === 'inbox' ? inbox.isLoading : hist.isLoading) ? <Loading /> : !shown.length ? <Empty>{tab === 'inbox' ? 'Aucune pièce en attente : tout est à jour.' : 'Aucune décision enregistrée.'}</Empty> : (
              <ul className="list" style={{ padding: '0 20px' }}>
                {shown.map((r) => (
                  <li key={r.id} style={{ cursor: tab === 'inbox' ? 'pointer' : undefined, background: cur?.id === r.id && tab === 'inbox' ? 'var(--accent-soft)' : undefined, margin: '0 -20px', padding: '12px 20px' }}
                    onClick={() => tab === 'inbox' && setSel(r.id)}>
                    <span className="grow"><Mono>{r.number}</Mono><strong>{r.title}</strong><span className="small muted">{TYPES[r.objectType]} · demandé par {r.requestedByName} · étape {r.step} sur {r.totalSteps} : {r.label}</span></span>
                    {tab === 'inbox' ? (r.late ? <Pill tone="bad">En retard</Pill> : <Pill tone="warn">Échéance {new Date(r.dueAt).toLocaleDateString('fr-FR')}</Pill>)
                      : <Pill tone={r.status === 'APPROUVE' ? 'ok' : 'bad'}>{r.status === 'APPROUVE' ? 'Validé' : 'Rejeté'} · {dateTime(r.decidedAt)}</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {tab === 'inbox' && cur && (
          <div className="narrow">
            <Card title="Décision">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><Mono>{cur.number}</Mono><strong style={{ fontSize: 17 }}>{cur.title}</strong><span className="muted small">{cur.subtitle}</span></div>
              <div className="note info">Étape {cur.step} sur {cur.totalSteps} : <strong>{cur.label}</strong></div>
              <Link to={cur.link} className="btn">Ouvrir la pièce complète</Link>
              <div className="field"><label htmlFor="cm">Commentaire (obligatoire en cas de rejet)</label><textarea id="cm" className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Motif, précisions pour le demandeur…" /></div>
              <div className="actions">
                <button className="btn success" disabled={decide.isPending} onClick={() => decide.mutate({ id: cur.id, approve: true })}>Approuver</button>
                <button className="btn danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: cur.id, approve: false })}>Rejeter</button>
              </div>
              <span className="small muted">Vous ne pouvez pas valider une pièce que vous avez créée (séparation des tâches).</span>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
