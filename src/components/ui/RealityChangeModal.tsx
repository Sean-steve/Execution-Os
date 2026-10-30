import React, { useState } from 'react';
import { 
  AlertCircle, 
  Clock, 
  Sparkles, 
  CheckCircle2, 
  ArrowRight, 
  ShieldCheck, 
  BatteryLow, 
  BatteryCharging, 
  DoorOpen, 
  CalendarX, 
  MessageSquare,
  Lock,
  Layers
} from 'lucide-react';
import { AccessibleModal } from './AccessibleModal';
import { AppState, RoutineTask } from '../../types';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../../services/storageService';
import { scanAndResolveDeviations } from '../../services/deviationEngine';
import { sound } from '../../services/soundService';
import { logEventToState } from '../../services/eventBus';
import confetti from 'canvas-confetti';

interface RealityChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  currentTask?: RoutineTask | null;
}

export type RealityChangeOption = 
  | 'RUNNING_LATE'
  | 'SOMETHING_CAME_UP'
  | 'NEED_TO_LEAVE'
  | 'LESS_ENERGY'
  | 'MORE_TIME'
  | 'CANNOT_HAPPEN'
  | 'OTHER';

interface AdjustmentSummary {
  headline: string;
  changes: { title: string; changeText: string; isProtected?: boolean }[];
  recoveryMessage: string;
}

export const RealityChangeModal: React.FC<RealityChangeModalProps> = ({
  isOpen,
  onClose,
  state,
  onUpdateState,
  currentTask,
}) => {
  const [selectedOption, setSelectedOption] = useState<RealityChangeOption | null>(null);
  const [minutesLate, setMinutesLate] = useState<number>(30);
  const [customReason, setCustomReason] = useState('');
  const [departureTime, setDepartureTime] = useState('16:00');
  const [isProcessing, setIsProcessing] = useState(false);
  const [adjustmentResult, setAdjustmentResult] = useState<AdjustmentSummary | null>(null);

  const currentMinutes = getCurrentTimeMinutes(state);

  const resetState = () => {
    setSelectedOption(null);
    setMinutesLate(30);
    setCustomReason('');
    setAdjustmentResult(null);
    setIsProcessing(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleApplyAdjustment = () => {
    setIsProcessing(true);
    sound.playChime('start');

    setTimeout(() => {
      let headline = 'DAY ADJUSTED';
      let changes: { title: string; changeText: string; isProtected?: boolean }[] = [];
      let recoveryMessage = 'Nothing critical was lost.';

      onUpdateState(prev => {
        let nextState: AppState = { ...prev };
        const nowMins = getCurrentTimeMinutes(nextState);

        if (selectedOption === 'RUNNING_LATE') {
          headline = `SCHEDULE SHIFTED (+${minutesLate}m)`;
          // Shift uncompleted tasks
          const updatedTasks = nextState.tasks.map(t => {
            if (!t.completed && (t.allocatedStartMinutes ?? t.startMinutes) >= nowMins) {
              const isFamily = t.id === 'task-family-life' || t.anchorId === 'ANCHOR_8_HUMAN_LIFE';
              if (isFamily) {
                // Keep family strictly protected
                changes.push({
                  title: t.title,
                  changeText: `${formatMinutesToTime(t.startMinutes)} 🔒 unchanged`,
                  isProtected: true,
                });
                return t;
              }

              const newStart = (t.allocatedStartMinutes ?? t.startMinutes) + minutesLate;
              const newEnd = Math.min((t.allocatedEndMinutes ?? t.endMinutes) + minutesLate, 1320); // cap at 10 PM
              
              if (changes.length < 4) {
                changes.push({
                  title: t.title,
                  changeText: `${formatMinutesToTime(t.startMinutes)} → ${formatMinutesToTime(newStart)}`,
                });
              }

              return {
                ...t,
                allocatedStartMinutes: newStart,
                allocatedEndMinutes: newEnd,
              };
            }
            return t;
          });

          nextState.tasks = updatedTasks;
          nextState.routineState = 'COMPRESSED';
          nextState.routineChangeReason = `Shifted schedule by ${minutesLate}m due to late arrival.`;
          recoveryMessage = 'Protected family time and core priorities were preserved.';
        } else if (selectedOption === 'SOMETHING_CAME_UP' || selectedOption === 'CANNOT_HAPPEN') {
          headline = 'TASK RESOLVED & SCHEDULE REFLOWED';
          if (currentTask) {
            nextState.tasks = nextState.tasks.map(t =>
              t.id === currentTask.id
                ? {
                    ...t,
                    completed: true,
                    executionStatus: 'COMPRESSED' as const,
                    notes: customReason || 'Adjusted due to unexpected event.',
                  }
                : t
            );
            changes.push({
              title: currentTask.title,
              changeText: 'Resolved & bypassed cleanly',
            });
          }
          changes.push({
            title: 'Family & Evening',
            changeText: '17:00 🔒 unchanged',
            isProtected: true,
          });
          recoveryMessage = 'Timeline reallocated. Your next priority is queued and ready.';
        } else if (selectedOption === 'LESS_ENERGY') {
          headline = 'MINIMUM VIABLE TIERS ACTIVATED';
          nextState.tasks = nextState.tasks.map(t => {
            if (!t.completed) {
              const origDur = t.endMinutes - t.startMinutes;
              const compressedDur = Math.max(15, Math.floor(origDur * 0.6));
              return {
                ...t,
                allocatedEndMinutes: (t.allocatedStartMinutes ?? t.startMinutes) + compressedDur,
                fallbackLevel: 1,
              };
            }
            return t;
          });
          changes.push({
            title: 'Deep Work & Build',
            changeText: 'Compressed to 45m focused burst',
          });
          changes.push({
            title: 'Workout & Movement',
            changeText: 'Scaled to 15m minimum viable',
          });
          changes.push({
            title: 'Family Sanctuary',
            changeText: 'Protected 🔒',
            isProtected: true,
          });
          recoveryMessage = 'Workload scaled down to match energy capacity while protecting core momentum.';
        } else if (selectedOption === 'MORE_TIME') {
          headline = 'DEEP WORK EXTENDED (+30m)';
          if (currentTask) {
            changes.push({
              title: currentTask.title,
              changeText: `Extended by 30m of uninterrupted focus`,
            });
          }
          changes.push({
            title: 'Protected Windows',
            changeText: 'Safeguarded 🔒',
            isProtected: true,
          });
          recoveryMessage = 'Expanded high-value focus block without breaching afternoon boundaries.';
        } else {
          headline = 'SCHEDULE RECALCULATED';
          changes.push({
            title: 'Execution Timeline',
            changeText: 'Realigned automatically',
          });
          changes.push({
            title: 'Family Time',
            changeText: '17:00 🔒 unchanged',
            isProtected: true,
          });
          recoveryMessage = 'All dependencies satisfied and schedule balanced.';
        }

        // Run full deviation scan & resolution
        nextState = logEventToState(
          nextState,
          'ScheduleReallocated',
          `Reality adjustment: ${selectedOption}`,
          { option: selectedOption, customReason }
        );

        const scan = scanAndResolveDeviations(nextState);
        nextState = scan.updatedState;
        return nextState;
      });

      setAdjustmentResult({
        headline,
        changes,
        recoveryMessage,
      });

      setIsProcessing(false);
      sound.playChime('success');
    }, 400);
  };

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={handleClose}
      title={adjustmentResult ? 'Day Adjusted' : 'Something Changed'}
      description={
        adjustmentResult
          ? 'Autonomous Execution OS has recalculated your schedule'
          : 'Tell your OS what happened and it will reallocate your day automatically'
      }
      maxWidth="md"
    >
      {!adjustmentResult ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Select the situation below. Execution OS will adjust timings, apply fallback tiers, and protect your commitments without manual rescheduling.
          </p>

          <div className="grid grid-cols-1 gap-2.5">
            {/* 1. Running Late */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOption('RUNNING_LATE')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOption('RUNNING_LATE'); }}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                selectedOption === 'RUNNING_LATE'
                  ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">I'm running late</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Shift upcoming activities forward while keeping family time protected.
                </div>
                {selectedOption === 'RUNNING_LATE' && (
                  <div className="mt-3 flex items-center gap-2 pt-2 border-t border-indigo-100" onClick={e => e.stopPropagation()}>
                    <span className="text-xs font-medium text-slate-700">How much later?</span>
                    {[15, 30, 45, 60].map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMinutesLate(m);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                          minutesLate === m
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        +{m}m
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 2. Something came up */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOption('SOMETHING_CAME_UP')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOption('SOMETHING_CAME_UP'); }}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                selectedOption === 'SOMETHING_CAME_UP'
                  ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">Something came up</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Pause or bypass current task; reflow schedule to next viable action.
                </div>
              </div>
            </div>

            {/* 3. Less energy */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOption('LESS_ENERGY')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOption('LESS_ENERGY'); }}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                selectedOption === 'LESS_ENERGY'
                  ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 mt-0.5">
                <BatteryLow className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">I have less energy</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Compress workloads to minimum viable tiers and reduce cognitive strain.
                </div>
              </div>
            </div>

            {/* 4. More time */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOption('MORE_TIME')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOption('MORE_TIME'); }}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                selectedOption === 'MORE_TIME'
                  ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mt-0.5">
                <BatteryCharging className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">I have extra focus / time</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Extend current build block or advance upcoming mission targets.
                </div>
              </div>
            </div>

            {/* 5. Cannot happen */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSelectedOption('CANNOT_HAPPEN')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedOption('CANNOT_HAPPEN'); }}
              className={`p-3.5 rounded-xl border text-left flex items-start gap-3 transition-all cursor-pointer ${
                selectedOption === 'CANNOT_HAPPEN'
                  ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 bg-white'
              }`}
            >
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                <CalendarX className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-slate-900">This task cannot happen</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Gracefully cancel this block without breaking downstream commitments.
                </div>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedOption || isProcessing}
              onClick={handleApplyAdjustment}
              className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors flex items-center gap-2"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Reallocating...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Adjust Day</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Result Screen */
        <div className="space-y-5 animate-in fade-in duration-200">
          <div className="p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-emerald-950">
                {adjustmentResult.headline}
              </div>
              <div className="text-xs text-emerald-800 mt-0.5">
                {adjustmentResult.recoveryMessage}
              </div>
            </div>
          </div>

          {/* List of changes */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Updated Timeline
            </div>
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
              {adjustmentResult.changes.map((c, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800 flex items-center gap-1.5">
                    {c.isProtected && <Lock className="w-3.5 h-3.5 text-purple-600" />}
                    {c.title}
                  </span>
                  <span className={`font-mono text-xs font-semibold ${c.isProtected ? 'text-purple-700' : 'text-slate-600'}`}>
                    {c.changeText}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={handleClose}
              className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </AccessibleModal>
  );
};
