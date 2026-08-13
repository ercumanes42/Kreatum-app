import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, LockKeyhole, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { signInWithCustomToken, updatePassword } from 'firebase/auth';
import type { GetInvitationActivationOutput, VerifyInvitationCodeOutput } from '../shared/contracts';
import { Button } from './components/ui/Button';
import { auth } from './lib/firebase';
import { getUserFacingError } from './lib/errors';
import { createIdempotencyKey, workshopApi } from './lib/workshopApi';

const passwordIsStrong = (value: string) => value.length >= 12
  && /[a-z]/.test(value)
  && /[A-Z]/.test(value)
  && /\d/.test(value);

const resolveLegalUrl = (value: string | undefined) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    const isLocalHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return url.protocol === 'https:' || isLocalHttp ? url.toString() : '';
  } catch {
    return '';
  }
};

export default function ActivationApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const organizationId = params.get('organizationId') ?? '';
  const invitationId = params.get('invitationId') ?? '';
  const [invitation, setInvitation] = useState<GetInvitationActivationOutput | null>(null);
  const [verification, setVerification] = useState<VerifyInvitationCodeOutput | null>(null);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [acceptsPrivacy, setAcceptsPrivacy] = useState(false);
  const [acceptsTerms, setAcceptsTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completed, setCompleted] = useState(false);
  const privacyUrl = resolveLegalUrl(invitation?.privacyPolicyUrl);
  const termsUrl = resolveLegalUrl(invitation?.termsUrl);
  const privacyVersion = invitation?.privacyVersion ?? '';
  const termsVersion = invitation?.termsVersion ?? '';
  const legalDocumentsReady = Boolean(privacyUrl && termsUrl && privacyVersion && termsVersion);

  useEffect(() => {
    const load = async () => {
      if (!organizationId || !invitationId) {
        setError('El enlace de activación no es válido.');
        setIsLoading(false);
        return;
      }
      try {
        setInvitation(await workshopApi.getInvitationActivation({ organizationId, invitationId }));
      } catch (loadError: unknown) {
        setError(getUserFacingError(loadError, 'La invitación no está disponible.'));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [invitationId, organizationId]);

  const verifyCode = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const result = await workshopApi.verifyInvitationCode({ organizationId, invitationId, code });
      await signInWithCustomToken(auth, result.customToken);
      setVerification(result);
    } catch (verifyError: unknown) {
      setError(getUserFacingError(verifyError, 'No se pudo verificar el código.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!verification || !auth.currentUser) return;
    if (!legalDocumentsReady) {
      setError('Los documentos legales vigentes no están disponibles.');
      return;
    }
    if (!firstName.trim() || !lastName.trim()) {
      setError('Nombre y apellidos son obligatorios.');
      return;
    }
    if (!passwordIsStrong(password)) {
      setError('La contraseña debe tener 12 caracteres, mayúscula, minúscula y número.');
      return;
    }
    if (password !== passwordConfirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!acceptsPrivacy || !acceptsTerms) {
      setError('Debes aceptar privacidad y condiciones.');
      return;
    }
    setIsSubmitting(true);
    try {
      await updatePassword(auth.currentUser, password);
      await workshopApi.acceptInvitation({
        organizationId,
        invitationId,
        activationToken: verification.activationToken,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        acceptsPrivacy,
        acceptsTerms,
        privacyVersion,
        termsVersion,
        idempotencyKey: createIdempotencyKey('acceptInvitation'),
      });
      setCompleted(true);
    } catch (activationError: unknown) {
      setError(getUserFacingError(activationError, 'No se pudo activar la cuenta.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) return <div className="min-h-screen grid place-items-center bg-kreatum-bg-light" role="status">Comprobando invitación…</div>;

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(162,84,156,.13),transparent_36%),linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top_left,rgba(162,84,156,.18),transparent_34%),linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)]">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-kreatum-purple text-white"><ShieldCheck className="h-6 w-6" /></div>
          <div><p className="text-xs font-extrabold uppercase tracking-[0.2em] text-kreatum-purple">KREATUM</p><p className="font-bold text-kreatum-dark dark:text-white">Activación segura de cuenta</p></div>
        </div>

        <section className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-[0_24px_70px_-44px_rgba(22,28,45,.65)] dark:border-white/[0.08] dark:bg-kreatum-bg-dark sm:p-8" aria-labelledby="activation-title">
          {completed ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" />
              <h1 id="activation-title" className="mt-5 text-3xl font-extrabold text-kreatum-dark dark:text-white">Cuenta activada</h1>
              <p className="mt-3 text-sm text-kreatum-gray/65 dark:text-white/60">Ya puedes entrar en el Panel del Alquimista con tu correo y la contraseña que acabas de crear.</p>
              <Button className="mt-7 h-12 rounded-xl bg-kreatum-purple px-7 text-white" onClick={() => window.location.assign('/admin')}>Ir al panel</Button>
            </div>
          ) : !invitation ? (
            <div className="py-8 text-center"><h1 id="activation-title" className="text-2xl font-extrabold">Invitación no disponible</h1><p className="mt-3 text-sm text-red-600" role="alert">{error}</p></div>
          ) : !verification ? (
            <form onSubmit={verifyCode}>
              <KeyRound className="h-8 w-8 text-kreatum-purple" />
              <h1 id="activation-title" className="mt-4 text-3xl font-extrabold text-kreatum-dark dark:text-white">Verifica tu invitación</h1>
              <p className="mt-3 text-sm leading-6 text-kreatum-gray/65 dark:text-white/60">{invitation.invitedBy} te ha invitado a <strong>{invitation.organizationName}</strong>. El código se envió a {invitation.maskedEmail} y caduca a las {new Intl.DateTimeFormat('es-ES', { timeStyle: 'short' }).format(invitation.expiresAt)}.</p>
              {error && <div className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600" role="alert">{error}</div>}
              <label htmlFor="activation-code" className="mb-2 mt-7 block text-xs font-bold">Código de 6 dígitos</label>
              <input id="activation-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="h-14 w-full rounded-xl border border-kreatum-purple/20 bg-kreatum-purple/5 px-4 text-center font-mono text-2xl font-extrabold tracking-[0.35em] text-kreatum-purple outline-none focus:border-kreatum-purple focus:ring-2 focus:ring-kreatum-purple/20" required />
              <Button type="submit" disabled={code.length !== 6 || isSubmitting} className="mt-6 h-12 w-full rounded-xl bg-kreatum-purple text-white">{isSubmitting ? 'Verificando…' : 'Verificar código'}</Button>
            </form>
          ) : (
            <form onSubmit={activate}>
              <UserRoundCheck className="h-8 w-8 text-kreatum-purple" />
              <h1 id="activation-title" className="mt-4 text-3xl font-extrabold text-kreatum-dark dark:text-white">Completa tu cuenta</h1>
              <p className="mt-3 text-sm text-kreatum-gray/65 dark:text-white/60">El rol ya ha sido asignado por el Administrador. Define tus datos y una contraseña propia.</p>
              {error && <div className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600" role="alert">{error}</div>}
              <div className="mt-7 grid gap-4 sm:grid-cols-2"><div><label htmlFor="first-name" className="mb-2 block text-xs font-bold">Nombre</label><input id="first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" maxLength={80} required className="h-12 w-full rounded-xl border border-black/10 px-4 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" /></div><div><label htmlFor="last-name" className="mb-2 block text-xs font-bold">Apellidos</label><input id="last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" maxLength={80} required className="h-12 w-full rounded-xl border border-black/10 px-4 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" /></div></div>
              <div className="mt-4"><label htmlFor="new-password" className="mb-2 block text-xs font-bold">Contraseña</label><div className="relative"><LockKeyhole className="absolute left-4 top-3.5 h-5 w-5 opacity-40" /><input id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={12} required className="h-12 w-full rounded-xl border border-black/10 pl-12 pr-4 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" /></div><p className="mt-2 text-xs opacity-55">Mínimo 12 caracteres, con mayúscula, minúscula y número.</p></div>
              <div className="mt-4"><label htmlFor="confirm-password" className="mb-2 block text-xs font-bold">Confirmar contraseña</label><input id="confirm-password" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={12} required className="h-12 w-full rounded-xl border border-black/10 px-4 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" /></div>
              {legalDocumentsReady ? <div className="mt-6 space-y-3 text-sm"><label className="flex items-start gap-3"><input type="checkbox" checked={acceptsPrivacy} onChange={(event) => setAcceptsPrivacy(event.target.checked)} className="mt-1" required /><span>Acepto la <a href={privacyUrl} target="_blank" rel="noreferrer" className="font-bold text-kreatum-purple underline">política de privacidad</a>.</span></label><label className="flex items-start gap-3"><input type="checkbox" checked={acceptsTerms} onChange={(event) => setAcceptsTerms(event.target.checked)} className="mt-1" required /><span>Acepto las <a href={termsUrl} target="_blank" rel="noreferrer" className="font-bold text-kreatum-purple underline">condiciones de uso</a>.</span></label></div> : <div className="mt-6 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800" role="alert">Los documentos legales vigentes deben estar disponibles antes de activar cuentas.</div>}
              <Button type="submit" disabled={isSubmitting || !legalDocumentsReady} className="mt-7 h-12 w-full rounded-xl bg-kreatum-purple text-white">{isSubmitting ? 'Activando…' : 'Crear contraseña y activar'}</Button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
