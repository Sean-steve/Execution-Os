import React, { useState } from 'react';
import { 
  Heart, 
  Car, 
  MapPin, 
  Coffee, 
  Sparkles, 
  CheckCircle2, 
  Plus, 
  Dumbbell, 
  Compass, 
  Users,
  Camera,
  Sun
} from 'lucide-react';
import { AppState } from '../types';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';

interface FamilyLifeViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const FamilyLifeView: React.FC<FamilyLifeViewProps> = ({
  state,
  onUpdateState,
}) => {
  const [selectedActivity, setSelectedActivity] = useState('Scenic Sunset Drive');
  const [scenicNotes, setScenicNotes] = useState('');
  const [familyPointsAwarded, setFamilyPointsAwarded] = useState(false);

  const outingOptions = [
    {
      id: 'drive',
      title: 'Scenic Sunset Drive',
      desc: 'Drive to a serene overlook or tree-lined road with soothing music for baby and family.',
      icon: Car,
      color: 'text-amber-400',
    },
    {
      id: 'walk',
      title: 'Nature & Park Walk',
      desc: '1-hour unhurried stroll in botanical gardens, lake trail, or serene park.',
      icon: Compass,
      color: 'text-emerald-400',
    },
    {
      id: 'picnic',
      title: 'Outdoor Blanket Picnic',
      desc: 'Pack wholesome snacks and sit under shaded trees enjoying fresh breeze.',
      icon: Sun,
      color: 'text-cyan-400',
    },
    {
      id: 'cafe',
      title: 'Serene Café / Restaurant',
      desc: 'Treat family to a relaxing meal or pastry in a beautiful ambient setting.',
      icon: Coffee,
      color: 'text-purple-400',
    },
    {
      id: 'home',
      title: 'Dedicated Home Connection',
      desc: 'Floor play with baby, undivided eye contact, deep storytelling, zero screens.',
      icon: Heart,
      color: 'text-rose-400',
    },
  ];

  const handleCompleteConnection = () => {
    sound.playChime('success');
    try {
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.5 } });
    } catch {
      // ignore
    }

    onUpdateState(prev => ({
      ...prev,
      tasks: prev.tasks.map(t =>
        t.id === 'task-family-connection' || t.id === 'task-family-outing'
          ? { ...t, completed: true }
          : t
      ),
      rewardPoints: prev.rewardPoints + 8,
    }));
    setFamilyPointsAwarded(true);
  };

  const handleLogAfternoonWorkout = () => {
    sound.playChime('start');
    onUpdateState(prev => {
      const nextSets = prev.afternoonWorkoutSetsDone + 1;
      const isDone = nextSets >= 3;
      return {
        ...prev,
        afternoonWorkoutSetsDone: nextSets,
        tasks: prev.tasks.map(t =>
          t.id === 'task-afternoon-workout' ? { ...t, completed: isDone } : t
        ),
        rewardPoints: prev.rewardPoints + (isDone ? 5 : 2),
      };
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Banner Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-rose-600 font-mono text-xs uppercase tracking-wider font-bold">
          <Heart className="w-4 h-4" />
          <span>Anchor 8 & 9 • 4:00 PM – 8:00 PM Human Life & Family</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mt-1">
          Human Life & Family Connection
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          "4:00 PM — Shift out of builder mode. Optimize for the outcome: <span className="text-rose-600 font-bold">Family deeply connected.</span>"
        </p>
      </div>

      {/* Grid: 3 Main Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Afternoon Training (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900 font-mono">
                  Movement Session (3 Sets)
                </h3>
              </div>
              <span className="text-[10px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 font-bold">
                4:00 PM
              </span>
            </div>

            <p className="text-xs text-slate-600">
              Physical vitality transition before family evening. Reset physical posture.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono text-slate-500 font-medium">Sets Done:</span>
                <div className="text-2xl font-bold font-mono text-emerald-600">
                  {state.afternoonWorkoutSetsDone} / 3 Sets
                </div>
              </div>

              <button
                id="log-afternoon-set-btn"
                onClick={handleLogAfternoonWorkout}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Log +1 Set</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Family Connection & Outings (8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-5 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-rose-600" />
                <h3 className="text-base font-bold text-slate-900 font-mono">
                  Family Connection & Serene Outing Engine
                </h3>
              </div>
              <span className="text-xs font-mono text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded-md border border-rose-200 font-bold">
                Outcome: Connected
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Don't make the drive mandatory every single day. <span className="font-semibold text-slate-900">Make the family connection mandatory.</span> Select today's format:
            </p>

            {/* Outing Option Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {outingOptions.map(opt => {
                const Icon = opt.icon;
                const isSelected = selectedActivity === opt.title;
                return (
                  <div
                    key={opt.id}
                    onClick={() => setSelectedActivity(opt.title)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-rose-50/70 border-rose-300 shadow-xs ring-1 ring-rose-200'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 ${opt.color}`} />
                      <h4 className="text-xs font-bold text-slate-900">{opt.title}</h4>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-1.5 leading-relaxed">
                      {opt.desc}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Serene Spot Notes */}
            <div className="pt-2">
              <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                Serene Environment Location & Shared Memories:
              </label>
              <input
                type="text"
                value={scenicNotes}
                onChange={e => setScenicNotes(e.target.value)}
                placeholder="e.g. Sunset point on West Ridge, baby loved the cool breeze and park flowers..."
                className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
              />
            </div>

            {/* Confirm & Award */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                Selected: <span className="text-slate-900 font-semibold">{selectedActivity}</span>
              </span>

              <button
                id="complete-family-connection-btn"
                onClick={handleCompleteConnection}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-sm flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Family Connection (+8 pts)</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
