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
      <div className="min-h-screen bg-kreatum-bg-light dark:bg-kreatum-bg-dark relative overflow-hidden font-sans">
        <div className="grain-overlay" />
        {/* Background orbs */}
        <div className="fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[200px] pointer-events-none z-0 bg-kreatum-purple/10 opacity-30" />
        <div className="fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[200px] pointer-events-none z-0 bg-kreatum-blue/10 opacity-30" />

        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-lg"
          >
            <div className="w-20 h-20 bg-kreatum-purple rounded-3xl flex items-center justify-center shadow-xl mx-auto mb-8 transform -rotate-3">
              <LayoutDashboard className="w-10 h-10 text-white" />
            </div>
            
            <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-kreatum-dark dark:text-white leading-none mb-4">
              Panel del Alquimista
            </h1>
            <p className="text-sm font-mono text-kreatum-purple uppercase tracking-[0.3em] font-black mb-12">
              No hay ninguna partida activa
            </p>

            <p className="text-kreatum-gray/70 dark:text-white/60 mb-10 leading-relaxed">
              Crea una nueva partida para comenzar el workshop, o revisa el historial de partidas anteriores.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                className="px-10 h-14 rounded-2xl bg-kreatum-purple hover:bg-kreatum-purple-dark text-white shadow-premium btn-premium flex gap-3 items-center text-base"
                onClick={() => setShowNewGameModal(true)}
              >
                <Plus className="w-5 h-5" />
                Nueva Partida
              </Button>
              <Button
                variant="outline"
                className="px-8 h-14 rounded-2xl flex gap-3 items-center text-base border-black/10 dark:border-white/10"
                onClick={() => setShowHistory(true)}
              >
                <History className="w-5 h-5" />
                Ver Historial
              </Button>
            </div>

            <div className="mt-8 flex flex-col items-center gap-4">
              <button
                onClick={() => setShowResetModal(true)}
                className="text-xs font-mono text-red-500/40 hover:text-red-500 transition-colors uppercase tracking-widest border border-red-500/20 px-4 py-2 rounded-lg"
              >
                Resetear Plataforma (Danger Zone)
              </button>
              
              <button
                onClick={handleLogout}
                className="text-xs font-mono text-kreatum-gray/40 hover:text-red-500 transition-colors uppercase tracking-widest"
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-kreatum-bg-dark p-8 rounded-[32px] max-w-md w-full shadow-2xl border border-red-500/20"
      >
        <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <History className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-2xl font-serif font-bold text-center mb-2 text-kreatum-dark dark:text-white">Purgar Todas las Partidas</h2>
        <p className="text-sm text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
          Esta acción <span className="text-red-500 font-bold uppercase">eliminará todas las partidas</span>, equipos y datos históricos. No se puede deshacer.
        </p>

        {resetError && (
          <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-xl font-mono text-center mb-4">{resetError}</div>
        )}

        <div className="mb-8">
          <label className="block text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">
            Escribe <span className="text-red-500 font-bold">BORRAR TODO</span> para confirmar
          </label>
          <input
            type="text"
            value={confirmCode}
            onChange={(e) => setConfirmCode(e.target.value.toUpperCase())}
            placeholder="BORRAR TODO"
            className="w-full px-4 py-4 bg-black/5 dark:bg-white/5 border-2 border-red-500/20 focus:border-red-500 rounded-2xl outline-none transition-all text-center font-bold tracking-[0.2em]"
          />
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1 py-4" onClick={onClose}>Cancelar</Button>
          <Button 
            className="flex-1 py-4 bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-kreatum-bg-light dark:bg-kreatum-bg-dark font-sans">
      <div className="grain-overlay" />
      <div className="fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[200px] pointer-events-none z-0 bg-kreatum-purple/20 opacity-30" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[200px] pointer-events-none z-0 bg-kreatum-blue/15 opacity-30" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md mx-4 reveal-cascade"
      >
        <div className="glass-card rounded-[40px] p-10 shadow-premium">
          <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-kreatum-purple to-kreatum-purple-dark rounded-[24px] flex items-center justify-center shadow-lg shadow-kreatum-purple/30">
              <LayoutDashboard className="w-10 h-10 text-white" />
            </div>
          </div>

          <h2 className="text-4xl font-black tracking-tighter text-center mb-2 text-kreatum-dark dark:text-white">
            Acceso Alquimista
          </h2>
          <p className="text-[10px] font-mono text-center text-kreatum-purple uppercase tracking-[0.3em] font-black opacity-60">Control Central</p>

          
          <form onSubmit={handleSubmit} className="space-y-4 mt-8">
            {error && <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-xl font-mono text-center">{error}</div>}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-4 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Contraseña"
              className="w-full px-4 py-4 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none"
            />
            <Button type="submit" disabled={isLoading} className="w-full py-6 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-2xl">
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
        className="relative w-full max-w-md overflow-hidden bg-white dark:bg-kreatum-bg-dark border border-black/10 dark:border-white/10 rounded-[32px] shadow-2xl"
      >
        <div className="p-8">
          <h2 className="text-2xl font-serif font-bold text-center mb-2 text-kreatum-dark dark:text-white">
            Nueva Partida
          </h2>
          <p className="text-sm font-mono text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
            Define los detalles del workshop
          </p>

          <div className="space-y-4 mb-8">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-xl font-mono text-center">
                {error}
              </div>
            )}
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">
                Reto del Workshop <span className="text-red-400">*</span>
              </label>
              <textarea
                value={challenge}
                onChange={(e) => onChallengeChange(e.target.value)}
                placeholder="Ej: ¿Cómo podemos mejorar la experiencia?"
                required
                rows={3}
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none transition-colors text-kreatum-dark dark:text-white resize-none text-sm"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={client}
                onChange={(e) => onClientChange(e.target.value)}
                placeholder="Cliente"
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none"
              />
              <input
                type="text"
                value={facilitator}
                onChange={(e) => onFacilitatorChange(e.target.value)}
                placeholder="Facilitador"
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none"
              />
            </div>

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">
                Código Personalizado (opcional)
              </label>
              <input
                type="text"
                value={customCode}
                onChange={(e) => onCustomCodeChange(e.target.value.toUpperCase())}
                placeholder="Ej: PRUEBA"
                maxLength={ROOM_CODE_MAX_LENGTH}
                className="w-full px-4 py-3 bg-kreatum-purple/5 border-dashed border-2 border-kreatum-purple/20 focus:border-kreatum-purple rounded-2xl outline-none text-center font-bold tracking-widest text-kreatum-purple"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 py-4" onClick={onClose} disabled={isCreating}>Cancelar</Button>
            <Button
              className="flex-1 py-4 bg-kreatum-purple hover:bg-kreatum-purple-dark text-white rounded-2xl disabled:opacity-50"
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
