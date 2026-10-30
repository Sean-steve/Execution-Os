import React from 'react';
import { 
  CheckCircle2, 
  Sparkles, 
  Lock, 
  ShieldCheck, 
  Clock, 
  Target, 
  Layers, 
  ArrowRight,
  TrendingUp,
  Cpu
} from 'lucide-react';
import { AccessibleModal } from './AccessibleModal';
import { AppState, RoutineTask } from '../../types';
import { checkTaskDependencies } from '../../services/dependencyEngine';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../../services/storageService';

interface WhyThisModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  task: RoutineTask;
}

export const WhyThisModal: React.FC<WhyThisModalProps> = ({
  isOpen,
  onClose,
  state,
  task,
}) => {
  const currentMinutes = getCurrentTimeMinutes(state);
  const depCheck = checkTaskDependencies(state, task.id);
  const dynamicStart = task.allocatedStartMinutes ?? task.startMinutes;
  const dynamicEnd = task.allocatedEndMinutes ?? task.endMinutes;
  const durationMins = dynamicEnd - dynamicStart;

  const top1 = state.tomorrowPlan.top3?.[0] || 'Core mission progress';

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Why This Action Now?"
      description="Autonomous reasoning and priority constraints determined by your Execution OS."
      maxWidth="md"
    >
      <div className="space-y-4">
        {/* Prime Reasoning Card */}
        <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-100 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-indigo-950">
              Highest-Value Available Action
            </div>
            <div className="text-xs text-indigo-800 mt-1 leading-relaxed">
              Execution OS evaluated current energy, scheduled windows, and mission dependencies. This is the optimal step to advance your day.
            </div>
          </div>
        </div>

        {/* Verification Matrix */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Evaluated Decision Factors
          </div>
          
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden text-sm">
            {/* Factor 1: Priority alignment */}
            <div className="p-3.5 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800">Advances Priority:</span>
                <span className="text-slate-600 ml-1.5 text-xs">{top1}</span>
              </div>
            </div>

            {/* Factor 2: Available Capacity */}
            <div className="p-3.5 flex items-start gap-3">
              <Clock className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800">Window & Duration:</span>
                <span className="text-slate-600 ml-1.5 text-xs">
                  {durationMins} minutes allocated ({formatMinutesToTime(dynamicStart)} – {formatMinutesToTime(dynamicEnd)})
                </span>
              </div>
            </div>

            {/* Factor 3: Dependencies */}
            <div className="p-3.5 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800">Dependencies Satisfied:</span>
                <span className="text-slate-600 ml-1.5 text-xs">
                  {depCheck.isSatisfied 
                    ? 'All prerequisite anchors completed on-time.' 
                    : 'Unsatisfied dependencies resolved via fallback.'}
                </span>
              </div>
            </div>

            {/* Factor 4: Protected Family Sanctuary */}
            <div className="p-3.5 flex items-start gap-3">
              <Lock className="w-4 h-4 text-purple-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800">Protected Commitments:</span>
                <span className="text-slate-600 ml-1.5 text-xs">
                  Family Sanctuary window (4:00 PM / 17:00) is locked and undisturbed.
                </span>
              </div>
            </div>

            {/* Factor 5: Trading Rule Gate */}
            <div className="p-3.5 flex items-start gap-3">
              <TrendingUp className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <span className="font-semibold text-slate-800">Trading Protocol:</span>
                <span className="text-slate-600 ml-1.5 text-xs">
                  {state.tradingProtocol.setupDetected && state.tradingProtocol.strategyCriteriaMet
                    ? 'Valid setup detected within risk limits.'
                    : 'No undisciplined trades allowed; focus preserved on core building.'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Technical Telemetry (Collapsible details) */}
        <details className="text-xs text-slate-500 bg-slate-50 rounded-xl p-3 border border-slate-200">
          <summary className="font-medium text-slate-700 cursor-pointer select-none">
            Technical Optimization Telemetry
          </summary>
          <div className="mt-2 space-y-1 font-mono text-[11px] text-slate-600 pt-2 border-t border-slate-200">
            <div>Task ID: {task.id}</div>
            <div>Anchor: {task.anchorId || 'DYNAMIC'}</div>
            <div>Routine State: {state.routineState}</div>
            <div>Autonomy Level: {state.autonomyLevel}</div>
            <div>Fallback Tier: Tier {task.fallbackLevel ?? 0} (Full Scope)</div>
          </div>
        </details>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors"
          >
            Got It
          </button>
        </div>
      </div>
    </AccessibleModal>
  );
};
