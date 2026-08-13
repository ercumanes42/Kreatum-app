import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Mail,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserRoundCog,
  UserRoundX,
  XCircle,
} from 'lucide-react';
import type {
  ListTeamAccessOutput,
  OrganizationRole,
  OrganizationSummary,
  TeamMemberSummary,
} from '../../../shared/contracts';
import { getUserFacingError } from '../../lib/errors';
import { createIdempotencyKey, workshopApi } from '../../lib/workshopApi';
import { ActionDialog } from '../ui/ActionDialog';
import { Button } from '../ui/Button';

type PendingMemberAction = {
  member: TeamMemberSummary;
  kind: 'role' | 'status';
  nextRole?: OrganizationRole;
  nextStatus?: 'active' | 'disabled';
};

const roleLabel = (role: OrganizationRole) => role === 'owner' ? 'Administrador' : 'Facilitador';
const statusLabel = (status: 'active' | 'disabled') => status === 'active' ? 'Activa' : 'Desactivada';
const dateLabel = (value: number | null) => value
  ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
  : 'No disponible';

export function TeamAccessPanel({ organization }: { organization: OrganizationSummary }) {
  const organizationId = organization.id;
  const [data, setData] = useState<ListTeamAccessOutput | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('facilitator');
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingMemberAction | null>(null);
  const [cancelInvitationId, setCancelInvitationId] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setData(await workshopApi.listTeamAccess({ organizationId: organizationId }));
    } catch (loadError: unknown) {
      setError(getUserFacingError(loadError, 'No se pudo cargar el equipo.'));
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const activeOwners = data?.activeOwnerCount ?? 0;
  const sortedMembers = useMemo(() => [...(data?.members ?? [])].sort((left, right) => (
    Number(right.currentUser) - Number(left.currentUser) || left.email.localeCompare(right.email)
  )), [data?.members]);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusyKey(key);
    setError('');
    setSuccess('');
    try {
      await action();
      setSuccess(message);
      await load();
    } catch (actionError: unknown) {
      setError(getUserFacingError(actionError, 'No se pudo completar la operación.'));
    } finally {
      setBusyKey('');
    }
  };

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    await run('invite', () => workshopApi.inviteMember({
      organizationId: organizationId,
      email: normalizedEmail,
      role,
      idempotencyKey: createIdempotencyKey('inviteMember'),
    }), 'Invitación creada.');
    setEmail('');
  };

  const confirmMemberAction = async (reason: string) => {
    if (!pendingAction) return;
    const { member } = pendingAction;
    if (pendingAction.kind === 'role' && pendingAction.nextRole) {
      const nextRole = pendingAction.nextRole;
      await run(`role-${member.uid}`, () => workshopApi.changeMemberRole({
        organizationId: organizationId,
        memberId: member.uid,
        role: nextRole,
        reason: reason || undefined,
        idempotencyKey: createIdempotencyKey('changeMemberRole'),
      }), `Rol actualizado a ${roleLabel(nextRole)}.`);
    }
    if (pendingAction.kind === 'status' && pendingAction.nextStatus) {
      const nextStatus = pendingAction.nextStatus;
      await run(`status-${member.uid}`, () => workshopApi.changeMemberStatus({
        organizationId: organizationId,
        memberId: member.uid,
        status: nextStatus,
        reason,
        idempotencyKey: createIdempotencyKey('changeMemberStatus'),
      }), nextStatus === 'active' ? 'Cuenta activada.' : 'Cuenta desactivada y sesiones revocadas.');
    }
    setPendingAction(null);
  };

  return (
    <section className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6" aria-labelledby="team-access-title">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.22em] text-kreatum-purple">Administración</p>
          <h2 id="team-access-title" className="text-3xl font-extrabold text-kreatum-dark dark:text-white">Equipo y accesos</h2>
          <p className="mt-2 max-w-2xl text-sm text-kreatum-gray dark:text-white/80">
            Invita al equipo autorizado de esta organización, asigna permisos y revoca accesos.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full bg-kreatum-purple/10 px-3 py-1.5 text-kreatum-purple">{organization.name}</span>
            <span className="rounded-full bg-slate-500/10 px-3 py-1.5 text-slate-700 dark:text-slate-200">
              {organization.commercial ? `Plan ${organization.commercial.plan}` : 'Piloto gestionado por GFS'}
            </span>
            <span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-200">
              {organization.creditsRemaining === null ? 'Partidas gestionadas por GFS' : `${organization.creditsRemaining} partidas disponibles`}
            </span>
          </div>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={isLoading} className="self-start rounded-xl sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {data && activeOwners < 2 && (
        <div className="mb-6 flex gap-3 rounded-2xl border border-amber-400/30 bg-amber-50 p-4 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100" role="status">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-bold">Conviene disponer de dos Administradores</p>
            <p className="mt-1 text-sm opacity-80">Ahora hay {activeOwners}. Un segundo Administrador evita que la gestión quede bloqueada si una cuenta no está disponible.</p>
          </div>
        </div>
      )}

      {(error || success) && (
        <div className={`mb-6 rounded-xl px-4 py-3 text-sm font-semibold ${error ? 'bg-red-500/10 text-red-600' : 'bg-emerald-500/10 text-emerald-700'}`} role={error ? 'alert' : 'status'}>
          {error || success}
        </div>
      )}

      <form onSubmit={invite} className="mb-8 grid gap-4 rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_18px_45px_-38px_rgba(22,28,45,0.45)] dark:border-white/[0.08] dark:bg-white/[0.04] md:grid-cols-[1fr_220px_auto] md:items-end">
        <div>
          <label htmlFor="invite-email" className="mb-2 block text-xs font-bold text-kreatum-gray dark:text-white/85">Correo corporativo</label>
          <input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="persona@empresa.com" required autoComplete="email" className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 outline-none focus:border-kreatum-purple focus:ring-2 focus:ring-kreatum-purple/20 dark:border-white/10 dark:bg-white/[0.04]" />
        </div>
        <div>
          <label htmlFor="invite-role" className="mb-2 block text-xs font-bold text-kreatum-gray dark:text-white/85">Rol</label>
          <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as OrganizationRole)} className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-kreatum-bg-dark">
            <option value="facilitator">Facilitador</option>
            <option value="owner">Administrador</option>
          </select>
        </div>
        <Button type="submit" disabled={busyKey === 'invite'} className="h-12 rounded-xl bg-kreatum-purple px-6 text-white">
          <Mail className="h-4 w-4" />
          {busyKey === 'invite' ? 'Enviando…' : 'Invitar'}
        </Button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.08]">
          <h3 className="font-extrabold text-kreatum-dark dark:text-white">Cuentas</h3>
        </div>
        {isLoading && !data ? (
          <p className="p-8 text-center text-sm text-kreatum-gray dark:text-white/80" role="status">Cargando cuentas…</p>
        ) : sortedMembers.length === 0 ? (
          <p className="p-8 text-center text-sm text-kreatum-gray dark:text-white/80">No hay cuentas disponibles.</p>
        ) : (
          <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {sortedMembers.map((member) => {
              const isLastOwner = member.role === 'owner' && member.status === 'active' && activeOwners <= 1;
              return (
                <li key={member.uid} className="grid gap-4 p-5 lg:grid-cols-[minmax(240px,1.3fr)_minmax(180px,.7fr)_minmax(240px,1fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-bold text-kreatum-dark dark:text-white">{member.firstName || member.lastName ? `${member.firstName} ${member.lastName}`.trim() : member.email}</p>
                      {member.currentUser && <span className="rounded-full bg-kreatum-purple/10 px-2 py-1 text-[11px] font-extrabold text-kreatum-dark dark:text-fuchsia-200">Tu cuenta</span>}
                    </div>
                    <p className="mt-1 truncate text-sm text-kreatum-gray dark:text-white/80">{member.email}</p>
                  </div>
                  <div>
                    <label htmlFor={`role-${member.uid}`} className="sr-only">Rol de {member.email}</label>
                    <select id={`role-${member.uid}`} value={member.role} disabled={busyKey.includes(member.uid) || isLastOwner} onChange={(event) => setPendingAction({ member, kind: 'role', nextRole: event.target.value as OrganizationRole })} className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm font-bold outline-none disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/10 dark:bg-kreatum-bg-dark">
                      <option value="owner">Administrador</option>
                      <option value="facilitator">Facilitador</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><span className="block text-kreatum-gray dark:text-white/80">Alta</span><span className="mt-1 block font-semibold">{dateLabel(member.createdAt)}</span></div>
                    <div><span className="block text-kreatum-gray dark:text-white/80">Último acceso</span><span className="mt-1 block font-semibold">{dateLabel(member.lastLoginAt)}</span></div>
                  </div>
                  <div className="flex items-center justify-between gap-3 lg:justify-end">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${member.status === 'active' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-slate-500/10 text-slate-600'}`}>
                      {member.status === 'active' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                      {statusLabel(member.status)}
                    </span>
                    <Button variant="outline" size="sm" disabled={busyKey.includes(member.uid) || isLastOwner} onClick={() => setPendingAction({ member, kind: 'status', nextStatus: member.status === 'active' ? 'disabled' : 'active' })} className="rounded-xl">
                      {member.status === 'active' ? <UserRoundX className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      {member.status === 'active' ? 'Desactivar' : 'Activar'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-black/[0.06] bg-white dark:border-white/[0.08] dark:bg-white/[0.04]">
        <div className="border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.08]">
          <h3 className="font-extrabold text-kreatum-dark dark:text-white">Invitaciones pendientes</h3>
        </div>
        {(data?.invitations.length ?? 0) === 0 ? (
          <p className="p-8 text-center text-sm text-kreatum-gray dark:text-white/80">No hay invitaciones pendientes.</p>
        ) : (
          <ul className="divide-y divide-black/[0.06] dark:divide-white/[0.08]">
            {data?.invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-kreatum-dark dark:text-white">{invitation.email}</p>
                  <p className="mt-1 text-xs text-kreatum-gray dark:text-white/80">{roleLabel(invitation.role)} · caduca {dateLabel(invitation.expiresAt)} · {invitation.resendCountLastHour}/3 reenvíos en la última hora</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={busyKey === invitation.id || invitation.resendCountLastHour >= 3} onClick={() => void run(invitation.id, () => workshopApi.resendInvitation({ organizationId: organizationId, invitationId: invitation.id, idempotencyKey: createIdempotencyKey('resendInvitation') }), 'Invitación reenviada con un código nuevo.')} className="rounded-xl">
                    <RefreshCw className="h-4 w-4" /> Reenviar
                  </Button>
                  <Button variant="danger" size="sm" disabled={busyKey === invitation.id} onClick={() => setCancelInvitationId(invitation.id)} className="rounded-xl">
                    <XCircle className="h-4 w-4" /> Cancelar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ActionDialog
        open={Boolean(cancelInvitationId)}
        title="Cancelar invitación"
        description="El enlace y el código dejarán de funcionar inmediatamente."
        confirmLabel="Cancelar invitación"
        variant="danger"
        busy={busyKey === cancelInvitationId}
        onClose={() => setCancelInvitationId('')}
        onConfirm={async () => {
          const invitationId = cancelInvitationId;
          if (!invitationId) return;
          await run(invitationId, () => workshopApi.cancelInvitation({ organizationId: organizationId, invitationId, idempotencyKey: createIdempotencyKey('cancelInvitation') }), 'Invitación cancelada.');
          setCancelInvitationId('');
        }}
      />

      {pendingAction && (
        <MemberActionDialog
          action={pendingAction}
          busy={busyKey.includes(pendingAction.member.uid)}
          onClose={() => setPendingAction(null)}
          onConfirm={confirmMemberAction}
        />
      )}
    </section>
  );
}

function MemberActionDialog({ action, busy, onClose, onConfirm }: {
  action: PendingMemberAction;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const isDestructive = action.nextStatus === 'disabled' || (action.member.role === 'owner' && action.nextRole === 'facilitator');
  const phrase = action.nextStatus === 'disabled' ? 'DESACTIVAR' : 'CAMBIAR ROL';
  const title = action.kind === 'role' ? 'Confirmar cambio de rol' : action.nextStatus === 'active' ? 'Activar cuenta' : 'Desactivar cuenta';
  const valid = reason.trim().length >= 4 && (!isDestructive || confirmation === phrase);
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/65 p-4" role="dialog" aria-modal="true" aria-labelledby="member-action-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-kreatum-bg-dark">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-kreatum-purple/10 text-kreatum-purple">
          {isDestructive ? <UserRoundX className="h-6 w-6" /> : <UserRoundCog className="h-6 w-6" />}
        </div>
        <h3 id="member-action-title" className="text-xl font-extrabold text-kreatum-dark dark:text-white">{title}</h3>
        <p className="mt-2 text-sm text-kreatum-gray dark:text-white/80">{action.member.email}</p>
        {isDestructive && <p className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200"><ShieldCheck className="mr-2 inline h-4 w-4" />Esta acción modifica permisos críticos y quedará registrada.</p>}
        <label htmlFor="member-action-reason" className="mb-2 mt-5 block text-xs font-bold">Motivo</label>
        <textarea id="member-action-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} rows={3} required className="w-full resize-none rounded-xl border border-black/10 px-4 py-3 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" />
        {isDestructive && <><label htmlFor="member-action-confirmation" className="mb-2 mt-4 block text-xs font-bold">Escribe {phrase}</label><input id="member-action-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} className="h-11 w-full rounded-xl border border-black/10 px-4 font-mono font-bold tracking-wider outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]" /></>}
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button className="flex-1 bg-kreatum-purple text-white" onClick={() => void onConfirm(reason.trim())} disabled={!valid || busy}>{busy ? 'Guardando…' : 'Confirmar'}</Button>
        </div>
      </div>
    </div>
  );
}
