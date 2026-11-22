import { useIonToast } from '@ionic/react';
import { TAB_BAR_ID, dismissAllToasts } from './toast';
import { forgetLastEdit, recordEdit, undoLastEdit } from './undo';

/**
 * Day view edits (drag, resize, editor save/delete): run the edit, then show a
 * snackbar "<label> · Undo" for a few seconds. One step only; leaving the Day view
 * forgets it (call `forget`).
 */
export function useEditUndo() {
  const [present, dismiss] = useIonToast();
  const show = async (message: string, undoable: boolean) => {
    await dismiss().catch(() => {});
    await dismissAllToasts();
    await present({
      message,
      duration: undoable ? 5000 : 2500,
      position: 'bottom',
      positionAnchor: TAB_BAR_ID,
      cssClass: 'edit-undo-toast',
      // Like Android: the snackbar pushes the floating + button up instead of covering it.
      onWillPresent: () => document.body.classList.add('snackbar-up'),
      onWillDismiss: () => document.body.classList.remove('snackbar-up'),
      buttons: undoable
        ? [
            {
              text: 'Undo',
              handler: () => {
                void undoLastEdit().then(({ ok, label }) => {
                  if (label && !ok) void show('Can’t undo: things changed since', false);
                });
              },
            },
          ]
        : [],
    });
  };
  const run = async <T,>(label: string, fromMs: number, action: () => Promise<T>) => {
    const { result, changed } = await recordEdit(label, fromMs, action);
    if (changed) await show(label, true);
    return result;
  };
  const forget = () => {
    forgetLastEdit();
    void dismiss().catch(() => {});
  };
  return { run, forget };
}
