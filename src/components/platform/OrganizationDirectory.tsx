import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { getUserFacingError } from '../../lib/errors';
import { createIdempotencyKey } from '../../lib/workshopApi';
import {
  platformApi,
  type PlatformDocumentCursor,
  type PlatformOrganization,
  type PlatformOrganizationDetail,
} from '../../lib/platformApi';
import {
  formatPlatformActivityAction,
  formatPlatformValidity,
  groupConsecutivePlatformActivity,
} from '../../lib/platformPresentation';
import {
  formatPlatformDate,
  PlatformEmptyState,
  PlatformError,
  PlatformLoading,
  PlatformPanel,
  PlatformStatusBadge,
} from './PlatformPrimitives';

const PAGE_SIZE = 20;

const toInputDate = (value: PlatformOrganization['validUntil']) => {
  if (!value) return '';
  const raw = typeof value === 'object'
    ? (value.seconds ?? value._seconds ?? 0) * 1_000
    : value;
  const parsed = typeof raw === 'number' ? new Date(raw) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
};

const REASON_PREVIEW_LENGTH = 140;

function ExpandableActivityReason({ reason }: { reason?: string | null }) {
  const value = reason?.trim() ?? '';
  if (!value) return null;
  if (value.length <= REASON_PREVIEW_LENGTH) {
    return <p className="mt-2 break-words text-sm text-kreatum-gray/75">Motivo: {value}</p>;
  }
  return (
    <details className="mt-2 text-sm text-kreatum-gray/75">
      <summary className="cursor-pointer break-words font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/30">
        Motivo: {value.slice(0, REASON_PREVIEW_LENGTH)}… <span className="font-bold text-kreatum-purple">Ver completo</span>
      </summary>
      <p className="mt-2 break-words rounded-xl bg-black/[0.025] p-3">Motivo completo: {value}</p>
    </details>
  );
}

type CreateForm = {
  organizationId: string;
  name: string;
  domain: string;
  validUntil: string;
  contractedWorkshops: string;
  facilitatorEmail: string;
};

const initialCreateForm = (): CreateForm => {
  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  return {
    organizationId: '',
    name: '',
    domain: '',
    validUntil: validUntil.toISOString().slice(0, 10),
    contractedWorkshops: '1',
    facilitatorEmail: '',
  };
};

export function OrganizationDirectory() {
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [cursor, setCursor] = useState<PlatformDocumentCursor | undefined>();
  const [nextCursor, setNextCursor] = useState<PlatformDocumentCursor | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<PlatformDocumentCursor | undefined>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlatformOrganizationDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const loadOrganizations = useCallback(async () => {
    setIsLoading(true);
    setListError('');
    try {
      const result = await platformApi.listOrganizations({
        search: search || undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        cursor,
      });
      setOrganizations(result.organizations);
      setNextCursor(result.hasMore ? result.nextCursor : null);
      if (!selectedId && result.organizations[0]) setSelectedId(result.organizations[0].id);
      if (selectedId && !result.organizations.some((item) => item.id === selectedId)) {
        setSelectedId(result.organizations[0]?.id ?? null);
      }
    } catch (error: unknown) {
      setListError(getUserFacingError(error, 'No se pudieron cargar las empresas.'));
    } finally {
      setIsLoading(false);
    }
  }, [cursor, search, selectedId, statusFilter]);

  useEffect(() => { void loadOrganizations(); }, [loadOrganizations]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setIsLoadingDetail(true);
    setDetailError('');
    try {
      setDetail(await platformApi.getOrganization({ organizationId: selectedId, activityLimit: 25 }));
    } catch (error: unknown) {
      setDetail(null);
      setDetailError(getUserFacingError(error, 'No se pudo cargar el detalle de la empresa.'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [selectedId]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setCursor(undefined);
    setCursorHistory([]);
    setSearch(searchInput.trim());
  };

  const changeStatus = (value: string) => {
    setStatusFilter(value);
    setCursor(undefined);
    setCursorHistory([]);
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorHistory((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  };

  const goPrevious = () => {
    setCursorHistory((previous) => {
      const copy = [...previous];
      setCursor(copy.pop());
      return copy;
    });
  };

  const createOrganization = async (event: FormEvent) => {
    event.preventDefault();
    const contractedWorkshops = Number(createForm.contractedWorkshops);
    if (
      !createForm.organizationId.trim()
      || !createForm.name.trim()
      || !createForm.domain.trim()
      || !createForm.validUntil
      || !createForm.facilitatorEmail.trim()
      || !Number.isInteger(contractedWorkshops)
      || contractedWorkshops < 0
    ) {
      setCreateError('Completa los datos y usa un número válido de partidas contratadas.');
      return;
    }
    setIsCreating(true);
    setCreateError('');
    try {
      const result = await platformApi.provisionOrganization({
        organizationId: createForm.organizationId.trim().toLowerCase(),
        name: createForm.name.trim(),
        allowedEmailDomains: [createForm.domain.trim().toLowerCase().replace(/^@/, '')],
        validFrom: Date.now(),
        validUntil: new Date(`${createForm.validUntil}T23:59:59.999Z`).getTime(),
        contractedWorkshops,
        facilitatorEmail: createForm.facilitatorEmail.trim().toLowerCase(),
        idempotencyKey: createIdempotencyKey('provisionOrganizationAndInviteFacilitator'),
      });
      setShowCreate(false);
      setCreateForm(initialCreateForm());
      setSelectedId(result.organization.id);
      setCursor(undefined);
      setCursorHistory([]);
      await loadOrganizations();
    } catch (error: unknown) {
      setCreateError(getUserFacingError(error, 'No se pudo crear la empresa ni enviar la invitación.'));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-kreatum-purple">Empresas</p>
          <h2 className="mt-2 text-2xl font-extrabold text-kreatum-dark sm:text-3xl">Contratos y acceso empresarial</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-kreatum-gray/75">
            Cada operación se valida de nuevo en servidor y queda limitada a la empresa seleccionada.
          </p>
        </div>
        <Button onClick={() => setShowCreate((value) => !value)} className="w-full lg:w-auto">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Crear empresa
        </Button>
      </div>

      {showCreate && (
        <PlatformPanel className="p-5 sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-extrabold text-kreatum-dark">Nueva empresa</h3>
              <p className="mt-1 text-sm text-kreatum-gray/75">Se creará pendiente. La primera cuenta será Facilitador y se activará al aceptar la invitación.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cerrar</Button>
          </div>
          <form onSubmit={createOrganization} className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold text-kreatum-dark">
              Referencia interna única
              <Input className="mt-2" value={createForm.organizationId} onChange={(event) => setCreateForm({ ...createForm, organizationId: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} placeholder="empresa-norte" pattern="[a-z0-9_-]+" required />
            </label>
            <label className="text-sm font-bold text-kreatum-dark">
              Nombre de la empresa
              <Input className="mt-2" value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} required />
            </label>
            <label className="text-sm font-bold text-kreatum-dark">
              Dominio permitido
              <Input className="mt-2" value={createForm.domain} onChange={(event) => setCreateForm({ ...createForm, domain: event.target.value })} placeholder="empresa.com" inputMode="url" required />
            </label>
            <label className="text-sm font-bold text-kreatum-dark">
              Vigencia hasta
              <Input className="mt-2" type="date" value={createForm.validUntil} onChange={(event) => setCreateForm({ ...createForm, validUntil: event.target.value })} required />
            </label>
            <label className="text-sm font-bold text-kreatum-dark">
              Partidas contratadas
              <Input className="mt-2" type="number" min="0" step="1" value={createForm.contractedWorkshops} onChange={(event) => setCreateForm({ ...createForm, contractedWorkshops: event.target.value })} required />
            </label>
            <label className="text-sm font-bold text-kreatum-dark md:col-span-2">
              Email del facilitador inicial
              <Input className="mt-2" type="email" value={createForm.facilitatorEmail} onChange={(event) => setCreateForm({ ...createForm, facilitatorEmail: event.target.value })} autoComplete="off" required />
            </label>
            <div className="md:col-span-2"><PlatformError message={createError} /></div>
            <div className="flex justify-end md:col-span-2">
              <Button type="submit" disabled={isCreating}>{isCreating ? 'Creando…' : 'Crear y enviar invitación'}</Button>
            </div>
          </form>
        </PlatformPanel>
      )}

      <PlatformPanel className="p-4 sm:p-5">
        <form onSubmit={applySearch} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
          <label className="relative">
            <span className="sr-only">Buscar empresas</span>
            <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-kreatum-gray/40" aria-hidden="true" />
            <Input className="pl-11" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por nombre o dominio" />
          </label>
          <label>
            <span className="sr-only">Filtrar por estado</span>
            <select className="h-12 w-full rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-kreatum-dark focus:outline-none focus:ring-2 focus:ring-kreatum-purple/25" value={statusFilter} onChange={(event) => changeStatus(event.target.value)}>
              <option value="">Todos los estados</option>
              <option value="pending">Pendientes</option>
              <option value="active">Activas</option>
              <option value="suspended">Suspendidas</option>
              <option value="expired">Vencidas</option>
            </select>
          </label>
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
      </PlatformPanel>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(19rem,0.78fr)_minmax(0,1.6fr)]">
        <PlatformPanel className="min-w-0 overflow-hidden">
          <div className="border-b border-black/[0.06] px-5 py-4">
            <p className="text-sm font-bold text-kreatum-dark">{organizations.length} empresas en esta página</p>
          </div>
          <PlatformError message={listError} />
          {isLoading ? <PlatformLoading label="Cargando empresas" /> : organizations.length === 0 ? (
            <PlatformEmptyState title="Sin resultados" description="Ajusta la búsqueda o crea la primera empresa." />
          ) : (
            <ul className="divide-y divide-black/[0.06]">
              {organizations.map((organization) => (
                <li key={organization.id}>
                  <button type="button" onClick={() => setSelectedId(organization.id)} className={`flex min-h-20 w-full items-center gap-3 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kreatum-purple ${selectedId === organization.id ? 'bg-kreatum-purple/[0.07]' : 'hover:bg-black/[0.025]'}`}>
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-kreatum-purple/10 text-kreatum-purple"><Building2 className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-kreatum-dark">{organization.name}</span>
                      <span className="mt-1 block truncate text-xs text-kreatum-gray/75">{organization.allowedEmailDomains.join(', ') || 'Sin dominio'}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 flex-none text-kreatum-gray/30" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-black/[0.06] p-4">
            <Button variant="ghost" size="sm" onClick={goPrevious} disabled={cursorHistory.length === 0}>Anterior</Button>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={!nextCursor}>Siguiente</Button>
          </div>
        </PlatformPanel>

        <OrganizationDetailPanel
          detail={detail}
          isLoading={isLoadingDetail}
          error={detailError}
          onRefresh={async () => { await loadDetail(); await loadOrganizations(); }}
        />
      </div>
    </div>
  );
}

function OrganizationDetailPanel({
  detail,
  isLoading,
  error,
  onRefresh,
}: {
  detail: PlatformOrganizationDetail | null;
  isLoading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [success, setSuccess] = useState('');
  const [reason, setReason] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [validUntil, setValidUntil] = useState('');

  useEffect(() => {
    if (!detail) return;
    setName(detail.organization.name);
    setDomain(detail.organization.allowedEmailDomains[0] ?? '');
    setValidUntil(toInputDate(detail.organization.validUntil));
    setReason('');
    setAdjustment('');
    setMutationError('');
    setSuccess('');
  }, [detail]);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusy(key);
    setMutationError('');
    setSuccess('');
    try {
      await action();
      await onRefresh();
      setSuccess(message);
      setReason('');
      setAdjustment('');
    } catch (mutationFailure: unknown) {
      setMutationError(getUserFacingError(mutationFailure, 'No se pudo completar la operación.'));
    } finally {
      setBusy('');
    }
  };

  if (isLoading) return <PlatformPanel><PlatformLoading label="Cargando detalle" /></PlatformPanel>;
  if (error) return <PlatformPanel className="p-5"><PlatformError message={error} /></PlatformPanel>;
  if (!detail) return <PlatformPanel><PlatformEmptyState title="Selecciona una empresa" description="Consulta contrato, vigencia, invitación y actividad sin mezclar datos entre organizaciones." /></PlatformPanel>;

  const { organization, facilitators, recentActivity } = detail;
  const invitation = organization.initialFacilitatorInvitation;
  const reasonValid = reason.trim().length >= 5;
  const activityGroups = groupConsecutivePlatformActivity(recentActivity);

  return (
    <PlatformPanel className="min-w-0 overflow-hidden">
      <div className="border-b border-black/[0.06] p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-2xl font-extrabold text-kreatum-dark">{organization.name}</p>
          </div>
          <PlatformStatusBadge status={organization.status} />
        </div>
      </div>

      <div className="grid gap-3 border-b border-black/[0.06] p-5 sm:grid-cols-3 sm:p-6">
        {[
          ['Partidas contratadas', organization.allowance.contracted],
          ['Partidas usadas', organization.allowance.used],
          ['Partidas disponibles', organization.allowance.available],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-black/[0.06] bg-kreatum-bg-light p-4">
            <p className="text-xs font-bold text-kreatum-gray/75">{label}</p>
            <p className="mt-2 text-2xl font-extrabold text-kreatum-dark">{value}</p>
          </div>
        ))}
      </div>

      <div className="space-y-6 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-start gap-3 rounded-2xl bg-black/[0.025] p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-kreatum-purple" aria-hidden="true" />
            <div><p className="text-xs font-bold text-kreatum-gray/75">Dominio permitido</p><p className="mt-1 font-semibold text-kreatum-dark">{organization.allowedEmailDomains.join(', ') || '—'}</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl bg-black/[0.025] p-4">
            <CalendarDays className="mt-0.5 h-5 w-5 text-kreatum-purple" aria-hidden="true" />
            <div><p className="text-xs font-bold text-kreatum-gray/75">Vigencia</p><p className="mt-1 font-semibold text-kreatum-dark">{formatPlatformValidity(organization.validFrom, organization.validUntil)}</p></div>
          </div>
        </div>

        <div>
          <h3 className="font-extrabold text-kreatum-dark">Configuración</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">Nombre<Input className="mt-2" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="text-sm font-bold">Dominio<Input className="mt-2" value={domain} onChange={(event) => setDomain(event.target.value)} /></label>
            <label className="text-sm font-bold" htmlFor="platform-valid-until">Vigencia hasta
              <Input id="platform-valid-until" aria-describedby="platform-valid-until-help" className="mt-2" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              <span id="platform-valid-until-help" className="mt-2 block text-xs font-medium text-kreatum-gray/75">Déjalo vacío para mantener la empresa sin fecha de vencimiento.</span>
            </label>
          </div>
        </div>

        <label className="block text-sm font-bold" htmlFor="platform-operation-reason">
          Motivo de la operación
          <Textarea id="platform-operation-reason" aria-describedby="platform-operation-reason-help" className="mt-2 min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mínimo 5 caracteres; quedará en auditoría" />
          <span id="platform-operation-reason-help" className="mt-2 block text-xs font-medium leading-5 text-kreatum-gray/75">No incluyas datos personales, códigos de sala, contraseñas ni secretos.</span>
        </label>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy !== '' || !reasonValid || !name.trim() || !domain.trim()} onClick={() => void run('update', () => platformApi.updateOrganization({ organizationId: organization.id, name: name.trim(), allowedEmailDomains: [domain.trim().toLowerCase().replace(/^@/, '')], validFrom: typeof organization.validFrom === 'number' ? organization.validFrom : Date.now(), validUntil: validUntil ? new Date(`${validUntil}T23:59:59.999Z`).getTime() : null, reason: reason.trim(), idempotencyKey: createIdempotencyKey('updatePlatformOrganization') }), 'Empresa actualizada.')}>
            {busy === 'update' ? 'Guardando…' : 'Guardar cambios'}
          </Button>
          {organization.status === 'suspended' ? (
            <Button disabled={busy !== '' || !reasonValid} onClick={() => void run('reactivate', () => platformApi.reactivateOrganization({ organizationId: organization.id, reason: reason.trim(), idempotencyKey: createIdempotencyKey('reactivatePlatformOrganization') }), 'Empresa reactivada.')}>
              Reactivar
            </Button>
          ) : (
            <Button variant="danger" disabled={busy !== '' || !reasonValid} onClick={() => void run('suspend', () => platformApi.suspendOrganization({ organizationId: organization.id, reason: reason.trim(), idempotencyKey: createIdempotencyKey('suspendPlatformOrganization') }), 'Empresa suspendida.')}>
              Suspender
            </Button>
          )}
        </div>

        <div className="rounded-2xl border border-black/[0.07] p-4">
          <h3 className="font-extrabold text-kreatum-dark">Ajuste manual de partidas</h3>
          <p className="mt-1 text-xs leading-5 text-kreatum-gray/75">Usa un valor positivo para añadir y negativo para devolver. El motivo es obligatorio y la operación queda auditada.</p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <Input className="sm:max-w-40" type="number" step="1" value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="Ej. 5 o -1" aria-label="Cantidad de partidas" />
            <Button variant="outline" disabled={busy !== '' || !reasonValid || !Number.isInteger(Number(adjustment)) || Number(adjustment) === 0} onClick={() => void run('allowance', () => platformApi.adjustWorkshopAllowance({ organizationId: organization.id, contractedDelta: Number(adjustment), usedDelta: 0, reason: reason.trim(), idempotencyKey: createIdempotencyKey('adjustWorkshopAllowance') }), 'Partidas ajustadas y auditadas.')}>
              {busy === 'allowance' ? 'Aplicando…' : 'Aplicar ajuste'}
            </Button>
          </div>
        </div>

        {invitation && (
          <div className="rounded-2xl border border-black/[0.07] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <Mail className="mt-0.5 h-5 w-5 flex-none text-kreatum-purple" aria-hidden="true" />
                <div className="min-w-0"><p className="font-bold text-kreatum-dark">Invitación inicial</p><p className="mt-1 truncate text-sm text-kreatum-gray/75">{invitation.maskedEmail || 'Email protegido'} · {invitation.status}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={busy !== '' || !reasonValid} onClick={() => void run('resend', () => platformApi.resendInvitation({ organizationId: organization.id, invitationId: invitation.id, reason: reason.trim(), idempotencyKey: createIdempotencyKey('resendPlatformFacilitatorInvitation') }), 'Invitación reenviada.')}><RefreshCw className="h-4 w-4" />Reenviar</Button>
                <Button size="sm" variant="danger" disabled={busy !== '' || !reasonValid} onClick={() => void run('cancel', () => platformApi.cancelInvitation({ organizationId: organization.id, invitationId: invitation.id, reason: reason.trim(), idempotencyKey: createIdempotencyKey('cancelPlatformFacilitatorInvitation') }), 'Invitación cancelada.')}>Cancelar</Button>
              </div>
            </div>
          </div>
        )}

        <PlatformError message={mutationError} />
        {success && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-700" role="status">{success}</p>}

        <div>
          <h3 className="font-extrabold text-kreatum-dark">Facilitadores</h3>
          <p className="mt-1 text-xs leading-5 text-kreatum-gray/75">
            La desactivación se aplica solo a esta empresa y queda registrada en auditoría.
          </p>
          {facilitators.length === 0 ? <p className="mt-2 text-sm text-kreatum-gray/75">Todavía no hay facilitadores.</p> : (
            <ul className="mt-3 divide-y divide-black/[0.06] rounded-2xl border border-black/[0.06]">
              {facilitators.map((facilitator) => {
                const isDisabled = facilitator.status === 'disabled';
                const busyKey = `facilitator-${facilitator.uid}`;
                const targetStatus = isDisabled ? 'active' : 'disabled';
                return (
                  <li key={facilitator.uid} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-kreatum-dark">{facilitator.displayName || facilitator.maskedEmail || 'Facilitador'}</span>
                      {facilitator.displayName && facilitator.maskedEmail && (
                        <span className="mt-1 block truncate text-xs text-kreatum-gray/75">{facilitator.maskedEmail}</span>
                      )}
                      <span className="mt-1 block text-xs text-kreatum-gray/75">
                        {facilitator.assignedWorkshops === 1
                          ? '1 partida asignada'
                          : `${facilitator.assignedWorkshops} partidas asignadas`}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                      {isDisabled ? (
                        <span className="inline-flex rounded-full border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-700">
                          Desactivado
                        </span>
                      ) : <PlatformStatusBadge status={facilitator.status} />}
                      <Button
                        size="sm"
                        variant={isDisabled ? 'outline' : 'danger'}
                        disabled={busy !== '' || !reasonValid}
                        aria-label={`${isDisabled ? 'Reactivar' : 'Desactivar'} a ${facilitator.displayName || facilitator.maskedEmail || 'facilitador'} en ${organization.name}`}
                        onClick={() => void run(
                          busyKey,
                          () => platformApi.changeFacilitatorStatus({
                            organizationId: organization.id,
                            memberId: facilitator.uid,
                            status: targetStatus,
                            reason: reason.trim(),
                            idempotencyKey: createIdempotencyKey('changePlatformFacilitatorStatus'),
                          }),
                          isDisabled
                            ? 'Facilitador reactivado en esta empresa.'
                            : 'Facilitador desactivado en esta empresa.',
                        )}
                      >
                        {busy === busyKey
                          ? (isDisabled ? 'Reactivando…' : 'Desactivando…')
                          : (isDisabled ? 'Reactivar' : 'Desactivar')}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div>
          <h3 className="font-extrabold text-kreatum-dark">Actividad reciente</h3>
          {activityGroups.length === 0 ? <p className="mt-2 text-sm text-kreatum-gray/75">Sin actividad registrada.</p> : (
            <ol className="mt-3 space-y-3">
              {activityGroups.map((group) => {
                const latest = group.items[0];
                const isRepeatedRead = group.isReadGroup && group.items.length > 1;
                return (
                  <li key={group.key} className="min-w-0 rounded-2xl bg-black/[0.025] p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-kreatum-dark">{formatPlatformActivityAction(group.action)}</p>
                        {isRepeatedRead && <p className="mt-1 text-xs font-semibold text-kreatum-purple">{group.items.length} consultas consecutivas agrupadas</p>}
                      </div>
                      <time className="shrink-0 text-xs text-kreatum-gray/75">{formatPlatformDate(latest.createdAt, true)}</time>
                    </div>
                    {isRepeatedRead ? (
                      <details className="mt-3 rounded-xl border border-black/[0.06] bg-white px-3 py-2">
                        <summary className="cursor-pointer text-sm font-bold text-kreatum-purple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple/30">Ver detalle de las consultas</summary>
                        <ol className="mt-2 divide-y divide-black/[0.06]">
                          {group.items.map((item) => (
                            <li key={item.id} className="py-2 text-sm text-kreatum-gray/75">
                              <time className="font-semibold text-kreatum-dark">{formatPlatformDate(item.createdAt, true)}</time>
                              <ExpandableActivityReason reason={item.reason} />
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : <ExpandableActivityReason reason={latest.reason} />}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </PlatformPanel>
  );
}
