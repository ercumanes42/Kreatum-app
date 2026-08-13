import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, History, LayoutDashboard, Plus, ShieldCheck, Trash2, UsersRound } from 'lucide-react';
import type { OrganizationRole, OrganizationSummary } from '../shared/contracts';
import { Button } from './components/ui/Button';
import { auth } from './lib/firebase';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { useGame } from './contexts/GameContext';
import { ActivityLogPanel } from './components/admin/ActivityLogPanel';
import { AlchemistPanel } from './components/admin/AlchemistPanel';
import { GameHistory } from './components/admin/GameHistory';
import { TeamAccessPanel } from './components/admin/TeamAccessPanel';
import { ROOM_CODE_MAX_LENGTH } from './types';
import { getUserFacingError } from './lib/errors';
import { reportClientError } from './lib/clientLogger';
import { useDialogFocus } from './hooks/useDialogFocus';
import { configuredDefaultOrganizationId, getSelectedOrganizationId, setSelectedOrganizationId } from './lib/dataModel';
import { workshopApi } from './lib/workshopApi';

type AdminSection = 'home' | 'history' | 'team' | 'activity';

const ADMIN_SECTIONS: readonly AdminSection[] = ['home', 'history', 'team', 'activity'];

const readAdminSectionFromUrl = (): AdminSection => {
  const section = new URLSearchParams(window.location.search).get('section');
  return ADMIN_SECTIONS.includes(section as AdminSection) ? section as AdminSection : 'home';
};

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const { gameId, createGame, joinGame, leaveGame } = useGame();

  // State for New Game modal
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [newGameClient, setNewGameClient] = useState('');
  const [newGameFacilitator, setNewGameFacilitator] = useState('');
  const [newGameChallenge, setNewGameChallenge] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>(readAdminSectionFromUrl);

  const handleSectionChange = (section: AdminSection) => {
    const url = new URL(window.location.href);
    if (section === 'home') url.searchParams.delete('section');
    else url.searchParams.set('section', section);
    window.history.pushState(null, '', url);
    setActiveSection(section);
  };
  const [membershipRole, setMembershipRole] = useState<OrganizationRole | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<OrganizationSummary | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(false);
  const [membershipError, setMembershipError] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [customRoomCode, setCustomRoomCode] = useState('');

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!active) return;
      setUser(firebaseUser);
      setIsPlatformAdmin(false);
      if (!firebaseUser || firebaseUser.isAnonymous) {
        setIsCheckingAuth(false);
        return;
      }

      setIsCheckingAuth(true);
      void firebaseUser.getIdTokenResult(true)
        .then((tokenResult) => {
          if (active) setIsPlatformAdmin(tokenResult.claims.platformAdmin === true);
        })
        .catch((error: unknown) => {
          reportClientError('Platform admin claim verification failed', error);
          if (active) setIsPlatformAdmin(false);
        })
        .finally(() => {
          if (active) setIsCheckingAuth(false);
        });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handlePopState = () => setActiveSection(readAdminSectionFromUrl());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!user || user.isAnonymous) {
      setMembershipRole(null);
      setOrganizations([]);
      setActiveOrganization(null);
      setMembershipError('');
      return;
    }
    let active = true;
    setIsCheckingMembership(true);
    const loadMembership = async () => {
      try {
        const result = await workshopApi.listMyOrganizations({
          fallbackOrganizationId: configuredDefaultOrganizationId || undefined,
        });
        if (result.organizations.length === 0) {
          throw new Error('Tu cuenta no tiene acceso administrativo activo.');
        }
        const requestedOrganizationId = new URLSearchParams(window.location.search).get('organization');
        const preferredOrganizationId = requestedOrganizationId || getSelectedOrganizationId();
        const selected = result.organizations.find((organization) => organization.id === preferredOrganizationId)
          ?? result.organizations[0];
        if (active) {
          setSelectedOrganizationId(selected.id);
          setOrganizations(result.organizations);
          setActiveOrganization(selected);
          setMembershipRole(selected.role);
          setMembershipError('');
        }
      } catch (loadError: unknown) {
        if (active) {
          setMembershipRole(null);
          setOrganizations([]);
          setActiveOrganization(null);
          setMembershipError(getUserFacingError(loadError, 'No se pudo validar tu acceso.'));
        }
      } finally {
        if (active) setIsCheckingMembership(false);
      }
    };
    void loadMembership();
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (membershipRole !== 'facilitator' || !['team', 'activity'].includes(activeSection)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('section');
    window.history.replaceState(null, '', url);
    setActiveSection('home');
  }, [activeSection, membershipRole]);

  const [createError, setCreateError] = useState('');

  const handleCreateGame = async () => {
    if (!newGameClient.trim() || !newGameFacilitator.trim() || !newGameChallenge.trim()) {
      setCreateError('Empresa contratante, facilitador y reto son obligatorios.');
      return;
    }
    setCreateError('');
    setIsCreatingGame(true);
    try {
      await createGame(null, true, { 
        client: newGameClient, 
        facilitator: newGameFacilitator, 
        challenge: newGameChallenge,
        customCode: customRoomCode.trim().toUpperCase() || undefined
      });
      handleCloseModal();
    } catch (error: unknown) {
      reportClientError('Error creating workshop', error);
      setCreateError(getUserFacingError(error, 'No se pudo crear la partida.'));
    } finally {
      setIsCreatingGame(false);
    }
  };

  const handleCloseModal = () => {
    setNewGameChallenge('');
    setNewGameClient('');
    setNewGameFacilitator('');
    setCustomRoomCode('');
    setCreateError('');
    setShowNewGameModal(false);
  };

  const handleLogout = async () => {
    leaveGame();
    await signOut(auth);
    setUser(null);
  };

  const handleOrganizationChange = (organizationId: string) => {
    const selected = organizations.find((organization) => organization.id === organizationId);
    if (!selected || selected.id === activeOrganization?.id) return;
    leaveGame();
    setSelectedOrganizationId(selected.id);
    setActiveOrganization(selected);
    setMembershipRole(selected.role);
    const url = new URL(window.location.href);
    url.searchParams.set('organization', selected.id);
    if (selected.role !== 'owner' && ['team', 'activity'].includes(activeSection)) {
      url.searchParams.delete('section');
      setActiveSection('home');
    }
    window.history.replaceState(null, '', url);
  };

  if (isCheckingAuth || (!!user && !user.isAnonymous && isCheckingMembership)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-kreatum-bg-light dark:bg-kreatum-bg-dark">
        <div className="w-8 h-8 border-2 border-kreatum-purple/30 border-t-kreatum-purple rounded-full animate-spin" />
      </div>
    );
  }

  // Not authenticated or is an anonymous player — show full-screen login
  if (!user || user.isAnonymous) {
    return <AdminLoginScreen />;
  }

  if (membershipError || !membershipRole || !activeOrganization) {
    return (
      <main className="min-h-screen grid place-items-center bg-kreatum-bg-light px-6 text-center dark:bg-kreatum-bg-dark">
        <div className="max-w-md rounded-2xl border border-red-500/15 bg-white p-8 shadow-xl dark:bg-white/[0.04]">
          <h1 className="text-2xl font-extrabold text-kreatum-dark dark:text-white">Acceso no disponible</h1>
          <p className="mt-3 text-sm text-red-600" role="alert">{membershipError || 'No se pudo validar tu membresía.'}</p>
          <Button className="mt-6" onClick={handleLogout}>Cerrar sesión</Button>
        </div>
      </main>
    );
  }

  if (!gameId && activeSection === 'team' && membershipRole === 'owner') {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] pt-28 dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)]">
        <AdminNavigation activeSection={activeSection} role={membershipRole} isPlatformAdmin={isPlatformAdmin} organizations={organizations} organizationId={activeOrganization.id} onOrganizationChange={handleOrganizationChange} onChange={handleSectionChange} onLogout={handleLogout} />
        <TeamAccessPanel key={activeOrganization.id} organization={activeOrganization} />
      </div>
    );
  }

  if (!gameId && activeSection === 'activity' && membershipRole === 'owner') {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] pt-28 dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)]">
        <AdminNavigation activeSection={activeSection} role={membershipRole} isPlatformAdmin={isPlatformAdmin} organizations={organizations} organizationId={activeOrganization.id} onOrganizationChange={handleOrganizationChange} onChange={handleSectionChange} onLogout={handleLogout} />
        <ActivityLogPanel key={activeOrganization.id} />
      </div>
    );
  }

  // Authenticated but no active game — show empty state
  if (!gameId) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)] font-sans">
        <AdminNavigation activeSection={activeSection} role={membershipRole} isPlatformAdmin={isPlatformAdmin} organizations={organizations} organizationId={activeOrganization.id} onOrganizationChange={handleOrganizationChange} onChange={handleSectionChange} onLogout={handleLogout} />
        <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-16 pt-24 sm:px-6 sm:pt-28">
          {activeSection === 'history' ? (
            <GameHistory
              key={activeOrganization.id}
              role={membershipRole}
              onResumeActiveGame={(roomCode) => joinGame(roomCode, 'Alchemist')}
            />
          ) : (
          <section className="flex min-h-[calc(100svh-7rem)] items-center justify-center py-8 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="w-full max-w-3xl text-center"
          >
            <div className="w-16 h-16 bg-kreatum-purple rounded-2xl flex items-center justify-center shadow-[0_16px_34px_-24px_rgba(162,84,156,0.85)] mx-auto mb-6">
              <LayoutDashboard className="w-8 h-8 text-white" />
            </div>
            
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-normal text-kreatum-dark dark:text-white leading-tight mb-3">
              Panel del Alquimista
            </h1>
            <p className="text-sm font-bold text-kreatum-purple mb-3">
              No hay una partida abierta en este dispositivo
            </p>
            <p className="mb-8 text-xs font-semibold text-kreatum-gray/70 dark:text-white/60">
              {activeOrganization.branding.displayName}
              {activeOrganization.creditsRemaining !== null && ` · ${activeOrganization.creditsRemaining} partidas disponibles`}
            </p>

            <p className="mx-auto mb-8 max-w-xl text-base font-medium leading-relaxed text-kreatum-gray/70 dark:text-white/60">
              Crea una nueva partida o reanuda una partida activa desde el historial.
            </p>

            <div className="flex flex-col justify-center gap-4 sm:flex-row sm:flex-wrap">
              <Button
                className="h-12 w-full shrink-0 whitespace-nowrap rounded-xl bg-kreatum-purple px-8 text-white hover:bg-kreatum-purple-dark sm:w-auto"
                onClick={() => setShowNewGameModal(true)}
                disabled={activeOrganization.creditsRemaining === 0}
              >
                <Plus className="w-5 h-5" />
                Nueva Partida
              </Button>
              <Button
                variant="outline"
                className="h-12 w-full shrink-0 whitespace-nowrap rounded-xl border-black/10 px-8 dark:border-white/10 sm:w-auto"
                onClick={() => handleSectionChange('history')}
              >
                <History className="w-5 h-5" />
                Ver Historial
              </Button>
              {membershipRole === 'owner' && (
                <Button
                  variant="danger"
                  className="h-12 w-full shrink-0 whitespace-nowrap rounded-xl px-8 sm:w-auto"
                  onClick={() => setShowResetModal(true)}
                >
                  <Trash2 className="h-5 w-5" />
                  Archivar datos
                </Button>
              )}
            </div>

          </motion.div>
          </section>
          )}
        </main>

        {/* Reset Modal */}
        {showResetModal && (
          <ResetModal
            onClose={() => setShowResetModal(false)}
          />
        )}

        {/* New Game Modal */}
        {showNewGameModal && (
          <NewGameModal
            client={newGameClient}
            onClientChange={setNewGameClient}
            facilitator={newGameFacilitator}
            onFacilitatorChange={setNewGameFacilitator}
            challenge={newGameChallenge}
            onChallengeChange={setNewGameChallenge}
            customCode={customRoomCode}
            onCustomCodeChange={setCustomRoomCode}
            error={createError}
            isCreating={isCreatingGame}
            onCreate={handleCreateGame}
            onClose={handleCloseModal}
          />
        )}
      </div>
    );
  }

  // Authenticated with active game: keep the administrative shell available.
  return (
    <div className="min-h-screen bg-kreatum-bg-light dark:bg-kreatum-bg-dark">
      <AdminNavigation
        activeSection={activeSection}
        role={membershipRole}
        isPlatformAdmin={isPlatformAdmin}
        organizations={organizations}
        organizationId={activeOrganization.id}
        onOrganizationChange={handleOrganizationChange}
        onChange={(section) => {
          leaveGame();
          handleSectionChange(section);
        }}
        onLogout={handleLogout}
      />
      <div className="pt-20">
        <AlchemistPanel gameId={gameId} onResetPlatform={() => setShowResetModal(true)} />
      </div>
      {showResetModal && (
        <ResetModal
          onClose={() => setShowResetModal(false)}
        />
      )}
    </div>
  );
}

function AdminNavigation({ activeSection, role, isPlatformAdmin, organizations, organizationId, onOrganizationChange, onChange, onLogout }: {
  activeSection: AdminSection;
  role: OrganizationRole;
  isPlatformAdmin: boolean;
  organizations: OrganizationSummary[];
  organizationId: string;
  onOrganizationChange: (organizationId: string) => void;
  onChange: (section: AdminSection) => void;
  onLogout: () => Promise<void>;
}) {
  const items: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard; ownerOnly?: boolean }> = [
    { id: 'home', label: 'Inicio', icon: LayoutDashboard },
    { id: 'history', label: 'Historial', icon: History },
    { id: 'team', label: 'Equipo y accesos', icon: UsersRound, ownerOnly: true },
    { id: 'activity', label: 'Actividad', icon: Activity, ownerOnly: true },
  ];
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-black/[0.06] bg-white/90 px-3 py-3 shadow-[0_12px_30px_-28px_rgba(16,47,64,0.65)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-kreatum-bg-dark/90 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-4">
        <a href="/admin" className="mr-2 hidden shrink-0 items-center gap-3 xl:flex" aria-label="Inicio del Panel del Alquimista">
          <img src="/logo.png" alt="KREATUM" className="h-7 w-auto" />
          <span className="h-6 w-px bg-black/10 dark:bg-white/10" aria-hidden="true" />
          <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-kreatum-dark/70 dark:text-white/70">Panel</span>
        </a>

        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain" aria-label="Panel de administración">
          {items.filter((item) => !item.ownerOnly || role === 'owner').map((item) => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => onChange(item.id)} aria-current={activeSection === item.id ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple focus-visible:ring-offset-2 sm:min-h-0 ${activeSection === item.id ? 'bg-kreatum-purple text-white' : 'text-kreatum-gray/70 hover:bg-black/[0.04] dark:text-white/65 dark:hover:bg-white/[0.05]'}`}><Icon className="h-4 w-4" />{item.label}</button>;
          })}
          {isPlatformAdmin && (
            <a
              href="/platform"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-kreatum-purple transition-colors hover:bg-kreatum-purple/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple focus-visible:ring-offset-2 sm:min-h-0 dark:text-kreatum-purple-light"
            >
              <ShieldCheck className="h-4 w-4" />
              Plataforma GFS
            </a>
          )}
        </nav>
        {organizations.length > 1 && (
          <label className="shrink-0">
            <span className="sr-only">Organización activa</span>
            <select
              value={organizationId}
              onChange={(event) => onOrganizationChange(event.target.value)}
              className="h-11 max-w-48 rounded-xl border border-black/10 bg-white px-3 text-sm font-bold text-kreatum-dark outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-kreatum-bg-dark dark:text-white sm:h-9"
            >
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>{organization.name}</option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 rounded-xl px-3 sm:h-9 sm:px-4"
          aria-label="Cerrar sesión"
          onClick={() => void onLogout()}
        >
          <span className="sm:hidden">Salir</span>
          <span className="hidden sm:inline">Cerrar sesión</span>
        </Button>
      </div>
    </header>
  );
}

// ─────────────────── RESET MODAL ───────────────────
function ResetModal({ onClose }: { onClose: () => void }) {
  const { purgeAllGames } = useGame();
  const [confirmCode, setConfirmCode] = useState('');
  const [reason, setReason] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const CONFIRM_PHRASE = 'ARCHIVAR TODO';
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);

  const handleReset = async () => {
    if (reason.trim().length < 4) {
      setResetError('Indica el motivo del archivado.');
      return;
    }
    if (confirmCode !== CONFIRM_PHRASE) {
      setResetError('Escribe exactamente "ARCHIVAR TODO" para confirmar.');
      return;
    }

    setIsResetting(true);
    setResetError('');
    setResetSuccess('');
    try {
      const result = await purgeAllGames(reason.trim());
      setReason('');
      setConfirmCode('');
      setResetSuccess(
        result.gamesDeleted > 0
          ? `Se archivaron ${result.gamesDeleted} partidas correctamente.`
          : 'No había partidas pendientes de archivar.'
      );
    } catch (error: unknown) {
      setResetError(getUserFacingError(error, 'No se pudieron archivar las partidas.'));
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="archive-dialog-title">
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-kreatum-bg-dark p-7 rounded-2xl max-w-md w-full shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] border border-red-500/20"
      >
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <History className="w-8 h-8 text-red-500" />
        </div>
        <h2 id="archive-dialog-title" className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">Archivar todas las partidas</h2>
        <p className="text-sm text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
          Las partidas dejarán de estar activas y se conservarán según la política de retención. Esta operación es solo para propietarios.
        </p>

        {resetError && (
          <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center mb-4" role="alert">{resetError}</div>
        )}
        {resetSuccess && (
          <div className="p-3 text-sm font-medium text-kreatum-green bg-kreatum-green/10 rounded-xl text-center mb-4" role="status">{resetSuccess}</div>
        )}

        <div className="mb-8">
          <label htmlFor="archive-reason" className="block text-xs font-bold opacity-60 mb-2">
            Motivo del archivado
          </label>
          <textarea
            id="archive-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setResetError('');
            }}
            required
            maxLength={500}
            rows={3}
            disabled={isResetting || !!resetSuccess}
            className="mb-4 w-full resize-none rounded-xl border border-black/10 bg-white px-4 py-3 outline-none focus:border-kreatum-purple dark:border-white/10 dark:bg-white/[0.04]"
          />
          <label htmlFor="archive-confirmation" className="block text-xs font-bold opacity-60 mb-2">
            Escribe <span className="text-red-500 font-bold">ARCHIVAR TODO</span> para confirmar
          </label>
          <input
            id="archive-confirmation"
            type="text"
            value={confirmCode}
            onChange={(e) => {
              setConfirmCode(e.target.value.toUpperCase());
              setResetError('');
              setResetSuccess('');
            }}
            placeholder="ARCHIVAR TODO"
            disabled={isResetting || !!resetSuccess}
            className="w-full px-4 py-4 bg-white dark:bg-white/[0.04] border border-red-500/20 focus:border-red-500 rounded-xl outline-none transition-colors text-center font-mono font-bold tracking-[0.2em]"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 py-4" onClick={onClose}>
            {resetSuccess ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button 
            className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white"
            onClick={handleReset}
            disabled={isResetting || !!resetSuccess || confirmCode !== CONFIRM_PHRASE || reason.trim().length < 4}
          >
            {isResetting ? 'Archivando...' : 'Archivar Todo'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────── LOGIN SCREEN (full page) ───────────────────
function AdminLoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handlePasswordReset = async () => {
    setError('');
    setNotice('');
    if (!email.trim()) {
      setError('Introduce tu email para recuperar la contraseña.');
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice('Si la cuenta existe, recibirás un enlace para restablecer la contraseña.');
    } catch (resetError: unknown) {
      setError(getUserFacingError(resetError, 'No se pudo solicitar la recuperación.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setIsLoading(true);

    try {
      if (auth.currentUser) {
        await signOut(auth);
      }
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const tokenResult = await credential.user.getIdTokenResult(true);
      if (tokenResult.signInProvider === 'anonymous') {
        await signOut(auth);
        throw new Error(
          'La sesi\u00f3n de administrador no se pudo validar. Cierra las dem\u00e1s pesta\u00f1as de KREATUM y vuelve a intentarlo.',
        );
      }
    } catch (error: unknown) {
      setError(getUserFacingError(error, 'No se pudo iniciar sesión.'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)] font-sans">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative z-10 w-full max-w-md mx-4 reveal-cascade"
      >
        <div className="glass-card rounded-2xl p-8">
          <div className="flex justify-center mb-7">
            <div className="w-16 h-16 bg-kreatum-purple rounded-2xl flex items-center justify-center shadow-[0_16px_34px_-24px_rgba(162,84,156,0.85)]">
              <LayoutDashboard className="w-8 h-8 text-white" />
            </div>
          </div>

          <h2 className="text-3xl font-extrabold tracking-normal text-center mb-2 text-kreatum-dark dark:text-white">
            Acceso Alquimista
          </h2>
          <p className="text-sm font-bold text-center text-kreatum-purple/80">Control Central</p>

          
          <form onSubmit={handleSubmit} className="space-y-4 mt-8">
            {error && <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center" role="alert">{error}</div>}
            {notice && <div className="p-3 text-sm font-medium text-green-700 bg-green-500/10 rounded-xl text-center" role="status">{notice}</div>}
            <label htmlFor="admin-email" className="sr-only">Email</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-3.5 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
            />
            <label htmlFor="admin-password" className="sr-only">Contraseña</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full px-4 py-3.5 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
            />
            <Button type="submit" disabled={isLoading} className="w-full h-12 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl">
              {isLoading ? 'Entrando...' : 'Entrar al Panel'}
            </Button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void handlePasswordReset()}
              className="min-h-11 w-full rounded-xl px-3 text-sm font-bold text-kreatum-purple underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple disabled:opacity-50"
            >
              He olvidado mi contraseña
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────── NEW GAME MODAL ───────────────────
function NewGameModal({ 
  client, onClientChange, 
  facilitator, onFacilitatorChange,
  challenge, onChallengeChange,
  customCode, onCustomCodeChange,
  error,
  isCreating, onCreate, onClose 
}: {
  client: string;
  onClientChange: (v: string) => void;
  facilitator: string;
  onFacilitatorChange: (v: string) => void;
  challenge: string;
  onChallengeChange: (v: string) => void;
  customCode: string;
  onCustomCodeChange: (v: string) => void;
  error: string;
  isCreating: boolean;
  onCreate: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(true, onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="new-game-dialog-title">
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md overflow-hidden bg-white dark:bg-kreatum-bg-dark border border-black/10 dark:border-white/10 rounded-2xl shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)]"
      >
        <div className="p-7">
          <h2 id="new-game-dialog-title" className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">
            Nueva Partida
          </h2>
          <p className="text-sm font-medium text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
            Define los detalles del workshop
          </p>

          <div className="space-y-4 mb-8">
            {error && (
              <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center" role="alert">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="workshop-challenge" className="block text-xs font-bold opacity-60 mb-2">
                Reto del Workshop <span className="text-red-400">*</span>
              </label>
              <textarea
                id="workshop-challenge"
                value={challenge}
                onChange={(e) => onChallengeChange(e.target.value)}
                placeholder="Ej: ¿Cómo podemos mejorar la experiencia?"
                required
                rows={3}
                className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors text-kreatum-dark dark:text-white resize-none text-sm"
              />
            </div>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="workshop-client" className="mb-2 block text-xs font-bold opacity-60">
                  Empresa contratante <span className="text-red-400">*</span>
                </label>
                <input
                  id="workshop-client"
                  type="text"
                  value={client}
                  onChange={(e) => onClientChange(e.target.value)}
                  required
                  maxLength={240}
                  className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
                />
              </div>
              <div>
                <label htmlFor="workshop-facilitator" className="mb-2 block text-xs font-bold opacity-60">
                  Facilitador <span className="text-red-400">*</span>
                </label>
                <input
                  id="workshop-facilitator"
                  type="text"
                  value={facilitator}
                  onChange={(e) => onFacilitatorChange(e.target.value)}
                  required
                  maxLength={240}
                  className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="custom-room-code" className="block text-xs font-bold opacity-60 mb-2">
                Código Personalizado (opcional)
              </label>
              <input
                id="custom-room-code"
                type="text"
                value={customCode}
                onChange={(e) => onCustomCodeChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="Ej: PRUEBA"
                minLength={4}
                maxLength={ROOM_CODE_MAX_LENGTH}
                pattern="[A-Z0-9]+"
                className="w-full px-4 py-3 bg-kreatum-purple/5 border border-kreatum-purple/20 focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none text-center font-mono font-bold tracking-[0.2em] text-kreatum-purple"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 py-4" onClick={onClose} disabled={isCreating}>Cancelar</Button>
            <Button
              className="flex-1 py-4 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl disabled:opacity-50"
              onClick={onCreate}
              disabled={isCreating || !client.trim() || !facilitator.trim() || !challenge.trim()}
            >
              {isCreating ? 'Creando...' : 'Crear Partida'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
