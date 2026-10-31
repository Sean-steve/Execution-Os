import React from 'react';
import { 
  Compass, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Flame, 
  Sparkles, 
  ShieldCheck, 
  Play, 
  RotateCcw,
  AlertTriangle,
  ShieldAlert
} from 'lucide-react';
import { AppState, RoutineTask } from '../types';
import { 
  getAutonomousNextAction, 
  formatMinutesToTime, 
  getCurrentTimeMinutes,
  isTaskMissedTime,
  getTaskTimeStatus
} from '../services/storageService';
import { sound } from '../services/soundService';
import { getActiveDayTheme } from '../services/dayThemeService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface NextActionBannerProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onNavigateToView: (view: AppState['activeView']) => void;
  onRequestDisciplineCheck: (task: RoutineTask) => void;
}

export const NextActionBanner: React.FC<NextActionBannerProps> = ({
  state,
  onUpdateState,
  onNavigateToView,
  onRequestDisciplineCheck,
}) => {
  const { currentTask, phaseTitle, phaseDesc, timeRemainingStr, isUrgent, upcomingTask } = getAutonomousNextAction(state);
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);

  const handleCompleteCurrentTask = async (task: RoutineTask) => {
    const effectiveEnd = task.allocatedEndMinutes ?? task.endMinutes;
    if (state.strictTimeEnforcement && currentMinutes > effectiveEnd + 5) {
      sound.playChime('warning');
      onRequestDisciplineCheck(task);
      return;
    }

    const result = await defaultApplicationService.completeActivity({
      taskId: task.id,
      completedAtMinutes: currentMinutes,
      executionStatus: 'ON_TIME',
      missedWindow: false,
    }, state);

    if (result.success && result.state) {
      sound.playChime('success');
      try {
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 }, colors: [activeTheme.colorHex, '#10b981', '#3b82f6'] });
      } catch {}
      onUpdateState(() => result.state!);
    }
  };

  const handleActionClick = (task: RoutineTask) => {
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
        onNavigateToView('DEEP_WORK');
        break;
      case 'TRADING_GATEKEEPER':
        onNavigateToView('TRADING');
        break;
      case 'COMPANY_TARGET':
        onNavigateToView('DEEP_WORK');
        break;
      case 'FAMILY_OUTING':
        onNavigateToView('FAMILY');
        break;
      case 'EVENING_REVIEW':
        onNavigateToView('EVENING');
        break;
      default:
        handleCompleteCurrentTask(task);
        break;
    }
  };

  const isCurrentTaskExpired = currentTask ? isTaskMissedTime(currentTask, currentMinutes) : false;

  return (
    <div className={`relative overflow-hidden rounded-2xl bg-white border p-5 sm:p-6 shadow-sm transition-colors ${
      isCurrentTaskExpired 
        ? 'border-red-200 ring-1 ring-red-100' 
        : activeTheme.classes.highlightCard
    }`}>
      {/* Subtle background glow effect using active day theme */}
      <div 
        className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full blur-3xl pointer-events-none opacity-20"
        style={{ backgroundColor: activeTheme.colorHex }}
      />
      <div className="absolute bottom-0 left-1/4 -mb-8 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* Phase Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full animate-ping"
              style={{ backgroundColor: isCurrentTaskExpired ? '#ef4444' : activeTheme.colorHex }} 
            />
            <span className={`text-xs font-mono font-bold uppercase tracking-wider ${
              isCurrentTaskExpired ? 'text-red-700' : activeTheme.classes.accentText
            }`}>
              Autonomous Action Dispatch • {activeTheme.dayName} Mode
            </span>
            <span className="text-slate-300">•</span>
            <span className="text-xs text-slate-500 font-medium">{phaseTitle}</span>
          </div>

          {timeRemainingStr && (
            <div className="flex items-center gap-1.5 text-xs font-mono text-slate-600 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 self-start sm:self-auto shadow-xs">
              <Clock className={`w-3.5 h-3.5 ${activeTheme.classes.accentText}`} />
              <span>{timeRemainingStr}</span>
            </div>
          )}
        </div>

        {/* Hero Next Action Block */}
        {currentTask ? (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2 max-w-2xl">
              <div className="flex items-center gap-2 flex-wrap">
                {currentTask.isNonNegotiable ? (
                  <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold border uppercase ${activeTheme.classes.badge}`}>
                    Non-Negotiable Anchor
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                    Flexible Execution
                  </span>
                )}
                <span className="text-xs font-mono text-slate-500">
                  {currentTask.timeWindow}
                </span>

                {/* Time status warning pill */}
                {isCurrentTaskExpired ? (
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-red-50 text-red-700 border border-red-200 uppercase flex items-center gap-1 animate-pulse">
                    <ShieldAlert className="w-3 h-3" />
                    Window Expired (Discipline Check Required)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Live Active Window
                  </span>
                )}

                {state.currentMode !== 'GREEN' && (
                  <span className="px-2.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-50 text-amber-700 border border-amber-200 uppercase">
                    {state.currentMode} Protocol
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight leading-snug">
                {currentTask.title}
              </h2>

              <p className="text-sm text-slate-600 leading-relaxed">
                {currentTask.subtext || currentTask.notes || phaseDesc}
              </p>

              {currentTask.notes && currentTask.notes !== currentTask.subtext && (
                <p className="text-xs text-slate-800 italic font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  "{currentTask.notes}"
                </p>
              )}
            </div>

            {/* Interactive Call to Action Controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
              {currentTask.interactiveActionType && currentTask.interactiveActionType !== 'GENERIC' ? (
                <button
                  id="launch-interactive-action-btn"
                  onClick={() => handleActionClick(currentTask)}
                  className={`px-5 py-2.5 rounded-xl font-bold text-sm shadow-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${activeTheme.classes.accentButton}`}
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>
                    {currentTask.interactiveActionType === 'MEDITATION_TIMER' && 'Open Meditation Suite'}
                    {currentTask.interactiveActionType === 'FOCUS_BLOCK' && 'Enter Deep Work Mode'}
                    {currentTask.interactiveActionType === 'TRADING_GATEKEEPER' && 'Open Trading Gatekeeper'}
                    {currentTask.interactiveActionType === 'COMMAND_CENTER' && 'Open Command Center'}
                    {currentTask.interactiveActionType === 'WORKOUT_TRACKER' && 'Log Physical Sets'}
                    {currentTask.interactiveActionType === 'IDENTITY_CHECK' && 'Open Morning Prime'}
                    {currentTask.interactiveActionType === 'DREAM_JOURNAL' && 'Log Dream Journal'}
                    {currentTask.interactiveActionType === 'OUTSIDE_TIMER' && 'Start 10m Light Timer'}
                    {currentTask.interactiveActionType === 'COMPANY_TARGET' && 'Open Company Battlefield'}
                    {currentTask.interactiveActionType === 'FAMILY_OUTING' && 'Open Family Suite'}
                    {currentTask.interactiveActionType === 'EVENING_REVIEW' && 'Start Evening Review'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : null}

              <button
                id="complete-task-btn"
                onClick={() => handleCompleteCurrentTask(currentTask)}
                className={`px-4 py-2.5 rounded-xl border font-semibold text-sm flex items-center justify-center gap-2 transition-all shadow-xs ${
                  isCurrentTaskExpired
                    ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300'
                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                }`}
                title={isCurrentTaskExpired ? 'Time window passed — click to review discipline consequence' : 'Mark this anchor completed and earn points'}
              >
                {isCurrentTaskExpired ? (
                  <>
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                    <span>Missed Time (-5 pts Cut)</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Mark Done (+5 pts)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-3">
            <div>
              <h2 className="text-lg font-bold text-emerald-700 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                All Anchors in Current Window Completed
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                You are currently on track with the autonomous kernel. Proceed mindfully or step into the next phase.
              </p>
            </div>
            <button
              onClick={() => onNavigateToView('ALL_TASKS')}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold border border-slate-200"
            >
              View Master Day Timeline
            </button>
          </div>
        )}

        {/* Footer Sub-HUD: Upcoming next & summary */}
        {upcomingTask && (
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-2 truncate">
              <span className="text-slate-400 uppercase font-mono text-[10px] font-bold">Upcoming Next:</span>
              <span className="text-slate-800 font-medium truncate">{upcomingTask.title}</span>
              <span className="text-slate-400 font-mono text-[11px]">({upcomingTask.timeWindow})</span>
            </div>

            <button
              onClick={() => handleActionClick(upcomingTask)}
              className={`font-semibold text-[11px] shrink-0 ml-2 flex items-center gap-1 hover:underline ${activeTheme.classes.accentText}`}
            >
              Preview <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
