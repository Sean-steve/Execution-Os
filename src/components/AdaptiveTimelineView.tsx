import React from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Lock, 
  Minimize2, 
  ArrowRight, 
  Layers, 
  AlertTriangle,
  Flame,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { AppState, RoutineTask } from '../types';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { checkTaskDependencies } from '../services/dependencyEngine';
import { getActiveDayTheme } from '../services/dayThemeService';

interface AdaptiveTimelineViewProps {
  state: AppState;
  onSelectTask: (task: RoutineTask) => void;
  onRequestDisciplineModal: (task: RoutineTask) => void;
}

export const AdaptiveTimelineView: React.FC<AdaptiveTimelineViewProps> = ({
  state,
  onSelectTask,
  onRequestDisciplineModal,
}) => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);
  const allocations = state.dynamicAllocations || [];
  const mode = state.currentMode;
  const tasks = state.tasks.filter(t => t.modesAllowed.includes(mode));

  return (
    <div className="space-y-4">
      {/* Header Bar with Allocation Engine Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <span>Dynamic Allocation & Adaptive Timeline</span>
          </h3>
          <p className="text-xs text-slate-500">
            Real-time schedule recalculation with protected family boundaries and dependency safeguards.
          </p>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-600">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Done
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-indigo-500" /> Active
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Compressed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500" /> Protected
          </span>
        </div>
      </div>

      {/* Timeline Task Cards */}
      <div className="space-y-3">
        {tasks.map(task => {
          const alloc = allocations.find(a => a.activityId === task.id);
          const depCheck = checkTaskDependencies(state, task.id);
          const isFamily = task.id === 'task-family-life' || task.anchorId === 'ANCHOR_8_HUMAN_LIFE';
          
          const scheduledStart = task.startMinutes;
          const scheduledEnd = task.endMinutes;
          const dynamicStart = task.allocatedStartMinutes ?? scheduledStart;
          const dynamicEnd = task.allocatedEndMinutes ?? scheduledEnd;
          const isShifted = dynamicStart !== scheduledStart || dynamicEnd !== scheduledEnd;
          const isCompressed = (dynamicEnd - dynamicStart) < (scheduledEnd - scheduledStart);
          const isLate = !task.completed && currentMinutes > (scheduledEnd + 5);

          return (
            <div
              key={task.id}
              onClick={() => onSelectTask(task)}
              className={`p-4 rounded-2xl border transition-all cursor-pointer hover:shadow-md ${
                task.completed
                  ? 'bg-slate-50 border-slate-200 opacity-80'
                  : isLate
                  ? 'bg-red-50/40 border-red-200 hover:border-red-300'
                  : isFamily
                  ? 'bg-purple-50/30 border-purple-200 hover:border-purple-300'
                  : isCompressed
                  ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300'
                  : 'bg-white border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Left: Checkmark & Title */}
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                    task.completed
                      ? 'bg-emerald-600 text-white'
                      : isLate
                      ? 'border-2 border-red-400 text-red-500 bg-white'
                      : 'border-2 border-slate-300 bg-white'
                  }`}>
                    {task.completed ? <CheckCircle2 className="w-4 h-4" /> : null}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className={`text-sm font-bold ${task.completed ? 'line-through text-slate-500' : 'text-slate-900'}`}>
                        {task.title}
                      </h4>

                      {task.isNonNegotiable && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 uppercase">
                          Non-Negotiable
                        </span>
                      )}

                      {isFamily && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" />
                          Protected Block
                        </span>
                      )}

                      {task.fallbackLevel !== undefined && task.fallbackLevel > 0 && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1">
                          <Minimize2 className="w-2.5 h-2.5" />
                          Fallback L{task.fallbackLevel}
                        </span>
                      )}

                      {depCheck.isBlocked && !task.completed && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          Blocked
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-1">
                      {task.subtext || task.notes}
                    </p>

                    {alloc?.reasonForAdjustment && (
                      <p className="text-[11px] font-mono text-indigo-700 font-medium">
                        ↳ {alloc.reasonForAdjustment}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Time Slot & Quick Action */}
                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                  <div className="text-right text-xs font-mono">
                    <div className="font-bold text-slate-900">
                      {formatMinutesToTime(dynamicStart)} – {formatMinutesToTime(dynamicEnd)}
                    </div>
                    {isShifted && (
                      <div className="text-[10px] text-slate-400 line-through">
                        Orig: {formatMinutesToTime(scheduledStart)} – {formatMinutesToTime(scheduledEnd)}
                      </div>
                    )}
                  </div>

                  <ArrowRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
