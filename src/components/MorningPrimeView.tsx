import React, { useState, useEffect } from 'react';
import { 
  Sun, 
  Sparkles, 
  BookOpen, 
  Dumbbell, 
  Wind, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  RotateCcw, 
  CheckCircle2, 
  Plus, 
  Tag, 
  Star, 
  Flame,
  Check
} from 'lucide-react';
import { AppState, DreamEntry } from '../types';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';

interface MorningPrimeViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const MorningPrimeView: React.FC<MorningPrimeViewProps> = ({
  state,
  onUpdateState,
}) => {
  // Meditation timer state
  const [meditationSeconds, setMeditationSeconds] = useState(30 * 60);
  const [initialMeditationSeconds, setInitialMeditationSeconds] = useState(30 * 60);
  const [isMeditating, setIsMeditating] = useState(false);
  const [isAmbientPlaying, setIsAmbientPlaying] = useState(false);

  // Outside light timer state
  const [outsideSeconds, setOutsideSeconds] = useState(10 * 60);
  const [isOutsideTimerRunning, setIsOutsideTimerRunning] = useState(false);

  // Dream Journal Form state
  const [dreamTitle, setDreamTitle] = useState('');
  const [dreamContent, setDreamContent] = useState('');
  const [dreamClarity, setDreamClarity] = useState(4);
  const [dreamTagInput, setDreamTagInput] = useState('');
  const [dreamTags, setDreamTags] = useState<string[]>(['Vision', 'Clarity']);
  const [isSavingDream, setIsSavingDream] = useState(false);

  // Meditation timer interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isMeditating && meditationSeconds > 0) {
      interval = setInterval(() => {
        setMeditationSeconds(prev => {
          if (prev <= 1) {
            sound.playChime('bell');
            sound.stopAmbient();
            setIsAmbientPlaying(false);
            setIsMeditating(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isMeditating, meditationSeconds]);

  // Outside light timer interval
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isOutsideTimerRunning && outsideSeconds > 0) {
      interval = setInterval(() => {
        setOutsideSeconds(prev => {
          if (prev <= 1) {
            sound.playChime('success');
            setIsOutsideTimerRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOutsideTimerRunning, outsideSeconds]);

  const toggleMeditation = () => {
    if (!isMeditating) {
      sound.playChime('bell');
      sound.startAmbient('MEDITATION_DRONE');
      setIsAmbientPlaying(true);
      setIsMeditating(true);
    } else {
      sound.stopAmbient();
      setIsAmbientPlaying(false);
      setIsMeditating(false);
    }
  };

  const resetMeditation = (durationMinutes: number) => {
    sound.stopAmbient();
    setIsAmbientPlaying(false);
    setIsMeditating(false);
    setMeditationSeconds(durationMinutes * 60);
    setInitialMeditationSeconds(durationMinutes * 60);
  };

  const handleCompleteIdentityCheck = () => {
    sound.playChime('success');
    try {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.5 } });
    } catch {
      // ignore
    }
    onUpdateState(prev => ({
      ...prev,
      identityStatus: {
        ...prev.identityStatus,
        completedToday: true,
      },
      tasks: prev.tasks.map(t =>
        t.id === 'task-awaken' ? { ...t, completed: true } : t
      ),
      rewardPoints: prev.rewardPoints + 5,
    }));
  };

  const handleSaveDream = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dreamTitle.trim() || !dreamContent.trim()) return;

    const newEntry: DreamEntry = {
      id: `dream-${Date.now()}`,
      timestamp: new Date().toISOString(),
      title: dreamTitle.trim(),
      content: dreamContent.trim(),
      clarityRating: dreamClarity,
      tags: dreamTags,
    };

    sound.playChime('success');
    onUpdateState(prev => ({
      ...prev,
      dreamEntries: [newEntry, ...prev.dreamEntries],
      tasks: prev.tasks.map(t =>
        t.id === 'task-dream-journal' ? { ...t, completed: true } : t
      ),
      rewardPoints: prev.rewardPoints + 3,
    }));

    setDreamTitle('');
    setDreamContent('');
    setIsSavingDream(false);
  };

  const handleAddWorkoutSet = () => {
    sound.playChime('start');
    onUpdateState(prev => {
      const nextSets = prev.morningWorkoutSetsDone + 1;
      const targetSets = prev.currentMode === 'GREEN' ? 2 : 1;
      const taskDone = nextSets >= targetSets;
      return {
        ...prev,
        morningWorkoutSetsDone: nextSets,
        tasks: prev.tasks.map(t =>
          t.id === 'task-workout-morning' ? { ...t, completed: taskDone } : t
        ),
        rewardPoints: prev.rewardPoints + (taskDone ? 5 : 2),
      };
    });
  };

  const formatTimer = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-amber-600 font-mono text-xs uppercase tracking-wider font-bold">
          <Sun className="w-4 h-4" />
          <span>Anchor 1 & 2 • 5:30 AM – 6:50 AM</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mt-1">
          Awaken & Morning Prime
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          "5:30 AM — Become. Feet on floor. Body → Environment → Mind. Build physiological readiness."
        </p>
      </div>

      {/* Grid for Prime Components */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Module 1: The 4 Truths Identity Ritual (5:30 AM) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Anchor 1: Identity & Reset Ritual
                </h3>
              </div>
              <span className="text-xs font-mono text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200 font-bold">
                5:30 AM Non-Negotiable
              </span>
            </div>

            <p className="text-xs text-slate-600 mt-3 leading-relaxed">
              No phone. Your first thought is not "What is happening online?" It is: <span className="text-slate-900 font-semibold">"What am I building today?"</span>
            </p>

            {/* 4 Truths Checklist */}
            <div className="space-y-2.5 mt-4">
              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-amber-200">
                  1
                </div>
                <div className="text-xs">
                  <span className="text-slate-900 font-semibold">Remember Your Dream:</span>{' '}
                  <span className="text-slate-600">Capture subconscious impressions before waking memory fades.</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-amber-200">
                  2
                </div>
                <div className="text-xs">
                  <span className="text-slate-900 font-semibold">Remember Who You Are:</span>{' '}
                  <span className="text-slate-600">A builder, sovereign executor, dedicated father and provider.</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-amber-200">
                  3
                </div>
                <div className="text-xs">
                  <span className="text-slate-900 font-semibold">Remember Where You Are:</span>{' '}
                  <span className="text-slate-600">Ground in the physical reality of the present moment.</span>
                </div>
              </div>

              <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-6 h-6 rounded-md bg-amber-100 text-amber-800 flex items-center justify-center font-mono text-xs font-bold shrink-0 border border-amber-200">
                  4
                </div>
                <div className="text-xs">
                  <span className="text-slate-900 font-semibold">Remember What You Are Building:</span>{' '}
                  <span className="text-slate-600">Autonomous systems, family wealth, and uncompromising sovereignty.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">
              {state.identityStatus.completedToday ? '✓ Identity Ritual Locked for Today' : 'Affirm the 4 Truths upon rising'}
            </span>
            <button
              id="affirm-identity-btn"
              onClick={handleCompleteIdentityCheck}
              disabled={state.identityStatus.completedToday}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all shadow-xs ${
                state.identityStatus.completedToday
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold shadow-sm'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{state.identityStatus.completedToday ? 'Identity Affirmed' : 'Affirm Identity (Done)'}</span>
            </button>
          </div>
        </div>

        {/* Module 2: Meditation & Internal Listening Suite (30 min / 432Hz Sound Synthesizer) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Wind className="w-4 h-4 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Stillness & Meditation
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                {[5, 15, 30].map(mins => (
                  <button
                    key={mins}
                    onClick={() => resetMeditation(mins)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-colors ${
                      initialMeditationSeconds === mins * 60
                        ? 'bg-indigo-600 text-white border-indigo-600 font-bold shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {mins}m
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Breath / Stillness Pacer */}
            <div className="my-6 flex flex-col items-center justify-center">
              <div className={`relative w-36 h-36 rounded-full flex items-center justify-center transition-all duration-1000 ${
                isMeditating 
                  ? 'bg-indigo-50 border-2 border-indigo-500 shadow-md shadow-indigo-100 scale-105 animate-pulse'
                  : 'bg-slate-50 border border-slate-200'
              }`}>
                <div className="text-center">
                  <span className="text-3xl font-extrabold font-mono text-slate-900 tracking-wider">
                    {formatTimer(meditationSeconds)}
                  </span>
                  <p className="text-[10px] text-indigo-600 uppercase font-mono mt-0.5 font-bold">
                    {isMeditating ? 'Internal Listening' : 'Stillness'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-3 text-center max-w-sm">
                432Hz harmonic meditation drone active. Listen to yourself. Expand internal stillness.
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              onClick={() => resetMeditation(30)}
              className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
              title="Reset timer to 30 mins"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              id="meditation-toggle-btn"
              onClick={toggleMeditation}
              className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                isMeditating
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm'
                  : 'bg-slate-900 hover:bg-slate-800 text-white border border-slate-800'
              }`}
            >
              {isMeditating ? (
                <>
                  <Pause className="w-4 h-4 fill-white" />
                  <span>Pause Meditation (432Hz Drone)</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-white" />
                  <span>Begin Stillness Session</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Module 3: Physical Movement (2 Sets Compound Full Body) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Morning Movement (2 Sets)
                </h3>
              </div>
              <span className="text-xs font-mono text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200 font-bold">
                Whole Body
              </span>
            </div>

            <p className="text-xs text-slate-600 mt-3">
              Purpose: Tell your brain <span className="text-slate-900 font-semibold">"The day has started."</span> On low-energy days: 10m walk + 1 set. Never skip the anchor.
            </p>

            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs text-slate-500 font-mono">Set 1: Upper / Core</span>
                <p className="text-xs font-semibold text-slate-900 mt-1">Push-ups + Plank / Arms + Chest</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <span className="text-xs text-slate-500 font-mono">Set 2: Lower / Posterior</span>
                <p className="text-xs font-semibold text-slate-900 mt-1">Bodyweight Squats + Lunges / Legs</p>
              </div>
            </div>

            {/* Set Counter Pill */}
            <div className="mt-4 flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <span className="text-xs text-slate-500 font-mono">Sets Logged Today:</span>
                <div className="text-xl font-bold font-mono text-emerald-600">
                  {state.morningWorkoutSetsDone} / {state.currentMode === 'GREEN' ? '2' : '1'} Target Sets
                </div>
              </div>
              <button
                id="log-workout-set-btn"
                onClick={handleAddWorkoutSet}
                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Log +1 Set</span>
              </button>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-medium">
            <span>Minimum Viable: 1 Set + Walk</span>
            <span className={state.morningWorkoutSetsDone >= 2 ? 'text-emerald-600 font-bold' : 'text-slate-400'}>
              {state.morningWorkoutSetsDone >= 2 ? '✓ Anchor Complete' : 'In Progress'}
            </span>
          </div>
        </div>

        {/* Module 4: Morning Light (10 min Breeze & Air) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 flex flex-col justify-between shadow-sm">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sun className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Morning Light & Fresh Breeze
                </h3>
              </div>
              <span className="text-xs font-mono text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200 font-bold">
                10 Mins Outdoors
              </span>
            </div>

            <p className="text-xs text-slate-600 mt-3">
              Step outside, feel the temperature, absorb natural photons to lock your suprachiasmatic circadian rhythm.
            </p>

            <div className="my-4 flex items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="text-center">
                <span className="text-3xl font-extrabold font-mono text-amber-600">
                  {formatTimer(outsideSeconds)}
                </span>
                <p className="text-[10px] text-slate-500 font-mono mt-1 font-semibold">
                  {isOutsideTimerRunning ? 'Absorbing Morning Light & Air' : '10-Minute Window'}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center gap-2">
            <button
              onClick={() => {
                setIsOutsideTimerRunning(false);
                setOutsideSeconds(10 * 60);
              }}
              className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              id="outside-timer-toggle-btn"
              onClick={() => {
                if (!isOutsideTimerRunning) {
                  sound.playChime('start');
                  setIsOutsideTimerRunning(true);
                } else {
                  setIsOutsideTimerRunning(false);
                }
              }}
              className={`flex-1 py-2 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                isOutsideTimerRunning
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'bg-slate-900 hover:bg-slate-800 text-white border border-slate-800'
              }`}
            >
              {isOutsideTimerRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isOutsideTimerRunning ? 'Pause Light Timer' : 'Start 10m Outdoors'}</span>
            </button>

            <button
              onClick={() => {
                sound.playChime('success');
                onUpdateState(prev => ({
                  ...prev,
                  tasks: prev.tasks.map(t =>
                    t.id === 'task-outside-light' ? { ...t, completed: true } : t
                  ),
                  rewardPoints: prev.rewardPoints + 3,
                }));
              }}
              className="px-3 py-2 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold"
            >
              <Check className="w-4 h-4 text-emerald-600" />
            </button>
          </div>
        </div>

      </div>

      {/* Module 5: Dream Journaling Vault */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            <h3 className="text-base font-bold text-slate-900 font-mono">
              Dream Journal & Subconscious Recall
            </h3>
          </div>
          <span className="text-xs font-mono text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-200 font-bold">
            Vault ({state.dreamEntries.length} logged)
          </span>
        </div>

        {/* Quick Log Form */}
        <form onSubmit={handleSaveDream} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="Dream Title / Core Theme..."
                value={dreamTitle}
                onChange={e => setDreamTitle(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <span className="text-[11px] text-slate-500 font-medium">Clarity:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    type="button"
                    key={star}
                    onClick={() => setDreamClarity(star)}
                    className={`p-0.5 ${star <= dreamClarity ? 'text-amber-500' : 'text-slate-300'}`}
                  >
                    <Star className="w-3.5 h-3.5 fill-current" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <textarea
            placeholder="Write down your dreams in detail — symbols, emotions, insights, geometry..."
            value={dreamContent}
            onChange={e => setDreamContent(e.target.value)}
            rows={3}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <div className="flex items-center gap-1">
                {dreamTags.map(tag => (
                  <span key={tag} className="bg-indigo-50 text-indigo-700 text-[10px] px-2 py-0.5 rounded-md border border-indigo-200 font-mono font-medium">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={!dreamTitle.trim() || !dreamContent.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold text-xs shadow-sm"
            >
              Save to Dream Vault (+3 pts)
            </button>
          </div>
        </form>

        {/* Existing Dream Entries List */}
        {state.dreamEntries.length > 0 && (
          <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
            <span className="text-xs font-mono uppercase text-slate-500 tracking-wider font-bold">
              Recent Dream Recalls
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {state.dreamEntries.slice(0, 4).map(entry => (
                <div key={entry.id} className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-slate-900">{entry.title}</h4>
                    <span className="text-[10px] font-mono text-slate-400">
                      {new Date(entry.timestamp).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                    {entry.content}
                  </p>
                  <div className="flex items-center gap-1.5 pt-1">
                    {entry.tags.map(t => (
                      <span key={t} className="text-[9px] font-mono text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
