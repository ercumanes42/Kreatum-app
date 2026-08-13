import React, { createContext, useContext, useEffect, useState } from 'react';
import { ROOM_CODE_MAX_LENGTH, ROOM_CODE_MIN_LENGTH, Team } from '../types';
import { db, signInAnonymous, auth } from '../lib/firebase';
import {
  doc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  getDocs,
  query,
  where,
  writeBatch,
  deleteDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  SCHEMA_VERSION,
  TEAMS,
  isRoomCodeValid,
  normalizeRoomCode,
} from '../../shared/contracts';
import {
  isV2DataModel,
  requireDefaultOrganizationId,
  workshopCollectionName,
} from '../lib/dataModel';
import { createIdempotencyKey, workshopApi } from '../lib/workshopApi';
import type { DocumentData, DocumentReference } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { reportClientError } from '../lib/clientLogger';
import {
  participantRecoveryApi,
  type ReconnectParticipantSessionOutput,
} from '../lib/platformApi';



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
  clearTeamSelection: () => void;
  applyTeamReassignment: (team: Team) => void;
  reassignTeamMember: (sourceTeam: Team, memberId: string, destinationTeam: Team) => Promise<void>;
  sendAttack: (content: string, toTeam: Team, fromTeam: Team) => Promise<void>;
  editAttack: (attackId: string, newContent: string) => Promise<void>;
  sendDefense: (attackId: string, content: string) => Promise<void>;
  updateSolution: (reformulated: string, results: string) => Promise<void>;
  saveSolution: (team: Team, content: string) => Promise<void>;
  validateRoomCode: (code: string) => Promise<boolean>;
  purgeAllGames: (reason: string) => Promise<{ gamesDeleted: number; documentsDeleted: number }>;
  deleteAttack: (attackId: string) => Promise<void>;
  reconnectParticipantSession: () => Promise<ReconnectParticipantSessionOutput>;
}

const GameContext = createContext<GameContextType | null>(null);

const TEAM_NAMES: Team[] = [...TEAMS];
const PARTICIPANT_IDENTITY_KEY = 'kreatum_participant_identity_uid';

const clearStoredSession = () => {
  localStorage.removeItem('kreatum_game_id');
  localStorage.removeItem('kreatum_team');
  localStorage.removeItem('kreatum_is_alchemist');
  localStorage.removeItem('kreatum_room_code');
  localStorage.removeItem('kreatum_session_at');
  localStorage.removeItem(PARTICIPANT_IDENTITY_KEY);
};

const isStoredTeam = (value: string | null): value is Team =>
  value !== null && TEAM_NAMES.includes(value as Team);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(() => localStorage.getItem('kreatum_game_id'));
  const [team, setTeam] = useState<Team | null>(() => {
    const storedTeam = localStorage.getItem('kreatum_team');
    return isStoredTeam(storedTeam) ? storedTeam : null;
  });
  const [roomCode, setRoomCode] = useState<string | null>(() => localStorage.getItem('kreatum_room_code'));
  const [isAlchemist, setIsAlchemist] = useState(
    () => localStorage.getItem('kreatum_is_alchemist') === 'true',
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setPlayerId(user.uid);
          const storedIdentityUid = localStorage.getItem(PARTICIPANT_IDENTITY_KEY);
          const hasRememberedParticipant = Boolean(
            localStorage.getItem('kreatum_game_id')
            && localStorage.getItem('kreatum_team'),
          );
          if (hasRememberedParticipant && storedIdentityUid !== user.uid) {
            clearStoredSession();
            setGameId(null);
            setTeam(null);
            setRoomCode(null);
            setIsAlchemist(false);
          }
        } else if (
          window.location.pathname === '/admin'
          || window.location.pathname === '/alquimista'
          || window.location.pathname === '/platform'
        ) {
          setPlayerId(null);
        } else {
          const result = await signInAnonymous();
          setPlayerId(result.user.uid);
        }
      } catch (error) {
        reportClientError('Error de autenticación anónima', error);
        // Aunque falle, desbloquear la UI para que el usuario vea la pantalla
        // y pueda intentarlo de nuevo
      } finally {
        setIsLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const rememberParticipantSession = (
    workshopId: string,
    selectedTeam: Team,
    selectedRoomCode: string,
  ) => {
    if (!playerId) throw new Error('No se pudo verificar la identidad de este navegador.');
    localStorage.setItem('kreatum_game_id', workshopId);
    localStorage.setItem('kreatum_team', selectedTeam);
    localStorage.setItem('kreatum_is_alchemist', 'false');
    localStorage.setItem('kreatum_room_code', selectedRoomCode);
    localStorage.setItem('kreatum_session_at', Date.now().toString());
    localStorage.setItem(PARTICIPANT_IDENTITY_KEY, playerId);
  };

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const assertValidRoomCode = (code: string) => {
  if (!isRoomCodeValid(code)) {
    throw new Error(
      'El código debe contener entre '
        + ROOM_CODE_MIN_LENGTH
        + ' y '
        + ROOM_CODE_MAX_LENGTH
        + ' letras o números.',
    );
  }
};

const validateRoomCode = async (code: string): Promise<boolean> => {
  const normalizedCode = normalizeRoomCode(code);
  if (!isRoomCodeValid(normalizedCode)) return false;

  if (isV2DataModel) {
    try {
      await workshopApi.joinWorkshopByCode({
        roomCode: normalizedCode,
        idempotencyKey: createIdempotencyKey('validateRoomCode'),
      });
      return true;
    } catch (error) {
      const errorCode = typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : '';
      if (errorCode.includes('not-found')) return false;
      throw error;
    }
  }

  const gamesRef = collection(db, workshopCollectionName);
  const q = query(gamesRef, where('roomCode', '==', normalizedCode));
  const snapshot = await getDocs(q);
  return !snapshot.empty;
};

  const createGame = async (team: Team | null, asAlchemist: boolean = false, metadata?: { client?: string; facilitator?: string; challenge?: string, customCode?: string }): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!asAlchemist || !currentUser || currentUser.isAnonymous || !currentUser.email) {
      throw new Error('Solo el Alquimista autenticado puede crear partidas.');
    }

    if (isV2DataModel) {
      const tokenResult = await currentUser.getIdTokenResult(true);
      if (tokenResult.signInProvider === 'anonymous') {
        throw new Error(
          'La sesi\u00f3n de administrador no se pudo validar. Cierra las dem\u00e1s pesta\u00f1as de KREATUM y vuelve a identificarte.',
        );
      }
      const result = await workshopApi.createWorkshop({
        organizationId: requireDefaultOrganizationId(),
        client: metadata?.client || '',
        facilitator: metadata?.facilitator || '',
        challenge: metadata?.challenge || '',
        customCode: metadata?.customCode || undefined,
        idempotencyKey: createIdempotencyKey('createWorkshop'),
      });

      setGameId(result.workshopId);
      setRoomCode(result.roomCode);
      setIsAlchemist(true);
      setTeam(null);
      localStorage.setItem('kreatum_game_id', result.workshopId);
      localStorage.setItem('kreatum_room_code', result.roomCode);
      localStorage.setItem('kreatum_is_alchemist', 'true');
      localStorage.setItem('kreatum_session_at', Date.now().toString());
      return result.workshopId;
    }

    // Validate room code uniqueness
    let code = normalizeRoomCode(metadata?.customCode || '');
    if (code) {
      assertValidRoomCode(code);
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

    const gameRef = await addDoc(collection(db, workshopCollectionName), {
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
      await setDoc(doc(db, workshopCollectionName, gameId, 'teams', team), {
        playerId,
        memberIds: [playerId],
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
    
    const inputCode = normalizeRoomCode(gameIdOrCode);
    if (!inputCode) throw new Error('Por favor, introduce un código de sala válido.');
    assertValidRoomCode(inputCode);

    if (isV2DataModel) {
      if (joinAs === 'Alchemist') {
        const currentUser = auth.currentUser;
        if (!currentUser || currentUser.isAnonymous || !currentUser.email) {
          throw new Error('Solo el Alquimista autenticado puede recuperar una partida.');
        }
        const resumedWorkshop = await workshopApi.resumeWorkshopByCode({
          roomCode: inputCode,
          idempotencyKey: createIdempotencyKey('resumeWorkshopByCode'),
        });
        setGameId(resumedWorkshop.workshopId);
        setIsAlchemist(true);
        setTeam(null);
        setRoomCode(resumedWorkshop.roomCode);
        localStorage.setItem('kreatum_game_id', resumedWorkshop.workshopId);
        localStorage.setItem('kreatum_is_alchemist', 'true');
        localStorage.setItem('kreatum_room_code', resumedWorkshop.roomCode);
        localStorage.setItem('kreatum_session_at', Date.now().toString());
        return;
      }

      const joinedWorkshop = await workshopApi.joinWorkshopByCode({
        roomCode: inputCode,
        idempotencyKey: createIdempotencyKey('joinWorkshopByCode'),
      });
      const selectedTeam = joinAs as Team;
      await workshopApi.selectTeam({
        workshopId: joinedWorkshop.workshopId,
        team: selectedTeam,
        idempotencyKey: createIdempotencyKey('selectTeam'),
      });

      setGameId(joinedWorkshop.workshopId);
      setTeam(selectedTeam);
      setIsAlchemist(false);
      setRoomCode(joinedWorkshop.roomCode);
      rememberParticipantSession(joinedWorkshop.workshopId, selectedTeam, joinedWorkshop.roomCode);
      return;
    }

    // Query the games collection to find the game by roomCode
    const gamesRef = collection(db, workshopCollectionName);
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

    const team = joinAs as Team;
    await runTransaction(db, async (transaction) => {
      const teamRefs = TEAM_NAMES.map((teamName) => doc(db, workshopCollectionName, targetGameId, 'teams', teamName));
      const teamSnapshots = await Promise.all(teamRefs.map((teamRef) => transaction.get(teamRef)));

      const existingMembership = teamSnapshots.find((snapshot) => {
        if (!snapshot.exists()) return false;
        const data = snapshot.data();
        const members = Array.isArray(data.memberIds) ? data.memberIds : [];
        return data.playerId === playerId || members.includes(playerId);
      });

      if (existingMembership && existingMembership.id !== team) {
        throw new Error(`Ya estás registrado en el Equipo ${existingMembership.id} de esta partida. El Alquimista debe reabrir tu selección para que puedas cambiar.`);
      }

      const selectedTeamRef = doc(db, workshopCollectionName, targetGameId, 'teams', team);
      const selectedTeamSnapshot = teamSnapshots.find((snapshot) => snapshot.id === team);
      const now = Date.now();

      if (selectedTeamSnapshot?.exists()) {
        const data = selectedTeamSnapshot.data();
        const currentMembers = Array.isArray(data.memberIds)
          ? data.memberIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
          : [];
        const legacyOwner = typeof data.playerId === 'string' && data.playerId.length > 0
          ? data.playerId
          : null;
        const memberIds = Array.from(new Set([
          ...(legacyOwner ? [legacyOwner] : []),
          ...currentMembers,
          playerId,
        ]));

        transaction.update(selectedTeamRef, {
          playerId: legacyOwner || playerId,
          memberIds,
          updatedAt: now,
        });
      } else {
        transaction.set(selectedTeamRef, {
          playerId,
          memberIds: [playerId],
          team,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    setGameId(targetGameId);
    setTeam(team);
    setIsAlchemist(false);
    setRoomCode(targetRoomCode);
    rememberParticipantSession(targetGameId, team, targetRoomCode);
  };

  const reconnectParticipantSession = async () => {
    if (!gameId || !team || !playerId) throw new Error('No hay una sesión anterior que recuperar.');
    if (localStorage.getItem(PARTICIPANT_IDENTITY_KEY) !== playerId) {
      throw Object.assign(new Error('La identidad del navegador ha cambiado.'), {
        code: 'functions/unauthenticated',
      });
    }
    const result = await participantRecoveryApi.reconnect({
      workshopId: gameId,
      team,
      idempotencyKey: createIdempotencyKey('reconnectParticipantSession'),
    });
    setRoomCode(result.roomCode);
    rememberParticipantSession(result.workshopId, result.team, result.roomCode);
    return result;
  };

  const leaveGame = () => {
    setGameId(null);
    setTeam(null);
    setRoomCode(null);
    setIsAlchemist(false);
    // Only clear Kreatum-specific keys to avoid wiping unrelated localStorage data
    clearStoredSession();
  };

  const clearTeamSelection = () => {
    setTeam(null);
    setIsAlchemist(false);
    localStorage.removeItem('kreatum_team');
    localStorage.setItem('kreatum_is_alchemist', 'false');
    localStorage.setItem('kreatum_session_at', Date.now().toString());
  };

  const applyTeamReassignment = (reassignedTeam: Team) => {
    setTeam(reassignedTeam);
    setIsAlchemist(false);
    localStorage.setItem('kreatum_team', reassignedTeam);
    localStorage.setItem('kreatum_is_alchemist', 'false');
    localStorage.setItem('kreatum_session_at', Date.now().toString());
  };

  const reassignTeamMember = async (sourceTeam: Team, memberId: string, destinationTeam: Team) => {
    if (!gameId) throw new Error('No hay una partida activa.');
    if (sourceTeam === destinationTeam) throw new Error('Elige un equipo de destino diferente.');
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.isAnonymous || !currentUser.email) {
      throw new Error('Solo el Alquimista autenticado puede reasignar dispositivos.');
    }

    if (isV2DataModel) {
      await workshopApi.reassignParticipant({
        workshopId: gameId,
        participantId: memberId,
        destinationTeam,
        idempotencyKey: createIdempotencyKey('reassignParticipant'),
      });
      return;
    }

    const gameRef = doc(db, workshopCollectionName, gameId);
    const sourceRef = doc(db, workshopCollectionName, gameId, 'teams', sourceTeam);
    const destinationRef = doc(db, workshopCollectionName, gameId, 'teams', destinationTeam);

    await runTransaction(db, async (transaction) => {
      const [gameSnapshot, sourceSnapshot, destinationSnapshot] = await Promise.all([
        transaction.get(gameRef),
        transaction.get(sourceRef),
        transaction.get(destinationRef),
      ]);

      if (!gameSnapshot.exists() || gameSnapshot.data().status === 'completed') {
        throw new Error('La partida ya no está activa.');
      }
      if (!sourceSnapshot.exists()) {
        throw new Error(`El Equipo ${sourceTeam} no tiene dispositivos asignados.`);
      }

      const sourceData = sourceSnapshot.data();
      const sourceMembers = Array.from(new Set([
        ...(typeof sourceData.playerId === 'string' ? [sourceData.playerId] : []),
        ...(Array.isArray(sourceData.memberIds) ? sourceData.memberIds : []),
      ]));

      if (!sourceMembers.includes(memberId)) {
        throw new Error('Ese dispositivo ya no pertenece al equipo de origen.');
      }

      const remainingSourceMembers = sourceMembers.filter((id) => id !== memberId);
      const destinationData = destinationSnapshot.exists() ? destinationSnapshot.data() : {};
      const destinationMembers = Array.from(new Set([
        ...(typeof destinationData.playerId === 'string' ? [destinationData.playerId] : []),
        ...(Array.isArray(destinationData.memberIds) ? destinationData.memberIds : []),
        memberId,
      ]));
      const reassignments = {
        ...(sourceData.reassignments && typeof sourceData.reassignments === 'object'
          ? sourceData.reassignments
          : {}),
        [memberId]: destinationTeam,
      };
      const destinationReassignments = {
        ...(destinationData.reassignments && typeof destinationData.reassignments === 'object'
          ? destinationData.reassignments
          : {}),
      };
      delete destinationReassignments[memberId];
      const now = Date.now();

      transaction.update(sourceRef, {
        playerId: sourceData.playerId === memberId
          ? remainingSourceMembers[0] || null
          : sourceData.playerId || remainingSourceMembers[0] || null,
        memberIds: remainingSourceMembers,
        reassignments,
        updatedAt: now,
      });

      transaction.set(destinationRef, {
        team: destinationTeam,
        playerId: typeof destinationData.playerId === 'string' && destinationData.playerId
          ? destinationData.playerId
          : memberId,
        memberIds: destinationMembers,
        reassignments: destinationReassignments,
        createdAt: destinationData.createdAt || now,
        updatedAt: now,
      }, { merge: true });
    });
  };

  const purgeAllGames = async (reason: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.isAnonymous || !currentUser.email) {
      throw new Error('Solo el administrador autenticado puede archivar las partidas.');
    }

    if (isV2DataModel) {
      const organizationId = requireDefaultOrganizationId();
      const result = await workshopApi.archiveOrganizationWorkshops({
        organizationId,
        reason,
        idempotencyKey: createIdempotencyKey('archiveOrganizationWorkshops'),
      });
      leaveGame();
      return {
        gamesDeleted: result.archivedCount,
        documentsDeleted: result.archivedCount,
      };
    }

    const gamesRef = collection(db, workshopCollectionName);
    const snapshot = await getDocs(gamesRef);
    const SUB_COLLECTIONS = ['attacks', 'defenses', 'teams', 'solutions'];
    const MAX_BATCH_OPS = 499;

    let batch = writeBatch(db);
    let opCount = 0;
    let gamesDeleted = 0;
    let documentsDeleted = 0;

    const commitBatch = async () => {
      if (opCount > 0) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    };

    const queueDelete = async (ref: DocumentReference<DocumentData>) => {
      batch.delete(ref);
      opCount++;
      documentsDeleted++;
      if (opCount >= MAX_BATCH_OPS) {
        await commitBatch();
      }
    };

    for (const gameDoc of snapshot.docs) {
      // Borrar subcolecciones antes del documento padre
      for (const sub of SUB_COLLECTIONS) {
        const subSnap = await getDocs(collection(db, workshopCollectionName, gameDoc.id, sub));
        for (const subDoc of subSnap.docs) {
          await queueDelete(subDoc.ref);
        }
      }
      await queueDelete(gameDoc.ref);
      gamesDeleted++;
    }

    await commitBatch();

    leaveGame();
    return { gamesDeleted, documentsDeleted };
  };

  const sendAttack = async (content: string, toTeam: Team, fromTeam: Team) => {
    if (!gameId || !playerId) throw new Error('No game or player ID');

    if (isV2DataModel) {
      await workshopApi.submitWorkshopAttack({
        workshopId: gameId,
        toTeam,
        content,
        idempotencyKey: createIdempotencyKey('submitWorkshopAttack'),
      });
      return;
    }

    await addDoc(collection(db, workshopCollectionName, gameId, 'attacks'), {
      fromTeam,
      toTeam,
      content,
      timestamp: Date.now(),
      playerId,
    });
  };

  const editAttack = async (attackId: string, newContent: string) => {
    if (!gameId || !playerId) throw new Error('No game or player ID');
    if (isV2DataModel) {
      await workshopApi.updateWorkshopAttack({
        workshopId: gameId,
        attackId,
        content: newContent,
        idempotencyKey: createIdempotencyKey('updateWorkshopAttack'),
      });
      return;
    }
    await updateDoc(doc(db, workshopCollectionName, gameId, 'attacks', attackId), {
      content: newContent,
      editedAt: Date.now(),
    });
  };

  const sendDefense = async (attackId: string, content: string) => {
    if (!gameId || !team || !playerId) throw new Error('Not in a game');
    if (isV2DataModel) {
      await workshopApi.saveWorkshopDefense({
        workshopId: gameId,
        attackId,
        content,
        idempotencyKey: createIdempotencyKey('saveWorkshopDefense'),
      });
      return;
    }

    await addDoc(collection(db, workshopCollectionName, gameId, 'defenses'), {
      attackId,
      team,
      content,
      timestamp: Date.now(),
      playerId,
    });
  };
  const updateSolution = async (reformulated: string, results: string) => {
    if (!gameId || !team) return;

    await setDoc(doc(db, workshopCollectionName, gameId, 'teams', team), {
      reformulatedSolution: reformulated,
      expectedResults: results,
      ...(isV2DataModel ? { updatedAt: serverTimestamp() } : {}),
    }, { merge: true });
  };

  const saveSolution = async (team: Team, content: string) => {
    if (!gameId) return;
    await setDoc(doc(db, workshopCollectionName, gameId, 'solutions', team), {
      team,
      content,
      timestamp: isV2DataModel ? serverTimestamp() : Date.now(),
      ...(isV2DataModel ? { schemaVersion: SCHEMA_VERSION } : {}),
    });
  };

  const deleteAttack = async (attackId: string) => {
    if (!gameId) return;
    if (isV2DataModel) {
      await workshopApi.deleteWorkshopAttack({
        workshopId: gameId,
        attackId,
        idempotencyKey: createIdempotencyKey('deleteWorkshopAttack'),
      });
      return;
    }
    await deleteDoc(doc(db, workshopCollectionName, gameId, 'attacks', attackId));
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
        clearTeamSelection,
        applyTeamReassignment,
        reassignTeamMember,
        sendAttack,
        editAttack,
        sendDefense,
        updateSolution,
        saveSolution,
        validateRoomCode,
        purgeAllGames,
        deleteAttack,
        reconnectParticipantSession,
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
