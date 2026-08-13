import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type FirestoreError,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isV2DataModel, workshopCollectionName } from '../lib/dataModel';
import { reportClientError } from '../lib/clientLogger';
import { createIdempotencyKey, workshopApi } from '../lib/workshopApi';
import { PHASES, type GameState, type Phase, type Team } from '../types';

const SAVE_DEBOUNCE_MS = 750;

const toMillis = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const candidate = value as { toMillis?: unknown };
    if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  }
  return 0;
};

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error('Se produjo un error de sincronización.');

const reportSubscriptionError = (
  label: string,
  error: FirestoreError,
  setError: (error: Error) => void,
  setIsLoading: (loading: boolean) => void,
) => {
  reportClientError(label, error);
  setError(error);
  setIsLoading(false);
};

export interface Attack {
  id: string;
  fromTeam: Team;
  toTeam: Team;
  content: string;
  timestamp: number;
}

export interface Defense {
  id: string;
  attackId: string;
  team: Team;
  content: string;
  timestamp: number;
}

export interface ParticipantSession {
  id: string;
  team: Team | null;
  status: 'active' | 'expired';
  joinedAt: number;
  lastSeenAt: number;
  expiresAt: number;
  lastSavedAt: number;
  persistedRevision: number;
  transitionAckId: string | null;
}


export interface WorkshopTransition {
  id: string;
  state: 'requested' | 'committing' | 'committed' | 'completed' | 'cancelled' | 'expired';
  targetPhase?: Phase;
  complete?: boolean;
  requiredAcks: string[] | number;
  receivedAcks: string[] | number;
  requestedAt: number;
  expiresAt: number;
  overrideReason?: string;
}
const mapAttack = (id: string, data: DocumentData): Attack => ({
  id,
  fromTeam: data.fromTeam as Team,
  toTeam: data.toTeam as Team,
  content: typeof data.content === 'string' ? data.content : '',
  timestamp: toMillis(data.timestamp),
});

const mapDefense = (id: string, data: DocumentData): Defense => ({
  id,
  attackId: typeof data.attackId === 'string' ? data.attackId : '',
  team: data.team as Team,
  content: typeof data.content === 'string' ? data.content : '',
  timestamp: toMillis(data.timestamp),
});

const mapParticipantSession = (id: string, data: DocumentData): ParticipantSession => ({
  id,
  team: typeof data.team === 'string' ? data.team as Team : null,
  status: data.status === 'expired' ? 'expired' : 'active',
  joinedAt: toMillis(data.joinedAt),
  lastSeenAt: toMillis(data.lastSeenAt),
  expiresAt: toMillis(data.expiresAt),
  lastSavedAt: toMillis(data.lastSavedAt),
  persistedRevision: typeof data.persistedRevision === 'number' ? data.persistedRevision : 0,
  transitionAckId: typeof data.transitionAckId === 'string' ? data.transitionAckId : null,
});

export function useAttacksReceived(gameId: string | null, myTeam: Team | null) {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId || !myTeam) {
      setAttacks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const attacksQuery = query(
      collection(db, workshopCollectionName, gameId, 'attacks'),
      where('toTeam', '==', myTeam),
    );

    return onSnapshot(
      attacksQuery,
      (snapshot) => {
        setAttacks(snapshot.docs
          .map((item) => mapAttack(item.id, item.data()))
          .sort((a, b) => a.timestamp - b.timestamp));
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to received attacks:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId, myTeam]);

  return { attacks, isLoading, error };
}

export interface GlobalGameState {
  currentPhase?: Phase;
  timer?: number;
  challenge?: string;
  unlockedPhases?: Phase[];
  status?: 'active' | 'completed' | 'archived' | 'pendingDeletion';
  createdAt?: number;
  completedAt?: number;
  sublimarDefenseUnlocked?: boolean;
  sublimarDefenseUnlockedAt?: number;
  transition?: WorkshopTransition | null;
  [key: string]: unknown;
}
export function useGameGlobal(gameId: string | null) {
  const [globalState, setGlobalState] = useState<GlobalGameState>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId) {
      setGlobalState({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const documentRef = doc(db, workshopCollectionName, gameId);
    return onSnapshot(
      documentRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setGlobalState({
            ...data,
            createdAt: toMillis(data.createdAt),
            completedAt: toMillis(data.completedAt),
            sublimarDefenseUnlockedAt: toMillis(data.sublimarDefenseUnlockedAt),
            transition: data.transition && typeof data.transition === 'object'
              ? {
                ...data.transition,
                id: typeof data.transition.id === 'string' ? data.transition.id : typeof data.transition.transitionId === 'string' ? data.transition.transitionId : '',
                state: typeof data.transition.state === 'string' ? data.transition.state : 'requested',
                complete: data.transition.complete === true || data.transition.kind === 'complete',
                requiredAcks: Array.isArray(data.transition.requiredAcks) || typeof data.transition.requiredAcks === 'number' ? data.transition.requiredAcks : [],
                receivedAcks: Array.isArray(data.transition.receivedAcks) || typeof data.transition.receivedAcks === 'number' ? data.transition.receivedAcks : [],
                requestedAt: toMillis(data.transition.requestedAt),
                expiresAt: toMillis(data.transition.expiresAt || data.transition.deadline),
              }
              : null,
          });
        } else {
          setGlobalState({});
          setError(new Error('La partida ya no existe.'));
        }
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to workshop state:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId]);

  const updateGlobalState = useCallback(async (updates: Partial<GlobalGameState>) => {
    if (!gameId) return;
    setError(null);
    try {
      if (!isV2DataModel) {
        await updateDoc(doc(db, workshopCollectionName, gameId), updates);
        return;
      }

      if (updates.currentPhase) {
        if (!PHASES.includes(updates.currentPhase)) {
          throw new Error('La fase solicitada no es válida.');
        }
        await workshopApi.advanceWorkshopPhase({
          workshopId: gameId,
          phase: updates.currentPhase,
          idempotencyKey: createIdempotencyKey('advanceWorkshopPhase'),
        });
      }

      if (updates.status === 'completed') {
        await workshopApi.completeWorkshop({
          workshopId: gameId,
          idempotencyKey: createIdempotencyKey('completeWorkshop'),
        });
      }

      if (typeof updates.sublimarDefenseUnlocked === 'boolean') {
        await workshopApi.updateWorkshopControl({
          workshopId: gameId,
          sublimarDefenseUnlocked: updates.sublimarDefenseUnlocked,
          idempotencyKey: createIdempotencyKey('updateWorkshopControl'),
        });
      }

      const supportedKeys = new Set([
        'currentPhase',
        'unlockedPhases',
        'status',
        'completedAt',
        'sublimarDefenseUnlocked',
        'sublimarDefenseUnlockedAt',
      ]);
      const unsupportedKeys = Object.keys(updates).filter((key) => !supportedKeys.has(key));
      if (unsupportedKeys.length > 0) {
        throw new Error('El control solicitado no está permitido: ' + unsupportedKeys.join(', '));
      }
    } catch (updateError) {
      const normalizedError = toError(updateError);
      setError(normalizedError);
      reportClientError('Error updating workshop state', normalizedError);
      throw normalizedError;
    }
  }, [gameId]);

  return { globalState, updateGlobalState, isLoading, error };
}

export function useAllTeams(gameId: string | null) {
  const [teams, setTeams] = useState<Record<Team, Partial<GameState>>>({} as Record<Team, Partial<GameState>>);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId) {
      setTeams({} as Record<Team, Partial<GameState>>);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    return onSnapshot(
      collection(db, workshopCollectionName, gameId, 'teams'),
      (snapshot) => {
        const allTeams = {} as Record<Team, Partial<GameState>>;
        snapshot.forEach((teamDocument) => {
          allTeams[teamDocument.id as Team] = teamDocument.data() as Partial<GameState>;
        });
        setTeams(allTeams);
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to team state:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId]);

  return { teams, isLoading, error };
}

const V2_TEAM_FIELDS = new Set<keyof GameState>([
  'perspectives',
  'top3Perspectives',
  'perspectiveVotes',
  'selectedPerspective',
  'solutions',
  'top3Solutions',
  'solutionVotes',
  'selectedSolution',
  'receivedSolutionToAttack',
  'attacksOnOthers',
  'receivedAttacks',
  'defenses',
  'reformulatedSolution',
  'expectedResults',
  'sublimarView',
  'sublimarDefenseCompleted',
  'audience',
  'strengths',
  'weaknesses',
  'pilot',
  'resources',
  'pitch',
  'pitchStart',
  'pitchProblem',
  'pitchSolution',
  'pitchAction',
  'isFinished',
]);

const sanitizeTeamUpdates = (updates: Partial<GameState>) =>
  Object.fromEntries(
    Object.entries(updates).filter(([key, value]) =>
      value !== undefined && (!isV2DataModel || V2_TEAM_FIELDS.has(key as keyof GameState)),
    ),
  ) as Partial<GameState>;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'reconnecting' | 'error';

interface SaveQueue {
  scope: string;
  gameId: string;
  team: Team;
  pending: Partial<GameState>;
  timer: number | null;
  chain: Promise<boolean>;
  retryCount: number;
  detached: boolean;
}

export function useTeamSync(gameId: string | null, team: Team | null) {
  const [teamState, setTeamState] = useState<Partial<GameState>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [exists, setExists] = useState<boolean | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const queuesRef = useRef(new Map<string, SaveQueue>());
  const previousScopeRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const currentScope = gameId && team ? `${gameId}/${team}` : null;

  const getQueue = useCallback((scope: string, workshopId: string, teamId: Team) => {
    const existing = queuesRef.current.get(scope);
    if (existing) return existing;
    const queue: SaveQueue = {
      scope,
      gameId: workshopId,
      team: teamId,
      pending: {},
      timer: null,
      chain: Promise.resolve(true),
      retryCount: 0,
      detached: false,
    };
    queuesRef.current.set(scope, queue);
    return queue;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setError(null);
    if (!gameId || !team || !currentScope) {
      setTeamState({});
      setExists(null);
      setLastSavedAt(null);
      setSaveStatus(navigator.onLine ? 'idle' : 'offline');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const documentRef = doc(db, workshopCollectionName, gameId, 'teams', team);
    return onSnapshot(
      documentRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.exists()) {
          const queue = queuesRef.current.get(currentScope);
          const data = snapshot.data();
          setTeamState({
            ...(data as Partial<GameState>),
            ...(queue?.pending || {}),
          });
          setLastSavedAt(toMillis(data.lastSavedAt || data.updatedAt) || null);
          setExists(true);
          if (!snapshot.metadata.hasPendingWrites && queue && Object.keys(queue.pending).length === 0) {
            setSaveStatus(navigator.onLine ? 'saved' : 'offline');
          }
        } else {
          setTeamState({});
          setExists(false);
        }
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to the selected team:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [currentScope, gameId, team]);

  const flushQueue = useCallback(async (queue: SaveQueue): Promise<boolean> => {
    if (queue.timer !== null) {
      window.clearTimeout(queue.timer);
      queue.timer = null;
    }

    const updates = sanitizeTeamUpdates(queue.pending);
    if (Object.keys(updates).length === 0) return queue.chain;
    queue.pending = {};

    const writeOperation = async () => {
      const isCurrent = currentScope === queue.scope;
      if (!navigator.onLine) {
        queue.pending = { ...updates, ...queue.pending };
        if (mountedRef.current && isCurrent) setSaveStatus('offline');
        return false;
      }

      try {
        if (mountedRef.current && isCurrent) {
          setSaveStatus(queue.retryCount > 0 ? 'reconnecting' : 'saving');
          setError(null);
        }
        await setDoc(
          doc(db, workshopCollectionName, queue.gameId, 'teams', queue.team),
          isV2DataModel
            ? { ...updates, updatedAt: serverTimestamp(), lastSavedAt: serverTimestamp() }
            : updates,
          { merge: true },
        );
        queue.retryCount = 0;
        if (mountedRef.current && isCurrent && Object.keys(queue.pending).length === 0) {
          setLastSavedAt(Date.now());
          setSaveStatus('saved');
        }
        return true;
      } catch (writeError) {
        const normalizedError = toError(writeError);
        queue.pending = { ...updates, ...queue.pending };
        queue.retryCount += 1;
        if (mountedRef.current && isCurrent) {
          setSaveStatus(navigator.onLine ? 'error' : 'offline');
          setError(normalizedError);
        }
        reportClientError('Error saving team state', normalizedError);
        if (mountedRef.current && navigator.onLine && !queue.detached) {
          const retryDelay = Math.min(1_000 * (2 ** queue.retryCount), 15_000);
          queue.timer = window.setTimeout(() => void flushQueue(queue), retryDelay);
        }
        return false;
      }
    };

    queue.chain = queue.chain.then(writeOperation, writeOperation);
    return queue.chain;
  }, [currentScope]);

  const flush = useCallback(async () => {
    if (!gameId || !team || !currentScope) return false;
    return flushQueue(getQueue(currentScope, gameId, team));
  }, [currentScope, flushQueue, gameId, getQueue, team]);

  const updateTeamSync = useCallback((updates: Partial<GameState>) => {
    const sanitizedUpdates = sanitizeTeamUpdates(updates);
    if (!gameId || !team || !currentScope || Object.keys(sanitizedUpdates).length === 0) return;

    const queue = getQueue(currentScope, gameId, team);
    queue.pending = { ...queue.pending, ...sanitizedUpdates };
    setTeamState((previous) => ({ ...previous, ...sanitizedUpdates }));
    setSaveStatus(navigator.onLine ? 'saving' : 'offline');
    setError(null);
    if (queue.timer !== null) window.clearTimeout(queue.timer);
    queue.timer = window.setTimeout(() => {
      void flushQueue(queue);
    }, SAVE_DEBOUNCE_MS);
  }, [currentScope, flushQueue, gameId, getQueue, team]);

  useEffect(() => {
    const previousScope = previousScopeRef.current;
    previousScopeRef.current = currentScope;
    if (!previousScope || previousScope === currentScope) return;
    const previousQueue = queuesRef.current.get(previousScope);
    if (!previousQueue) return;
    previousQueue.detached = true;
    if (previousQueue.timer !== null) {
      window.clearTimeout(previousQueue.timer);
      previousQueue.timer = null;
    }
    void flushQueue(previousQueue).finally(() => {
      queuesRef.current.delete(previousScope);
    });
  }, [currentScope, flushQueue]);

  useEffect(() => {
    const handleOffline = () => setSaveStatus('offline');
    const handleOnline = () => {
      setSaveStatus('reconnecting');
      const queue = currentScope ? queuesRef.current.get(currentScope) : null;
      if (!queue) {
        setSaveStatus('idle');
        return;
      }
      void flushQueue(queue).then((saved) => {
        if (saved && Object.keys(queue.pending).length === 0) setSaveStatus('saved');
      });
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    if (!navigator.onLine) handleOffline();
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [currentScope, flushQueue]);

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden' && navigator.onLine) void flush();
    };
    const flushBeforeExit = () => {
      if (navigator.onLine) void flush();
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('pagehide', flushBeforeExit);
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('pagehide', flushBeforeExit);
      void flush();
    };
  }, [flush]);

  return {
    teamState,
    updateTeamSync,
    flush,
    isLoading,
    exists,
    saveStatus,
    lastSavedAt,
    error,
  };
}
export function useParticipantSession(
  gameId: string | null,
  participantId: string | null,
) {
  const [session, setSession] = useState<ParticipantSession | null>(null);
  const [isLoading, setIsLoading] = useState(isV2DataModel);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!isV2DataModel || !gameId || !participantId) {
      setSession(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    return onSnapshot(
      doc(db, workshopCollectionName, gameId, 'participantSessions', participantId),
      (snapshot) => {
        setSession(snapshot.exists()
          ? mapParticipantSession(snapshot.id, snapshot.data())
          : null);
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to participant session:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId, participantId]);

  return { session, isLoading, error };
}

export function useParticipantSessions(gameId: string | null) {
  const [sessions, setSessions] = useState<ParticipantSession[]>([]);
  const [isLoading, setIsLoading] = useState(isV2DataModel);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!isV2DataModel || !gameId) {
      setSessions([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    return onSnapshot(
      collection(db, workshopCollectionName, gameId, 'participantSessions'),
      (snapshot) => {
        setSessions(snapshot.docs
          .map((item) => mapParticipantSession(item.id, item.data()))
          .sort((a, b) => a.joinedAt - b.joinedAt));
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to participant sessions:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId]);

  return { sessions, isLoading, error };
}

export function useDefensesReceived(gameId: string | null, myTeam: Team | null) {
  const [defenses, setDefenses] = useState<Defense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId || !myTeam) {
      setDefenses([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const defensesQuery = query(
      collection(db, workshopCollectionName, gameId, 'defenses'),
      where('team', '==', myTeam),
    );

    return onSnapshot(
      defensesQuery,
      (snapshot) => {
        setDefenses(snapshot.docs
          .map((item) => mapDefense(item.id, item.data()))
          .sort((a, b) => b.timestamp - a.timestamp));
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to received defenses:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId, myTeam]);

  return { defenses, isLoading, error };
}

export function useOpponentSolutions(gameId: string | null, myTeam: Team | null) {
  const [solutions, setSolutions] = useState<Record<Team, string>>({} as Record<Team, string>);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId || !myTeam) {
      setSolutions({} as Record<Team, string>);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    return onSnapshot(
      collection(db, workshopCollectionName, gameId, 'solutions'),
      (snapshot) => {
        const nextSolutions = {} as Record<Team, string>;
        snapshot.forEach((solutionDocument) => {
          const data = solutionDocument.data();
          if (data.team !== myTeam && typeof data.content === 'string') {
            nextSolutions[data.team as Team] = data.content;
          }
        });
        setSolutions(nextSolutions);
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to opponent solutions:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId, myTeam]);

  return { solutions, isLoading, error };
}

export function useAttacksSent(gameId: string | null, myTeam: Team | null) {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId || !myTeam) {
      setAttacks([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const attacksQuery = query(
      collection(db, workshopCollectionName, gameId, 'attacks'),
      where('fromTeam', '==', myTeam),
    );

    return onSnapshot(
      attacksQuery,
      (snapshot) => {
        setAttacks(snapshot.docs
          .map((item) => mapAttack(item.id, item.data()))
          .sort((a, b) => a.timestamp - b.timestamp));
        setIsLoading(false);
      },
      (snapshotError) => reportSubscriptionError(
        'Error subscribing to sent attacks:',
        snapshotError,
        setError,
        setIsLoading,
      ),
    );
  }, [gameId, myTeam]);

  return { attacks, isLoading, error };
}

export function useAttacksCountByTeam(gameId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setError(null);
    if (!gameId) {
      setCounts({});
      return;
    }

    return onSnapshot(
      collection(db, workshopCollectionName, gameId, 'attacks'),
      (snapshot) => {
        const nextCounts: Record<string, number> = {};
        snapshot.forEach((attackDocument) => {
          const from = attackDocument.data().fromTeam as string;
          nextCounts[from] = (nextCounts[from] || 0) + 1;
        });
        setCounts(nextCounts);
      },
      (snapshotError) => {
        reportClientError('Error subscribing to attack counts', snapshotError);
        setError(snapshotError);
      },
    );
  }, [gameId]);

  return { counts, error };
}
