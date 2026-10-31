import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  ShieldAlert, 
  ShieldCheck, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  Briefcase, 
  Sparkles, 
  Plus, 
  Trash2, 
  CheckSquare, 
  Square,
  Radio,
  Lock,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { AppState, CompanyAction } from '../types';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface DeepWorkViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const DeepWorkView: React.FC<DeepWorkViewProps> = ({
  state,
  onUpdateState,
}) => {
  // Focus Timer
  const [timerSeconds, setTimerSeconds] = useState(45 * 60);
  const [initialSeconds, setInitialSeconds] = useState(45 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [soundMode, setSoundMode] = useState<'NONE' | 'BROWN_NOISE' | 'RAIN_FOCUS' | 'MEDITATION_DRONE'>('NONE');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Company of the Day editor state
  const [companyName, setCompanyName] = useState(state.companyOfTheDay.companyName);
  const [objective, setObjective] = useState(state.companyOfTheDay.objective);
  const [targetOutcome, setTargetOutcome] = useState(state.companyOfTheDay.targetOutcome);
  const [actions, setActions] = useState<CompanyAction[]>(state.companyOfTheDay.actions);
  const [newActionText, setNewActionText] = useState('');

  // Timer interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds(prev => {
          if (prev <= 1) {
            sound.playChime('success');
            sound.stopAmbient();
            setSoundMode('NONE');
            setIsRunning(false);
            try {
              confetti({ particleCount: 50, spread: 70, origin: { y: 0.6 } });
            } catch {
              // ignore
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning, timerSeconds]);

  const handleToggleTimer = () => {
    if (!isRunning) {
      sound.playChime('start');
      if (soundMode !== 'NONE') {
        sound.startAmbient(soundMode);
      }
      setIsRunning(true);
    } else {
      sound.stopAmbient();
      setIsRunning(false);
    }
  };

  const handleSelectSound = (type: 'NONE' | 'BROWN_NOISE' | 'RAIN_FOCUS' | 'MEDITATION_DRONE') => {
    setSoundMode(type);
    if (type === 'NONE') {
      sound.stopAmbient();
    } else if (isRunning) {
      sound.startAmbient(type);
    }
  };

  const handleResetTimer = (minutes: number) => {
    sound.stopAmbient();
    setIsRunning(false);
    setTimerSeconds(minutes * 60);
    setInitialSeconds(minutes * 60);
  };

  const handleToggleAction = (id: string) => {
    sound.playChime('success');
    const updated = actions.map(a =>
      a.id === id ? { ...a, done: !a.done } : a
    );
    setActions(updated);

    const allDone = updated.every(a => a.done);
    if (allDone) {
      try {
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.5 } });
      } catch {
        // ignore
      }
    }

    onUpdateState(prev => ({
      ...prev,
      companyOfTheDay: {
        ...prev.companyOfTheDay,
        actions: updated,
      },
      tasks: prev.tasks.map(t =>
        t.id === 'task-company-of-day' ? { ...t, completed: updated.filter(a => a.done).length >= 2 } : t
      ),
    }));
  };

  const handleSaveCompanySetup = (e: React.FormEvent) => {
    e.preventDefault();
    sound.playChime('start');
    onUpdateState(prev => ({
      ...prev,
      companyOfTheDay: {
        companyName,
        objective,
        targetOutcome,
        actions,
      },
    }));
  };

  const handleAddCustomAction = () => {
    if (!newActionText.trim()) return;
    const newAct: CompanyAction = {
      id: `act-${Date.now()}`,
      text: newActionText.trim(),
      done: false,
    };
    const updated = [...actions, newAct];
    setActions(updated);
    setNewActionText('');

    onUpdateState(prev => ({
      ...prev,
      companyOfTheDay: {
        ...prev.companyOfTheDay,
        actions: updated,
      },
    }));
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Banner Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-indigo-600 font-mono text-xs uppercase tracking-wider font-bold">
          <Cpu className="w-4 h-4" />
          <span>Anchor 5 & 7 • Deep Work & Company Production</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mt-1">
          Deep Work Battlefield
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          "One primary mission. One battlefield. Phone physically away. Website distraction shields active."
        </p>
      </div>

      {/* Grid: Focus Battlefield on Left, Company of the Day on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Focus Block & Shield (7 Cols) */}
        <div className="lg:col-span-7 space-y-6">
          
          {/* Active Focus Card */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm relative overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Radio className={`w-4 h-4 ${isRunning ? 'text-emerald-600 animate-pulse' : 'text-slate-400'}`} />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Deep Focus Protocol
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                {[25, 45, 90].map(m => (
                  <button
                    key={m}
                    onClick={() => handleResetTimer(m)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                      initialSeconds === m * 60
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
            </div>

            {/* Giant Timer Display */}
            <div className="my-8 flex flex-col items-center justify-center">
              <div className="text-center">
                <span className="text-6xl sm:text-7xl font-extrabold font-mono text-slate-900 tracking-tight">
                  {formatTimer(timerSeconds)}
                </span>
                <p className="text-xs text-indigo-600 font-mono uppercase tracking-widest mt-2 font-bold">
                  {isRunning ? '⚔️ Battlefield Active • Distraction Lockdown' : 'Ready to Engage Target'}
                </p>
              </div>
            </div>

            {/* Ambient Sound Selector */}
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs text-slate-600 flex items-center gap-1.5 font-mono font-medium">
                <Volume2 className="w-3.5 h-3.5 text-indigo-600" />
                Focus Audio Synth:
              </span>
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'NONE', label: 'Mute' },
                  { id: 'BROWN_NOISE', label: 'Brown Noise' },
                  { id: 'RAIN_FOCUS', label: 'Rain Focus' },
                  { id: 'MEDITATION_DRONE', label: '432Hz Drone' },
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => handleSelectSound(s.id as any)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-colors ${
                      soundMode === s.id
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Timer Controls */}
            <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <button
                onClick={() => handleResetTimer(45)}
                className="p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
                title="Reset timer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                id="focus-timer-toggle-btn"
                onClick={handleToggleTimer}
                className={`flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm ${
                  isRunning
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                }`}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4 fill-current" />
                    <span>Pause Focus Block</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-white" />
                    <span>Engage Battlefield Focus (45m)</span>
                  </>
                )}
              </button>

              <button
                onClick={async () => {
                  const target = state.tasks.find(t => t.id === 'task-deep-work-build') || state.tasks.find(t => t.category === 'DEEP_WORK' && !t.completed);
                  if (!target) return;
                  const result = await defaultApplicationService.completeActivity({ taskId: target.id, executionStatus: 'ON_TIME' }, state);
                  if (result.success && result.state) {
                    sound.playChime('success');
                    onUpdateState(() => result.state!);
                  }
                }}
                className="px-3.5 py-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold"
                title="Mark deep work block done"
              >
                Done
              </button>
            </div>
          </div>

          {/* Distraction Shield Status */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold text-slate-900 font-mono">
                  Distraction Lockdown Shields
                </h4>
              </div>
              <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold">
                ACTIVE (5:30 AM – 10:00 AM)
              </span>
            </div>

            <p className="text-xs text-slate-600">
              "Your phone is an enemy of the system. Phone away. Blocked during deep work:"
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {['Reddit', 'YouTube Shorts', 'TikTok / Reels', 'Streaming / Feeds'].map(site => (
                <div key={site} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[11px] font-mono flex items-center justify-center gap-1 font-medium">
                  <Lock className="w-3 h-3 text-rose-500" />
                  <span>{site}</span>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-slate-500 font-mono pt-1">
              * Permitted entertainment window unlocked later tonight: <span className="text-slate-800 font-bold">8:00 PM – 9:30 PM</span>
            </div>
          </div>

        </div>

        {/* Right Column: Company of the Day Workspace (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Company of the Day
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-500 font-medium">
                1 Venture Focus
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              "A company is never 'finished'. Designate today's venture, specify 1 objective and execute 3 discrete actions."
            </p>

            {/* Company Metadata Form */}
            <form onSubmit={handleSaveCompanySetup} className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                  Designated Venture:
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. NFlake Revenue Engine"
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                  Primary Objective:
                </label>
                <input
                  type="text"
                  value={objective}
                  onChange={e => setObjective(e.target.value)}
                  placeholder="e.g. Generate new revenue & qualified pipeline"
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                  Target Outcome:
                </label>
                <input
                  type="text"
                  value={targetOutcome}
                  onChange={e => setTargetOutcome(e.target.value)}
                  placeholder="e.g. Contact 10 prospects, follow up 5, send 2 proposals"
                  className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-indigo-700 font-mono font-semibold focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                />
              </div>
            </form>

            {/* The 3 Discrete Actions Checklist */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="text-xs font-mono uppercase text-slate-700 font-bold">
                The 3 Discrete Actions:
              </span>

              <div className="space-y-2 mt-2">
                {actions.map((act, idx) => (
                  <div
                    key={act.id}
                    onClick={() => handleToggleAction(act.id)}
                    className={`p-3 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                      act.done
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 text-xs">
                      {act.done ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span className={act.done ? 'line-through opacity-70 font-medium' : 'font-medium'}>
                        {act.text}
                      </span>
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 shrink-0 font-medium">
                      {act.done ? '✓ Done' : `Action ${idx + 1}`}
                    </span>
                  </div>
                ))}
              </div>

              {/* Add Action row */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="text"
                  placeholder="Add target action..."
                  value={newActionText}
                  onChange={e => setNewActionText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustomAction()}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleAddCustomAction}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="pt-2 text-right">
              <span className="text-xs font-mono text-emerald-600 font-bold">
                {actions.filter(a => a.done).length} / {actions.length} Actions Completed
              </span>
            </div>

          </div>

        </div>

      </div>
    </div>
  );
};
