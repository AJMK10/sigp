import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { downloadPack, syncApi } from './api';
import { synchronize, SyncReport, unsent } from './sync';
import { AppData, emptyData } from './types';

const KEY = 'sigp.inventaire.v1';
export const uuid = () => Crypto.randomUUID();

interface Store {
  data: AppData | null;
  online: boolean;
  syncing: boolean;
  lastReport: SyncReport | null;
  update: (fn: (d: AppData) => AppData) => void;
  syncNow: () => Promise<SyncReport | null>;
  refreshPack: () => Promise<void>;
  /** État courant, y compris juste après une mise à jour (hors cycle de rendu). */
  get: () => AppData | null;
}
const Ctx = createContext<Store>(null as never);
export const useStore = () => useContext(Ctx);

/**
 * État de l'application, enregistré sur l'appareil à chaque modification : un constat saisi survit à la fermeture
 * de l'application, à une panne de batterie ou à une absence de réseau prolongée.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const ref = useRef<AppData | null>(null);
  const busy = useRef(false);
  const get = useCallback(() => ref.current, []);

  useEffect(() => {
    (async () => {
      let d: AppData | null = null;
      try { const raw = await AsyncStorage.getItem(KEY); if (raw) d = JSON.parse(raw) as AppData; } catch { /* stockage illisible : on repart d'un état vide */ }
      const def = (Constants.expoConfig?.extra as { defaultApiUrl?: string } | undefined)?.defaultApiUrl || (Platform.OS === 'web' ? '/api' : '');
      ref.current = d ?? emptyData(uuid(), def);
      setData(ref.current);
    })();
  }, []);

  const persist = useCallback((d: AppData) => {
    ref.current = d;
    setData(d);
    AsyncStorage.setItem(KEY, JSON.stringify(d)).catch(() => {});
  }, []);
  const update = useCallback((fn: (d: AppData) => AppData) => { if (ref.current) persist(fn(ref.current)); }, [persist]);

  const syncNow = useCallback(async () => {
    const d = ref.current;
    if (!d?.session || busy.current) return null;
    busy.current = true; setSyncing(true);
    try {
      const { data: next, report } = await synchronize(d, syncApi(d.session));
      // Les constats saisis pendant la synchronisation sont conservés.
      const cur = ref.current!;
      const known = new Set(next.counts.map((k) => k.clientId));
      persist({ ...next, counts: [...next.counts, ...cur.counts.filter((k) => !known.has(k.clientId))], photos: [...next.photos, ...cur.photos.filter((p) => !next.photos.some((x) => x.photoId === p.photoId))],
        session: report.authExpired ? null : cur.session });
      setLastReport(report);
      return report;
    } finally { busy.current = false; setSyncing(false); }
  }, [persist]);

  const refreshPack = useCallback(async () => {
    const d = ref.current;
    if (!d?.session) return;
    const pack = await downloadPack(d.session);
    update((x) => ({ ...x, pack }));
  }, [update]);

  // Synchronisation automatique au retour du réseau et au retour au premier plan.
  // L'accès est vérifié auprès du serveur SIGP lui-même (un intranet peut bloquer les adresses publiques).
  const server = data?.session?.server ?? data?.server ?? '';
  useEffect(() => {
    if (server) NetInfo.configure({ reachabilityUrl: `${server}/sante`, reachabilityTest: async (r) => r.status === 200, reachabilityShortTimeout: 15_000, reachabilityLongTimeout: 120_000, reachabilityRequestTimeout: 8_000 });
    const off = NetInfo.addEventListener((s) => {
      // Connecté à un réseau suffit pour tenter l'envoi : s'il échoue, les constats restent simplement en file.
      const on = !!s.isConnected;
      setOnline(on);
      if (on && ref.current && unsent(ref.current) > 0) syncNow().catch(() => {});
    });
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active' && ref.current && unsent(ref.current) > 0) syncNow().catch(() => {}); });
    // Navigateur : les événements online/offline sont immédiats.
    const onWeb = (on: boolean) => () => { setOnline(on); if (on && ref.current && unsent(ref.current) > 0) syncNow().catch(() => {}); };
    const up = onWeb(true), down = onWeb(false);
    if (Platform.OS === 'web' && typeof window !== 'undefined') { window.addEventListener('online', up); window.addEventListener('offline', down); }
    return () => { off(); sub.remove(); if (Platform.OS === 'web' && typeof window !== 'undefined') { window.removeEventListener('online', up); window.removeEventListener('offline', down); } };
  }, [syncNow, server]);

  return <Ctx.Provider value={{ data, online, syncing, lastReport, update, syncNow, refreshPack, get }}>{children}</Ctx.Provider>;
}
