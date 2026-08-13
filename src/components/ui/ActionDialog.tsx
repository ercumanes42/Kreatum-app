import { useEffect, useId, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { Button } from './Button';

interface ActionDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: 'primary' | 'danger';
  reasonLabel?: string;
  reasonMinLength?: number;
  confirmationPhrase?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (reason: string) => void | Promise<void>;
}

export function ActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancelar',
  variant = 'primary',
  reasonLabel,
  reasonMinLength = 4,
  confirmationPhrase,
  busy = false,
  error = '',
  onClose,
  onConfirm,
}: ActionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const confirmationId = useId();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const dialogRef = useDialogFocus<HTMLDivElement>(open, onClose);

  useEffect(() => {
    if (!open) {
      setReason('');
      setConfirmation('');
    }
  }, [open]);

  if (!open) return null;

  const reasonValid = !reasonLabel || reason.trim().length >= reasonMinLength;
  const phraseValid = !confirmationPhrase || confirmation === confirmationPhrase;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-2xl outline-none dark:border-white/10 dark:bg-kreatum-bg-dark sm:p-7"
      >
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-xl font-extrabold text-kreatum-dark dark:text-white">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-kreatum-gray/70 dark:text-white/65">{description}</p>

        {error && <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm font-semibold text-red-700" role="alert">{error}</div>}

        {reasonLabel && (
          <label htmlFor={reasonId} className="mt-5 block text-sm font-bold text-kreatum-dark dark:text-white">
            {reasonLabel}
            <textarea
              id={reasonId}
              rows={3}
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]"
            />
          </label>
        )}

        {confirmationPhrase && (
          <label htmlFor={confirmationId} className="mt-4 block text-sm font-bold text-kreatum-dark dark:text-white">
            Escribe {confirmationPhrase} para confirmar
            <input
              id={confirmationId}
              value={confirmation}
              disabled={busy}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
              className="mt-2 h-11 w-full rounded-xl border border-black/10 bg-white px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]"
            />
          </label>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            disabled={busy || !reasonValid || !phraseValid}
            onClick={() => void onConfirm(reason.trim())}
          >
            {busy ? 'Procesando.' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
