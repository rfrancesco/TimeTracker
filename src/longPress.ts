import { native } from './native';

/**
 * How long a press must last to count as a hold (Day view drag): Android's own
 * long-press timeout (Settings → Accessibility → Touch & hold delay; 400 ms by
 * default), read once from the Android app. In the browser/PWA, or with an older
 * APK: 400 ms.
 */
let ms = 400;
if (native) {
  native
    .status()
    .then((s) => {
      if (typeof s.longPressTimeout === 'number' && s.longPressTimeout > 0) ms = s.longPressTimeout;
    })
    .catch(() => {});
}
export const longPressMs = () => ms;
