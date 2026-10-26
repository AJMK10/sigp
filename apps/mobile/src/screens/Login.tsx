import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { downloadPack, login, normalizeServer } from '../core/api';
import { useStore } from '../core/store';
import { unsent } from '../core/sync';
import { Banner, Btn, C, Card, Field, Header, s } from '../ui/kit';

/** Connexion : l'adresse du serveur est retenue sur l'appareil ; le paquet des zones est téléchargé dans la foulée. */
export function Login() {
  const { data, update } = useStore();
  const [server, setServer] = useState(data?.server ?? '');
  const [email, setEmail] = useState(data?.owner ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = data ? unsent(data) : 0;
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const url = normalizeServer(server);
      if (!url) throw new Error("Indiquez l'adresse du serveur SIGP");
      const mail = email.trim().toLowerCase();
      if (pending && data?.owner && data.owner !== mail) throw new Error(`${pending} élément(s) saisis par ${data.owner} restent à transmettre : reconnectez-vous avec ce compte.`);
      const session = await login(url, mail, password);
      const pack = await downloadPack(session);
      update((d) => ({ ...d, server: url, session, owner: mail, pack, counts: d.owner && d.owner !== mail ? [] : d.counts, photos: d.owner && d.owner !== mail ? [] : d.photos }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Header title="SIGP Inventaire" sub="Inventaire physique, avec ou sans réseau" />
      <ScrollView contentContainerStyle={[s.body, { paddingTop: 24 }]} keyboardShouldPersistTaps="handled">
        {pending > 0 && <Banner tone="warn">{pending} élément(s) enregistrés sur l'appareil seront transmis après la connexion.</Banner>}
        <Card style={{ gap: 14, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '700', color: C.navy }}>Connexion</Text>
          <Field label="Adresse du serveur" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="sigp.monentite.ci" hint="Fournie par l'administrateur du patrimoine" />
          <Field label="Adresse e-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" />
          <Field label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={go} />
          {error && <Banner tone="bad">{error}</Banner>}
          <Btn label="Se connecter" onPress={go} busy={busy} disabled={!email || !password} />
        </Card>
        <View style={{ gap: 6, paddingHorizontal: 4 }}>
          <Text style={s.muted}>Après la connexion, les zones confiées à votre équipe et la liste des biens sont enregistrées sur l'appareil : le comptage se poursuit sans réseau, la transmission reprend dès que la connexion revient.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
