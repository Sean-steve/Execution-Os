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
  CornerDownRight, 
  ChevronRight,
  Shield,
  Activity,
  Maximize2,
  Sparkles,
  Lock,
  Minimize2
} from 'lucide-react';
import { AppState, RoutineTask, FallbackTier, AutonomyLevel } from '../types';
import { getAutonomousNextDecision } from '../services/decisionEngine';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { getActiveDayTheme } from '../services/dayThemeService';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface AutonomousControlHUDProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onNavigateToInteractive: (task: RoutineTask) => void;
  onRequestDisciplineModal: (task: RoutineTask) => void;
}

export const AutonomousControlHUD: React.FC<AutonomousControlHUDProps> = ({
  state,
  onUpdateState,
  onNavigateToInteractive,
  onRequestDisciplineModal,
}) => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);
  const decision = getAutonomousNextDecision(state);
  const task = decision.currentTask;

  const [showAdjustmentMenu, setShowAdjustmentMenu] = useState(false);
  const [showFallbackSelector, setShowFallbackSelector] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideAction, setOverrideAction] = useState<'ADVANCE' | 'DEFER' | 'COMPRESS' | 'SKIP' | 'REPLACE'>('DEFER');
  const [showOverrideInput, setShowOverrideInput] = useState(false);

  const handleCompleteAction = async () => {
    if (!task) return;
    const effectiveEnd = task.allocatedEndMinutes ?? task.endMinutes;
    if (state.strictTimeEnforcement && currentMinutes > effectiveEnd + 5) {
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
      try { confetti({ particleCount: 35, spread: 60, origin: { y: 0.6 } }); } catch {}
      onUpdateState(() => result.state!);
    }
  };

  const handleApplyFallback = async (tier: FallbackTier) => {
    if (!task) return;
    sound.playChime('start');
    const result = await defaultApplicationService.triggerFallback(
      task.id,
      tier.level,
      `User selected fallback: ${tier.title}`,
      state
    );
    if (result.success && result.state) {
      onUpdateState(() => result.state!);
    }
    setShowFallbackSelector(false);
  };

  const handleExecuteAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task || !overrideReason.trim()) return;

    sound.playChime('start');
    let result;

    if (overrideAction === 'ADVANCE') {
      result = await defaultApplicationService.advanceActivity(task.id, 30, overrideReason, state);
    } else if (overrideAction === 'DEFER') {
      result = await defaultApplicationService.deferActivity(task.id, 60, overrideReason, state);
    } else if (overrideAction === 'COMPRESS') {
      const currentDuration = (task.allocatedEndMinutes ?? task.endMinutes) - (task.allocatedStartMinutes ?? task.startMinutes);
      result = await defaultApplicationService.compressActivity(task.id, Math.max(10, Math.floor(currentDuration * 0.5)), overrideReason, undefined, state);
    } else if (overrideAction === 'SKIP') {
      result = await defaultApplicationService.overrideActivity({
        taskId: task.id,
        overrideType: 'SKIP',
        reason: overrideReason,
        modifications: { completed: false, executionStatus: 'SKIPPED', notes: `Skipped by user: ${overrideReason}` },
      }, state);
    } else {
      result = await defaultApplicationService.overrideActivity({
        taskId: task.id,
        overrideType: 'REPLACE',
        reason: overrideReason,
      }, state);
    }

    if (result.success && result.state) {
      onUpdateState(() => result.state!);
    }

    setShowOverrideInput(false);
    setShowAdjustmentMenu(false);
    setOverrideReason('');
  };

  const getRoutineBadgeColor = (rState: string) => {
    switch (rState) {
      case 'COMPRESSED': return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'DISRUPTED': return 'bg-orange-50 text-orange-800 border-orange-200';
      case 'RECOVERY': return 'bg-red-50 text-red-800 border-red-200';
      case 'EARLY_EXIT': return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      case 'COMPLETED': return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      default: return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="rounded-3xl bg-white border border-slate-200/90 shadow-lg overflow-hidden transition-all duration-200">
      
      {/* Top Autonomous Intelligence Radar Banner */}
      <div className="px-6 py-3 bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shrink-0" />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              <span>Autonomous Execution Kernel</span>
            </span>
            <span className="text-slate-500 font-mono text-xs hidden sm:inline">•</span>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${getRoutineBadgeColor(state.routineState)}`}>
              {state.routineState} ROUTINE
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
              Autonomy Level {state.autonomyLevel}: Auto-Reallocate
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-emerald-400" />
            <span className="text-slate-300 font-bold">{state.autonomousResolutionCount || 0}</span> Auto-Resolved
          </span>
          <span>•</span>
          <span className="text-slate-300 font-semibold">{decision.timeRemainingStr}</span>
        </div>
      </div>

      {/* Routine Change Context Strip (if compressed or reallocated) */}
      {state.routineChangeReason && state.routineState !== 'STANDARD' && (
        <div className="bg-amber-50/90 border-b border-amber-200/70 px-6 py-2 flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="font-medium">{state.routineChangeReason}</span>
          </div>
          <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded uppercase">
            Auto-Protected
          </span>
        </div>
      )}

      {/* Main Command Action Canvas */}
      <div className="p-6 sm:p-8 space-y-6">
        
        {/* Core Question & Selected Action */}
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="space-y-3 max-w-3xl">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-mono font-extrabold uppercase tracking-widest px-2.5 py-1 rounded-lg border ${activeTheme.classes.badge}`}>
                What Should I Do Now?
              </span>
              {decision.isProtected && (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  Protected Commitment
                </span>
              )}
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
              {task ? task.title : 'All Scheduled Anchors Complete'}
            </h2>

            {/* Contextual Rationale ("Why is this next?") */}
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs sm:text-sm text-slate-700 space-y-1">
              <div className="flex items-center gap-1.5 text-indigo-700 font-mono text-[11px] font-bold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>Contextual Decision Rationale:</span>
              </div>
              <p className="leading-relaxed font-medium text-slate-800">
                "{decision.decisionReason}"
              </p>
            </div>

            {/* Dependency Alert if Blocked */}
            {decision.isBlockedByDependency && (
              <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-900 space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold font-mono">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>DEPENDENCY GOVERNANCE BLOCK:</span>
                </div>
                <p className="leading-relaxed">
                  {decision.dependencyBlockReason}
                </p>
              </div>
            )}
          </div>

          {/* Time Window & Fallback Badge Box */}
          {task && (
            <div className="lg:w-72 shrink-0 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                <span>Execution Slot:</span>
                <span className="font-bold text-slate-800">
                  {task.allocatedStartMinutes 
                    ? `${formatMinutesToTime(task.allocatedStartMinutes)} – ${formatMinutesToTime(task.allocatedEndMinutes!)}`
                    : task.timeWindow}
                </span>
              </div>

              {task.fallbackLevel !== undefined && task.fallbackLevel > 0 && (
                <div className="p-2 rounded-xl bg-amber-100/70 border border-amber-300 text-[11px] font-mono text-amber-900 flex items-center justify-between">
                  <span className="font-bold">Fallback Level {task.fallbackLevel} Active</span>
                  <span className="text-[10px] bg-amber-200 px-1.5 py-0.5 rounded font-bold">Compressed</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-mono">Pillar Target:</span>
                <span className="font-bold text-slate-800 capitalize font-mono">
                  {task.associatedPillar || 'Core Routine'}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Actions & Adjustment Controls */}
        {task && !task.completed && (
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            
            {/* Left: Direct Execution Buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {task.interactiveActionType && task.interactiveActionType !== 'GENERIC' ? (
                <button
                  id="hud-enter-suite-btn"
                  onClick={() => onNavigateToInteractive(task)}
                  className={`px-5 py-3 rounded-2xl text-white font-mono font-bold text-xs flex items-center gap-2 shadow-md transition-all active:scale-[0.98] ${activeTheme.classes.accentBg}`}
                >
                  <span>Engage Interactive Suite</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : null}

              <button
                id="hud-complete-now-btn"
                onClick={handleCompleteAction}
                disabled={decision.isBlockedByDependency}
                className={`px-5 py-3 rounded-2xl text-white font-mono font-bold text-xs flex items-center gap-2 shadow-md transition-all active:scale-[0.98] ${
                  decision.isBlockedByDependency
                    ? 'bg-slate-400 cursor-not-allowed opacity-60'
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Mark Action Executed</span>
              </button>
            </div>

            {/* Right: Fallback Tier & Adjustment Menus */}
            <div className="flex items-center gap-2">
              {decision.availableFallbackTiers.length > 0 && (
                <button
                  id="hud-fallback-toggle-btn"
                  onClick={() => setShowFallbackSelector(!showFallbackSelector)}
                  className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
                  title="Select lower-duration fallback tier"
                >
                  <Minimize2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Fallbacks ({decision.availableFallbackTiers.length})</span>
                </button>
              )}

              <button
                id="hud-adjust-toggle-btn"
                onClick={() => setShowAdjustmentMenu(!showAdjustmentMenu)}
                className="px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors shadow-xs"
              >
                <Sliders className="w-3.5 h-3.5 text-slate-600" />
                <span>Adjust / Override</span>
              </button>
            </div>
          </div>
        )}

        {/* Fallback Selector Drawer */}
        {showFallbackSelector && decision.availableFallbackTiers.length > 0 && (
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200 animate-in slide-in-from-top-2 duration-150 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-amber-900 flex items-center gap-1.5">
                <Minimize2 className="w-4 h-4 text-amber-600" />
                <span>Available Fallback Hierarchy for "{task?.title}":</span>
              </span>
              <span className="text-[11px] text-amber-700 font-medium">Select tier to instantly compress duration</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
              {decision.availableFallbackTiers.map(tier => {
                const isActive = task?.fallbackLevel === tier.level;
                return (
                  <button
                    key={tier.level}
                    onClick={() => handleApplyFallback(tier)}
                    className={`p-3 rounded-xl border text-left text-xs transition-all ${
                      isActive
                        ? 'bg-amber-600 text-white border-amber-700 shadow-sm font-bold'
                        : 'bg-white border-amber-200 text-slate-800 hover:border-amber-400 hover:bg-amber-50/50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-mono pb-1 border-b border-amber-100">
                      <span>Level {tier.level}</span>
                      <span className="font-bold">{tier.durationMinutes} mins</span>
                    </div>
                    <div className="font-bold text-sm mt-1">{tier.title}</div>
                    <p className={`text-[11px] mt-1 line-clamp-2 ${isActive ? 'text-amber-100' : 'text-slate-600'}`}>
                      {tier.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Adjustment / Override Drawer */}
        {showAdjustmentMenu && (
          <div className="p-5 rounded-2xl bg-slate-900 text-white animate-in slide-in-from-top-2 duration-150 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-slate-200">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span>Autonomous Adjustment & Human Override Protocol</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                Requires genuine justification for audit ledger
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['DEFER', 'COMPRESS', 'SKIP', 'ADVANCE'] as const).map(action => (
                <button
                  key={action}
                  onClick={() => {
                    setOverrideAction(action);
                    setShowOverrideInput(true);
                  }}
                  className={`p-3 rounded-xl border text-xs font-mono font-bold transition-all text-center ${
                    overrideAction === action && showOverrideInput
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  {action} TASK
                </button>
              ))}
            </div>

            {showOverrideInput && (
              <form onSubmit={handleExecuteAdjustment} className="space-y-3 pt-2">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    State the genuine reason for {overrideAction}ing "{task?.title}":
                  </label>
                  <input
                    type="text"
                    required
                    value={overrideReason}
                    onChange={e => setOverrideReason(e.target.value)}
                    placeholder="e.g. Urgent production deployment hotfix / delayed client meeting"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 text-xs focus:outline-hidden focus:border-indigo-500"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOverrideInput(false)}
                    className="px-3 py-2 rounded-xl text-xs font-mono text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-mono font-bold text-xs shadow-sm transition-colors"
                  >
                    Confirm & Recalculate Day
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

      </div>
    </div>
  );
};
