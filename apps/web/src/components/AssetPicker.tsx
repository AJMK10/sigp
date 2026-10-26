import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ASSET_STATUS, fcfa } from '../format';
import { Mono, StatusPill } from './ui';
import type { Paged, Row } from '../types';

/** Sélection de biens dans le registre (recherche + cases à cocher). Les biens choisis restent affichés. */
export function AssetPicker({ value, onChange, statuses, initialIds }: { value: Row[]; onChange: (rows: Row[]) => void; statuses?: string; initialIds?: number[] }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(t); }, [q]);
  const params = new URLSearchParams({ pageSize: '12', ...(debounced ? { q: debounced } : {}), ...(statuses ? { status: statuses } : {}) }).toString();
  const res = useQuery({ queryKey: ['assets', 'picker', params], queryFn: () => api<Paged>(`/biens?${params}`), placeholderData: keepPreviousData });
  useEffect(() => {
    if (!initialIds?.length || value.length) return;
    Promise.all(initialIds.map((id) => api<Row>(`/biens/${id}`))).then((rows) => onChange(rows)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const has = (id: number) => value.some((v) => v.id === id);
  const toggle = (a: Row) => onChange(has(a.id) ? value.filter((v) => v.id !== a.id) : [...value, a]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="field"><label htmlFor="pick-q">Rechercher un bien</label><input id="pick-q" className="input" placeholder="Code, désignation ou n° de série" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="table-wrap" style={{ border: '1px solid var(--line-soft)', borderRadius: 8 }}>
        <table className="t" style={{ minWidth: 620 }}>
          <thead><tr><th /><th>Code</th><th>Désignation</th><th>Localisation</th><th className="num">Valeur</th><th>Statut</th></tr></thead>
          <tbody>{(res.data?.items ?? []).map((a) => (
            <tr key={a.id} className={`click ${has(a.id) ? 'sel' : ''}`} onClick={() => toggle(a)}>
              <td><input type="checkbox" aria-label={`Choisir ${a.code}`} checked={has(a.id)} onChange={() => toggle(a)} onClick={(e) => e.stopPropagation()} /></td>
              <td><Mono>{a.code}</Mono></td><td>{a.designation}</td><td className="small" title={a.location ?? ''}>{a.location ? a.location.split(' › ').slice(-2).join(' › ') : '—'}</td><td className="num">{fcfa(a.acquisitionValue)}</td><td><StatusPill map={ASSET_STATUS} value={a.status} /></td>
            </tr>))}
            {res.data && !res.data.items.length && <tr><td colSpan={6} className="muted">Aucun bien éligible ne correspond.</td></tr>}
          </tbody>
        </table>
      </div>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <strong>{value.length} bien(s) sélectionné(s) · {fcfa(value.reduce((s, a) => s + a.acquisitionValue, 0))} FCFA</strong>
          <div className="chips">{value.map((a) => <button key={a.id} type="button" className="chip active" onClick={() => toggle(a)} aria-label={`Retirer ${a.code}`}>{a.code} ×</button>)}</div>
        </div>
      )}
    </div>
  );
}
