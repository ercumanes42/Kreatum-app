import React, { useState, useEffect } from 'react';
import { db } from '../../lib/firebase';
import { collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Team } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  History,
  Search,
  Download,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Calendar,
  Users,
  Trophy,
  Eye,
  CheckCircle2,
} from 'lucide-react';

interface GameRecord {
  id: string;
  roomCode: string;
  status: 'active' | 'completed';
  createdAt: number;
  completedAt?: number;
  client?: string;
  facilitator?: string;
  globalState: any;
  teams: Record<string, any>;
  attacksCount: number;
}

const TEAM_CONFIG: Record<Team, { icon: string; color: string; bg: string }> = {
  Fuego: { icon: '/assets/logos/fuego.png', color: 'text-kreatum-red', bg: 'bg-kreatum-red/10' },
  Agua: { icon: '/assets/logos/agua.png', color: 'text-kreatum-blue', bg: 'bg-kreatum-blue/10' },
  Tierra: { icon: '/assets/logos/tierra.png', color: 'text-kreatum-green', bg: 'bg-kreatum-green/10' },
  Aire: { icon: '/assets/logos/aire.png', color: 'text-kreatum-turquoise', bg: 'bg-kreatum-turquoise/10' },
};

export function GameHistory() {
  const [games, setGames] = useState<GameRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  useEffect(() => {
    loadGames();
  }, []);

  const loadGames = async () => {
    setIsLoading(true);
    try {
      const gamesSnap = await getDocs(collection(db, 'games'));
      const gamesList: GameRecord[] = [];

      for (const gameDoc of gamesSnap.docs) {
        const data = gameDoc.data();
        
        // Load teams
        const teamsSnap = await getDocs(collection(db, 'games', gameDoc.id, 'teams'));
        const teams: Record<string, any> = {};
        teamsSnap.forEach(t => { teams[t.id] = t.data(); });

        // Load attacks
        const attacksSnap = await getDocs(collection(db, 'games', gameDoc.id, 'attacks'));
        
        gamesList.push({
          id: gameDoc.id,
          roomCode: data.roomCode || '---',
          status: data.status === 'completed' ? 'completed' : 'active',
          createdAt: data.createdAt || 0,
          completedAt: data.completedAt,
          client: data.client,
          facilitator: data.facilitator,
          globalState: {
            currentPhase: data.currentPhase,
            challenge: data.challenge,
            client: data.client,
            facilitator: data.facilitator,
            roomCode: data.roomCode,
            status: data.status,
            unlockedPhases: data.unlockedPhases,
          },
          teams,
          attacksCount: attacksSnap.size,
        });
      }

      // Sort by date, newest first
      gamesList.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setGames(gamesList);
    } catch (err) {
      console.error('Error loading games:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const finalizeGame = async (gameId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm('¿Finalizar esta partida? Se marcará como completada.')) return;
    try {
      await setDoc(doc(db, 'games', gameId), { status: 'completed', completedAt: Date.now() }, { merge: true });
      // Update local state
      setGames(prev => prev.map(g => g.id === gameId ? { ...g, status: 'completed', completedAt: Date.now() } : g));
      if (selectedGame?.id === gameId) {
        setSelectedGame(prev => prev ? { ...prev, status: 'completed', completedAt: Date.now() } : null);
      }
    } catch (err) {
      console.error('Error finalizing game:', err);
      alert('Error al finalizar: ' + (err as Error).message);
    }
  };

  const filteredGames = games.filter(game => {
    const matchesSearch = searchTerm === '' ||
      game.roomCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      game.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      Object.keys(game.teams).some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'completed' && game.status === 'completed') ||
      (statusFilter === 'active' && game.status !== 'completed');

    return matchesSearch && matchesStatus;
  });

  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Sin fecha';
    return new Date(timestamp).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const exportToCSV = (game: GameRecord) => {
    const rows: string[][] = [];
    
    // Header
    rows.push([
      'Equipo', 'Fase Actual', 'Reto', 'Perspectiva Definitiva',
      'Solución Definitiva', 'Solución Reformulada', 'Resultados Esperados',
      'Audiencia', 'Fortalezas', 'Debilidades', 'Prueba Piloto', 'Recursos',
      'Pitch - Inicio', 'Pitch - Problema', 'Pitch - Solución', 'Pitch - Acción',
    ]);

    const teamNames: Team[] = ['Agua', 'Aire', 'Fuego', 'Tierra'];
    for (const team of teamNames) {
      const data = game.teams[team] || {};
      rows.push([
        team,
        data.currentPhase || 'Selección',
        data.challenge || '',
        data.selectedPerspective || '',
        data.selectedSolution || '',
        data.reformulatedSolution || '',
        data.expectedResults || '',
        data.audience || '',
        data.strengths || '',
        data.weaknesses || '',
        data.pilot || '',
        data.resources || '',
        data.pitchStart || '',
        data.pitchProblem || '',
        data.pitchSolution || '',
        data.pitchAction || '',
      ]);
    }

    // Escape CSV and generate file
    const csvContent = rows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kreatum_${game.roomCode}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportAllToCSV = () => {
    const rows: string[][] = [];
    rows.push([
      'ID Partida', 'Código Sala', 'Estado', 'Fecha Creación', 'Fecha Fin',
      'Equipo', 'Fase', 'Reto', 'Perspectiva', 'Solución', 'Solución Reformulada',
    ]);

    for (const game of filteredGames) {
      const teamNames: Team[] = ['Agua', 'Aire', 'Fuego', 'Tierra'];
      for (const team of teamNames) {
        const data = game.teams[team] || {};
        rows.push([
          game.id,
          game.roomCode,
          game.status,
          formatDate(game.createdAt),
          game.completedAt ? formatDate(game.completedAt) : '',
          team,
          data.currentPhase || 'Selección',
          data.challenge || '',
          data.selectedPerspective || '',
          data.selectedSolution || '',
          data.reformulatedSolution || '',
        ]);
      }
    }

    const csvContent = rows
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Kreatum_Historial_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─────────────────── DETAIL VIEW ───────────────────
  if (selectedGame) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="space-y-8"
      >
        {/* Back bar */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => { setSelectedGame(null); setExpandedTeam(null); }}
            className="flex items-center gap-2 text-kreatum-purple hover:text-kreatum-purple-dark transition-colors font-medium"
          >
            <ChevronDown className="w-4 h-4 rotate-90" />
            Volver al Historial
          </button>
          <div className="flex gap-3">
            {selectedGame.status !== 'completed' && (
              <Button 
                variant="outline" 
                className="rounded-xl gap-2 h-10 border-amber-500/30 text-amber-600 hover:bg-amber-500/10" 
                onClick={() => finalizeGame(selectedGame.id)}
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalizar Partida
              </Button>
            )}
            <Button variant="outline" className="rounded-xl gap-2 h-10" onClick={() => exportToCSV(selectedGame)}>
              <FileSpreadsheet className="w-4 h-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {/* Game header */}
        <div className="bg-white/50 dark:bg-white/5 backdrop-blur-xl rounded-[28px] border border-black/5 dark:border-white/5 p-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl font-bold font-mono text-kreatum-purple tracking-wider">{selectedGame.roomCode}</span>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  selectedGame.status === 'completed' ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"
                )}>
                  {selectedGame.status === 'completed' ? 'Completada' : 'Activa'}
                </span>
              </div>
              <p className="text-sm font-mono text-kreatum-gray/60 dark:text-white/50">
                {formatDate(selectedGame.createdAt)}
                {selectedGame.completedAt && ` → ${formatDate(selectedGame.completedAt)}`}
              </p>
            </div>
            <div className="flex gap-3">
              {Object.keys(selectedGame.teams).map(team => (
                <div key={team} className={cn("p-2 rounded-xl", TEAM_CONFIG[team as Team]?.bg)}>
                  <img src={TEAM_CONFIG[team as Team]?.icon} alt={team} className="w-8 h-8 object-contain" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Teams detail */}
        <div className="space-y-4">
          {(['Agua', 'Aire', 'Fuego', 'Tierra'] as Team[]).map(team => {
            const data = selectedGame.teams[team];
            if (!data) return null;
            const config = TEAM_CONFIG[team];
            const isExpanded = expandedTeam === team;

            return (
              <Card key={team} className="overflow-hidden border-black/5 dark:border-white/5">
                <div className={cn("h-1.5 w-full", config.color.replace('text-', 'bg-'))} />
                <button
                  onClick={() => setExpandedTeam(isExpanded ? null : team)}
                  className="w-full p-6 flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={cn("p-2 rounded-xl", config.bg)}>
                      <img src={config.icon} alt={team} className="w-8 h-8 object-contain" />
                    </div>
                    <div className="text-left">
                      <h3 className={cn("text-lg font-bold", config.color)}>Equipo {team}</h3>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-5 h-5 opacity-40" /> : <ChevronDown className="w-5 h-5 opacity-40" />}
                </button>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <CardContent className="pt-0 pb-8 px-8 space-y-6">
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {[
                            { label: 'Reto', value: data.challenge },
                            { label: 'Perspectiva Definitiva', value: data.selectedPerspective },
                            { label: 'Solución Definitiva', value: data.selectedSolution },
                            { label: 'Solución Reformulada', value: data.reformulatedSolution },
                            { label: 'Resultados Esperados', value: data.expectedResults },
                            { label: 'Audiencia', value: data.audience },
                            { label: 'Fortalezas', value: data.strengths },
                            { label: 'Debilidades', value: data.weaknesses },
                            { label: 'Prueba Piloto', value: data.pilot },
                            { label: 'Recursos', value: data.resources },
                            { label: 'Pitch - Inicio', value: data.pitchStart },
                            { label: 'Pitch - Problema', value: data.pitchProblem },
                            { label: 'Pitch - Solución', value: data.pitchSolution },
                            { label: 'Pitch - Acción', value: data.pitchAction },
                          ].filter(item => item.value).map(item => (
                            <div key={item.label} className="bg-black/[0.03] dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                              <p className="text-[10px] font-mono uppercase tracking-widest opacity-50 mb-1.5">{item.label}</p>
                              <p className="text-sm leading-relaxed">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      </motion.div>
    );
  }

  // ─────────────────── LIST VIEW ───────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-kreatum-purple/10 rounded-2xl flex items-center justify-center">
            <History className="w-6 h-6 text-kreatum-purple" />
          </div>
          <div>
            <h2 className="text-2xl font-serif font-light tracking-tight text-kreatum-dark dark:text-white">Historial de Partidas</h2>
            <p className="text-xs font-mono text-kreatum-gray/50 dark:text-white/40 uppercase tracking-widest">{games.length} partidas registradas</p>
          </div>
        </div>
        <Button variant="outline" className="rounded-xl gap-2 h-10" onClick={exportAllToCSV} disabled={filteredGames.length === 0}>
          <FileSpreadsheet className="w-4 h-4" />
          Exportar Todo a CSV
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-kreatum-gray/40 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por código de sala o ID..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 h-11 rounded-xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 text-sm font-mono outline-none focus:ring-2 focus:ring-kreatum-purple/30 transition-all"
          />
        </div>
        <div className="flex gap-1 p-1 bg-white dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/10">
          {(['all', 'active', 'completed'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                statusFilter === f
                  ? "bg-kreatum-purple text-white shadow-sm"
                  : "text-kreatum-gray/50 hover:text-kreatum-gray dark:text-white/40 dark:hover:text-white"
              )}
            >
              {f === 'all' ? 'Todas' : f === 'active' ? 'Activas' : 'Completadas'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-2 border-kreatum-purple/30 border-t-kreatum-purple rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-mono text-kreatum-gray/50">Cargando partidas...</p>
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="text-center py-20 bg-white/30 dark:bg-white/5 rounded-[28px] border border-black/5 dark:border-white/5">
          <History className="w-12 h-12 text-kreatum-gray/20 dark:text-white/10 mx-auto mb-4" />
          <p className="text-kreatum-gray/50 dark:text-white/30 font-medium">No se encontraron partidas</p>
          <p className="text-xs text-kreatum-gray/30 dark:text-white/20 mt-1">Intenta con otros filtros</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGames.map((game, idx) => (
            <motion.div
              key={game.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <button
                onClick={() => setSelectedGame(game)}
                className="w-full bg-white/50 dark:bg-white/5 backdrop-blur-xl rounded-2xl border border-black/5 dark:border-white/5 p-5 flex items-center justify-between gap-4 hover:shadow-lg hover:border-kreatum-purple/20 transition-all group text-left"
              >
                <div className="flex items-center gap-5 min-w-0">
                  <div className="shrink-0 w-24 h-14 bg-kreatum-purple/10 rounded-2xl flex items-center justify-center">
                    <span className="text-lg font-bold font-mono text-kreatum-purple tracking-widest">{game.roomCode}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest",
                        game.status === 'completed' ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"
                      )}>
                        {game.status === 'completed' ? 'Completada' : 'Activa'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-kreatum-gray/60 dark:text-white/60">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(game.createdAt).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {Object.keys(game.teams).length} equipos
                      </span>
                      {game.client && (
                        <span className="hidden sm:flex items-center gap-1 truncate max-w-[150px]">
                          <span className="opacity-50">Cliente:</span>
                          <span className="font-medium text-kreatum-dark dark:text-white truncate">{game.client}</span>
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Trophy className="w-3.5 h-3.5" />
                        {game.attacksCount} ataques
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {game.status !== 'completed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl gap-1.5 h-8 text-[10px] font-bold border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/50 uppercase tracking-wider"
                      onClick={(e) => finalizeGame(game.id, e)}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Finalizar
                    </Button>
                  )}
                  <div className="hidden sm:flex gap-1">
                    {Object.keys(game.teams).map(team => (
                      <div key={team} className={cn("p-1 rounded-lg", TEAM_CONFIG[team as Team]?.bg)}>
                        <img src={TEAM_CONFIG[team as Team]?.icon} alt={team} className="w-5 h-5 object-contain" />
                      </div>
                    ))}
                  </div>
                  <Eye className="w-5 h-5 text-kreatum-gray/20 group-hover:text-kreatum-purple transition-colors" />
                </div>
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
