import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth, db } from '../../lib/firebase';
import { collection, getDocs, doc, limit, orderBy, query, setDoc, startAfter, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore';
import { isV2DataModel, workshopCollectionName } from '../../lib/dataModel';
import { createIdempotencyKey, workshopApi } from '../../lib/workshopApi';
import { getErrorCode, getUserFacingError } from '../../lib/errors';
import { canAccessTenantReports } from '../../lib/organizationAccess';
import type { OrganizationRole } from '../../../shared/contracts';
import { ReportManager } from './ReportManager';
import { Card, CardContent } from '../ui/Card';
import { ActionDialog } from '../ui/ActionDialog';
import { Button } from '../ui/Button';
import { Team } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import {
  buildGameCsvRows,
  downloadCsv,
  GameCsvRecord,
  GameExportDocument,
} from '../../lib/gameCsv';
import {
  History,
  Search,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Calendar,
  Users,
  Trophy,
  Eye,
  CheckCircle2,
  PlayCircle,
  RotateCcw,
  Trash2,
} from 'lucide-react';

type GameLifecycleStatus = 'active' | 'completed' | 'archived' | 'pendingDeletion';

interface GameRecord extends GameCsvRecord {
  attacksCount: number;
  teamsCount: number;
  lifecycleStatus: GameLifecycleStatus;
}
interface GameHistoryProps {
  organizationId: string;
  role: OrganizationRole;
  verifiedGfsIdentity: boolean;
  onResumeActiveGame?: (roomCode: string) => Promise<void>;
}




const toMillis = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value) {
    const candidate = value as { toMillis?: unknown };
    if (typeof candidate.toMillis === 'function') return candidate.toMillis();
  }
  return 0;
};

const normalizeLifecycleStatus = (value: unknown): GameLifecycleStatus =>
  value === 'active' || value === 'completed' || value === 'archived' || value === 'pendingDeletion'
    ? value
    : 'completed';

const TEAM_CONFIG: Record<Team, { icon: string; color: string; bg: string; barColor: string }> = {
  Fuego: { icon: '/assets/logos/fuego.png', color: 'text-kreatum-red', bg: 'bg-kreatum-red/10', barColor: 'bg-kreatum-red' },
  Agua: { icon: '/assets/logos/agua.png', color: 'text-kreatum-blue', bg: 'bg-kreatum-blue/10', barColor: 'bg-kreatum-blue' },
  Tierra: { icon: '/assets/logos/tierra.png', color: 'text-kreatum-green', bg: 'bg-kreatum-green/10', barColor: 'bg-kreatum-green' },
  Aire: { icon: '/assets/logos/aire.png', color: 'text-kreatum-turquoise', bg: 'bg-kreatum-turquoise/10', barColor: 'bg-kreatum-turquoise' },
};

export function GameHistory({ organizationId, onResumeActiveGame, role, verifiedGfsIdentity }: GameHistoryProps) {
  const canAccessReports = canAccessTenantReports(role, verifiedGfsIdentity);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | GameLifecycleStatus>('all');
  const [selectedGame, setSelectedGame] = useState<GameRecord | null>(null);
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [resumingGameId, setResumingGameId] = useState<string | null>(null);
  const [historyAction, setHistoryAction] = useState<{ kind: 'finalize' | 'trash' | 'restore'; game: GameRecord } | null>(null);
  const [isHistoryActionBusy, setIsHistoryActionBusy] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const cursorRef = useRef<QueryDocumentSnapshot<DocumentData> | null>(null);

  const loadGames = useCallback(async (reset: boolean) => {
    if (reset) setIsLoading(true);
    else setIsLoadingMore(true);
    setActionError('');

    try {
      if (isV2DataModel && !organizationId) {
        throw new Error('Falta configurar la organización para consultar el historial.');
      }

      const currentUser = auth.currentUser;
      if (isV2DataModel && role === 'facilitator' && !currentUser) {
        throw new Error('Debes iniciar sesion para consultar tus partidas.');
      }
      const workshopsRef = collection(db, workshopCollectionName);
      const baseConstraints = isV2DataModel
        ? [
          where('organizationId', '==', organizationId),
          ...(role === 'facilitator' && currentUser ? [where('facilitatorUid', '==', currentUser.uid)] : []),
          orderBy('createdAt', 'desc'),
        ]
        : [orderBy('createdAt', 'desc')];
      const currentCursor = reset ? null : cursorRef.current;
      const historyQuery = query(
        workshopsRef,
        ...baseConstraints,
        ...(currentCursor ? [startAfter(currentCursor)] : []),
        limit(20),
      );
      const gamesSnap = await getDocs(historyQuery);
      const gamesList: GameRecord[] = gamesSnap.docs.map((gameDocument) => {
        const data = gameDocument.data();
        const summary = data.summary && typeof data.summary === 'object'
          ? data.summary as Record<string, unknown>
          : {};

        return {
          id: gameDocument.id,
          roomCode: data.roomCode || '---',
          status: data.status === 'active' ? 'active' : 'completed',
          lifecycleStatus: normalizeLifecycleStatus(data.status),
          createdAt: toMillis(data.createdAt),
          completedAt: toMillis(data.completedAt) || undefined,
          client: data.client,
          facilitator: data.facilitator,
          globalState: { ...data },
          teams: {},
          attacks: [],
          defenses: [],
          solutions: [],
          attacksCount: typeof summary.attacksCount === 'number' ? summary.attacksCount : 0,
          teamsCount: typeof summary.teamsCount === 'number' ? summary.teamsCount : 0,
        };
      });

      cursorRef.current = gamesSnap.docs.at(-1) ?? null;
      setHasMore(gamesSnap.size === 20);
      setGames((previous) => reset ? gamesList : [...previous, ...gamesList]);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo cargar el historial.'));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [organizationId, role]);

  useEffect(() => {
    void loadGames(true);
  }, [loadGames]);

  const openGameDetails = async (game: GameRecord) => {
    setIsLoadingDetails(true);
    setActionError('');
    try {
      const [teamsSnap, attacksSnap, defensesSnap, solutionsSnap] = await Promise.all([
        getDocs(collection(db, workshopCollectionName, game.id, 'teams')),
        getDocs(collection(db, workshopCollectionName, game.id, 'attacks')),
        getDocs(collection(db, workshopCollectionName, game.id, 'defenses')),
        getDocs(collection(db, workshopCollectionName, game.id, 'solutions')),
      ]);
      const teams: Record<string, Record<string, unknown>> = {};
      teamsSnap.forEach((teamDocument) => {
        teams[teamDocument.id] = teamDocument.data();
      });
      const toDocuments = (snapshot: typeof attacksSnap): GameExportDocument[] =>
        snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const detailedGame: GameRecord = {
        ...game,
        teams,
        attacks: toDocuments(attacksSnap),
        defenses: toDocuments(defensesSnap),
        solutions: toDocuments(solutionsSnap),
        attacksCount: attacksSnap.size,
        teamsCount: teamsSnap.size,
      };
      setSelectedGame(detailedGame);
      setGames((previous) => previous.map((item) =>
        item.id === game.id
          ? { ...item, attacksCount: attacksSnap.size, teamsCount: teamsSnap.size }
          : item));
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudieron cargar los detalles de la partida.'));
    } finally {
      setIsLoadingDetails(false);
    }
  };
  const resumeGame = async (game: GameRecord) => {
    if (!onResumeActiveGame || game.lifecycleStatus !== 'active') return;
    setActionError('');
    setResumingGameId(game.id);
    try {
      await onResumeActiveGame(game.roomCode);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo reanudar la partida.'));
    } finally {
      setResumingGameId(null);
    }
  };

  const runHistoryAction = async (reason: string) => {
    if (!historyAction || isHistoryActionBusy) return;
    const { kind, game } = historyAction;
    setIsHistoryActionBusy(true);
    setActionError('');
    try {
      if (kind === 'finalize') {
        if (isV2DataModel) {
          await resumeGame(game);
        } else {
          await setDoc(
            doc(db, workshopCollectionName, game.id),
            { status: 'completed', completedAt: Date.now() },
            { merge: true },
          );
          const updated: GameRecord = { ...game, status: 'completed', lifecycleStatus: 'completed', completedAt: Date.now() };
          setGames((previous) => previous.map((item) => item.id === game.id ? updated : item));
          if (selectedGame?.id === game.id) setSelectedGame(updated);
        }
      } else if (kind === 'trash') {
        await workshopApi.deleteWorkshop({
          workshopId: game.id,
          reason,
          idempotencyKey: createIdempotencyKey('deleteWorkshop'),
        });
        const updated = { ...game, lifecycleStatus: 'pendingDeletion' as const };
        setGames((previous) => previous.map((item) => item.id === game.id ? updated : item));
        if (selectedGame?.id === game.id) setSelectedGame(updated);
      } else {
        await workshopApi.restoreWorkshop({
          workshopId: game.id,
          reason,
          idempotencyKey: createIdempotencyKey('restoreWorkshop'),
        });
        const updated = { ...game, lifecycleStatus: 'archived' as const };
        setGames((previous) => previous.map((item) => item.id === game.id ? updated : item));
        if (selectedGame?.id === game.id) setSelectedGame(updated);
      }
      setHistoryAction(null);
    } catch (error: unknown) {
      setActionError(getUserFacingError(error, 'No se pudo completar la operación.'));
    } finally {
      setIsHistoryActionBusy(false);
    }
  };
  const lifecycleLabel = (status: GameLifecycleStatus) => ({
    active: 'Activa',
    completed: 'Completada',
    archived: 'Archivada',
    pendingDeletion: 'Papelera',
  })[status];

  const lifecycleClass = (status: GameLifecycleStatus) => ({
    active: 'bg-amber-500/10 text-amber-600',
    completed: 'bg-green-500/10 text-green-600',
    archived: 'bg-slate-500/10 text-slate-600',
    pendingDeletion: 'bg-red-500/10 text-red-600',
  })[status];

  const filteredGames = games.filter(game => {
    const matchesSearch = searchTerm === '' ||
      game.roomCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      game.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (game.client || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (game.facilitator || '').toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || game.lifecycleStatus === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const formatDate = (timestamp: number) => {
    if (!timestamp) return 'Sin fecha';
    return new Date(timestamp).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const exportToCSV = (game: GameRecord) => {
    downloadCsv(
      buildGameCsvRows(game),
      `Kreatum_${game.roomCode}_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const exportAllToCSV = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setActionError('');
    setExportMessage('');
    try {
      if (!isV2DataModel || !organizationId) {
        throw new Error('No hay una organización seleccionada para exportar.');
      }
      const result = await workshopApi.exportOrganizationWorkshopHistory({
        organizationId,
        filters: { search: searchTerm, status: statusFilter },
      });
      const blob = new Blob(['\uFEFF' + result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportMessage(`${result.rowCount} partidas exportadas.`);
    } catch (error: unknown) {
      setActionError(
        getErrorCode(error) === 'functions/resource-exhausted'
          ? 'La exportación supera 10.000 partidas. Acota la búsqueda o el estado.'
          : getUserFacingError(error, 'No se pudo exportar el historial.'),
      );
    } finally {
      setIsExporting(false);
    }
  };

  // ─────────────────── DETAIL VIEW ───────────────────
  if (selectedGame) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="min-w-0 space-y-6 sm:space-y-8"
    >
      {actionError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm font-semibold text-red-600" role="alert">
          {actionError}
        </div>
      )}
        {/* Back bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <button
            onClick={() => { setSelectedGame(null); setExpandedTeam(null); }}
            className="flex min-h-11 items-center gap-2 font-medium text-kreatum-purple transition-colors hover:text-kreatum-purple-dark"
          >
            <ChevronDown className="w-4 h-4 rotate-90" />
            Volver al Historial
          </button>
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
            {selectedGame.lifecycleStatus === 'active' && onResumeActiveGame && (
              <Button
                className="h-11 w-full justify-center gap-2 rounded-xl bg-kreatum-purple text-white hover:bg-kreatum-purple-dark lg:w-auto"
                onClick={() => void resumeGame(selectedGame)}
                disabled={resumingGameId === selectedGame.id}
              >
                <PlayCircle className="w-4 h-4" />
                {resumingGameId === selectedGame.id ? 'Reanudando...' : 'Reanudar partida'}
              </Button>
            )}
            {selectedGame.lifecycleStatus === 'active' && (
              <Button 
                variant="outline" 
                className="h-11 w-full justify-center gap-2 rounded-xl border-amber-500/30 text-amber-600 hover:bg-amber-500/10 lg:w-auto"
                onClick={() => setHistoryAction({ kind: 'finalize', game: selectedGame })}
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalizar Partida
              </Button>
            )}
            {role === 'owner' && selectedGame.lifecycleStatus !== 'pendingDeletion' && (
              <Button variant="danger" className="h-11 w-full justify-center gap-2 rounded-xl lg:w-auto" onClick={() => setHistoryAction({ kind: 'trash', game: selectedGame })}>
                <Trash2 className="w-4 h-4" />
                Enviar a papelera
              </Button>
            )}
            {role === 'owner' && selectedGame.lifecycleStatus === 'pendingDeletion' && (
              <Button variant="outline" className="h-11 w-full justify-center gap-2 rounded-xl lg:w-auto" onClick={() => setHistoryAction({ kind: 'restore', game: selectedGame })}>
                <RotateCcw className="w-4 h-4" />
                Restaurar partida
              </Button>
            )}
            {canAccessReports && (
              <Button variant="outline" className="h-11 w-full justify-center gap-2 rounded-xl lg:w-auto" onClick={() => exportToCSV(selectedGame)}>
                <FileSpreadsheet className="w-4 h-4" />
                Exportar CSV
              </Button>
            )}
          </div>
        </div>

        {/* Game header */}
        <div className="min-w-0 rounded-2xl border border-black/[0.06] bg-white/90 p-4 dark:border-white/[0.08] dark:bg-white/[0.04] sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <span className="break-all font-mono text-2xl font-bold tracking-wider text-kreatum-purple sm:text-3xl">{selectedGame.roomCode}</span>
                <span className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold",
                  lifecycleClass(selectedGame.lifecycleStatus)
                )}>
                  {lifecycleLabel(selectedGame.lifecycleStatus)}
                </span>
              </div>
              <p className="text-sm font-medium text-kreatum-gray/60 dark:text-white/50">
                {formatDate(selectedGame.createdAt)}
                {selectedGame.completedAt && ` → ${formatDate(selectedGame.completedAt)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {Object.keys(selectedGame.teams).map(team => (
                <div key={team} className={cn("p-2 rounded-xl", TEAM_CONFIG[team as Team]?.bg)}>
                  <img src={TEAM_CONFIG[team as Team]?.icon} alt={team} className="w-8 h-8 object-contain" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {canAccessReports && isV2DataModel && selectedGame.lifecycleStatus === 'completed' && (
          <ReportManager
            organizationId={organizationId}
            role={role}
            verifiedGfsIdentity={verifiedGfsIdentity}
            workshopId={selectedGame.id}
            roomCode={selectedGame.roomCode}
          />
        )}

        {/* Teams detail */}
        <div className="space-y-4">
          {(['Agua', 'Aire', 'Fuego', 'Tierra'] as Team[]).map(team => {
            const data = selectedGame.teams[team];
            if (!data) return null;
            const config = TEAM_CONFIG[team];
            const isExpanded = expandedTeam === team;

            return (
              <Card key={team} className="overflow-hidden border-black/5 dark:border-white/5">
                <div className={cn("h-1.5 w-full", config.barColor)} />
                <button
                  onClick={() => setExpandedTeam(isExpanded ? null : team)}
                  className="flex w-full items-center justify-between p-4 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.02] sm:p-6"
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
                      <CardContent className="space-y-6 px-4 pb-6 pt-0 sm:px-8 sm:pb-8">
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
                            { label: 'Pitch - 1. Captación', value: data.pitchStart },
                            { label: 'Pitch - 2. Acción', value: data.pitchProblem },
                            { label: 'Pitch - 3. Testeo', value: data.pitchSolution },
                            { label: 'Pitch - 4. Conclusiones', value: data.pitchAction },
                          ].filter(item => item.value).map(item => (
                            <div key={item.label} className="bg-black/[0.03] dark:bg-white/5 p-4 rounded-2xl border border-black/5 dark:border-white/5">
                              <p className="text-xs font-bold opacity-55 mb-1.5">{item.label}</p>
                              <p className="break-words text-sm leading-relaxed">{String(item.value)}</p>
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
        {historyAction && (
          <ActionDialog
            open
            title={historyAction.kind === 'finalize' ? 'Finalizar partida' : historyAction.kind === 'trash' ? 'Enviar a papelera' : 'Restaurar partida'}
            description={historyAction.kind === 'finalize'
              ? isV2DataModel
                ? 'Abrirás el Control Room para finalizar con guardado seguro de todos los equipos.'
                : 'La partida se marcará como completada.'
              : historyAction.kind === 'trash'
                ? 'La partida quedará en la papelera recuperable durante 30 días.'
                : 'La partida volverá al archivo de la organización.'}
            confirmLabel={historyAction.kind === 'finalize' && isV2DataModel ? 'Abrir Control Room' : 'Confirmar'}
            variant={historyAction.kind === 'trash' ? 'danger' : 'primary'}
            reasonLabel={historyAction.kind === 'finalize' ? undefined : 'Motivo'}
            confirmationPhrase={historyAction.kind === 'trash' ? 'ELIMINAR' : undefined}
            busy={isHistoryActionBusy}
            error={actionError}
            onClose={() => setHistoryAction(null)}
            onConfirm={runHistoryAction}
          />
        )}      </motion.div>
    );
  }

  // ─────────────────── LIST VIEW ───────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-w-0 space-y-6 sm:space-y-8"
    >
      {actionError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm font-semibold text-red-600" role="alert">
          <span className="break-words">{actionError}</span>
        </div>
      )}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-kreatum-purple/10">
            <History className="w-6 h-6 text-kreatum-purple" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold tracking-normal text-kreatum-dark dark:text-white sm:text-2xl">Historial de Partidas</h2>
            <p className="text-sm font-medium text-kreatum-gray/55 dark:text-white/45">{games.length} partidas cargadas</p>
          </div>
        </div>
        {canAccessReports && (
          <Button
            variant="outline"
            className="h-11 w-full gap-2 rounded-xl sm:w-auto"
            onClick={() => void exportAllToCSV()}
            disabled={isExporting || (games.length === 0 && !hasMore)}
            aria-busy={isExporting}
          >
            <FileSpreadsheet className="w-4 h-4" />
            {isExporting ? 'Exportando...' : 'Exportar Todo a CSV'}
          </Button>
        )}
      </div>
      {exportMessage && <p className="text-sm font-semibold text-green-700" role="status">{exportMessage}</p>}

      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-kreatum-gray/40 pointer-events-none" />
          <label htmlFor="history-search" className="sr-only">Buscar partidas</label>
          <input
            id="history-search"
            type="search"
            placeholder="Buscar por código de sala o ID..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 h-11 rounded-xl bg-white dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] text-sm font-medium outline-none focus:ring-2 focus:ring-kreatum-purple/25 focus:border-kreatum-purple/35 transition-colors"
          />
        </div>
        <div className="flex w-full gap-1 overflow-x-auto rounded-xl border border-black/5 bg-white p-1 dark:border-white/10 dark:bg-white/5 lg:w-auto">
          {(['all', 'active', 'completed', 'archived', 'pendingDeletion'] as const).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              aria-pressed={statusFilter === f}
              className={cn(
                "min-h-11 shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold transition-all",
                statusFilter === f
                  ? "bg-kreatum-purple/15 text-kreatum-dark shadow-sm dark:bg-kreatum-purple/25 dark:text-white"
                  : "text-kreatum-dark hover:bg-black/[0.04] dark:text-white/75 dark:hover:bg-white/[0.05] dark:hover:text-white"
              )}
            >
              {f === 'all' ? 'Todas' : f === 'completed' ? 'Completadas' : f === 'active' ? 'Activas' : f === 'archived' ? 'Archivadas' : 'Papelera'}
            </button>
          ))}
        </div>
      </div>

      {isLoadingDetails && (
        <p className="text-center text-sm font-semibold text-kreatum-purple" role="status">
          Cargando detalles...
        </p>
      )}
      {isLoading ? (
        <div className="text-center py-20">
          <div className="w-8 h-8 border-2 border-kreatum-purple/30 border-t-kreatum-purple rounded-full animate-spin mx-auto mb-4" aria-hidden="true" />
          <p className="text-sm font-medium text-kreatum-gray/50">Cargando partidas...</p>
        </div>
      ) : filteredGames.length === 0 ? (
        <div className="text-center py-20 bg-white/75 dark:bg-white/[0.04] rounded-2xl border border-black/[0.06] dark:border-white/[0.08]">
          <History className="w-12 h-12 text-kreatum-gray/20 dark:text-white/10 mx-auto mb-4" />
          <p className="text-kreatum-gray/50 dark:text-white/30 font-medium">No se encontraron partidas</p>
          <p className="text-xs text-kreatum-gray/30 dark:text-white/20 mt-1">Intenta con otros filtros</p>
        </div>
      ) : (
        <>
        <div className="space-y-3">
          {filteredGames.map((game, idx) => (
            <motion.div
              key={game.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <button
                onClick={() => void openGameDetails(game)}
                aria-label={`Abrir partida ${game.roomCode}`}
                className="group flex w-full flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white/90 p-4 text-left transition-colors hover:border-kreatum-purple/25 dark:border-white/[0.08] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                  <div className="flex h-12 w-full shrink-0 items-center justify-center rounded-2xl bg-kreatum-purple/10 sm:h-14 sm:w-24">
                    <span className="break-all font-mono text-lg font-bold tracking-wider text-kreatum-purple">{game.roomCode}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded-md text-xs font-bold",
                        lifecycleClass(game.lifecycleStatus)
                      )}>
                        {lifecycleLabel(game.lifecycleStatus)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-kreatum-gray/60 dark:text-white/60">
                      <span className="flex shrink-0 items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(game.createdAt).toLocaleDateString()}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {game.teamsCount} equipos
                      </span>
                      {game.client && (
                        <span className="flex min-w-0 max-w-full items-center gap-1 sm:max-w-[150px]">
                          <span className="opacity-50">Cliente:</span>
                          <span className="font-medium text-kreatum-dark dark:text-white truncate">{game.client}</span>
                        </span>
                      )}
                      <span className="flex shrink-0 items-center gap-1">
                        <Trophy className="w-3.5 h-3.5" />
                        {game.attacksCount} ataques
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3 self-end sm:self-auto">
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
        {hasMore && (
          <div className="flex justify-center pt-5">
            <Button
              variant="outline"
              onClick={() => void loadGames(false)}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? 'Cargando...' : 'Cargar más partidas'}
            </Button>
          </div>
        )}
        </>
      )}
    </motion.div>
  );
}
