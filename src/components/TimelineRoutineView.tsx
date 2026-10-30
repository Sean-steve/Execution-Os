import React, { useState } from 'react';
import { 
  ListOrdered, 
  CheckCircle2, 
  Circle, 
  Clock, 
  Flame, 
  Sparkles, 
  Filter, 
  Play, 
  ExternalLink,
  ShieldCheck,
  Zap,
  AlertTriangle,
  ShieldAlert,
  XCircle
} from 'lucide-react';
import { AppState, RoutineTask, AnchorId } from '../types';
import { 
  sound 
} from '../services/soundService';
import { 
  getCurrentTimeMinutes, 
  isTaskMissedTime, 
  getTaskTimeStatus,
  formatMinutesToTime 
} from '../services/storageService';
import { getActiveDayTheme } from '../services/dayThemeService';
import confetti from 'canvas-confetti';

interface TimelineRoutineViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onNavigateToView: (view: AppState['activeView']) => void;
  onRequestDisciplineCheck: (task: RoutineTask) => void;
}

export const TimelineRoutineView: React.FC<TimelineRoutineViewProps> = ({
  state,
  onUpdateState,
  onNavigateToView,
  onRequestDisciplineCheck,
}) => {
  const [filterNonNegotiableOnly, setFilterNonNegotiableOnly] = useState(false);
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);

  const mode = state.currentMode;
  let filteredTasks = state.tasks.filter(t => t.modesAllowed.includes(mode));
  if (filterNonNegotiableOnly) {
    filteredTasks = filteredTasks.filter(t => t.isNonNegotiable);
  }

  const handleToggleTask = (task: RoutineTask) => {
    // If currently completed, uncomplete it
    if (task.completed) {
      onUpdateState(prev => ({
        ...prev,
        tasks: prev.tasks.map(t => 
          t.id === task.id ? { 
            ...t, 
            completed: false, 
            missedWindow: false,
            executionStatus: 'PENDING'
          } : t
        ),
      }));
      return;
    }

    // Task is being marked done — strictly check time window
    if (isTaskMissedTime(task, currentMinutes)) {
      sound.playChime('warning');
      onRequestDisciplineCheck(task);
      return;
    }

    // On-time completion
    sound.playChime('success');
    try {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
    } catch {
      // ignore
    }

    onUpdateState(prev => {
      const isEarly = currentMinutes < task.startMinutes;
      const updated = prev.tasks.map(t =>
        t.id === task.id ? { 
          ...t, 
          completed: true, 
          completedAtMinutes: currentMinutes,
          executionStatus: isEarly ? ('ADVANCE' as const) : ('ON_TIME' as const),
          missedWindow: false 
        } : t
      );

      return {
        ...prev,
        tasks: updated,
        rewardPoints: prev.rewardPoints + (task.isNonNegotiable ? 5 : 3),
      };
    });
  };

  const handleOpenAction = (task: RoutineTask) => {
    switch (task.interactiveActionType) {
      case 'IDENTITY_CHECK':
      case 'DREAM_JOURNAL':
      case 'OUTSIDE_TIMER':
      case 'WORKOUT_TRACKER':
      case 'MEDITATION_TIMER':
        onNavigateToView('MORNING_PRIME');
        break;
      case 'COMMAND_CENTER':
        onNavigateToView('COMMAND_CENTER');
        break;
      case 'FOCUS_BLOCK':
      case 'COMPANY_TARGET':
        onNavigateToView('DEEP_WORK');
        break;
      case 'TRADING_GATEKEEPER':
        onNavigateToView('TRADING');
        break;
      case 'FAMILY_OUTING':
        onNavigateToView('FAMILY');
        break;
      case 'EVENING_REVIEW':
        onNavigateToView('EVENING');
        break;
      default:
        handleToggleTask(task);
        break;
    }
  };

  const totalTasks = filteredTasks.length;
  const completedTasks = filteredTasks.filter(t => t.completed).length;
  const onTimeCompleted = filteredTasks.filter(t => t.completed && !t.missedWindow).length;
  const latePenalized = filteredTasks.filter(t => t.completed && t.missedWindow).length;
  const percentComplete = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* View Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 font-mono text-xs uppercase tracking-wider font-bold ${activeTheme.classes.accentText}`}>
            <ListOrdered className="w-4 h-4" />
            <span>Master Execution Matrix • {activeTheme.dayName} Palette</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            Master Routine Timeline
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            "Strict Time-Bound Anchors, Non-Negotiable Core & Real-Time Discipline Audit."
          </p>
        </div>

        {/* Progress meter */}
        <div className="flex items-center gap-3 bg-white border border-slate-200 px-4 py-2 rounded-2xl shadow-sm">
          <div className="w-24 bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${activeTheme.classes.accentBg}`}
              style={{ width: `${percentComplete}%` }}
            />
          </div>
          <span className="text-xs font-mono font-bold text-slate-800">
            {completedTasks}/{totalTasks} ({percentComplete}%)
          </span>
        </div>
      </div>

      {/* Discipline Audit Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">On-Time Completions</span>
            <div className="text-lg font-bold font-mono text-emerald-600">
              {onTimeCompleted} Anchors
            </div>
          </div>
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Late Penalty Infractions</span>
            <div className="text-lg font-bold font-mono text-red-600">
              {latePenalized} Penalized
            </div>
          </div>
          <ShieldAlert className="w-5 h-5 text-red-500" />
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-xs">
          <div>
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Discipline Standard</span>
            <div className="text-sm font-bold font-mono text-slate-800">
              {latePenalized === 0 ? 'Flawless Precision' : 'Accountability Active'}
            </div>
          </div>
          <Sparkles className={`w-5 h-5 ${activeTheme.classes.accentText}`} />
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500 font-medium">Current Mode:</span>
          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
            mode === 'GREEN' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
            mode === 'YELLOW' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
            'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            {mode} Mode Active ({totalTasks} tasks)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterNonNegotiableOnly(!filterNonNegotiableOnly)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
              filterNonNegotiableOnly
                ? `${activeTheme.classes.badge} font-bold shadow-xs`
                : 'bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Non-Negotiables Only</span>
          </button>
        </div>
      </div>

      {/* Chronological Tasks List */}
      <div className="space-y-3">
        {filteredTasks.map((task) => {
          const isExpired = isTaskMissedTime(task, currentMinutes);
          const isCompletedLate = task.completed && task.missedWindow;

          return (
            <div
              key={task.id}
              className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all ${
                task.completed
                  ? isCompletedLate
                    ? 'bg-amber-50/40 border-amber-200'
                    : 'bg-slate-50/70 border-slate-200 opacity-80'
                  : isExpired
                  ? 'bg-red-50/30 border-red-200 ring-1 ring-red-100 shadow-sm'
                  : task.isNonNegotiable
                  ? 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                  : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-xs'
              }`}
            >
              <div className="flex items-start gap-3.5">
                <button
                  onClick={() => handleToggleTask(task)}
                  className="mt-0.5 shrink-0 transition-colors"
                >
                  {task.completed ? (
                    isCompletedLate ? (
                      <AlertTriangle className="w-5 h-5 text-amber-600 fill-amber-100" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 fill-emerald-100" />
                    )
                  ) : isExpired ? (
                    <XCircle className="w-5 h-5 text-red-400 hover:text-red-600" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300 hover:text-slate-500" />
                  )}
                </button>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {task.isNonNegotiable ? (
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border uppercase ${activeTheme.classes.badge}`}>
                        Non-Negotiable
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded border border-slate-200 uppercase font-medium">
                        Flexible
                      </span>
                    )}
                    <span className="text-xs font-mono text-slate-500 font-medium">
                      {task.timeWindow}
                    </span>

                    {/* Dynamic Real-time Status Badges */}
                    {!task.completed && isExpired && (
                      <span className="text-[10px] font-mono font-bold bg-red-100 text-red-800 px-2 py-0.5 rounded border border-red-200 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-red-600" />
                        Window Expired (Cutoff {formatMinutesToTime(task.endMinutes)})
                      </span>
                    )}

                    {isCompletedLate && (
                      <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-200 flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3 text-amber-700" />
                        Late Penalty Applied (-5 pts)
                      </span>
                    )}

                    {task.completed && !task.missedWindow && (
                      <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200">
                        ✓ On-Time Execution
                      </span>
                    )}
                  </div>

                  <h3 className={`text-sm font-bold text-slate-900 ${task.completed ? 'line-through opacity-70 text-slate-500' : ''}`}>
                    {task.title}
                  </h3>

                  <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                    {task.subtext || task.notes}
                  </p>
                </div>
              </div>

              {/* Quick Action Button on Right */}
              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                {task.interactiveActionType && task.interactiveActionType !== 'GENERIC' && (
                  <button
                    onClick={() => handleOpenAction(task)}
                    className="px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium border border-slate-200 flex items-center gap-1.5 transition-all"
                  >
                    <Play className={`w-3.5 h-3.5 ${activeTheme.classes.accentText}`} />
                    <span>Open Suite</span>
                  </button>
                )}

                <button
                  onClick={() => handleToggleTask(task)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    task.completed
                      ? 'bg-slate-100 text-slate-500 hover:text-slate-800'
                      : isExpired
                      ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-300 font-bold'
                      : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 font-bold'
                  }`}
                >
                  {task.completed ? 'Undo' : isExpired ? 'Missed Time' : 'Done'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
