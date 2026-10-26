import { useMemo, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import { findZone, normalizeCode, recognize, upsertCount, validateCount } from '../core/inventory';
import { useStore, uuid } from '../core/store';
import { resubmit } from '../core/sync';
import { CONDITIONS, Condition, LocalPhoto, needsJustification } from '../core/types';
import { Banner, Btn, C, Card, Field, Header, s } from '../ui/kit';

/** Position au moment du constat, sans bloquer la saisie (3 s au plus, refus de l'utilisateur respecté). */
async function position(): Promise<{ lat: number; lng: number } | null> {
  try {
    const p = await Location.getForegroundPermissionsAsync();
    const ok = p.granted || (p.canAskAgain && (await Location.requestForegroundPermissionsAsync()).granted);
    if (!ok) return null;
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
    const pos = last ?? await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    return pos ? { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 } : null;
  } catch { return null; }
}

export function Constat({ zoneId, code: rawCode, onDone }: { zoneId: number; code: string; onDone: () => void }) {
  const { data, update } = useStore();
  const code = normalizeCode(rawCode);
  const z = findZone(data?.pack ?? null, zoneId);
  const existing = data?.counts.filter((k) => k.code === code && k.zoneId === zoneId).slice(-1)[0];
  const r = useMemo(() => (data ? recognize(data, zoneId, code) : null), [data, zoneId, code]);
  const asset = r && 'asset' in r ? r.asset : null;
  const [condition, setCondition] = useState<Condition>(existing?.condition === 'NEUF' ? 'BON' : existing?.condition ?? 'BON');
  const [locationId, setLocationId] = useState<number | null>(existing?.locationId ?? null);
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [photos, setPhotos] = useState<LocalPhoto[]>(() => data?.photos.filter((p) => existing?.photoIds.includes(p.photoId)) ?? []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!data || !z) return null;
  const locs = z.zone.locations;
  const blind = z.blind;

  const addPhoto = async () => {
    setError(null);
    try {
      const perm = Platform.OS === 'web' ? { granted: true } : await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError('Autorisez la caméra pour photographier le bien'); return; }
      const res = Platform.OS === 'web' ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.4 }) : await ImagePicker.launchCameraAsync({ quality: 0.5, exif: false });
      if (res.canceled || !res.assets[0]) return;
      const photoId = uuid();
      let uri = res.assets[0].uri;
      // Copie dans l'espace de l'application : le cache du système peut être vidé avant la synchronisation.
      if (Platform.OS !== 'web' && FileSystem.documentDirectory) {
        const dest = `${FileSystem.documentDirectory}constats/${photoId}.jpg`;
        await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}constats`, { intermediates: true }).catch(() => {});
        await FileSystem.copyAsync({ from: uri, to: dest });
        uri = dest;
      }
      setPhotos((p) => [...p, { photoId, clientId: '', uri, state: 'PENDING' }]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const save = async () => {
    const photoIds = photos.map((p) => p.photoId);
    const err = validateCount({ condition, comment, photoIds });
    if (err) { setError(err); return; }
    setSaving(true);
    const pos = await position();
    const base = { campaignId: z.zone.campaignId, zoneId, code, condition, locationId, comment: comment.trim(), countedAt: new Date().toISOString(), lat: pos?.lat ?? null, lng: pos?.lng ?? null,
      assetId: asset?.id ?? null, designation: asset?.designation ?? '', photoIds };
    update((d) => {
      // Un constat refusé puis corrigé repart avec un nouvel identifiant.
      const refused = d.counts.find((k) => k.code === code && k.zoneId === zoneId && (k.state === 'REFUSE' || k.state === 'CONFLIT'));
      const counts = refused ? d.counts.map((k) => (k === refused ? resubmit(k, uuid(), base) : k)) : upsertCount(d.counts, { ...base, clientId: uuid(), state: 'PENDING' });
      const target = counts.find((k) => k.code === code && k.zoneId === zoneId && k.state === 'PENDING')!;
      const known = new Set(d.photos.map((p) => p.photoId));
      return { ...d, counts, photos: [...d.photos.map((p) => (target.photoIds.includes(p.photoId) && p.state === 'PENDING' ? { ...p, clientId: target.clientId } : p)),
        ...photos.filter((p) => !known.has(p.photoId)).map((p) => ({ ...p, clientId: target.clientId }))] };
    });
    setSaving(false);
    onDone();
  };

  const locLabel = locationId == null ? `${z.zone.name.split(' › ').pop()} (conforme)` : locs.find((l) => l.id === locationId)?.path.split(' › ').slice(-2).join(' › ') ?? '—';
  return (
    <View style={s.screen}>
      <Header title="Fiche constat" sub={code} onBack={onDone} />
      <ScrollView contentContainerStyle={[s.body, { gap: 16 }]} keyboardShouldPersistTaps="handled">
        {existing?.message && <Banner tone="bad">Refusé à la synchronisation : {existing.message}</Banner>}
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.fg }}>{asset?.designation ?? 'Code non référencé'}</Text>
          {asset ? <>
            <Text style={s.muted}>{asset.category} · détenteur : {asset.holder ?? '—'}</Text>
            {!blind && asset.expectedLocation && <Text style={s.muted}>Localisation attendue : {asset.expectedLocation.split(' › ').slice(-2).join(' · ')}</Text>}
            <Text style={s.muted}>Dernier constat : {asset.lastSeenAt ? new Date(asset.lastSeenAt).toLocaleDateString('fr-FR') : 'jamais'}{asset.serial ? ` · n° de série ${asset.serial}` : ''}</Text>
          </> : <Text style={s.muted}>Ce code n'est pas dans la liste de l'appareil. Il sera vérifié à la synchronisation et signalé en excédent s'il n'existe pas au registre : décrivez le bien dans le commentaire.</Text>}
        </Card>
        <View style={{ gap: 8 }}>
          <Text style={s.label}>État constaté</Text>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CONDITIONS.map(([k, l]) => {
              const on = condition === k;
              return (
                <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setCondition(k)}
                  style={{ width: '48.5%', height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 1, borderColor: on ? C.accent : C.input, backgroundColor: on ? C.accentSoft : C.surface }}>
                  <Text style={{ fontSize: 15, color: on ? C.accentInk : C.fg, fontWeight: on ? '600' : '400' }}>{l}</Text>
                </Pressable>);
            })}
          </View>
          {needsJustification(condition) && <Banner tone="warn">Photo et commentaire obligatoires : le bien sera proposé au gestionnaire pour une réforme éventuelle.</Banner>}
        </View>
        <View style={{ gap: 6 }}>
          <Text style={s.label}>Localisation constatée</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Localisation constatée : ${locLabel}`} onPress={() => setPicking(true)}
            style={{ height: 48, borderWidth: 1, borderColor: C.input, borderRadius: 10, paddingHorizontal: 12, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 15, color: C.fg, flex: 1 }} numberOfLines={1}>{locLabel}</Text><Text style={{ color: C.muted }}>▾</Text>
          </Pressable>
        </View>
        <Field label="Commentaire" value={comment} onChangeText={setComment} multiline maxLength={500} placeholder={needsJustification(condition) ? 'Décrivez le défaut constaté' : 'Facultatif'} />
        <View style={{ gap: 8 }}>
          <Text style={s.label}>Photos</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {photos.map((p) => (
              <Pressable key={p.photoId} accessibilityRole="button" accessibilityLabel="Retirer la photo" onLongPress={() => setPhotos((x) => x.filter((y) => y.photoId !== p.photoId))}>
                <Image source={{ uri: p.uri }} style={{ width: 84, height: 84, borderRadius: 10, backgroundColor: '#C9D6E6' }} />
              </Pressable>))}
            <Pressable accessibilityRole="button" onPress={addPhoto} style={{ width: 84, height: 84, borderRadius: 10, borderWidth: 2, borderStyle: 'dashed', borderColor: '#9AA7B6', alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }}>
              <Text style={{ fontSize: 13, color: C.muted2 }}>+ Photo</Text>
            </Pressable>
          </View>
          {photos.length > 0 && <Text style={{ fontSize: 12, color: C.muted }}>Appui long sur une photo pour la retirer.</Text>}
        </View>
        <Text style={{ fontSize: 12, color: C.muted }}>Constat horodaté et géolocalisé · {data.pack?.user.fullName} · {new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</Text>
      </ScrollView>
      {error && <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Banner tone="bad">{error}</Banner></View>}
      <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 28, backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line }}>
        <Btn label="Annuler" kind="secondary" style={{ flex: 1 }} onPress={onDone} />
        <Btn label="Enregistrer et scanner" style={{ flex: 2 }} busy={saving} onPress={save} />
      </View>
      {picking && (
        <Modal transparent animationType="slide" onRequestClose={() => setPicking(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(19,41,75,0.45)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%', paddingBottom: 24 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: C.fg, padding: 18 }}>Où se trouve le bien ?</Text>
              <ScrollView>
                {[{ id: null as number | null, path: `${z.zone.name.split(' › ').pop()} (conforme)` }, ...locs.map((l) => ({ id: l.id as number | null, path: l.path.split(' › ').slice(-2).join(' › ') }))].map((l) => (
                  <Pressable key={String(l.id)} accessibilityRole="radio" accessibilityState={{ checked: l.id === locationId }} onPress={() => { setLocationId(l.id); setPicking(false); }}
                    style={{ paddingHorizontal: 18, minHeight: 50, justifyContent: 'center', backgroundColor: l.id === locationId ? C.accentSoft : C.surface, borderTopWidth: 1, borderTopColor: C.lineSoft }}>
                    <Text style={{ fontSize: 15, color: l.id === locationId ? C.accentInk : C.fg, fontWeight: l.id === locationId ? '600' : '400' }}>{l.path}</Text>
                  </Pressable>))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}
