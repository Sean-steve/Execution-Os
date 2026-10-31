import React, { useState } from 'react';
import { 
  Compass, 
  ArrowRight, 
  Clock, 
  Zap, 
  ShieldCheck, 
  AlertTriangle, 
  Sliders, 
  RotateCcw, 
  CheckCircle2, 
  Layers, 
  ChevronRight,
  Shield,
  Activity,
  Sparkles,
  Lock,
  Play,
  HelpCircle,
  TrendingUp,
  Target,
  Sun,
  Heart,
  Briefcase,
  AlertCircle
} from 'lucide-react';
import { AppState, RoutineTask } from '../types';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { getActiveDayTheme } from '../services/dayThemeService';
import { sound } from '../services/soundService';
import { RealityChangeModal } from './ui/RealityChangeModal';
import { WhyThisModal } from './ui/WhyThisModal';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface NowViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onNavigateToView: (view: AppState['activeView']) => void;
  onRequestDisciplineModal: (task: RoutineTask) => void;
}

export const NowView: React.FC<NowViewProps> = ({
  state,
  onUpdateState,
  onNavigateToView,
  onRequestDisciplineModal,
}) => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);
  const decision = getAutonomousNextDecision(state);
  const task = decision.currentTask;

  const [showRealityModal, setShowRealityModal] = useState(false);
  const [showWhyModal, setShowWhyModal] = useState(false);

  // Find next upcoming uncompleted task
  const upcomingTasks = state.tasks.filter(
    t => !t.completed && (task ? t.id !== task.id : true) && t.modesAllowed.includes(state.currentMode)
  ).sort((a, b) => (a.allocatedStartMinutes ?? a.startMinutes) - (b.allocatedStartMinutes ?? b.startMinutes));

  const nextTask = upcomingTasks[0] || null;

  // Calculate top 3 advancement
  const top3 = state.tomorrowPlan.top3 || [];
  const top3CompletedCount = top3.filter((_, idx) => {
    if (idx === 0) return state.tasks.some(t => t.completed && (t.id === 'task-deep-work-1' || t.id === 'task-deep-work-2' || t.id === 'task-command-center'));
    if (idx === 1) return state.tasks.some(t => t.completed && (t.id === 'task-company-priority' || t.id === 'task-deep-work-1'));
    return state.tasks.some(t => t.completed && (t.id === 'task-family-connection' || t.id === 'task-family-outing'));
  }).length;

  const completedCount = state.tasks.filter(t => t.completed).length;
  const totalModeTasks = state.tasks.filter(t => t.modesAllowed.includes(state.currentMode)).length;

  const handleLaunchOrComplete = () => {
    if (!task) return;

    const performanceActionTypes = new Set([
      'FOCUS_BLOCK',
      'COMPANY_TARGET',
      'TRADING_GATEKEEPER',
      'FAMILY_OUTING',
      'IDENTITY_CHECK',
      'OUTSIDE_TIMER',
      'WORKOUT_TRACKER',
      'MEDITATION_TIMER',
    ]);

    if (
      performanceActionTypes.has(task.interactiveActionType || '') ||
      task.id.includes('deep-work') ||
      task.id === 'task-trading-protocol' ||
      task.id === 'task-family-life' ||
      task.id === 'task-family-connection'
    ) {
      void handlePerformWorkspace();
      return;
    }

    if (task.interactiveActionType === 'COMMAND_CENTER' || task.id === 'task-command-center') {
      onNavigateToView('COMMAND_CENTER');
      return;
    }
    if (task.interactiveActionType === 'EVENING_REVIEW' || task.id === 'task-evening-review') {
      onNavigateToView('REVIEW');
      return;
    }

    void handleDirectComplete();
  };

  const handleDirectComplete = async () => {
    if (!task) return;

    const effectiveEnd = task.allocatedEndMinutes ?? task.endMinutes;
    if (state.strictTimeEnforcement && currentMinutes > (effectiveEnd + 5)) {
      onRequestDisciplineModal(task);
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
      try { confetti({ particleCount: 40, spread: 60, origin: { y: 0.6 } }); } catch {}
      onUpdateState(() => result.state!);
    }
  };

  const handlePerformWorkspace = async () => {
    if (!task) return;
    sound.playChime('start');

    const existing = (state.performanceSessions || []).find(
      s => s.activityInstanceId === task.id && !['COMPLETED', 'PARTIAL', 'ABANDONED', 'CANCELLED'].includes(s.status)
    );

    if (existing) {
      onUpdateState(prev => ({
        ...prev,
        activePerformanceSessionId: existing.id,
        activeView: 'PERFORMANCE',
      }));
      return;
    }

    const result = await defaultApplicationService.execute({
      type: 'CreatePerformanceSession',
      payload: { activityInstanceId: task.id },
    }, state);

    if (result.success && result.state) {
      onUpdateState(() => result.state!);
    }
  };

  const handleDoneEarly = async () => {
    if (!task) return;

    let workingState = state;
    const effectiveStart = task.allocatedStartMinutes ?? task.startMinutes;

    if (currentMinutes < effectiveStart) {
      const advance = await defaultApplicationService.advanceActivity(
        task.id,
        Math.max(1, effectiveStart - currentMinutes),
        'User explicitly advanced this activity from NOW before its effective window.',
        workingState
      );
      if (!advance.success || !advance.state) return;
      workingState = advance.state;
    }

    const result = await defaultApplicationService.completeActivity({
      taskId: task.id,
      completedAtMinutes: currentMinutes,
      executionStatus: 'ON_TIME',
      missedWindow: false,
    }, workingState);

    if (result.success && result.state) {
      sound.playChime('success');
      try { confetti({ particleCount: 35, spread: 50, origin: { y: 0.6 } }); } catch {}
      onUpdateState(() => result.state!);
    }
  };

  const handleNeedMoreTime = async () => {
    if (!task) return;
    sound.playChime('start');

    let workingState = state;
    let session = (workingState.performanceSessions || []).find(
      s => s.activityInstanceId === task.id && !['COMPLETED', 'PARTIAL', 'ABANDONED', 'CANCELLED'].includes(s.status)
    );

    if (!session) {
      const created = await defaultApplicationService.execute({
        type: 'CreatePerformanceSession',
        payload: { activityInstanceId: task.id },
      }, workingState);
      if (!created.success || !created.state) return;
      workingState = created.state;
      session = (workingState.performanceSessions || []).find(s => s.id === workingState.activePerformanceSessionId);
    }

    if (!session) return;

    const extended = await defaultApplicationService.execute({
      type: 'RequestPerformanceExtension',
      payload: {
        sessionId: session.id,
        requestedMinutes: 15,
        reason: 'User requested more time from NOW.',
      },
    }, workingState);

    if (extended.success && extended.state) {
      onUpdateState(() => extended.state!);
    }
  };

  const handleCantDoThis = () => {
    if (!task) return;
    setShowRealityModal(true);
  };

  // Determine button CTA text based on task type
  const getPrimaryButtonLabel = () => {
    if (!task) return 'All Current Tasks Completed';
    if (task.interactiveActionType === 'FOCUS_BLOCK' || task.id.includes('deep-work')) return 'Perform Focus Block';
    if (task.interactiveActionType === 'TRADING_GATEKEEPER' || task.id === 'task-trading-protocol') return 'Perform Trading Protocol';
    if (task.interactiveActionType === 'FAMILY_OUTING' || task.id === 'task-family-life') return 'Enter Family Time';
    if (task.interactiveActionType === 'IDENTITY_CHECK' || task.interactiveActionType === 'OUTSIDE_TIMER' || task.interactiveActionType === 'WORKOUT_TRACKER' || task.interactiveActionType === 'MEDITATION_TIMER') return 'Perform Morning Activity';
    if (task.interactiveActionType === 'COMMAND_CENTER') return 'Open Command Center';
    if (task.interactiveActionType === 'EVENING_REVIEW') return 'Begin Evening Review';
    return 'Mark Completed';
  };

  // Duration & remaining calculation
  const dynamicStart = task ? (task.allocatedStartMinutes ?? task.startMinutes) : 0;
  const dynamicEnd = task ? (task.allocatedEndMinutes ?? task.endMinutes) : 0;
  const durationMins = dynamicEnd - dynamicStart;
  const minutesRemaining = task ? Math.max(0, dynamicEnd - currentMinutes) : 0;

  const modeBadge = {
    GREEN: { label: 'GREEN DAY', desc: 'On Track · Sovereign Momentum', color: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
    YELLOW: { label: 'YELLOW DAY', desc: 'Schedule Auto-Adjusted · Core Protected', color: 'bg-amber-50 text-amber-900 border-amber-200' },
    RED: { label: 'RED DAY', desc: 'Emergency Fallback · Minimum Viable Core', color: 'bg-rose-50 text-rose-900 border-rose-200' },
  }[state.currentMode];

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
      
      {/* 1. Header Status Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>{activeTheme.dayName}</span>
            <span>·</span>
            <span className="font-mono text-slate-700 font-bold">{formatMinutesToTime(currentMinutes)}</span>
            {state.isSimulatedTime && (
              <span className="px-1.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 text-[11px] font-medium lowercase">
                simulated
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
            What Matters Now
          </h1>
        </div>

        {/* Current Mode Badge */}
        <div className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 text-xs font-semibold ${modeBadge.color}`}>
          <span className="w-2 h-2 rounded-full bg-current animate-pulse" />
          <div className="flex flex-col">
            <span className="font-bold">{modeBadge.label}</span>
            <span className="text-[11px] opacity-80 font-normal">{modeBadge.desc}</span>
          </div>
        </div>
      </div>

      {/* 2. Pending Human Decision Alert (If Any) */}
      {state.activeHumanDecision && (
        <div className="p-5 rounded-2xl bg-amber-50 border-2 border-amber-300 shadow-sm animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                Autonomous Engine Decision Required
              </div>
              <h3 className="text-base font-bold text-amber-950 mt-0.5">
                {state.activeHumanDecision.prompt}
              </h3>
              <p className="text-xs text-amber-800 mt-1">
                {state.activeHumanDecision.context}
              </p>

              {/* Options */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {state.activeHumanDecision.options.map(option => (
                  <button
                    key={option.id}
                    onClick={() => {
                      sound.playChime('success');
                      onUpdateState(prev => ({
                        ...prev,
                        activeHumanDecision: null,
                        lastDecisionReason: `User selected: ${option.label}`,
                      }));
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Hero Card: Current Action */}
      {task ? (
        <div className="rounded-2xl bg-white border border-slate-200/90 shadow-sm p-6 sm:p-7 relative overflow-hidden transition-all hover:border-slate-300">
          
          {/* Top meta tags */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-semibold">
                {task.category || 'Mission Activity'}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-mono font-medium">
                {formatMinutesToTime(dynamicStart)} – {formatMinutesToTime(dynamicEnd)}
              </span>
            </div>

            {/* Time Remaining Pill */}
            <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-slate-700 bg-slate-50 px-3 py-1 rounded-lg border border-slate-200">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{minutesRemaining > 0 ? `${minutesRemaining}m remaining` : `${durationMins}m allocated`}</span>
            </div>
          </div>

          {/* Main Title & Rationale */}
          <div className="py-5">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight leading-snug">
              {task.title}
            </h2>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed max-w-2xl">
              {task.notes || 'Highest-value available action before your next protected commitment. Fully aligned with today’s priorities.'}
            </p>
          </div>

          {/* Primary Action Button & Quick Adjustments */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Primary Action & Performance Workspace */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={handleLaunchOrComplete}
                id="hero-primary-action-btn"
                className="px-6 py-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm shadow-sm transition-all flex items-center justify-center gap-2.5 group active:scale-[0.99]"
              >
                <Play className="w-4 h-4 text-emerald-400 fill-emerald-400 group-hover:translate-x-0.5 transition-transform" />
                <span>{getPrimaryButtonLabel()}</span>
              </button>

              <button
                onClick={handlePerformWorkspace}
                id="hero-performance-workspace-btn"
                className="px-4 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-1.5 active:scale-[0.99]"
                title="Launch Human Performance Engine execution environment"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Focus Workspace</span>
              </button>
            </div>

            {/* Secondary / Quick Actions */}
            <div className="flex items-center flex-wrap gap-2">
              <button
                onClick={handleDoneEarly}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
                title="Finish early and bank reward points"
              >
                Done early
              </button>
              <button
                onClick={handleNeedMoreTime}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
                title="Add 15 minutes of buffer"
              >
                Need +15m
              </button>
              <button
                onClick={() => setShowRealityModal(true)}
                className="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors"
                title="Report a schedule change"
              >
                Something changed
              </button>
              <button
                onClick={() => setShowWhyModal(true)}
                aria-label="Why this action now?"
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                title="Why this action now?"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* All Done State */
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center shadow-sm space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">
            All Current Activities Completed
          </h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            You have executed all scheduled items for this window. Family and evening commitments remain protected.
          </p>
          <div className="pt-2">
            <button
              onClick={() => onNavigateToView('REVIEW')}
              className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors"
            >
              Open Evening Review
            </button>
          </div>
        </div>
      )}

      {/* 4. Next Activity Preview & Day Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Next Activity Preview */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
            <ArrowRight className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Queued Next
            </div>
            {nextTask ? (
              <>
                <div className="text-sm font-bold text-slate-900 truncate mt-0.5">
                  {nextTask.title}
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  {formatMinutesToTime(nextTask.allocatedStartMinutes ?? nextTask.startMinutes)} · {nextTask.category || 'Mission'}
                </div>
              </>
            ) : (
              <div className="text-sm text-slate-500 mt-0.5">
                No further execution is scheduled by the active operating plan.
              </div>
            )}
          </div>
        </div>

        {/* Day Status Summary */}
        <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-xs flex items-center justify-between gap-2 text-xs">
          <div className="flex flex-col">
            <span className="text-slate-400 uppercase font-bold text-[10px] tracking-wider">Top 3 Advancing</span>
            <span className="font-bold text-slate-900 text-sm mt-0.5">{top3CompletedCount} of {top3.length || 3}</span>
          </div>
          <div className="h-8 w-px bg-slate-100" />
          <div className="flex flex-col">
            <span className="text-slate-400 uppercase font-bold text-[10px] tracking-wider">Progress</span>
            <span className="font-bold text-slate-900 text-sm mt-0.5">{completedCount} / {totalModeTasks} Done</span>
          </div>
          <div className="h-8 w-px bg-slate-100" />
          <div className="flex flex-col">
            <span className="text-slate-400 uppercase font-bold text-[10px] tracking-wider">Protected</span>
            <span className="font-bold text-purple-700 text-sm mt-0.5 flex items-center gap-1">
              <Lock className="w-3 h-3" /> 2 Windows
            </span>
          </div>
        </div>
      </div>

      {/* 5. Modals */}
      <RealityChangeModal
        isOpen={showRealityModal}
        onClose={() => setShowRealityModal(false)}
        state={state}
        onUpdateState={onUpdateState}
        currentTask={task}
      />

      {task && (
        <WhyThisModal
          isOpen={showWhyModal}
          onClose={() => setShowWhyModal(false)}
          state={state}
          task={task}
        />
      )}
    </div>
  );
};
