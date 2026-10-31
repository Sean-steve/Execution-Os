import React, { useState } from 'react';
import { 
  Award, 
  Sparkles, 
  Flame, 
  CheckCircle2, 
  Lock, 
  Unlock, 
  Gift, 
  Plus, 
  Compass, 
  Utensils, 
  Cpu, 
  Palmtree,
  ShieldAlert,
  AlertTriangle,
  TrendingDown
} from 'lucide-react';
import { AppState, Reward } from '../types';
import { sound } from '../services/soundService';
import { getActiveDayTheme } from '../services/dayThemeService';
import { replenishRewardsCatalog } from '../services/rewardCatalogService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface RewardEngineViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const RewardEngineView: React.FC<RewardEngineViewProps> = ({
  state,
  onUpdateState,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPts, setNewPts] = useState(50);
  const [newCategory, setNewCategory] = useState<Reward['category']>('EXPERIENCE');
  const activeTheme = getActiveDayTheme(state);

  const lateTasks = state.tasks.filter(t => t.completed && t.missedWindow);

  const handleUnlockAndRedeem = async (reward: Reward) => {
    if (state.rewardPoints < reward.pointsRequired && !reward.unlocked) return;
    const result = await defaultApplicationService.redeemReward(reward.id, state);
    if (!result.success || !result.state) return;

    const replenished = replenishRewardsCatalog(result.state.rewards);
    onUpdateState(() => ({ ...result.state!, rewards: replenished }));
    sound.playChime('success');
    try {
      confetti({ particleCount: 70, spread: 80, origin: { y: 0.5 }, colors: [activeTheme.colorHex, '#ec4899', '#8b5cf6', '#10b981'] });
    } catch {}
  };

  const handleCreateCustomReward = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const newReward: Reward = {
      id: `rew-${Date.now()}`,
      title: newTitle.trim(),
      description: newDesc.trim() || 'Custom high-value milestone reward',
      category: newCategory,
      pointsRequired: Number(newPts) || 50,
      unlocked: false,
      redeemed: false,
    };

    sound.playChime('start');
    onUpdateState(prev => ({
      ...prev,
      rewards: [...prev.rewards, newReward],
    }));

    setNewTitle('');
    setNewDesc('');
  };

  const getCategoryIcon = (cat: Reward['category']) => {
    switch (cat) {
      case 'ADVENTURE': return Compass;
      case 'DINING': return Utensils;
      case 'TECH': return Cpu;
      case 'EXPERIENCE': return Palmtree;
      default: return Gift;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Banner Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className={`flex items-center gap-2 font-mono text-xs uppercase tracking-wider font-bold ${activeTheme.classes.accentText}`}>
            <Award className="w-4 h-4" />
            <span>Human Reward & Milestone Engine • {activeTheme.dayName} Mode</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            Real-World Experiential Reward Vault
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            "Achievement → Reward → Experience → Memory → Motivation → Achievement."
          </p>
        </div>

        {/* Total Points Card */}
        <div className="flex items-center gap-3 bg-white border border-slate-200 p-3 rounded-2xl shadow-sm">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${activeTheme.classes.badge}`}>
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">Available Points</span>
            <div className={`text-2xl font-extrabold font-mono ${activeTheme.classes.accentText}`}>
              {state.rewardPoints} <span className="text-xs font-normal text-slate-500">PTS</span>
            </div>
          </div>
        </div>
      </div>

      {/* Discipline Ledger Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Points Economy Rules</span>
            <div className="text-xs text-slate-600">
              • On-Time Anchor: <strong className="text-emerald-700">+5 pts</strong><br />
              • Missed Time Window Cut: <strong className="text-red-700">-5 pts</strong>
            </div>
          </div>
          <ShieldAlert className="w-8 h-8 text-slate-300" />
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-mono text-slate-400 uppercase font-bold">Discipline Infraction Tally</span>
            <div className="text-lg font-bold font-mono text-slate-800">
              {state.disciplinePenaltiesCount || 0} Total Missed Windows Recorded
            </div>
            <div className="text-[11px] text-slate-500 font-mono">
              {lateTasks.length > 0 ? `${lateTasks.length} late tasks today` : 'Zero late infractions today!'}
            </div>
          </div>
          {state.disciplinePenaltiesCount && state.disciplinePenaltiesCount > 0 ? (
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          ) : (
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
          )}
        </div>
      </div>

      {/* Rewards Catalog Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold font-mono text-slate-800 uppercase tracking-wider">
            Available Experiential Milestones
          </h3>
          <span className="text-xs text-slate-500 font-mono font-medium">
            Earned from 7-Pillar Days & Non-Negotiable Anchors
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {state.rewards.map(reward => {
            const Icon = getCategoryIcon(reward.category);
            const canAfford = state.rewardPoints >= reward.pointsRequired;
            return (
              <div
                key={reward.id}
                className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-all ${
                  reward.redeemed
                    ? 'bg-slate-50/70 border-slate-200 opacity-60'
                    : canAfford
                    ? `bg-white ${activeTheme.classes.accentBorder} shadow-sm ring-1 ring-slate-200`
                    : 'bg-white border-slate-200 shadow-sm'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase bg-slate-100 text-slate-700 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                      <Icon className={`w-3 h-3 ${activeTheme.classes.accentText}`} />
                      {reward.category}
                    </span>

                    <div className={`flex items-center gap-1 text-xs font-mono font-bold ${activeTheme.classes.accentText}`}>
                      <Sparkles className="w-3 h-3" />
                      <span>{reward.pointsRequired} pts</span>
                    </div>
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 mt-2">
                    {reward.title}
                  </h4>

                  <p className="text-xs text-slate-600 leading-relaxed">
                    {reward.description}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-500 font-medium">
                    {reward.redeemed
                      ? `Redeemed ${new Date(reward.redeemedAt || '').toLocaleDateString()}`
                      : canAfford
                      ? 'Ready to Redeem'
                      : `${reward.pointsRequired - state.rewardPoints} pts needed`}
                  </span>

                  <button
                    onClick={() => handleUnlockAndRedeem(reward)}
                    disabled={reward.redeemed || !canAfford}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 transition-all ${
                      reward.redeemed
                        ? 'bg-slate-100 text-slate-500'
                        : canAfford
                        ? `${activeTheme.classes.accentButton} shadow-sm`
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {reward.redeemed ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Claimed</span>
                      </>
                    ) : canAfford ? (
                      <>
                        <Unlock className="w-3.5 h-3.5" />
                        <span>Redeem Reward</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" />
                        <span>Locked</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Custom Reward Form */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Gift className={`w-4 h-4 ${activeTheme.classes.accentText}`} />
            <h3 className="text-sm font-bold text-slate-900 font-mono">
              Create New Custom Milestone Reward
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400">Custom Goals</span>
        </div>

        <form onSubmit={handleCreateCustomReward} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-mono font-medium text-slate-700">Reward Title</label>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="e.g. Weekend Mountain Getaway"
                className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-mono font-medium text-slate-700">Points Cost</label>
                <input
                  type="number"
                  min="10"
                  max="1000"
                  value={newPts}
                  onChange={e => setNewPts(Number(e.target.value))}
                  className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono font-medium text-slate-700">Category</label>
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value as Reward['category'])}
                  className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="EXPERIENCE">Experience</option>
                  <option value="DINING">Fine Dining</option>
                  <option value="ADVENTURE">Adventure</option>
                  <option value="TECH">Gear & Tech</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-mono font-medium text-slate-700">Reward Description / Experience Details</label>
            <input
              type="text"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="e.g. Full day off with phone on airplane mode exploring a scenic trail and fine dinner."
              className="w-full text-xs font-mono p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className={`px-4 py-2 rounded-xl text-xs font-bold font-mono flex items-center gap-1.5 shadow-sm transition-all ${activeTheme.classes.accentButton}`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add to Reward Vault</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
