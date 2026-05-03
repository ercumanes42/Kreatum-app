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

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const { gameId, createGame, leaveGame, setIsAlchemist, roomCode } = useGame();

  // State for New Game modal
  const [showNewGameModal, setShowNewGameModal] = useState(false);
  const [newGameClient, setNewGameClient] = useState('');
  const [newGameFacilitator, setNewGameFacilitator] = useState('');
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsCheckingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  const handleCreateGame = async () => {
    if (!newGameFacilitator.trim()) {
      alert('Por favor, introduce el nombre del facilitador (es obligatorio).');
      return;
    }
    setIsCreatingGame(true);
    try {
      await createGame(null, true, { client: newGameClient, facilitator: newGameFacilitator });
      setShowNewGameModal(false);
      setNewGameClient('');
      setNewGameFacilitator('');
    } catch (e: any) {
      alert('Error al crear partida: ' + e.message);
    } finally {
      setIsCreatingGame(false);
    }
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

  // Not authenticated — show full-screen login
  if (!user) {
    return <AdminLoginScreen />;
  }

  // Authenticated but no active game — show empty state
  if (!gameId) {
    return (
      <div className="min-h-screen bg-kreatum-bg-light dark:bg-kreatum-bg-dark relative overflow-hidden">
        {/* Background orbs */}
        <div className="fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[140px] pointer-events-none z-0 bg-kreatum-purple/10" />
        <div className="fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[160px] pointer-events-none z-0 bg-kreatum-blue/10" />

        <div className="relative z-10 min-h-screen flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-lg"
          >
            <div className="w-20 h-20 bg-kreatum-purple rounded-3xl flex items-center justify-center shadow-xl mx-auto mb-8 transform -rotate-3">
              <LayoutDashboard className="w-10 h-10 text-white" />
            </div>
            
            <h1 className="text-4xl font-light tracking-tighter text-kreatum-dark dark:text-white font-serif mb-3">
              Panel del Alquimista
            </h1>
            <p className="text-sm font-mono text-kreatum-gray/60 dark:text-white/50 uppercase tracking-widest mb-12">
              No hay ninguna partida activa
            </p>

            <p className="text-kreatum-gray/70 dark:text-white/60 mb-10 leading-relaxed">
              Crea una nueva partida para comenzar el workshop, o revisa el historial de partidas anteriores.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button
                className="px-8 h-14 rounded-2xl bg-kreatum-purple hover:bg-kreatum-purple-dark text-white shadow-lg shadow-kreatum-purple/20 flex gap-3 items-center text-base"
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

            <div className="mt-8">
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

        {/* New Game Modal */}
        {showNewGameModal && (
          <NewGameModal
            client={newGameClient}
            onClientChange={setNewGameClient}
            facilitator={newGameFacilitator}
            onFacilitatorChange={setNewGameFacilitator}
            isCreating={isCreatingGame}
            onCreate={handleCreateGame}
            onClose={() => setShowNewGameModal(false)}
          />
        )}
      </div>
    );
  }

  // Authenticated with active game — show full AlchemistPanel
  return <AlchemistPanel gameId={gameId} />;
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
      // onAuthStateChanged will pick up the new user
    } catch (err: any) {
      if (
        err.code === 'auth/invalid-credential' ||
        err.code === 'auth/user-not-found' ||
        err.code === 'auth/wrong-password'
      ) {
        setError('Credenciales incorrectas. Verifica tu email y contraseña.');
      } else if (err.code === 'auth/too-many-requests') {
        setError('Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo.');
      } else if (err.code === 'auth/network-request-failed') {
        setError('Error de red. Verifica tu conexión a internet.');
      } else {
        setError(err.message || 'Error de autenticación');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-kreatum-bg-light dark:bg-kreatum-bg-dark">
      {/* Background orbs */}
      <div className="fixed -top-40 -left-40 w-[600px] h-[600px] rounded-full blur-[140px] pointer-events-none z-0 bg-kreatum-purple/15" />
      <div className="fixed bottom-0 right-0 w-[500px] h-[500px] rounded-full blur-[160px] pointer-events-none z-0 bg-kreatum-blue/10" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img src="/logo.png" alt="Kreatum" className="h-12 w-auto object-contain" />
        </div>

        <div className="bg-white/60 dark:bg-white/5 backdrop-blur-2xl border border-black/5 dark:border-white/10 rounded-[32px] shadow-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-kreatum-purple/10 rounded-2xl flex items-center justify-center">
              <LayoutDashboard className="w-8 h-8 text-kreatum-purple" />
            </div>
          </div>

          <h2 className="text-2xl font-serif font-bold text-center mb-2 text-kreatum-dark dark:text-white">
            Acceso Alquimista
          </h2>
          <p className="text-sm font-mono text-center text-kreatum-gray/60 dark:text-white/60 mb-8">
            Solo personal autorizado de Kreatum
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-xl font-mono text-center">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kreatum-gray/40 dark:text-white/40" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@kreatum.com"
                  required
                  className="w-full pl-12 pr-4 py-4 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none transition-colors text-kreatum-dark dark:text-white"
                />
              </div>
              
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-kreatum-gray/40 dark:text-white/40" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Contraseña"
                  required
                  className="w-full pl-12 pr-4 py-4 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none transition-colors text-kreatum-dark dark:text-white"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full py-6 mt-4 rounded-2xl bg-kreatum-purple hover:bg-kreatum-purple-dark text-white font-bold tracking-wide"
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Entrar al Panel'
              )}
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
  isCreating, onCreate, onClose 
}: {
  client: string;
  onClientChange: (v: string) => void;
  facilitator: string;
  onFacilitatorChange: (v: string) => void;
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
            Se generará un código de sala automáticamente
          </p>

          <div className="space-y-4 mb-8">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">
                Nombre del cliente (opcional)
              </label>
              <input
                type="text"
                value={client}
                onChange={(e) => onClientChange(e.target.value)}
                placeholder="Ej: Empresa XYZ"
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none transition-colors text-kreatum-dark dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest opacity-50 mb-2">
                Facilitador (Obligatorio)
              </label>
              <input
                type="text"
                value={facilitator}
                onChange={(e) => onFacilitatorChange(e.target.value)}
                placeholder="Tu nombre"
                className="w-full px-4 py-3 bg-black/5 dark:bg-white/5 border border-transparent focus:border-kreatum-purple rounded-2xl outline-none transition-colors text-kreatum-dark dark:text-white"
              />
            </div>
          </div>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1 py-4 rounded-2xl"
              onClick={onClose}
              disabled={isCreating}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 py-4 rounded-2xl bg-kreatum-purple hover:bg-kreatum-purple-dark text-white disabled:opacity-50"
              onClick={onCreate}
              disabled={isCreating || !facilitator.trim()}
            >
              {isCreating ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Crear Partida'
              )}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

