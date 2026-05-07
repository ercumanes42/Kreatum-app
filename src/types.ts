export type Team = 'Fuego' | 'Agua' | 'Aire' | 'Tierra';

export type Phase = 
  | 'Selección' 
  | 'Calcinar' 
  | 'Diluir' 
  | 'Conjugar' 
  | 'Sublimar' 
  | 'Fermentar' 
  | 'Proyectar';

export const PHASES: Phase[] = [
  'Selección',
  'Calcinar',
  'Diluir',
  'Conjugar',
  'Sublimar',
  'Fermentar',
  'Proyectar'
];

export interface GameState {
  team: Team | null;
  currentPhase: Phase;
  
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
