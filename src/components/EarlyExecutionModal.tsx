import React from 'react';
import { Clock, AlertCircle, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { RoutineTask } from '../types';
import { formatMinutesToTime } from '../services/storageService';

interface EarlyExecutionModalProps {
  task: RoutineTask;
  currentMinutes: number;
  onConfirmEarlyExecution: (task: RoutineTask) => void;
  onClose: () => void;
}

export const EarlyExecutionModal: React.FC<EarlyExecutionModalProps> = ({
  task,
  currentMinutes,
  onConfirmEarlyExecution,
  onClose,
}) => {
  const minutesEarly = task.startMinutes - currentMinutes;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-indigo-700 font-mono text-xs font-bold uppercase tracking-wider">
            <Clock className="w-4 h-4 text-indigo-600" />
            <span>Time-Boundary Gatekeeper</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Body */}
        <div className="space-y-3">
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 font-mono">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Anchor Scheduled for Later ({formatMinutesToTime(task.startMinutes)})</span>
            </div>
            <p className="text-amber-800 leading-relaxed">
              Current clock time is <strong className="font-mono">{formatMinutesToTime(currentMinutes)}</strong>. You are executing <strong className="text-slate-900">{task.title}</strong> approximately <strong className="font-mono">{minutesEarly} minutes</strong> ahead of its scheduled anchor window.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
            <span className="font-bold text-slate-900 font-mono text-[11px] uppercase tracking-wider">
              Autonomous Policy Choice:
            </span>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Intentional advance execution is permitted. The Autonomous Engine will log an <strong className="font-mono text-indigo-700">ADVANCE_EXECUTION</strong> audit event and pull forward your subsequent sequence.
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Wait for Scheduled Time
          </button>
          <button
            onClick={() => onConfirmEarlyExecution(task)}
            className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Confirm Advance Execution</span>
          </button>
        </div>

      </div>
    </div>
  );
};
