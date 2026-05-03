import { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, where, orderBy, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { Team, GameState, Phase } from '../types';

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

export function useAttacksReceived(gameId: string | null, myTeam: Team | null) {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId || !myTeam) {
      setAttacks([]);
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'games', gameId, 'attacks'),
      where('toTeam', '==', myTeam)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const attackList: Attack[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          fromTeam: data.fromTeam as Team,
          toTeam: data.toTeam as Team,
          content: data.content,
          timestamp: data.timestamp,
        };
      });
      attackList.sort((a, b) => a.timestamp - b.timestamp);
      setAttacks(attackList);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId, myTeam]);

  return { attacks, isLoading };
}

export function useGameGlobal(gameId: string | null) {
  const [globalState, setGlobalState] = useState<{ currentPhase?: Phase; timer?: number }>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(db, 'games', gameId);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setGlobalState(snapshot.data() as any);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId]);

  const updateGlobalState = async (updates: any) => {
    if (!gameId) return;
    const docRef = doc(db, 'games', gameId);
    await setDoc(docRef, updates, { merge: true });
  };

  return { globalState, updateGlobalState, isLoading };
}

export function useAllTeams(gameId: string | null) {
  const [teams, setTeams] = useState<Record<Team, Partial<GameState>>>({} as any);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setIsLoading(false);
      return;
    }

    const q = collection(db, 'games', gameId, 'teams');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allTeams: any = {};
      snapshot.forEach((doc) => {
        allTeams[doc.id] = doc.data();
      });
      setTeams(allTeams);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId]);

  return { teams, isLoading };
}

export function useTeamSync(gameId: string | null, team: Team | null) {
  const [teamState, setTeamState] = useState<Partial<GameState>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId || !team) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(db, 'games', gameId, 'teams', team);
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setTeamState(snapshot.data() as Partial<GameState>);
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId, team]);

  const updateTeamSync = async (updates: Partial<GameState>) => {
    if (!gameId || !team) return;
    const docRef = doc(db, 'games', gameId, 'teams', team);
    await setDoc(docRef, updates, { merge: true });
  };

  return { teamState, updateTeamSync, isLoading };
}

export function useDefensesReceived(gameId: string | null, myTeam: Team | null) {
  const [defenses, setDefenses] = useState<Defense[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId || !myTeam) {
      setDefenses([]);
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'games', gameId, 'defenses'),
      where('team', '==', myTeam)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const defenseList: Defense[] = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          attackId: data.attackId,
          team: data.team as Team,
          content: data.content,
          timestamp: data.timestamp,
        };
      });
      defenseList.sort((a, b) => b.timestamp - a.timestamp);
      setDefenses(defenseList);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId, myTeam]);

  return { defenses, isLoading };
}

export function useOpponentSolutions(gameId: string | null, myTeam: Team | null) {
  const [solutions, setSolutions] = useState<Record<Team, string>>({} as Record<Team, string>);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId || !myTeam) {
      setSolutions({} as Record<Team, string>);
      setIsLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      collection(db, 'games', gameId, 'solutions'),
      (snapshot) => {
        const sols: Record<Team, string> = {} as Record<Team, string>;
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.team !== myTeam) {
            sols[data.team as Team] = data.content;
          }
        });
        setSolutions(sols);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [gameId, myTeam]);

  return { solutions, isLoading };
}

export function useAttacksSent(gameId: string | null, myTeam: Team | null) {
  const [attacks, setAttacks] = useState<Attack[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!gameId || !myTeam) {
      setAttacks([]);
      setIsLoading(false);
      return;
    }

    const q = query(
      collection(db, 'games', gameId, 'attacks'),
      where('fromTeam', '==', myTeam)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const attackList: Attack[] = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Attack, 'id'>)
      }));
      attackList.sort((a, b) => a.timestamp - b.timestamp);
      setAttacks(attackList);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [gameId, myTeam]);

  return { attacks, isLoading };
}

export function useAttacksCountByTeam(gameId: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!gameId) return;

    const unsubscribe = onSnapshot(
      collection(db, 'games', gameId, 'attacks'),
      (snapshot) => {
        const c: Record<string, number> = {};
        snapshot.forEach((doc) => {
          const from = doc.data().fromTeam as string;
          c[from] = (c[from] || 0) + 1;
        });
        setCounts(c);
      }
    );

    return () => unsubscribe();
  }, [gameId]);

  return counts;
}