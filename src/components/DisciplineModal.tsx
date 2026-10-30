import React from 'react';
import { AlertTriangle, Clock, ShieldAlert, ArrowRight, X, Flame } from 'lucide-react';
import { RoutineTask } from '../types';
import { formatMinutesToTime, PENALTY_POINTS_MISSED_WINDOW } from '../services/storageService';

interface DisciplineModalProps {
  task: RoutineTask | null;
  currentMinutes: number;
  onAcceptPenaltyAndComplete: (task: RoutineTask) => void;
  onClose: () => void;
}

export const DisciplineModal: React.FC<DisciplineModalProps> = ({
  task,
  currentMinutes,
  onAcceptPenaltyAndComplete,
  onClose,
}) => {
  if (!task) return null;

  const minutesLate = Math.max(1, currentMinutes - task.endMinutes);
  const hoursLate = (minutesLate / 60).toFixed(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-red-200 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        
        {/* Header Alert Strip */}
        <div className="bg-red-600 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[11px] font-mono uppercase tracking-wider text-red-100 font-bold">
                Time Window Violation
              </div>
              <h3 className="text-base font-extrabold leading-tight">
                Discipline Accountability Check
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Target Task Summary */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-500 font-medium">Target Anchor:</span>
              <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded-md border border-red-200 font-bold">
                Missed by {minutesLate > 60 ? `${hoursLate} hrs` : `${minutesLate} mins`}
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-900">
              {task.title}
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs pt-1">
              <div className="p-2 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] font-mono text-slate-400 block">Scheduled Window</span>
                <span className="font-semibold text-slate-800 font-mono">{task.timeWindow}</span>
              </div>
              <div className="p-2 rounded-xl bg-white border border-slate-200">
                <span className="text-[10px] font-mono text-slate-400 block">Current Clock Time</span>
                <span className="font-semibold text-red-600 font-mono">{formatMinutesToTime(currentMinutes)}</span>
              </div>
            </div>
          </div>

          {/* Hard Truth / Tough Love Callout */}
          <div className="p-4 rounded-2xl bg-red-50/80 border border-red-200 text-xs text-red-950 space-y-2">
            <div className="flex items-center gap-2 font-bold text-red-800 font-mono">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <span>THE SOVEREIGN REALITY:</span>
            </div>
            <p className="leading-relaxed text-slate-700">
              The clock does not negotiate. If you missed the execution window, you missed it. You cannot just mark it effortlessly as if discipline were intact.
            </p>
            <p className="leading-relaxed font-semibold text-red-900">
              Points have been deducted. Acknowledge your shortfall, take the loss, and step back up to work harder on everything that remains today.
            </p>
          </div>

          {/* Penalty Stats */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-900 text-white">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-mono text-slate-300">Point Consequence:</span>
            </div>
            <span className="text-sm font-mono font-extrabold text-red-400">
              -{PENALTY_POINTS_MISSED_WINDOW} PTS DEDUCTION
            </span>
          </div>

          {/* Actions */}
          <div className="space-y-2 pt-1">
            <button
              id="accept-penalty-commit-btn"
              onClick={() => onAcceptPenaltyAndComplete(task)}
              className="w-full py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs font-mono flex items-center justify-center gap-2 shadow-md shadow-red-500/20 transition-all active:scale-[0.98]"
            >
              <span>Acknowledge Failure, Accept -{PENALTY_POINTS_MISSED_WINDOW} PTS & Work Harder</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
            >
              Leave Incomplete (Do Not Mark)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
