import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Lock, Mail, LayoutDashboard, Plus, History, Clipboard, Check } from 'lucide-react';
import { Button } from './components/ui/Button';
import { cn } from './lib/utils';
import { auth } from './lib/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, User, signOut } from 'firebase/auth';
import { useGame } from './contexts/GameContext';
import { AlchemistPanel } from './components/admin/AlchemistPanel';
import { GameHistory } from './components/admin/GameHistory';
import { ROOM_CODE_MAX_LENGTH } from './types';

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const { gameId, createGame, leaveGame, setIsAlchemist, roomCode } = useGame();

  // State for New Game modal
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [newGameClient, setNewGameClient] = useState('');
  const [newGameFacilitator, setNewGameFacilitator] = useState('');
  const [newGameChallenge, setNewGameChallenge] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [customRoomCode, setCustomRoomCode] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsCheckingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  const [createError, setCreateError] = useState('');

  const handleCreateGame = async () => {
    if (!newGameChallenge.trim()) {
      setCreateError('Por favor, introduce el Reto del Workshop (es obligatorio).');
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
    } catch (e: any) {
      setCreateError(e.message || 'Error al crear partida.');
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

  if (isCheckingAuth) {
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

  // Authenticated but no active game — show empty state
  if (!gameId) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef3f8_100%)] dark:bg-[linear-gradient(180deg,#0d0f15_0%,#090a0e_100%)] relative overflow-hidden font-sans">
        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="text-center max-w-lg"
          >
            <div className="w-16 h-16 bg-kreatum-purple rounded-2xl flex items-center justify-center shadow-[0_16px_34px_-24px_rgba(162,84,156,0.85)] mx-auto mb-6">
              <LayoutDashboard className="w-8 h-8 text-white" />
            </div>
            
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-normal text-kreatum-dark dark:text-white leading-tight mb-3">
              Panel del Alquimista
            </h1>
            <p className="text-sm font-bold text-kreatum-purple mb-8">
              No hay ninguna partida activa
            </p>

            <p className="text-base font-medium text-kreatum-gray/70 dark:text-white/60 mb-8 leading-relaxed">
              Crea una nueva partida para comenzar el workshop, o revisa el historial de partidas anteriores.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                className="px-8 h-12 rounded-xl bg-kreatum-purple hover:bg-kreatum-purple-dark text-white"
                onClick={() => setShowNewGameModal(true)}
              >
                <Plus className="w-5 h-5" />
                Nueva Partida
              </Button>
              <Button
                variant="outline"
                className="px-8 h-12 rounded-xl border-black/10 dark:border-white/10"
                onClick={() => setShowHistory(true)}
              >
                <History className="w-5 h-5" />
                Ver Historial
              </Button>
            </div>

            <div className="mt-8 flex flex-col items-center gap-4">
              <button
                onClick={() => setShowResetModal(true)}
                className="text-xs font-semibold text-red-500/60 hover:text-red-500 transition-colors border border-red-500/20 px-4 py-2 rounded-lg"
              >
                Resetear Plataforma (Danger Zone)
              </button>
              
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-kreatum-gray/45 hover:text-red-500 transition-colors"
              >
                Cerrar Sesión
              </button>
            </div>
          </motion.div>

          {showHistory && (
            <div className="w-full max-w-7xl mt-20">
              <GameHistory />
            </div>
          )}
        </div>

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

  // Authenticated with active game — show full AlchemistPanel
  return <AlchemistPanel gameId={gameId} />;
}

// ─────────────────── RESET MODAL ───────────────────
function ResetModal({ onClose }: { onClose: () => void }) {
  const { purgeAllGames } = useGame();
  const [confirmCode, setConfirmCode] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const CONFIRM_PHRASE = 'BORRAR TODO';

  const handleReset = async () => {
    if (confirmCode !== CONFIRM_PHRASE) {
      setResetError('Escribe exactamente "BORRAR TODO" para confirmar.');
      return;
    }

    setIsResetting(true);
    setResetError('');
    try {
      await purgeAllGames();
      onClose();
    } catch (e: any) {
      setResetError(e.message || 'Error al resetear la plataforma.');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-kreatum-bg-dark p-7 rounded-2xl max-w-md w-full shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)] border border-red-500/20"
      >
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <History className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">Purgar Todas las Partidas</h2>
        <p className="text-sm text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
          Esta acción <span className="text-red-500 font-bold uppercase">eliminará todas las partidas</span>, equipos y datos históricos. No se puede deshacer.
        </p>

        {resetError && (
          <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center mb-4">{resetError}</div>
        )}

        <div className="mb-8">
          <label className="block text-xs font-bold opacity-60 mb-2">
            Escribe <span className="text-red-500 font-bold">BORRAR TODO</span> para confirmar
          </label>
          <input
            type="text"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value.toUpperCase())}
            placeholder="BORRAR TODO"
            className="w-full px-4 py-4 bg-white dark:bg-white/[0.04] border border-red-500/20 focus:border-red-500 rounded-xl outline-none transition-colors text-center font-mono font-bold tracking-[0.2em]"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 py-4" onClick={onClose}>Cancelar</Button>
          <Button 
            className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white"
            onClick={handleReset}
            disabled={isResetting || confirmCode !== CONFIRM_PHRASE}
          >
            {isResetting ? 'Borrando...' : 'Purgar Todo'}
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
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError(err.message || 'Error de autenticación');
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
            {error && <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center">{error}</div>}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-3.5 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full px-4 py-3.5 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
            />
            <Button type="submit" disabled={isLoading} className="w-full h-12 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl">
              {isLoading ? 'Entrando...' : 'Entrar al Panel'}
            </Button>
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative w-full max-w-md overflow-hidden bg-white dark:bg-kreatum-bg-dark border border-black/10 dark:border-white/10 rounded-2xl shadow-[0_24px_60px_-34px_rgba(0,0,0,0.75)]"
      >
        <div className="p-7">
          <h2 className="text-2xl font-extrabold text-center mb-2 text-kreatum-dark dark:text-white">
            Nueva Partida
          </h2>
          <p className="text-sm font-medium text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
            Define los detalles del workshop
          </p>

          <div className="space-y-4 mb-8">
            {error && (
              <div className="p-3 text-sm font-medium text-red-500 bg-red-500/10 rounded-xl text-center">
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold opacity-60 mb-2">
                Reto del Workshop <span className="text-red-400">*</span>
              </label>
              <textarea
                value={challenge}
                onChange={(e) => onChallengeChange(e.target.value)}
                placeholder="Ej: ¿Cómo podemos mejorar la experiencia?"
                required
                rows={3}
                className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors text-kreatum-dark dark:text-white resize-none text-sm"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={client}
                onChange={(e) => onClientChange(e.target.value)}
                placeholder="Cliente"
                className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
              />
              <input
                type="text"
                value={facilitator}
                onChange={(e) => onFacilitatorChange(e.target.value)}
                placeholder="Facilitador"
                className="w-full px-4 py-3 bg-white dark:bg-white/[0.04] border border-black/10 dark:border-white/[0.08] focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-bold opacity-60 mb-2">
                Código Personalizado (opcional)
              </label>
              <input
                type="text"
                value={customCode}
                onChange={(e) => onCustomCodeChange(e.target.value.toUpperCase())}
                placeholder="Ej: PRUEBA"
                maxLength={ROOM_CODE_MAX_LENGTH}
                className="w-full px-4 py-3 bg-kreatum-purple/5 border border-kreatum-purple/20 focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 rounded-xl outline-none text-center font-mono font-bold tracking-[0.2em] text-kreatum-purple"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 py-4" onClick={onClose} disabled={isCreating}>Cancelar</Button>
            <Button
              className="flex-1 py-4 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-xl disabled:opacity-50"
              onClick={onCreate}
              disabled={isCreating || !challenge.trim()}
            >
              {isCreating ? 'Creando...' : 'Crear Partida'}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
