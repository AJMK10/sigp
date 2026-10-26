/** Client HTTP de l'API SIGP : jeton porteur, erreurs lisibles, téléchargements authentifiés. */
const BASE = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ?? '/api';
const TOKEN_KEY = 'sigp.token';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const token = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* stockage indisponible */ } },
};
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method: init.method ?? 'GET', headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join(' ; ') : j.message ?? msg; } catch { /* corps non JSON */ }
    throw new ApiError(res.status, msg);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : (res.text() as unknown)) as Promise<T>;
}
export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });

/** Télécharge (ou ouvre, pour un PDF) un fichier produit par l'API. */
export async function download(path: string, filename: string, open = false) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token.get() ?? ''}` } });
  if (!res.ok) { let m = `Erreur ${res.status}`; try { m = (await res.json()).message ?? m; } catch { /* */ } throw new ApiError(res.status, m); }
  const url = URL.createObjectURL(await res.blob());
  if (open) window.open(url, '_blank');
  else { const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Envoi multipart (pièces jointes de la GED). */
export async function upload<T = unknown>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token.get() ?? ''}` }, body: form });
  if (res.status === 401) onUnauthorized();
  if (!res.ok) { let m = `Erreur ${res.status}`; try { const j = await res.json(); m = Array.isArray(j.message) ? j.message.join(' ; ') : j.message ?? m; } catch { /* */ } throw new ApiError(res.status, m); }
  return res.json() as Promise<T>;
}
