import { IonInput, IonItem } from '@ionic/react';
import { localDateKey } from '../time';

const pad = (n: number) => String(n).padStart(2, '0');
const timeKey = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Local date + local time → epoch ms (the browser resolves DST gaps). */
const combine = (date: string, time: string) => new Date(`${date}T${time}`).getTime();

/** Open the platform picker on tap (Android: the system date dialog / clock dial). */
const openPicker = (e: React.MouseEvent<HTMLIonInputElement>) =>
  e.currentTarget.getInputElement().then((el) => {
    try {
      el.showPicker?.();
    } catch {
      /* not allowed or unsupported: the browser's default handling applies */
    }
  });

/** A date field and a time field side by side, both native inputs. */
export default function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (ms: number, part: 'date' | 'time') => void;
}) {
  const date = localDateKey(value);
  const time = timeKey(value);
  return (
    <IonItem className="datetime-field">
      <span slot="start" className="datetime-label">{label}</span>
      <IonInput
        aria-label={`${label} date`}
        type="date"
        className="date-input"
        value={date}
        onClick={openPicker}
        onIonInput={(e) => e.detail.value && onChange(combine(String(e.detail.value), time), 'date')}
      />
      <IonInput
        aria-label={`${label} time`}
        type="time"
        className="time-input"
        value={time}
        onClick={openPicker}
        onIonInput={(e) => e.detail.value && onChange(combine(date, String(e.detail.value)), 'time')}
      />
    </IonItem>
  );
}
