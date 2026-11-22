import { useEffect, useRef, useState } from 'react';
import { IonButton, IonContent, IonIcon, IonModal, IonText, IonTextarea } from '@ionic/react';
import type { AreaView } from '../hooks';
import { iconFor } from '../icons';
import { formatClock } from '../time';

interface Props {
  open: boolean;
  area: AreaView | undefined;
  subName?: string;
  start?: string;
  note: string;
  onClose: () => void;
  onSave: (note: string) => void;
}

/** The running timer's note (Timer → Note chip). Saved with the interval when the timer ends. */
export default function NoteSheet({ open, area, subName, start, note, onClose, onSave }: Props) {
  const [text, setText] = useState(note);
  const input = useRef<HTMLIonTextareaElement>(null);
  useEffect(() => {
    if (open) setText(note);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const changed = text.trim() !== note;
  return (
    <IonModal
      isOpen={open}
      onDidPresent={() => input.current?.setFocus()}
      onDidDismiss={onClose}
      initialBreakpoint={0.5}
      breakpoints={[0, 0.5, 0.9]}
      className="stop-sheet note-sheet"
    >
      <IonContent className="ion-padding">
        {area && (
          <>
            <h2 className="sheet-title">Note</h2>
            <div className="sheet-running">
              <span className="dot" style={{ background: area.color, color: area.onColor }}>
                <IonIcon icon={iconFor(area.icon)} />
              </span>
              <span>
                {area.name}
                {subName ? ` · ${subName}` : ''} {start && <IonText color="medium">· since {formatClock(start)}</IonText>}
              </span>
            </div>
            <IonTextarea
              ref={input}
              fill="outline"
              autoGrow
              rows={3}
              aria-label="Note"
              placeholder="What are you doing?"
              autocapitalize="sentences"
              value={text}
              onIonInput={(e) => setText(e.detail.value ?? '')}
              className="note-input"
            />
            <IonButton
              expand="block"
              shape="round"
              size="large"
              className="sheet-apply tinted"
              style={{ ['--background' as string]: area.color, ['--color' as string]: area.onColor }}
              disabled={!changed}
              onClick={() => onSave(text.trim())}
            >
              {note && !text.trim() ? 'Remove note' : 'Save note'}
            </IonButton>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
