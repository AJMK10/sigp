import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, post, setUnauthorizedHandler, token } from './api';

export interface Me { id: number; email: string; fullName: string; title: string | null; role: string; roleLabel: string; permissions: string[]; orgUnit: string | null; entity: { code: string; name: string } }
interface AuthCtx { me: Me | null; loading: boolean; login: (email: string, password: string) => Promise<void>; logout: () => void; can: (...p: string[]) => boolean }
const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!token.get());
  const logout = useCallback(() => { token.set(null); setMe(null); }, []);
  useEffect(() => { setUnauthorizedHandler(logout); }, [logout]);
  useEffect(() => {
    if (!token.get()) return;
    api<Me>('/auth/me').then(setMe).catch(() => token.set(null)).finally(() => setLoading(false));
  }, []);
  const login = async (email: string, password: string) => {
    const r = await post<{ token: string; user: Me }>('/auth/login', { email, password });
    token.set(r.token); setMe(r.user);
  };
  const can = (...p: string[]) => !!me && p.some((x) => me.permissions.includes(x));
  return <Ctx.Provider value={{ me, loading, login, logout, can }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
