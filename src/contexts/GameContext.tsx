import React, { createContext, useContext, useEffect, useState } from 'react';
import { Team } from '../types';
import { db, signInAnonymous, auth } from '../lib/firebase';
import { doc, setDoc, collection, addDoc, updateDoc, getDocs, query, where, writeBatch, deleteDoc } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';



interface GameContextType {
  playerId: string | null;
  gameId: string | null;
  team: Team | null;
  isAlchemist: boolean;
  setIsAlchemist: (val: boolean) => void;
  isLoading: boolean;
  roomCode: string | null;
  createGame: (team: Team | null, asAlchemist?: boolean, metadata?: { client?: string; facilitator?: string; challenge?: string, customCode?: string }) => Promise<string>;
  joinGame: (gameIdOrCode: string, joinAs: Team | 'Alchemist') => Promise<void>;
  leaveGame: () => void;
  sendAttack: (content: string, toTeam: Team, fromTeam: Team) => Promise<void>;
  editAttack: (attackId: string, newContent: string) => Promise<void>;
  sendDefense: (attackId: string, content: string) => Promise<void>;
  updateSolution: (reformulated: string, results: string) => Promise<void>;
  saveSolution: (team: Team, content: string) => Promise<void>;
  validateRoomCode: (code: string) => Promise<boolean>;
  purgeAllGames: () => Promise<void>;
  deleteAttack: (attackId: string) => Promise<void>;
}

const GameContext = createContext<GameContextType | null>(null);

const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 horas

const isSessionExpired = (): boolean => {
  const savedAt = localStorage.getItem('kreatum_session_at');
  if (!savedAt) return true;
  return Date.now() - parseInt(savedAt, 10) > SESSION_EXPIRY_MS;
};

const clearExpiredSession = () => {
  localStorage.removeItem('kreatum_game_id');
  localStorage.removeItem('kreatum_team');
  localStorage.removeItem('kreatum_is_alchemist');
  localStorage.removeItem('kreatum_room_code');
  localStorage.removeItem('kreatum_session_at');
};

export function GameProvider({ children }: { children: React.ReactNode }) {
  const sessionExpired = isSessionExpired();
  if (sessionExpired) clearExpiredSession();

  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(
    sessionExpired ? null : localStorage.getItem('kreatum_game_id')
  );
  const [team, setTeam] = useState<Team | null>(
    sessionExpired ? null : (localStorage.getItem('kreatum_team') as Team)
  );
  const [roomCode, setRoomCode] = useState<string | null>(
    sessionExpired ? null : localStorage.getItem('kreatum_room_code')
  );
  const [isAlchemist, setIsAlchemist] = useState(
    sessionExpired ? false : localStorage.getItem('kreatum_is_alchemist') === 'true'
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setPlayerId(user.uid);
        } else {
          const result = await signInAnonymous();
          setPlayerId(result.user.uid);
        }
      } catch (error) {
        console.error('Error de autenticación anónima:', error);
        // Aunque falle, desbloquear la UI para que el usuario vea la pantalla
        // y pueda intentarlo de nuevo
      } finally {
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const validateRoomCode = async (code: string): Promise<boolean> => {
  const gamesRef = collection(db, 'games');
  const q = query(gamesRef, where('roomCode', '==', code.trim().toUpperCase()));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
};

  const createGame = async (team: Team | null, asAlchemist: boolean = false, metadata?: { client?: string; facilitator?: string; challenge?: string, customCode?: string }): Promise<string> => {
    if (!playerId) throw new Error('No se ha podido identificar al usuario. Reintenta en unos segundos.');

    // Validate room code uniqueness
    let code = metadata?.customCode?.trim().toUpperCase() || '';
    if (code) {
      // Custom code: check uniqueness
      const exists = await validateRoomCode(code);
      if (exists) {
        throw new Error(`El código de sala "${code}" ya está en uso. Elige otro código.`);
      }
    } else {
      // Auto-generated code: keep trying until unique
      let attempts = 0;
      do {
        code = generateRoomCode();
        const exists = await validateRoomCode(code);
        if (!exists) break;
        attempts++;
      } while (attempts < 10);
      if (attempts >= 10) {
        throw new Error('No se pudo generar un código único. Inténtalo de nuevo.');
      }
    }

    const gameRef = await addDoc(collection(db, 'games'), {
      createdAt: Date.now(),
      status: 'active',
      currentPhase: 'Selección',
      roomCode: code,
      client: metadata?.client || '',
      facilitator: metadata?.facilitator || '',
      challenge: metadata?.challenge || '',
      unlockedPhases: ['Selección'],
    });

    const gameId = gameRef.id;

    if (!asAlchemist && team) {
      await setDoc(doc(db, 'games', gameId, 'teams', team), {
        playerId,
        team,
        createdAt: Date.now(),
      });
      setTeam(team);
      localStorage.setItem('kreatum_team', team);
    } else {
      setIsAlchemist(true);
      setTeam(null);
      localStorage.setItem('kreatum_is_alchemist', 'true');
    }

    setGameId(gameId);
    setRoomCode(code);
    
    localStorage.setItem('kreatum_game_id', gameId);
    localStorage.setItem('kreatum_room_code', code);
    localStorage.setItem('kreatum_session_at', Date.now().toString());

    return gameId;
  };

  const joinGame = async (gameIdOrCode: string, joinAs: Team | 'Alchemist') => {
    if (!playerId) throw new Error('No player ID');
    
    const inputCode = gameIdOrCode.trim().toUpperCase();
    if (!inputCode) throw new Error('Por favor, introduce un código de sala válido.');

    // Query the games collection to find the game by roomCode
    const gamesRef = collection(db, 'games');
    const q = query(gamesRef, where('roomCode', '==', inputCode));
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      throw new Error(`No se encontró ninguna sala con el código "${inputCode}". Verifica que el código sea correcto.`);
    }

    const targetGameId = querySnapshot.docs[0].id;
    const targetRoomCode = inputCode;

    if (joinAs === 'Alchemist') {
      setGameId(targetGameId);
      setIsAlchemist(true);
      setTeam(null);
      setRoomCode(targetRoomCode);
      localStorage.setItem('kreatum_game_id', targetGameId);
      localStorage.setItem('kreatum_is_alchemist', 'true');
      localStorage.setItem('kreatum_room_code', targetRoomCode);
      localStorage.setItem('kreatum_session_at', Date.now().toString());
      return;
    }

    // Verificar si este playerId ya está en algún equipo de esta partida
    const teamsRef = collection(db, 'games', targetGameId, 'teams');
    const teamsSnapshot = await getDocs(teamsRef);
    const alreadyInTeam = teamsSnapshot.docs.find(
      (doc) => doc.data().playerId === playerId
    );

    if (alreadyInTeam) {
      const existingTeam = alreadyInTeam.id;
      // Si ya está en el mismo equipo que quiere unirse, simplemente reconectar
      if (existingTeam === joinAs) {
        setGameId(targetGameId);
        setTeam(joinAs as Team);
        setIsAlchemist(false);
        setRoomCode(targetRoomCode);
        localStorage.setItem('kreatum_game_id', targetGameId);
        localStorage.setItem('kreatum_team', joinAs);
        localStorage.setItem('kreatum_is_alchemist', 'false');
        localStorage.setItem('kreatum_room_code', targetRoomCode);
        localStorage.setItem('kreatum_session_at', Date.now().toString());
        return;
      }
      // Si está en un equipo diferente, lanzar error
      throw new Error(`Ya estás registrado en el Equipo ${existingTeam} de esta partida. No puedes cambiar de equipo.`);
    }

    const team = joinAs;
    await setDoc(doc(db, 'games', targetGameId, 'teams', team), {
      playerId,
      team,
      updatedAt: Date.now(),
    }, { merge: true });

    setGameId(targetGameId);
    setTeam(team);
    setIsAlchemist(false);
    setRoomCode(targetRoomCode);
    
    localStorage.setItem('kreatum_game_id', targetGameId);
    localStorage.setItem('kreatum_team', team);
    localStorage.setItem('kreatum_is_alchemist', 'false');
    localStorage.setItem('kreatum_room_code', targetRoomCode);
    localStorage.setItem('kreatum_session_at', Date.now().toString());
  };

  const leaveGame = () => {
    setGameId(null);
    setTeam(null);
    setRoomCode(null);
    setIsAlchemist(false);
    // Only clear Kreatum-specific keys to avoid wiping unrelated localStorage data
    localStorage.removeItem('kreatum_game_id');
    localStorage.removeItem('kreatum_team');
    localStorage.removeItem('kreatum_is_alchemist');
    localStorage.removeItem('kreatum_room_code');
    localStorage.removeItem('kreatum_session_at');
  };

  const purgeAllGames = async () => {
    if (!isAlchemist) return;

    const gamesRef = collection(db, 'games');
    const snapshot = await getDocs(gamesRef);
    const SUB_COLLECTIONS = ['attacks', 'defenses', 'teams', 'solutions'];
    const MAX_BATCH_OPS = 499;

    let batch = writeBatch(db);
    let opCount = 0;

    const commitIfNeeded = async () => {
      if (opCount >= MAX_BATCH_OPS) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    };

    for (const gameDoc of snapshot.docs) {
      // Borrar subcolecciones antes del documento padre
      for (const sub of SUB_COLLECTIONS) {
        const subSnap = await getDocs(collection(db, 'games', gameDoc.id, sub));
        for (const subDoc of subSnap.docs) {
          await commitIfNeeded();
          batch.delete(subDoc.ref);
          opCount++;
        }
      }
      await commitIfNeeded();
      batch.delete(gameDoc.ref);
      opCount++;
    }

    if (opCount > 0) await batch.commit();

    leaveGame();
  };

  const sendAttack = async (content: string, toTeam: Team, fromTeam: Team) => {
    if (!gameId || !playerId) throw new Error('No game or player ID');
    
    await addDoc(collection(db, 'games', gameId, 'attacks'), {
      fromTeam,
      toTeam,
      content,
      timestamp: Date.now(),
      playerId,
    });
  };

  const editAttack = async (attackId: string, newContent: string) => {
    if (!gameId || !playerId) throw new Error('No game or player ID');
    await updateDoc(doc(db, 'games', gameId, 'attacks', attackId), {
      content: newContent,
      editedAt: Date.now(),
    });
  };

  const sendDefense = async (attackId: string, content: string) => {
    if (!gameId || !team || !playerId) throw new Error('Not in a game');

    await addDoc(collection(db, 'games', gameId, 'defenses'), {
      attackId,
      team,
      content,
      timestamp: Date.now(),
      playerId,
    });
  };

  const updateSolution = async (reformulated: string, results: string) => {
    if (!gameId || !team) return;

    await setDoc(doc(db, 'games', gameId, 'teams', team), {
      reformulatedSolution: reformulated,
      expectedResults: results,
    }, { merge: true });
  };

  const saveSolution = async (team: Team, content: string) => {
    if (!gameId) return;
    await setDoc(doc(db, 'games', gameId, 'solutions', team), {
      team,
      content,
      timestamp: Date.now(),
    });
  };

  const deleteAttack = async (attackId: string) => {
    if (!gameId) return;
    await deleteDoc(doc(db, 'games', gameId, 'attacks', attackId));
  };

  return (
    <GameContext.Provider
      value={{
        playerId,
        gameId,
        team,
        isLoading,
        isAlchemist,
        setIsAlchemist,
        roomCode,
        createGame,
        joinGame,
        leaveGame,
        sendAttack,
        editAttack,
        sendDefense,
        updateSolution,
        saveSolution,
        validateRoomCode,
        purgeAllGames,
        deleteAttack,
      }}
    >
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
}