import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { totals, zoneStats } from '../core/inventory';
import { useStore } from '../core/store';
import { Banner, C, Header, Pill, Progress, s } from '../ui/kit';

const STATUS = { A_FAIRE: ['À faire', 'grey'], EN_COURS: ['En cours', 'info'], TERMINEE: ['Terminée', 'ok'] } as const;

export function Zones({ onOpen, onSettings }: { onOpen: (zoneId: number) => void; onSettings: () => void }) {
  const { data, online, refreshPack } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!data?.pack) return null;
  const t = totals(data);
  const camp = data.pack.campaigns;
  const refresh = async () => { setRefreshing(true); setError(null); try { await refreshPack(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setRefreshing(false); } };
  return (
    <View style={s.screen}>
      <Header title="Mes zones" sub={`${camp.map((c) => c.number).join(', ') || 'Aucune campagne'} · équipe ${data.pack.user.fullName}`}
        right={<Pressable accessibilityRole="button" accessibilityLabel="Réglages" onPress={onSettings} hitSlop={8} style={{ paddingHorizontal: 6, height: 44, justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 14 }}>Réglages</Text></Pressable>} />
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <Banner tone={online ? 'info' : 'warn'}>{online ? `Hors ligne possible : ${data.pack.assets.length.toLocaleString('fr-FR')} biens de vos zones sont enregistrés sur l'appareil.` : 'Pas de réseau : le comptage continue, les constats seront transmis au retour de la connexion.'}</Banner>
        {error && <Banner tone="bad">{error}</Banner>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[['Attendus', t.expected, C.fg], ['Constatés', t.counted, C.ok], ['Écarts', t.gaps, C.bad]].map(([l, v, col]) => (
            <View key={l as string} style={{ flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 10, padding: 10 }}>
              <Text style={{ fontSize: 12, color: C.muted }}>{l}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: col as string }}>{(v as number).toLocaleString('fr-FR')}</Text>
            </View>))}
        </View>
        <Text style={[s.h2, { marginTop: 4 }]} accessibilityRole="header">Zones assignées</Text>
        {!camp.length && <Banner>Aucune zone ne vous est confiée dans une campagne ouverte. Tirez vers le bas pour actualiser.</Banner>}
        {camp.flatMap((c) => c.zones.map((z) => {
          const st = zoneStats(data, z.id);
          const closed = z.status === 'TERMINEE' || data.closedZones.includes(z.id);
          const status = closed ? 'TERMINEE' : st.counted > 0 ? 'EN_COURS' : z.status;
          const [label, tone] = STATUS[status];
          const [where, ...rest] = z.name.split(' › ').reverse();
          return (
            <Pressable key={z.id} accessibilityRole="button" accessibilityLabel={`${z.name}, ${label}, ${st.counted} sur ${st.expected}`} onPress={() => onOpen(z.id)}
              style={({ pressed }) => ({ backgroundColor: pressed ? C.accentSoft : C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, gap: 10 })}>
              <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: C.fg }}>{where}</Text>
                  <Text style={s.muted} numberOfLines={1}>{rest.reverse().join(' › ')}{camp.length > 1 ? ` · ${c.number}` : ''}{c.blind ? ' · à l\'aveugle' : ''}</Text>
                </View>
                <Pill tone={tone}>{label}</Pill>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Progress value={st.progress} color={closed ? C.okBar : C.accent} />
                <Text style={{ fontSize: 13, color: C.muted2 }}>{st.counted} / {st.expected}</Text>
              </View>
              {(st.pending > 0 || st.refused > 0) && <Text style={{ fontSize: 12, color: st.refused ? C.bad : C.warn }}>{st.pending ? `${st.pending} à transmettre` : ''}{st.pending && st.refused ? ' · ' : ''}{st.refused ? `${st.refused} refusé(s) à corriger` : ''}</Text>}
            </Pressable>
          );
        }))}
        <Text style={[s.muted, { fontSize: 12 }]}>Zones téléchargées le {new Date(data.pack.generatedAt).toLocaleString('fr-FR')}. Tirez vers le bas pour les mettre à jour.</Text>
      </ScrollView>
    </View>
  );
}
