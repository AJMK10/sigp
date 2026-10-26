import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { findZone, normalizeCode, recognize, Recognition, upsertCount, zoneStats } from '../core/inventory';
import { useStore, uuid } from '../core/store';
import { conditionLabel } from '../core/types';
import { Banner, Btn, C, Field, Header, Pill, Tone, mono, s } from '../ui/kit';

const BARCODES = ['qr', 'code128', 'code39', 'datamatrix', 'ean13', 'ean8'] as const;

export function Scan({ zoneId, onBack, onConstat }: { zoneId: number; onBack: () => void; onConstat: (code: string) => void }) {
  const { data, update } = useStore();
  const [perm, requestPerm] = useCameraPermissions();
  const [last, setLast] = useState<{ code: string; r: Recognition } | null>(null);
  const [manual, setManual] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const recent = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) requestPerm(); }, [perm, requestPerm]);
  const handle = useCallback((raw: string) => {
    if (!data) return;
    const code = normalizeCode(raw);
    const now = Date.now();
    if (code === recent.current.code && now - recent.current.at < 2500) return; // même étiquette encore devant l'objectif
    recent.current = { code, at: now };
    setLast({ code, r: recognize(data, zoneId, code) });
  }, [data, zoneId]);
  const z = findZone(data?.pack ?? null, zoneId);
  if (!data || !z) return null;
  const st = zoneStats(data, zoneId);
  const closed = z.zone.status === 'TERMINEE' || data.closedZones.includes(zoneId);
  const scans = data.counts.filter((k) => k.zoneId === zoneId).slice(-30).reverse();
  const quickOk = () => {
    if (!last || last.r.kind === 'DEJA_AILLEURS') return;
    const asset = 'asset' in last.r ? last.r.asset : null;
    update((d) => ({ ...d, counts: upsertCount(d.counts, { clientId: uuid(), campaignId: z.zone.campaignId, zoneId, code: last.code, condition: 'BON', locationId: null, comment: '',
      countedAt: new Date().toISOString(), lat: null, lng: null, assetId: asset?.id ?? null, designation: asset?.designation ?? '', state: 'PENDING', photoIds: [] }) }));
    setLast(null);
  };
  const result = last ? describe(last.r, last.code) : null;
  return (
    <View style={s.screen}>
      <Header title={z.zone.name.split(' › ').pop() ?? z.zone.name} sub={`${z.zone.name.split(' › ').slice(-2, -1)[0] ?? ''} · ${st.counted} / ${st.expected} constatés`} onBack={onBack} />
      {closed ? <View style={s.body}><Banner tone="ok">Zone clôturée : aucun constat ne peut plus y être ajouté.</Banner></View> : <>
        <View style={{ height: 300, backgroundColor: '#0E1B30', alignItems: 'center', justifyContent: 'center' }}>
          {perm?.granted && !cameraError ? (
            <CameraView style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} facing="back" barcodeScannerSettings={{ barcodeTypes: [...BARCODES] }}
              onBarcodeScanned={(e: BarcodeScanningResult) => handle(e.data)} onMountError={() => setCameraError(true)} />
          ) : null}
          <View pointerEvents="none" style={{ width: 230, height: 150, borderWidth: 3, borderColor: '#FFFFFF', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 190, height: 2, backgroundColor: C.amber }} />
          </View>
          <Text style={{ position: 'absolute', bottom: 14, color: '#FFFFFF', fontSize: 13, textAlign: 'center', paddingHorizontal: 16 }}>
            {perm?.granted && !cameraError ? "Visez le code-barres ou le QR code de l'étiquette" : cameraError || Platform.OS === 'web' ? 'Caméra indisponible : utilisez la saisie manuelle' : 'Autorisez la caméra pour lire les étiquettes'}
          </Text>
        </View>
        {result && <View accessibilityRole="alert" style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: result.bg, gap: 2 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: result.fg }}>{result.title}</Text>
          <Text style={{ fontSize: 13, color: result.fg }}>{result.sub}</Text>
          {last && last.r.kind !== 'DEJA_AILLEURS' && <Pressable accessibilityRole="button" onPress={quickOk} style={{ marginTop: 6, alignSelf: 'flex-start' }}><Text style={{ fontSize: 14, fontWeight: '700', color: C.accentInk, textDecorationLine: 'underline' }}>Enregistrer en bon état</Text></Pressable>}
        </View>}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 }}>
          <Btn label="Constater" style={{ flex: 1 }} disabled={!last || last.r.kind === 'DEJA_AILLEURS'} onPress={() => last && onConstat(last.code)} />
          <Btn label="Saisie manuelle" kind="secondary" style={{ flex: 1 }} onPress={() => setManual(true)} />
        </View>
      </>}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        <Text style={[s.h2, { fontSize: 14, color: C.muted2, marginTop: 14, marginBottom: 4 }]} accessibilityRole="header">Derniers scans</Text>
        {!scans.length && <Text style={s.muted}>Aucun constat dans cette zone sur cet appareil.</Text>}
        {scans.map((k) => {
          const [label, tone] = chip(k);
          return (
            <Pressable key={k.clientId} accessibilityRole="button" onPress={() => !closed && onConstat(k.code)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.lineSoft }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: C.fg }} numberOfLines={1}>{k.designation || `Code ${k.code} non référencé`}</Text>
                <Text style={[mono, { fontSize: 12, color: C.muted }]}>{k.designation ? k.code : 'Étiquette inconnue'}{k.message ? ` · ${k.message}` : ''}</Text>
              </View>
              <Pill tone={tone}>{label}</Pill>
            </Pressable>
          );
        })}
      </ScrollView>
      {manual && <ManualEntry onClose={() => setManual(false)} onCode={(c) => { setManual(false); handle(c); }} />}
    </View>
  );
}

function chip(k: { state: string; condition: Parameters<typeof conditionLabel>[0]; assetId: number | null; serverStatus?: string }): [string, Tone] {
  if (k.state === 'REFUSE' || k.state === 'CONFLIT') return ['Refusé', 'bad'];
  if (k.assetId == null && (k.serverStatus == null || k.serverStatus === 'EXCEDENT' || k.serverStatus === 'DEJA_SIGNALE')) return ['Excédent', 'bad'];
  if (k.condition === 'MAUVAIS' || k.condition === 'HORS_USAGE') return [`${conditionLabel(k.condition)} état`.replace("Hors d'usage état", "Hors d'usage"), 'warn'];
  return [k.state === 'PENDING' ? 'Conforme · à transmettre' : 'Conforme', 'ok'];
}

function describe(r: Recognition, code: string) {
  switch (r.kind) {
    case 'CONFORME': return { title: `Bien reconnu · ${code}`, sub: `${r.asset.designation} · localisation conforme`, bg: C.okBg, fg: C.ok };
    case 'RECONNU': return { title: `Bien reconnu · ${code}`, sub: r.asset.designation, bg: C.okBg, fg: C.ok };
    case 'AUTRE_LOCALISATION': return { title: `Bien reconnu · ${code}`, sub: `${r.asset.designation} · attendu ailleurs${r.asset.expectedLocation ? ` (${r.asset.expectedLocation})` : ''} : sera signalé mal localisé`, bg: C.warnBg, fg: C.warn };
    case 'DEJA_AILLEURS': return { title: `Déjà constaté · ${code}`, sub: `Constaté dans ${r.zoneName} : signalez-le au chef d'équipe`, bg: C.badBg, fg: C.bad };
    default: return { title: `Code ${code} non référencé`, sub: "Inconnu sur l'appareil : vérifié à la synchronisation, signalé en excédent s'il n'existe pas", bg: C.badBg, fg: C.bad };
  }
}

function ManualEntry({ onClose, onCode }: { onClose: () => void; onCode: (c: string) => void }) {
  const [code, setCode] = useState('');
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(19,41,75,0.45)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: C.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, gap: 14 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: C.fg }}>Saisie manuelle</Text>
          <Field label="Code du bien ou de l'étiquette" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} autoFocus placeholder="MEF-INF-2023-000811" onSubmitEditing={() => code.trim().length >= 3 && onCode(code)} hint="Pour une étiquette illisible, saisissez le code imprimé ou le n° de série." />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn label="Annuler" kind="secondary" style={{ flex: 1 }} onPress={onClose} />
            <Btn label="Rechercher" style={{ flex: 2 }} disabled={code.trim().length < 3} onPress={() => onCode(code)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
