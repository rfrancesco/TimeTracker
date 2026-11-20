import { native } from './native';

/**
 * Haptic feedback. In the Android app: the system's own haptics (no permission, and
 * they follow the phone's haptic settings); the WebView's navigator.vibrate would need
 * the VIBRATE permission. In the browser/PWA: navigator.vibrate.
 *   tick    – a light tap (selecting, tapping an area)
 *   long    – a hold has armed (lift a block, open a hold sheet)
 *   confirm – a drag/hold action was applied
 */
export type Haptic = 'tick' | 'long' | 'confirm';
const VIBRATE_MS: Record<Haptic, number> = { tick: 10, long: 25, confirm: 12 };

export function haptic(kind: Haptic = 'tick') {
  const fallback = () => navigator.vibrate?.(VIBRATE_MS[kind]);
  if (native) native.haptic({ kind }).catch(fallback); // an older APK lacks it
  else fallback();
}
