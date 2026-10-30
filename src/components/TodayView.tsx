import React, { useState } from 'react';
import { 
  Clock, 
  CheckCircle2, 
  Lock, 
  ArrowRight, 
  Layers, 
  Sparkles, 
  AlertTriangle, 
  ChevronDown, 
  ChevronUp, 
  Info,
  Calendar,
  Play,
  RotateCcw
} from 'lucide-react';
import { AppState, RoutineTask } from '../types';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { getActiveDayTheme } from '../services/dayThemeService';
import { RealityChangeModal } from './ui/RealityChangeModal';

interface TodayViewProps {
  state: AppState;
  onSelectTask: (task: RoutineTask) => void;
  onRequestDisciplineModal: (task: RoutineTask) => void;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const TodayView: React.FC<TodayViewProps> = ({
  state,
  onSelectTask,
  onRequestDisciplineModal,
  onUpdateState,
}) => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);
  const [showPlannedVsActual, setShowPlannedVsActual] = useState(false);
  const [showRealityModal, setShowRealityModal] = useState(false);

  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));

  // Partition tasks into Past, Now, Next, Later, Protected
  const pastTasks: RoutineTask[] = [];
  let currentTask: RoutineTask | null = null;
  const futureTasks: RoutineTask[] = [];

  tasks.forEach(t => {
    const start = t.allocatedStartMinutes ?? t.startMinutes;
    const end = t.allocatedEndMinutes ?? t.endMinutes;

    if (t.completed) {
      pastTasks.push(t);
    } else if (!currentTask && currentMinutes >= start && currentMinutes <= end + 5) {
      currentTask = t;
    } else if (!currentTask && currentMinutes < start && pastTasks.length === 0) {
      currentTask = t;
    } else {
      futureTasks.push(t);
    }
  });

  // If no task directly matched NOW, pick the first uncompleted task
  if (!currentTask && futureTasks.length > 0) {
    currentTask = futureTasks.shift()!;
  }

  const deviationsCount = state.deviations?.length || 0;
  const hasScheduleAdjustment = state.routineState === 'COMPRESSED' || state.routineState === 'RECOVERY' || deviationsCount > 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-in fade-in duration-200">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>{activeTheme.dayName} Timeline</span>
            <span>·</span>
            <span className="font-mono text-slate-700 font-bold">{formatMinutesToTime(currentMinutes)}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
            Living Execution Timeline
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRealityModal(true)}
            className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 shadow-xs transition-colors"
          >
            Something changed
          </button>
          <button
            onClick={() => setShowPlannedVsActual(prev => !prev)}
            className="px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 shadow-xs transition-colors flex items-center gap-1.5"
          >
            <span>{showPlannedVsActual ? 'Hide Planned' : 'Planned vs Actual'}</span>
            {showPlannedVsActual ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Single Recovery Summary Banner (If disruptions happened) */}
      {hasScheduleAdjustment && (
        <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200/90 text-amber-950 flex items-start gap-3 shadow-xs">
          <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 text-xs">
            <div className="font-bold text-sm text-amber-950">
              Schedule Recalibrated by Autonomous OS
            </div>
            <p className="text-amber-900 mt-0.5 leading-relaxed">
              {state.routineChangeReason || 'Timings dynamically reflowed to absorb delays while keeping Family Sanctuary (4:00 PM) strictly protected.'}
            </p>
          </div>
        </div>
      )}

      {/* Timeline Stream */}
      <div className="space-y-3">
        
        {/* Past Tasks (Collapsible or Muted) */}
        {pastTasks.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Completed Earlier ({pastTasks.length})
            </div>
            <div className="space-y-1.5">
              {pastTasks.map(t => {
                const dynamicStart = t.allocatedStartMinutes ?? t.startMinutes;
                const dynamicEnd = t.allocatedEndMinutes ?? t.endMinutes;
                return (
                  <div
                    key={t.id}
                    onClick={() => onSelectTask(t)}
                    className="px-4 py-3 rounded-xl border border-slate-200/60 bg-slate-50/70 hover:bg-slate-100/80 transition-colors flex items-center justify-between text-xs cursor-pointer opacity-75"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-medium text-slate-700 line-through decoration-slate-400">
                        {t.title}
                      </span>
                    </div>
                    <span className="font-mono text-slate-400">
                      {formatMinutesToTime(dynamicStart)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* NOW Highlight Section */}
        {currentTask && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-bold text-indigo-600 uppercase tracking-wider px-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
              <span>Happening Now</span>
            </div>

            {(() => {
              const t = currentTask;
              const dynamicStart = t.allocatedStartMinutes ?? t.startMinutes;
              const dynamicEnd = t.allocatedEndMinutes ?? t.endMinutes;
              const isProtected = t.id === 'task-family-life' || t.anchorId === 'ANCHOR_8_HUMAN_LIFE';
              const isShifted = dynamicStart !== t.startMinutes || dynamicEnd !== t.endMinutes;

              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTask(t)}
                  className="p-5 rounded-2xl border-2 border-indigo-500 bg-white shadow-md hover:shadow-lg transition-all cursor-pointer relative overflow-hidden"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                        <Play className="w-4 h-4 fill-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                            {t.category || 'Active Focus'}
                          </span>
                          {isProtected && (
                            <span className="text-xs font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md flex items-center gap-1">
                              <Lock className="w-3 h-3" /> Protected
                            </span>
                          )}
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 mt-1">
                          {t.title}
                        </h3>
                        {t.notes && (
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                            {t.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-1 text-right shrink-0">
                      <div className="text-sm font-bold font-mono text-slate-900">
                        {formatMinutesToTime(dynamicStart)} – {formatMinutesToTime(dynamicEnd)}
                      </div>
                      {isShifted && (
                        <div className="text-[11px] text-amber-700 font-mono">
                          (Planned: {formatMinutesToTime(t.startMinutes)})
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Future Tasks */}
        {futureTasks.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
              Upcoming Today ({futureTasks.length})
            </div>
            <div className="space-y-2">
              {futureTasks.map(t => {
                const dynamicStart = t.allocatedStartMinutes ?? t.startMinutes;
                const dynamicEnd = t.allocatedEndMinutes ?? t.endMinutes;
                const isProtected = t.id === 'task-family-life' || t.anchorId === 'ANCHOR_8_HUMAN_LIFE' || t.category === 'LIFE';
                const isShifted = dynamicStart !== t.startMinutes;
                const depCheck = checkTaskDependencies(state, t.id);

                return (
                  <div
                    key={t.id}
                    onClick={() => onSelectTask(t)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer hover:border-slate-300 hover:shadow-xs ${
                      isProtected
                        ? 'bg-purple-50/30 border-purple-200/80 hover:bg-purple-50/60'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${isProtected ? 'bg-purple-500' : 'bg-slate-300'}`} />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900">
                              {t.title}
                            </span>
                            {isProtected && (
                              <Lock className="w-3.5 h-3.5 text-purple-600" />
                            )}
                          </div>
                          <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                            <span>{t.category || 'Mission'}</span>
                            {!depCheck.isSatisfied && (
                              <span className="text-amber-600 font-medium">· Prerequisite queued</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono text-xs text-slate-600 shrink-0">
                        <div>{formatMinutesToTime(dynamicStart)}</div>
                        {showPlannedVsActual && isShifted && (
                          <div className="text-[10px] text-slate-400">
                            orig {formatMinutesToTime(t.startMinutes)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <RealityChangeModal
        isOpen={showRealityModal}
        onClose={() => setShowRealityModal(false)}
        state={state}
        onUpdateState={onUpdateState}
      />
    </div>
  );
};
