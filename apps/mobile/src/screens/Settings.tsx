import { useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { useStore } from '../core/store';
import { unsent } from '../core/sync';
import { emptyData } from '../core/types';
import { Banner, Btn, C, Card, Header, mono, s } from '../ui/kit';

function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n\n${message}`)) onYes(); return; }
  Alert.alert(title, message, [{ text: 'Annuler', style: 'cancel' }, { text: 'Confirmer', style: 'destructive', onPress: onYes }]);
}

export function Settings({ onBack }: { onBack: () => void }) {
  const { data, update, refreshPack, syncing } = useStore();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  if (!data) return null;
  const pending = unsent(data);
  const refresh = async () => { setBusy(true); setMsg(null); try { await refreshPack(); setMsg({ tone: 'ok', text: 'Zones et liste des biens mises à jour.' }); } catch (e) { setMsg({ tone: 'bad', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); } };
  return (
    <View style={s.screen}>
      <Header title="Réglages" sub={data.session?.user.fullName} onBack={onBack} />
      <ScrollView contentContainerStyle={s.body}>
        <Card>
          <Text style={s.h2}>Appareil</Text>
          <Row k="Serveur" v={data.server || '—'} />
          <Row k="Compte" v={data.owner ?? '—'} />
          <Row k="Identifiant de l'appareil" v={data.deviceId.slice(0, 8)} mono />
          <Row k="Zones téléchargées le" v={data.pack ? new Date(data.pack.generatedAt).toLocaleString('fr-FR') : '—'} />
          <Row k="Biens enregistrés hors ligne" v={(data.pack?.assets.length ?? 0).toLocaleString('fr-FR')} />
          <Row k="Éléments à transmettre" v={String(pending)} />
        </Card>
        {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
        <Btn label="Mettre à jour les zones" kind="secondary" busy={busy} disabled={!data.session} onPress={refresh} />
        {pending > 0 && <Banner tone="warn">{pending} élément(s) restent à transmettre : la déconnexion les conserve sur l'appareil, mais seul votre compte pourra les envoyer.</Banner>}
        <Btn label="Se déconnecter" kind="secondary" onPress={() => confirm('Se déconnecter', pending ? 'Les constats non transmis restent sur l\'appareil.' : 'Vous devrez saisir à nouveau votre mot de passe.', () => update((d) => ({ ...d, session: null })))} />
        <Btn label="Effacer les données de l'appareil" kind="danger" disabled={pending > 0 || syncing}
          onPress={() => confirm('Effacer les données', 'Zones, liste des biens et historique local seront supprimés de cet appareil.', () => update((d) => emptyData(d.deviceId, d.server)))} />
        {pending > 0 && <Text style={{ fontSize: 12, color: C.muted }}>L'effacement est impossible tant que des constats ne sont pas transmis.</Text>}
        <Text style={{ fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 8 }}>SIGP Inventaire · version 1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const Row = ({ k, v, mono: m }: { k: string; v: string; mono?: boolean }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 4 }}>
    <Text style={{ fontSize: 14, color: C.muted }}>{k}</Text><Text style={[{ fontSize: 14, color: C.fg, flexShrink: 1, textAlign: 'right' }, m && mono]}>{v}</Text>
  </View>
);
