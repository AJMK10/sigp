import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Charte SIGP (maquette mobile) : marine #13294B, bleu d'action #1F5FAE, IBM Plex. */
export const C = {
  navy: '#13294B', navyMuted: '#B8C7DA', accent: '#1F5FAE', accentInk: '#1A4E8C', accentSoft: '#F2F7FD', infoBg: '#E3EEFB',
  bg: '#F4F6F9', surface: '#FFFFFF', fg: '#16202E', muted: '#5B6775', muted2: '#3E4753', line: '#DDE3EA', lineSoft: '#EEF2F6', input: '#CBD3DD',
  ok: '#17603C', okBg: '#E3F3EA', okBar: '#2E8B57', warn: '#8A4B00', warnBg: '#FFF1DB', warnBox: '#FFF6E8', warnLine: '#F0C98A', warnInk: '#6E4300',
  bad: '#9B1C14', badBg: '#FBE4E2', grey: '#3E4753', greyBg: '#ECEEF1', amber: '#F0A93B',
};
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'grey';
const TONES: Record<Tone, [string, string]> = { ok: [C.okBg, C.ok], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], info: [C.infoBg, C.accentInk], grey: [C.greyBg, C.grey] };

export function Header({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.header, { paddingTop: insets.top + 8 }]}>
      {onBack && <Pressable accessibilityRole="button" accessibilityLabel="Retour" onPress={onBack} style={s.back} hitSlop={8}><Text style={s.backTxt}>‹</Text></Pressable>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.hTitle} numberOfLines={1}>{title}</Text>
        {!!sub && <Text style={s.hSub} numberOfLines={1}>{sub}</Text>}
      </View>
      {right}
    </View>
  );
}

export function Pill({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) {
  const [bg, fg] = TONES[tone];
  return <View style={[s.pill, { backgroundColor: bg }]}><Text style={[s.pillTxt, { color: fg }]}>{children}</Text></View>;
}

export function Btn({ label, onPress, kind = 'primary', disabled, busy, style }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'success' | 'danger'; disabled?: boolean; busy?: boolean; style?: ViewStyle }) {
  const bg = kind === 'primary' ? C.accent : kind === 'success' ? C.okBar : C.surface;
  const fg = kind === 'primary' || kind === 'success' ? '#FFFFFF' : kind === 'danger' ? C.bad : C.fg;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderWidth: kind === 'secondary' || kind === 'danger' ? 1 : 0 }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnTxt, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export const Card = ({ children, style }: { children: ReactNode; style?: ViewStyle }) => <View style={[s.card, style]}>{children}</View>;

export function Banner({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const map = { info: [C.infoBg, C.accentInk, C.infoBg], warn: [C.warnBox, C.warnInk, C.warnLine], bad: [C.badBg, C.bad, '#E3A49F'], ok: [C.okBg, C.ok, '#B9DEC8'] }[tone];
  return <View accessibilityRole="alert" style={[s.banner, { backgroundColor: map[0], borderColor: map[2] }]}><Text style={{ color: map[1], fontSize: 13, lineHeight: 18 }}>{children}</Text></View>;
}

export function Progress({ value, color = C.accent, height = 6 }: { value: number; color?: string; height?: number }) {
  return <View style={{ flex: 1, height, borderRadius: height / 2, backgroundColor: C.lineSoft, overflow: 'hidden' }}><View style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, height: '100%', backgroundColor: color }} /></View>;
}

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor="#8A96A3" style={[s.input, p.multiline && { height: 88, paddingTop: 10, textAlignVertical: 'top' }]} {...p} />
      {!!hint && <Text style={{ fontSize: 12, color: C.muted }}>{hint}</Text>}
    </View>
  );
}

export function TabBar({ current, onGo, badge }: { current: 'zones' | 'scan' | 'sync'; onGo: (t: 'zones' | 'scan' | 'sync') => void; badge?: number }) {
  const insets = useSafeAreaInsets();
  const items: ['zones' | 'scan' | 'sync', string][] = [['zones', 'Zones'], ['scan', 'Scanner'], ['sync', 'Synchroniser']];
  return (
    <View accessibilityRole="tablist" style={[s.tabbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {items.map(([k, l]) => (
        <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: current === k }} onPress={() => onGo(k)} style={s.tab}>
          <Text style={[s.tabTxt, current === k && { color: C.accentInk, fontWeight: '700' }]}>{l}</Text>
          {k === 'sync' && !!badge && <View style={s.badge}><Text style={{ color: C.navy, fontWeight: '700', fontSize: 11 }}>{badge}</Text></View>}
        </Pressable>
      ))}
    </View>
  );
}

export const mono = { fontFamily: 'monospace' as const };
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.navy, paddingHorizontal: 18, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 6 },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: '#FFFFFF', fontSize: 30, lineHeight: 32 },
  hTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  hSub: { color: C.navyMuted, fontSize: 12, marginTop: 2 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  pillTxt: { fontSize: 12, fontWeight: '600' },
  btn: { minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderColor: C.input },
  btnTxt: { fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 14, gap: 6 },
  banner: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  label: { fontSize: 14, fontWeight: '600', color: C.fg },
  input: { height: 48, borderWidth: 1, borderColor: C.input, borderRadius: 10, paddingHorizontal: 12, fontSize: 15, backgroundColor: C.surface, color: C.fg },
  tabbar: { flexDirection: 'row', backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.line },
  tab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  tabTxt: { fontSize: 13, color: C.muted2 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: C.amber, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  h2: { fontSize: 15, fontWeight: '600', color: C.fg },
  muted: { fontSize: 13, color: C.muted },
  body: { padding: 16, gap: 14 },
});
