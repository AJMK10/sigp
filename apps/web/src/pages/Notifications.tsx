import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, post } from '../api';
import { dateTime } from '../format';
import { Card, Empty, Loading, PageHead, useAction } from '../components/ui';
import type { Row } from '../types';

const DOT: Record<string, string> = { ok: '#2E8B57', warn: '#C27C0E', bad: '#B3261E', info: '#2F7DD1' };
export function Notifications() {
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; items: Row[] }>('/notifications') });
  const readAll = useAction(() => post('/notifications/lues'), { invalidate: [['notifications']], success: 'Toutes les notifications sont marquées comme lues' });
  const readOne = useAction((id: number) => post(`/notifications/${id}/lue`), { invalidate: [['notifications']] });
  return (
    <>
      <PageHead title="Notifications" sub="Ce qui demande votre action et ce qui arrive à échéance." actions={<button className="btn" onClick={() => readAll.mutate(undefined)} disabled={!q.data?.unread}>Tout marquer comme lu</button>} />
      <Card pad={false}>
        {q.isLoading ? <Loading /> : !q.data?.items.length ? <Empty>Aucune notification.</Empty> : (
          <ul className="list">
            {q.data.items.map((n) => (
              <li key={n.id} style={{ padding: '14px 20px', alignItems: 'flex-start', background: n.readAt ? undefined : 'var(--accent-soft)' }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', marginTop: 6, background: DOT[n.kind] ?? DOT.info }} />
                <span className="grow"><strong>{n.title}</strong><span>{n.body}</span><span className="small muted">{dateTime(n.createdAt)}</span></span>
                {n.link && <Link to={n.link} onClick={() => !n.readAt && readOne.mutate(n.id)}>Ouvrir</Link>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
