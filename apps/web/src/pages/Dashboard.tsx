import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, download } from '../api';
import { ACTION_LABELS, ASSET_STATUS, big, dateTime, fcfa, pct } from '../format';
import { Card, ErrorBox, Kpi, Loading, PageHead, useToast } from '../components/ui';
import type { Row } from '../types';

const STATUS_COLORS: Record<string, string> = { EN_SERVICE: '#1E7B4F', EN_STOCK: '#5B6775', EN_MAINTENANCE: '#C27C0E', EN_PRET: '#2F7DD1', EN_TRANSIT: '#6FA8E8', MANQUANT: '#B3261E', PROPOSE_REFORME: '#13294B' };
const LINKS: Record<string, string> = { RECEPTION: '/receptions', MOUVEMENT: '/mouvements', REFORME: '/reformes', DOTATION: '/valorisation', INVENTAIRE: '/inventaires', BIEN: '/biens' };

export function Dashboard() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<Row>('/tableau-de-bord') });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const c = d.control;
  const maxH = Math.max(...d.history.map((h: Row) => h.gross), 1);
  const maxC = Math.max(...d.byCategory.map((x: Row) => x.nbv), 1);
  const statusTotal = Object.values(d.byStatus as Record<string, number>).reduce((a, b) => a + b, 0) || 1;
  const tile = (label: string, value: string, note: string, to: string, tone: 'ok' | 'warn' | 'bad') => (
    <Link to={to} className="tile"><span className="k">{label}<span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)', marginTop: 4, flexShrink: 0 }} /></span>
      <span className="v" style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)' }}>{value}</span><span className="n">{note}</span></Link>
  );
  return (
    <>
      <PageHead title="Tableau de bord du patrimoine" sub={`Situation au ${new Date(d.asOf).toLocaleDateString('fr-FR')} · montants en FCFA`}
        actions={<><button className="btn" onClick={() => download(`/etats/registre.xlsx`, 'registre.xlsx').catch((e) => toast(e.message, 'bad'))}>Exporter le registre</button><Link to="/biens" className="btn primary">Voir le registre des biens</Link></>} />
      <section className="kpis" aria-label="Indicateurs clés">
        <Kpi label="Valeur brute" value={big(d.grossValue)} note={`${fcfa(d.grossValue)} FCFA`} />
        <Kpi label="Valeur nette comptable" value={big(d.nbv)} note={`${pct(d.grossValue ? d.nbv / d.grossValue : 0, 0)} de la valeur brute`} />
        <Kpi label="Biens actifs" value={fcfa(d.activeCount)} note={`dont ${fcfa(d.lowValueCount)} de faible valeur`} to="/biens" />
        <Kpi label="Taux de vétusté" value={pct(d.wearRate)} note="seuil d'alerte : 60 %" tone={d.wearRate > 0.6 ? 'warn' : undefined} />
        <Kpi label="Validations en attente" value={d.validations.pending} note={d.validations.late ? `dont ${d.validations.late} en retard` : 'aucune en retard'} tone={d.validations.pending ? 'warn' : undefined} to="/validations" />
      </section>
      <Card title="Fiabilité du registre et contrôle interne" extra={<span className="small muted">Ce que regardent en premier les auditeurs et la Cour des comptes</span>}>
        <div className="grid" style={{ ['--min' as string]: '210px' }}>
          {c.inventory ? tile("Couverture d'inventaire", pct(c.inventory.coverage), `${fcfa(c.inventory.found)} biens constatés sur ${fcfa(c.inventory.expected)} · ${c.inventory.number}`, `/inventaires/${c.inventory.id}`, c.inventory.coverage >= 0.98 ? 'ok' : 'warn')
            : tile("Couverture d'inventaire", '—', 'aucune campagne lancée', '/inventaires', 'warn')}
          {c.inventory && tile("Écarts d'inventaire ouverts", fcfa(c.inventory.openGaps), `sur ${fcfa(c.inventory.gaps)} écarts constatés`, `/inventaires/${c.inventory.id}/ecarts`, c.inventory.openGaps ? 'bad' : 'ok')}
          {tile('Biens manquants', fcfa(c.missing), 'statut Manquant après constat', '/biens?status=MANQUANT', c.missing ? 'bad' : 'ok')}
          {tile('Décharges non signées', fcfa(c.unsignedDischarges), 'signatures de détenteurs en attente', '/validations', c.unsignedDischarges ? 'warn' : 'ok')}
          {tile('Amortis encore en service', fcfa(c.fullyDepreciatedInService), 'valeur nulle au bilan, à surveiller', '/biens', 'warn')}
          {tile('Étiquettes non contrôlées', fcfa(c.labelsPending), 'pose non confirmée par scan', '/etiquettes', c.labelsPending ? 'warn' : 'ok')}
          {tile('Prêts échus', fcfa(c.overdueLoans), 'biens non restitués à la date prévue', '/mouvements?type=PRET', c.overdueLoans ? 'bad' : 'ok')}
          {tile('Garanties expirant sous 30 j', fcfa(c.warrantiesExpiring), 'faire réviser avant échéance', '/biens', c.warrantiesExpiring ? 'warn' : 'ok')}
        </div>
      </Card>
      <div className="grid" style={{ ['--min' as string]: '420px' }}>
        <Card title="Valeur brute et VNC sur 5 exercices" extra={<span className="legend" style={{ display: 'flex', gap: 14 }}><span><i style={{ background: '#1F5FAE' }} />Valeur brute</span><span><i style={{ background: '#8FB7E6' }} />VNC</span></span>}>
          <div className="bars" role="img" aria-label="Évolution de la valeur brute et de la VNC">
            {d.history.map((h: Row) => (
              <div className="col" key={h.year}>
                <span className="small muted">{big(h.gross).replace(' Md', '')} / {big(h.nbv).replace(' Md', '')}</span>
                <div className="pair"><span style={{ height: (h.gross / maxH) * 180, background: '#1F5FAE' }} /><span style={{ height: (h.nbv / maxH) * 180, background: '#8FB7E6' }} /></div>
              </div>
            ))}
          </div>
          <div className="bars" style={{ height: 'auto', border: 0 }}>{d.history.map((h: Row) => <span key={h.year} className="small muted" style={{ textAlign: 'center' }}>{h.year}</span>)}</div>
          <span className="small muted">En milliards de FCFA, au 31/12 de chaque exercice (à date pour l'exercice en cours).</span>
        </Card>
        <Card title="Répartition de la VNC par catégorie">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {d.byCategory.map((x: Row) => (
              <div className="hbar" key={x.label}><span>{x.label}</span><span className="track"><span style={{ width: `${(x.nbv / maxC) * 100}%` }} /></span><strong className="num">{big(x.nbv)} · {pct(d.nbv ? x.nbv / d.nbv : 0, 0)}</strong></div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid" style={{ ['--min' as string]: '420px' }}>
        <Card title="Biens par statut">
          <div className="stack" role="img" aria-label="Répartition des biens par statut">
            {Object.entries(d.byStatus as Record<string, number>).map(([k, n]) => <div key={k} style={{ width: `${(n / statusTotal) * 100}%`, background: STATUS_COLORS[k] ?? '#999' }} />)}
          </div>
          <div className="legend">
            {Object.entries(d.byStatus as Record<string, number>).map(([k, n]) => <Link key={k} to={`/biens?status=${k}`} style={{ color: 'inherit', textDecoration: 'none' }}><span><i style={{ background: STATUS_COLORS[k] }} />{ASSET_STATUS[k]?.[0] ?? k}<strong>{fcfa(n)}</strong></span></Link>)}
          </div>
        </Card>
        <Card title="Dernières opérations" extra={<Link to="/audit" className="small">Journal complet</Link>}>
          <ul className="list">
            {d.recent.map((r: Row, i: number) => (
              <li key={i}><span className="grow"><strong>{ACTION_LABELS[r.action] ?? r.action} · {r.objectRef}</strong><span className="small muted">{r.user} · {dateTime(r.at)}</span></span>
                {LINKS[r.objectType] && <Link to={LINKS[r.objectType]} className="small">Voir</Link>}</li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
