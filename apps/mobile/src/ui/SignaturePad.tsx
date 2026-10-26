import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { C } from './kit';

export interface SignatureHandle { toPng: () => Promise<string | null>; isEmpty: () => boolean; clear: () => void }
const H = 140;

/** Zone de signature tracée au doigt ; exportée en PNG pour la clôture de zone. */
export const SignaturePad = forwardRef<SignatureHandle, { signer: string }>(function SignaturePad({ signer }, ref) {
  const [paths, setPaths] = useState<string[]>([]);
  const [W, setW] = useState(340);
  const current = useRef('');
  const svg = useRef<Svg & { toDataURL?: (cb: (b64: string) => void) => void }>(null);
  const [, force] = useState(0);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { current.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`; force((x) => x + 1); },
    onPanResponderMove: (e) => { current.current += ` L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`; force((x) => x + 1); },
    onPanResponderRelease: () => { const p = current.current; current.current = ''; if (p.includes('L')) setPaths((x) => [...x, p]); },
  })).current;
  useImperativeHandle(ref, () => ({
    isEmpty: () => paths.length === 0,
    clear: () => setPaths([]),
    toPng: () => new Promise((resolve) => {
      if (!paths.length) return resolve(null);
      if (Platform.OS === 'web') {
        // Sur le web, le tracé est redessiné sur un canevas.
        const canvas = document.createElement('canvas'); canvas.width = W * 2; canvas.height = H * 2;
        const g = canvas.getContext('2d')!; g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, canvas.width, canvas.height); g.scale(2, 2);
        g.strokeStyle = C.navy; g.lineWidth = 2.5; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const p of paths) g.stroke(new Path2D(p));
        return resolve(canvas.toDataURL('image/png'));
      }
      if (!svg.current?.toDataURL) return resolve(null);
      svg.current.toDataURL((b64) => resolve(`data:image/png;base64,${b64}`));
    }),
  }), [paths, W]);
  return (
    <View style={{ gap: 6 }}>
      <View accessibilityLabel={`Zone de signature de ${signer}`} {...pan.panHandlers} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}
        style={{ height: H, borderWidth: 2, borderStyle: 'dashed', borderColor: '#9AA7B6', borderRadius: 10, backgroundColor: C.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Svg ref={svg as never} width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', top: 0, left: 0 }}>
          {[...paths, current.current].filter(Boolean).map((d, i) => <Path key={i} d={d} stroke={C.navy} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
        </Svg>
        {!paths.length && !current.current && <Text style={{ fontSize: 13, color: C.muted, pointerEvents: "none" }}>Signez ici · {signer}</Text>}
      </View>
      {paths.length > 0 && <Pressable accessibilityRole="button" onPress={() => setPaths([])} style={{ alignSelf: 'flex-end', padding: 4 }}><Text style={{ color: C.accentInk, fontSize: 13 }}>Effacer la signature</Text></Pressable>}
    </View>
  );
});
