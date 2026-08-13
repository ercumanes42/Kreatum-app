import React, { useState } from 'react';
import { GameState, ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH, Team } from '../../types';
import { ArrowLeft, LogIn } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';
import { useGame } from '../../contexts/GameContext';
import { Button } from '../ui/Button';
import { getUserFacingError } from '../../lib/errors';

interface Props {
  state: GameState;
  updateState: (updates: Partial<GameState>) => void;
}

type JoinStep = 'code' | 'team';

export function TeamSelection({ state }: Props) {
  const { gameId, roomCode, joinGame, validateRoomCode } = useGame();
  
  // If already in a game, skip to team selection
  const [step, setStep] = useState<JoinStep>(gameId ? 'team' : 'code');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [pendingCode, setPendingCode] = useState(roomCode || '');
  const [joiningTeam, setJoiningTeam] = useState<Team | null>(null);
  
  const teams: { id: Team; name: string; icon: string; color: string; bg: string }[] = [
    { id: 'Agua', name: 'Equipo Agua', icon: '/assets/logos/agua.png', color: 'text-kreatum-blue dark:text-blue-400', bg: 'bg-kreatum-blue/[0.04] hover:bg-kreatum-blue/[0.07] border-kreatum-blue/20' },
    { id: 'Aire', name: 'Equipo Aire', icon: '/assets/logos/aire.png', color: 'text-kreatum-turquoise dark:text-cyan-400', bg: 'bg-kreatum-turquoise/[0.04] hover:bg-kreatum-turquoise/[0.07] border-kreatum-turquoise/20' },
    { id: 'Fuego', name: 'Equipo Fuego', icon: '/assets/logos/fuego.png', color: 'text-kreatum-red dark:text-red-400', bg: 'bg-kreatum-red/[0.04] hover:bg-kreatum-red/[0.07] border-kreatum-red/20' },
    { id: 'Tierra', name: 'Equipo Tierra', icon: '/assets/logos/tierra.png', color: 'text-kreatum-green dark:text-green-400', bg: 'bg-kreatum-green/[0.04] hover:bg-kreatum-green/[0.07] border-kreatum-green/20' },
  ];

  // Step 1: Validate the room code exists in Firestore
  const handleCodeSubmit = async () => {
    const code = roomCodeInput.trim().toUpperCase();
    if (code.length < ROOM_CODE_MIN_LENGTH || code.length > ROOM_CODE_MAX_LENGTH) {
      setCodeError(`El código debe tener entre ${ROOM_CODE_MIN_LENGTH} y ${ROOM_CODE_MAX_LENGTH} caracteres.`);
      return;
    }
    if (!/^[A-Z0-9]+$/.test(code)) {
      setCodeError('El código solo puede contener letras y números.');
      return;
    }
    setCodeError('');
    setIsValidating(true);
    try {
      const exists = await validateRoomCode(code);
      if (!exists) {
        setCodeError(`No se encontró ninguna sala con el código "${code}". Verifica con tu facilitador.`);
        return;
      }
      setPendingCode(code);
      setStep('team');
    } catch (error: unknown) {
      setCodeError(getUserFacingError(error, 'No se pudo verificar el código. Comprueba tu conexión.'));
    } finally {
      setIsValidating(false);
    }
  };

  // Step 2: Join with validated code + chosen team
  const handleJoinWithTeam = async (team: Team) => {
    if (state.team) return; // Prevent clicking if already selected
    setJoiningTeam(team);
    setCodeError('');
    try {
      await joinGame(pendingCode || roomCode || '', team);
    } catch (error: unknown) {
      setCodeError(getUserFacingError(error, 'No se pudo entrar en la sala.'));
      // Go back to code step if the code was invalid
      setStep('code');
    } finally {
      setJoiningTeam(null);
    }
  };

  // ─────────────────── STEP 2: PICK TEAM ───────────────────
  if (step === 'team') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="max-w-3xl mx-auto text-center"
      >
        {pendingCode && (
          <div className="flex items-center justify-center gap-3 mb-4">
            <span className="px-3 py-1.5 bg-kreatum-purple/10 text-kreatum-purple font-mono text-sm font-bold rounded-lg border border-kreatum-purple/20">
              SALA: {pendingCode}
            </span>
          </div>
        )}
        <h1 className="mb-3 text-3xl font-extrabold tracking-normal text-kreatum-dark dark:text-white sm:text-4xl">
          Elige tu equipo
        </h1>
        <p className="text-base font-medium text-kreatum-gray/65 dark:text-white/60 mb-10">
          Selecciona tu equipo para comenzar
        </p>

        {codeError && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-medium text-center" role="alert">
            {codeError}
          </div>
        )}

        <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4">
          {teams.map((t) => {
            const isSelected = state.team === t.id;
            const isOtherSelected = state.team && state.team !== t.id;
            const isCurrentlyJoining = joiningTeam === t.id;
            const isAnyJoining = joiningTeam !== null;

            return (
              <button
                key={t.id}
                disabled={isAnyJoining || !!state.team}
                onClick={() => handleJoinWithTeam(t.id)}
                className={cn(
                  "group relative rounded-2xl border bg-white p-4 text-center shadow-[0_18px_38px_-34px_rgba(16,47,64,0.6)] transition-[color,background-color,border-color,box-shadow,transform] duration-200 dark:bg-white/[0.04] sm:p-7",
                  t.bg,
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple focus-visible:ring-offset-2",
                  isSelected ? "ring-2 ring-offset-2 ring-kreatum-purple dark:ring-offset-kreatum-bg-dark bg-white dark:bg-white/[0.07]" : "",
                  (isOtherSelected || (isAnyJoining && !isCurrentlyJoining)) && "opacity-30 grayscale cursor-not-allowed",
                  (isAnyJoining || !!state.team) && "cursor-default"
                )}
              >
                {isCurrentlyJoining ? (
                  <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-kreatum-purple border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="relative mx-auto mb-3 h-14 w-14 sm:mb-5 sm:h-20 sm:w-20">
                    <img 
                      src={t.icon} 
                      alt={t.name}
                      className={cn(
                        "w-full h-full object-contain drop-shadow-sm transition-transform duration-200",
                        !state.team && !isAnyJoining && "group-hover:scale-[1.03]"
                      )} 
                    />
                    {isSelected && (
                      <motion.div 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="absolute -bottom-2 -right-2 bg-kreatum-purple text-white p-1.5 rounded-lg shadow-lg"
                      >
                        <LogIn className="w-5 h-5" />
                      </motion.div>
                    )}
                  </div>
                )}
                <h3 className={cn("text-sm font-bold tracking-normal sm:text-lg", t.color)}>
                  {isSelected ? `¡Eres ${t.name}!` : t.name}
                </h3>
              </button>
            );
          })}
        </div>

        {pendingCode && (
          <button
            onClick={() => { setStep('code'); setCodeError(''); }}
            className="flex min-h-11 items-center gap-2 mx-auto rounded-lg px-3 text-sm font-semibold text-kreatum-gray/60 dark:text-white/45 hover:text-kreatum-purple transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple"
          >
            <ArrowLeft className="w-4 h-4" />
            Cambiar código
          </button>
        )}
      </motion.div>
    );
  }

  // ─────────────────── STEP 1: ENTER CODE ───────────────────
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="max-w-lg mx-auto"
    >
      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <div className="mb-7 text-center sm:mb-8">
          <p className="mb-3 text-[0.68rem] font-extrabold uppercase tracking-[0.2em] text-kreatum-purple/85">Experiencia colaborativa</p>
          <h1 className="mb-3 text-3xl font-extrabold tracking-normal text-kreatum-dark dark:text-white sm:text-4xl">
            Bienvenido a Kreatum
          </h1>
          <p className="text-base font-medium leading-relaxed text-kreatum-gray/65 dark:text-white/60">
            Ingresa el código de sala que te compartió tu facilitador
          </p>
        </div>

        <div className="space-y-4">
        {codeError && (
          <div id="room-code-error" className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm font-medium text-center" role="alert">
            {codeError}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <label htmlFor="room-code-input" className="sr-only">Código de sala</label>
          <input
            id="room-code-input"
            aria-describedby={codeError ? 'room-code-error' : undefined}
            aria-invalid={!!codeError}
            type="text" 
            value={roomCodeInput}
            onChange={(e) => {
              setRoomCodeInput(e.target.value.toUpperCase());
              setCodeError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleCodeSubmit()}
            placeholder="CÓDIGO" 
            className="h-14 w-full rounded-xl border border-black/10 bg-white px-5 text-center font-mono text-xl font-bold uppercase tracking-[0.22em] text-kreatum-dark outline-none transition-colors focus:border-kreatum-purple/45 focus:ring-2 focus:ring-kreatum-purple/25 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
            maxLength={ROOM_CODE_MAX_LENGTH}
            autoFocus
          />
          <Button
            aria-label="Entrar a la sala"
            className="h-14 rounded-xl px-6 text-white sm:min-w-32"
            disabled={isValidating || !roomCodeInput.trim()}
            onClick={handleCodeSubmit}
          >
            {isValidating ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <><LogIn className="h-5 w-5" /><span>Entrar</span></>
            )}
          </Button>
        </div>
        </div>
      </div>
    </motion.div>
  );
}
