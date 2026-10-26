import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { closeZone } from '../core/api';
import { findZone, zoneStats } from '../core/inventory';
import { useStore } from '../core/store';
import { unsent } from '../core/sync';
import { Banner, Btn, C, Card, Header, Progress, s } from '../ui/kit';
import { SignatureHandle, SignaturePad } from '../ui/SignaturePad';

/** Synchronisation et clôture de zone (bilan, transmission, signature du chef d'équipe). */
export function Sync({ zoneId, onBack, onFix, onZones }: { zoneId: number | null; onBack?: () => void; onFix: (zoneId: number, code: string) => void; onZones: () => void }) {
  const { data, online, syncing, lastReport, syncNow, refreshPack, update, get } = useStore();
  const sig = useRef<SignatureHandle>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  if (!data?.pack) return null;
  const z = zoneId ? findZone(data.pack, zoneId) : null;
  const st = zoneId ? zoneStats(data, zoneId) : null;
  const pendingAll = unsent(data);
  const refused = data.counts.filter((k) => k.state === 'REFUSE' || k.state === 'CONFLIT');
  const closed = !!z && (z.zone.status === 'TERMINEE' || data.closedZones.includes(z.zone.id));
  const photos = data.photos.filter((p) => p.state === 'PENDING').length;
  const total = data.counts.length + data.photos.length;
  const done = total - pendingAll;

  const sync = async () => {
    setMsg(null);
    const r = await syncNow();
    if (!r) return;
    if (r.authExpired) setMsg({ tone: 'warn', text: r.error ?? 'Session expirée' });
    else if (r.error) setMsg({ tone: 'bad', text: `${r.error}. Rien n'est perdu : réessayez quand le réseau revient.` });
    else setMsg({ tone: r.refused ? 'warn' : 'ok', text: `${r.accepted} constat(s) transmis${r.photos ? `, ${r.photos} photo(s)` : ''}${r.refused ? ` · ${r.refused} refusé(s) à corriger` : ''}.` });
  };

  const close = async () => {
    if (!z || !data.session) return;
    setMsg(null);
    if (sig.current?.isEmpty()) { setMsg({ tone: 'warn', text: 'La signature du chef d\'équipe est requise pour clôturer la zone.' }); return; }
    setBusy(true);
    try {
      const r = await syncNow();
      if (r?.error) throw new Error(`${r.error}. La zone n'est pas clôturée : réessayez avec du réseau.`);
      const cur = get()!;
      const fresh = zoneStats(cur, z.zone.id);
      if (fresh.refused) throw new Error(`${fresh.refused} constat(s) refusé(s) : corrigez-les avant la clôture.`);
      if (fresh.pending || cur.photos.some((p) => p.state === 'PENDING' && cur.counts.some((k) => k.clientId === p.clientId && k.zoneId === z.zone.id)))
        throw new Error("Des éléments de la zone n'ont pas pu être transmis : réessayez avec un meilleur réseau.");
      const png = await sig.current!.toPng();
      if (!png) throw new Error('Signature illisible : recommencez.');
      await closeZone(data.session, z.zone.id, png);
      update((d) => ({ ...d, closedZones: [...new Set([...d.closedZones, z.zone.id])] }));
      setMsg({ tone: 'ok', text: 'Zone clôturée et synchronisée. Les écarts sont transmis au gestionnaire.' });
      refreshPack().catch(() => {});
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(false); }
  };

  return (
    <View style={s.screen}>
      <Header title={z ? 'Clôture de zone' : 'Synchronisation'} sub={z ? z.zone.name.split(' › ').slice(-2).join(' · ') : `${pendingAll} élément(s) à transmettre`} onBack={onBack} />
      <ScrollView contentContainerStyle={s.body}>
        {!z && <Banner>Choisissez une zone dans l'onglet Zones pour en faire le bilan et la clôturer.</Banner>}
        {z && st && <Card style={{ gap: 10 }}>
          <Text style={s.h2}>Bilan de la zone</Text>
          {([['Biens attendus', st.expected, C.fg], ['Constatés conformes', st.conform, C.ok], ['Mauvais état', st.bad, C.warn],
            ...(st.missing != null ? [['Non trouvés', st.missing, C.bad]] : [['Restant à constater', Math.max(0, st.expected - st.counted), C.bad]]), ['Excédents (non référencés)', st.surplus, C.bad]] as [string, number, string][]).map(([l, v, col]) => (
            <View key={l} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 14, color: C.fg }}>{l}</Text><Text style={{ fontSize: 14, fontWeight: '700', color: col }}>{v}</Text></View>))}
        </Card>}
        {z && st && !closed && (st.missing ?? st.expected - st.counted) > 0 && <Banner tone="warn">{st.missing ?? st.expected - st.counted} bien(s) non trouvé(s) seront signalés en écart. Un second passage reste possible tant que la campagne est ouverte.</Banner>}
        <Card style={{ gap: 10 }}>
          <Text style={s.h2}>Synchronisation</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Progress value={total ? done / total : 1} height={8} /><Text style={{ fontSize: 13, color: C.fg }}>{total ? Math.round((done / total) * 100) : 100} %</Text>
          </View>
          <Text accessibilityLiveRegion="polite" style={{ fontSize: 13, color: C.muted2 }}>
            {syncing ? 'Transmission en cours…' : pendingAll ? `En attente : ${data.counts.filter((k) => k.state === 'PENDING').length} constat(s) et ${photos} photo(s) enregistrés sur l'appareil.` : 'Tout est transmis.'}
            {!online ? ' Pas de réseau pour le moment.' : ''}
          </Text>
          <Text style={{ fontSize: 12, color: C.muted }}>{data.counts.length} constat(s) · {data.photos.length} photo(s){data.lastSyncAt ? ` · dernière synchro ${new Date(data.lastSyncAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''}</Text>
          {!z && <Btn label="Synchroniser maintenant" kind="secondary" busy={syncing} disabled={!pendingAll} onPress={sync} />}
          {lastReport?.authExpired && !data.session && <Banner tone="warn">Session expirée : reconnectez-vous pour transmettre.</Banner>}
        </Card>
        {refused.length > 0 && <Card style={{ gap: 8 }}>
          <Text style={s.h2}>À corriger ({refused.length})</Text>
          {refused.map((k) => (
            <Pressable key={k.clientId} accessibilityRole="button" onPress={() => onFix(k.zoneId, k.code)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.lineSoft, gap: 2 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: C.fg }}>{k.designation || k.code}</Text>
              <Text style={{ fontSize: 13, color: C.bad }}>{k.message}</Text>
            </Pressable>))}
        </Card>}
        {z && !closed && <View style={{ gap: 6 }}>
          <Text style={s.label}>Signature du chef d'équipe</Text>
          <SignaturePad ref={sig} signer={data.pack.user.fullName} />
        </View>}
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        {z && closed && <Btn label="Retour aux zones" kind="secondary" onPress={onZones} />}
      </ScrollView>
      {z && !closed && <View style={{ padding: 16, paddingBottom: 28, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
        <Btn label="Clôturer et synchroniser" busy={busy || syncing} disabled={!online || !data.session} onPress={close} />
        {(!online || !data.session) && <Text style={{ fontSize: 12, color: C.muted, marginTop: 6, textAlign: 'center' }}>{!data.session ? 'Reconnectez-vous pour clôturer.' : 'La clôture demande du réseau ; le comptage, lui, continue sans.'}</Text>}
      </View>}
      {z && closed && <View style={{ padding: 16, paddingBottom: 28, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}><Btn label="Zone clôturée ✓" kind="success" disabled onPress={() => {}} /></View>}
    </View>
  );
}
