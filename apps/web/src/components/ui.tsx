import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { ApiError } from '../api';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'grey' | 'navy';
export const Pill = ({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>;
export const StatusPill = ({ map, value }: { map: Record<string, [string, Tone]>; value: string }) => {
  const [l, t] = map[value] ?? [value, 'grey'];
  return <Pill tone={t}>{l}</Pill>;
};
export const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
export function Card({ title, extra, children, pad = true, foot }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; pad?: boolean; foot?: ReactNode }) {
  if (!pad) return (
    <section className="card">
      {title && <div className="card-head"><h2>{title}</h2>{extra}</div>}
      {children}
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  );
  return (
    <section className="card pad">
      {title && <div className="page-head" style={{ alignItems: 'center' }}><h2>{title}</h2>{extra}</div>}
      {children}
      {foot}
    </section>
  );
}
export function Kpi({ label, value, note, tone, to }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'warn' | 'bad'; to?: string }) {
  const body = <><span className="label">{label}</span><span className="value">{value}</span>{note && <span className="kpi-note">{note}</span>}</>;
  return to ? <Link to={to} className={`card kpi ${tone ?? ''}`}>{body}</Link> : <div className={`card kpi ${tone ?? ''}`}>{body}</div>;
}
export const Note = ({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) => <div className={`note ${tone}`}>{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;
export const Loading = () => <div className="empty">Chargement…</div>;
export const ErrorBox = ({ error }: { error: unknown }) => <Note tone="bad">{error instanceof Error ? error.message : 'Erreur inattendue'}</Note>;

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}{hint && <small>{hint}</small>}</div>;
}
export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: [T, ReactNode][]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={value === k} className={`tab ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
export function SubNav({ items, current }: { items: [string, string][]; current: string }) {
  return (
    <nav className="tabs" aria-label="Sous-navigation">
      {items.map(([to, l]) => <Link key={to} to={to} className={`tab ${current === to ? 'active' : ''}`} aria-current={current === to ? 'page' : undefined}>{l}</Link>)}
    </nav>
  );
}
export function RadioCards<T extends string>({ value, onChange, items, label, min = 140 }: { value: T; onChange: (v: T) => void; items: [T, string][]; label: string; min?: number }) {
  return (
    <div className="radio-cards" role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {items.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} className={`radio-card ${value === k ? 'active' : ''}`} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ ['--w' as string]: `${width ?? 560}px` }}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="x" aria-label="Fermer" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <button type="button" className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
      <span className="small muted">Page {page} sur {pages}</span>
      <button type="button" className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button>
    </div>
  );
}
export function Steps({ steps }: { steps: { id: number; step: number; label: string; status: string; decidedBy?: string | null; decidedAt?: string | null; comment?: string | null }[] }) {
  return (
    <ol className="steps" aria-label="Circuit de validation">
      {steps.map((s) => {
        const cls = s.status === 'APPROUVE' ? 'ok' : s.status === 'EN_COURS' ? 'cur' : s.status === 'REJETE' ? 'bad' : '';
        return (
          <li key={s.id}>
            <span className={`step-dot ${cls}`} aria-hidden="true">{s.status === 'APPROUVE' ? '✓' : s.status === 'REJETE' ? '×' : s.step}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <strong style={{ fontSize: 14, color: s.status === 'EN_COURS' ? 'var(--accent-ink)' : undefined }}>{s.label}</strong>
              <span className="small muted">{s.decidedBy ? `${s.decidedBy} · ${new Date(s.decidedAt!).toLocaleDateString('fr-FR')}` : s.status === 'EN_COURS' ? 'En attente' : s.status === 'ANNULE' ? 'Annulée' : 'À venir'}</span>
              {s.comment && s.comment !== 'Conforme' && <span className="small">« {s.comment} »</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
export function QR({ value, size = 96 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(value, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc('')); }, [value, size]);
  return src ? <img src={src} alt={`QR code ${value}`} width={size} height={size} /> : <span style={{ width: size, height: size }} />;
}

/* Notifications éphémères */
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; tone: 'ok' | 'bad' } | null>(null);
  const show = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => { setT({ msg, tone }); setTimeout(() => setT(null), 4500); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={`toast ${t.tone}`} role="status">{t.msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Mutation avec message de succès, message d'erreur et invalidation du cache. */
export function useAction<V, R = unknown>(fn: (v: V) => Promise<R>, opts: { success?: string | ((r: R) => string); invalidate?: string[][]; onDone?: (r: R) => void } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      opts.onDone?.(r);
    },
    onError: (e) => toast(e instanceof ApiError || e instanceof Error ? e.message : 'Erreur', 'bad'),
  });
}
