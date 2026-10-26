import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, download } from '../api';
import { ASSET_STATUS, fcfa, pct } from '../format';
import { useCategories, useLocations } from '../refs';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, Loading, Mono, PageHead, Pager, StatusPill, useToast } from '../components/ui';
import type { Paged } from '../types';

export function Biens() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const cats = useCategories();
  const locs = useLocations();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const params = Object.fromEntries(sp.entries());
  const page = Number(sp.get('page') ?? 1);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const query = new URLSearchParams({ ...params, page: String(page), pageSize: '25' }).toString();
  const list = useQuery({ queryKey: ['assets', query], queryFn: () => api<Paged>(`/biens?${query}`), placeholderData: keepPreviousData });
  return (
    <>
      <PageHead title="Registre des biens" sub={list.data ? `${fcfa(list.data.total)} biens · valeur brute ${fcfa(list.data.grossValue)} FCFA` : 'Chargement du registre…'}
        actions={<>
          <button className="btn" onClick={() => download('/etats/registre.xlsx', 'registre-immobilisations.xlsx').catch((e) => toast(e.message, 'bad'))}>Exporter (Excel)</button>
          {can('receptions.write') && <Link to="/receptions/nouvelle" className="btn">Nouvelle réception</Link>}
          {can('assets.write') && <Link to="/biens/nouveau" className="btn primary">Entrée manuelle</Link>}
        </>} />
      <Card>
        <form className="grid" style={{ ['--min' as string]: '190px' }} onSubmit={(e) => { e.preventDefault(); set('q', q); }}>
          <div className="field"><label htmlFor="q">Recherche</label><input id="q" className="input" placeholder="Code, désignation, n° de série" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => set('q', q)} /></div>
          <div className="field"><label htmlFor="st">Statut</label><select id="st" className="input" value={params.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Tous (hors sortis)</option>{Object.entries(ASSET_STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="ca">Catégorie</label><select id="ca" className="input" value={params.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">Toutes</option>{cats.data?.filter((c) => c.code !== '2').map((c) => <option key={c.id} value={c.id}>{c.code} · {c.label}</option>)}</select></div>
          <div className="field"><label htmlFor="lo">Localisation</label><select id="lo" className="input" value={params.locationId ?? ''} onChange={(e) => set('locationId', e.target.value)}>
            <option value="">Toutes</option>{locs.data?.filter((l) => l.kind !== 'LOCAL').map((l) => <option key={l.id} value={l.id}>{l.path}</option>)}</select></div>
        </form>
      </Card>
      {list.error && <ErrorBox error={list.error} />}
      <Card pad={false} foot={list.data && <><span>{fcfa(list.data.total)} résultat(s)</span><Pager page={page} pageSize={25} total={list.data.total} onPage={(p) => set('page', String(p))} /></>}>
        {list.isLoading ? <Loading /> : !list.data?.items.length ? <Empty>Aucun bien ne correspond à ces critères.</Empty> : (
          <div className="table-wrap">
            <table className="t" style={{ minWidth: 980 }}>
              <thead><tr><th>Code</th><th>Désignation</th><th>Catégorie</th><th>Localisation</th><th>Détenteur</th><th className="num">Valeur d'origine</th><th className="num">VNC</th><th className="num">Vétusté</th><th>Statut</th></tr></thead>
              <tbody>
                {list.data.items.map((a) => (
                  <tr key={a.id} className="click" onClick={() => nav(`/biens/${a.id}`)}>
                    <td><Link to={`/biens/${a.id}`} onClick={(e) => e.stopPropagation()}><Mono>{a.code}</Mono></Link></td>
                    <td>{a.designation}</td><td className="small">{a.category}</td><td className="small">{a.location ?? '—'}</td><td className="small">{a.holder ?? a.orgUnit ?? '—'}</td>
                    <td className="num">{fcfa(a.acquisitionValue)}</td><td className="num">{fcfa(a.nbv)}</td><td className="num">{pct(a.wear, 0)}</td><td><StatusPill map={ASSET_STATUS} value={a.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
