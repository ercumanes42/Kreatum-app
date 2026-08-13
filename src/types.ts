import {
  PHASES,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_MIN_LENGTH,
  TEAMS,
  type Phase,
  type Team,
} from '../shared/contracts';

export {
  PHASES,
  ROOM_CODE_MAX_LENGTH,
  ROOM_CODE_MIN_LENGTH,
  TEAMS,
};
export type { Phase, Team };

export interface GameState {
  team: Team | null;
  currentPhase: Phase;

  // Team assignment metadata
  playerId?: string | null;
  memberIds?: string[];
  createdAt?: number;
  updatedAt?: number;
  assignmentResetAt?: number;
  reassignments?: Record<string, Team>;
  
  // Diluir
  challenge: string;
  perspectives: string[];
  top3Perspectives: [string, string, string];
  perspectiveVotes: [number, number, number];
  selectedPerspective: string;

  // Conjugar
  solutions: string[];
  top3Solutions: [string, string, string];
  solutionVotes: [number, number, number];
  selectedSolution: string;

  // Sublimar
  receivedSolutionToAttack: string;
  attacksOnOthers: string[];
  receivedAttacks: string[];
  defenses: string[];
  reformulatedSolution: string;
  expectedResults: string;
  sublimarView: 'Ataque' | 'Defensa';
  sublimarDefenseCompleted?: boolean;

  // Fermentar
  audience: string;
  strengths: string;
  weaknesses: string;
  pilot: string;
  resources: string;

  // Proyectar
  pitch: string;
  pitchStart: string;
  pitchProblem: string;
  pitchSolution: string;
  pitchAction: string;

  // Session state
  isFinished?: boolean;
}

export const initialState: GameState = {
  team: null,
  currentPhase: 'Selección',
  
  challenge: '',
  perspectives: [''],
  top3Perspectives: ['', '', ''],
  perspectiveVotes: [0, 0, 0],
  selectedPerspective: '',

  solutions: [''],
  top3Solutions: ['', '', ''],
  solutionVotes: [0, 0, 0],
  selectedSolution: '',

  receivedSolutionToAttack: '',
  attacksOnOthers: [''],
  receivedAttacks: [],
  defenses: [''],
  reformulatedSolution: '',
  expectedResults: '',
  sublimarView: 'Ataque',

  audience: '',
  strengths: '',
  weaknesses: '',
  pilot: '',
  resources: '',

  pitch: '',
  pitchStart: '',
  pitchProblem: '',
  pitchSolution: '',
  pitchAction: '',
};
