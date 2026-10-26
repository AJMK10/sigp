import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './core/store';
import { unsent } from './core/sync';
import { Constat } from './screens/Constat';
import { Login } from './screens/Login';
import { Scan } from './screens/Scan';
import { Settings } from './screens/Settings';
import { Sync } from './screens/Sync';
import { Zones } from './screens/Zones';
import { C, TabBar } from './ui/kit';

type Route = { name: 'zones' } | { name: 'scan'; zoneId: number } | { name: 'constat'; zoneId: number; code: string } | { name: 'sync'; zoneId: number | null } | { name: 'settings' };

function Shell() {
  const { data } = useStore();
  const [stack, setStack] = useState<Route[]>([{ name: 'zones' }]);
  const [zoneId, setZoneId] = useState<number | null>(null);
  const route = stack[stack.length - 1];
  const push = (r: Route) => setStack((s) => [...s, r]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const tab = (t: 'zones' | 'scan' | 'sync') => {
    if (t === 'zones') setStack([{ name: 'zones' }]);
    else if (t === 'scan') setStack(zoneId ? [{ name: 'zones' }, { name: 'scan', zoneId }] : [{ name: 'zones' }]);
    else setStack([{ name: 'zones' }, { name: 'sync', zoneId }]);
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (stack.length > 1) { back(); return true; } return false; });
    return () => sub.remove();
  }, [stack.length]);
  if (!data) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.navy} /></View>;
  if (!data.session || !data.pack) return <Login />;
  const current = route.name === 'zones' || route.name === 'settings' ? 'zones' : route.name === 'sync' ? 'sync' : 'scan';
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }}>
        {route.name === 'zones' && <Zones onOpen={(id) => { setZoneId(id); push({ name: 'scan', zoneId: id }); }} onSettings={() => push({ name: 'settings' })} />}
        {route.name === 'scan' && <Scan zoneId={route.zoneId} onBack={back} onConstat={(code) => push({ name: 'constat', zoneId: route.zoneId, code })} />}
        {route.name === 'constat' && <Constat key={`${route.zoneId}:${route.code}`} zoneId={route.zoneId} code={route.code} onDone={back} />}
        {route.name === 'sync' && <Sync zoneId={route.zoneId} onBack={stack.length > 1 ? back : undefined} onZones={() => tab('zones')} onFix={(z, code) => { setZoneId(z); push({ name: 'constat', zoneId: z, code }); }} />}
        {route.name === 'settings' && <Settings onBack={back} />}
      </View>
      {route.name !== 'constat' && <TabBar current={current} onGo={tab} badge={unsent(data)} />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <Shell />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
