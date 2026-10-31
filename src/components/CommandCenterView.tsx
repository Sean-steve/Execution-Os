import React, { useState } from 'react';
import { 
  Target, 
  Crown, 
  Briefcase, 
  User, 
  Heart, 
  Sparkles, 
  CheckCircle2, 
  Clock, 
  Award,
  Zap,
  TrendingUp,
  Save
} from 'lucide-react';
import { AppState } from '../types';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';

interface CommandCenterViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const CommandCenterView: React.FC<CommandCenterViewProps> = ({
  state,
  onUpdateState,
}) => {
  const [victoryAnswer, setVictoryAnswer] = useState(state.victoryQuestionAnswer || '');
  const [top1, setTop1] = useState(state.tomorrowPlan.top3[0] || '');
  const [top2, setTop2] = useState(state.tomorrowPlan.top3[1] || '');
  const [top3, setTop3] = useState(state.tomorrowPlan.top3[2] || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveCommand = async (e: React.FormEvent) => {
    e.preventDefault();

    const draft: AppState = {
      ...state,
      victoryQuestionAnswer: victoryAnswer,
      tomorrowPlan: {
        ...state.tomorrowPlan,
        top3: [top1, top2, top3],
      },
    };

    const result = await defaultApplicationService.completeActivity({
      taskId: 'task-command-center',
      executionStatus: 'ON_TIME',
    }, draft);

    if (result.success && result.state) {
      sound.playChime('success');
      try { confetti({ particleCount: 35, spread: 60, origin: { y: 0.5 } }); } catch {}
      onUpdateState(() => result.state!);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* View Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-mono text-xs uppercase tracking-wider font-bold">
            <Target className="w-4 h-4" />
            <span>Anchor 3 • 6:30 AM – 7:00 AM Command Center</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            Today's Tactical Command
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            "Define victory with surgical precision before the world demands your attention."
          </p>
        </div>

        {savedSuccess && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold animate-in zoom-in-95 shadow-xs">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>Command Parameters Locked</span>
          </div>
        )}
      </div>

      {/* Main Command Form */}
      <form onSubmit={handleSaveCommand} className="space-y-6">
        
        {/* Core Victory Question Hero Card */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-amber-500" />
              <h3 className="text-base font-bold text-slate-900 font-mono">
                Daily Definition of Victory
              </h3>
            </div>
            <span className="text-[11px] font-mono text-indigo-600 bg-indigo-50 border border-indigo-100 px-2.5 py-0.5 rounded-md uppercase tracking-wider font-bold">
              Prime Operating Question
            </span>
          </div>

          <p className="text-xs text-slate-600 mt-3 font-medium">
            "If today went exceptionally well, what would be true by 10:00 PM?"
          </p>

          <textarea
            id="victory-answer-input"
            value={victoryAnswer}
            onChange={e => setVictoryAnswer(e.target.value)}
            rows={2}
            placeholder="e.g., Shipped key AI workflow, closed 2 qualified enterprise leads, executed 2-set training, enjoyed unhurried evening drive with family..."
            className="w-full mt-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 leading-relaxed resize-none transition-all"
          />
        </div>

        {/* Top 3 High-Impact Outcomes (3 Fronts) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-indigo-600" />
              <h3 className="text-base font-bold text-slate-900 font-mono">
                Top 3 Outcomes for Today
              </h3>
            </div>
            <span className="text-xs font-mono text-slate-500 font-medium">The 3 Battlefields</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Outcome 1: Business / Venture */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-700 font-mono">
                <Briefcase className="w-3.5 h-3.5" />
                <span>1. Business / Venture</span>
              </div>
              <input
                type="text"
                value={top1}
                onChange={e => setTop1(e.target.value)}
                placeholder="Core commercial outcome..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="text-[11px] text-slate-500">
                Advances revenue, enterprise contracts, or venture pipeline.
              </p>
            </div>

            {/* Outcome 2: Personal / AI Project */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-700 font-mono">
                <User className="w-3.5 h-3.5" />
                <span>2. Personal / AI System</span>
              </div>
              <input
                type="text"
                value={top2}
                onChange={e => setTop2(e.target.value)}
                placeholder="System build outcome..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="text-[11px] text-slate-500">
                Core infrastructure, algorithmic code, or personal capability.
              </p>
            </div>

            {/* Outcome 3: Family / Life */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-700 font-mono">
                <Heart className="w-3.5 h-3.5" />
                <span>3. Family / Life</span>
              </div>
              <input
                type="text"
                value={top3}
                onChange={e => setTop3(e.target.value)}
                placeholder="Family & relationship outcome..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="text-[11px] text-slate-500">
                Meaningful presence, scenic outing, or shared family memory.
              </p>
            </div>
          </div>
        </div>

        {/* Tactical Overview: Appointments, Wealth & Reward Target */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Opportunities & Wealth Protocol */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold text-slate-900 font-mono">
                  Wealth & Trading Protocol Condition
                </h4>
              </div>
              <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded font-bold">
                Rule Check
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Is today an active trading day? <span className="font-semibold text-emerald-700">{state.tradingProtocol.isTradingDay ? 'YES (Strict Strategy Confluence Required)' : 'NO (Preserve Capital & Focus on Business)'}</span>
            </p>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-mono">
              Rule: "A productive day is NOT defined by whether you traded. No setup = No trade."
            </div>
          </div>

          {/* Day's Reward Preview */}
          <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-600" />
                <h4 className="text-xs font-bold text-slate-900 font-mono">
                  Today's Reward Target
                </h4>
              </div>
              <span className="text-[10px] font-mono text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-bold">
                {state.rewardPoints} Pts Banked
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              Executing a 7/7 day earns <span className="text-amber-800 font-bold font-mono">+10 bonus reward points</span> toward real-world experiential rewards (scenic road trip, fine dining, tech gear).
            </p>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
              Next Reward Threshold: <span className="text-indigo-700 font-semibold">{state.rewards.find(r => !r.unlocked)?.title || 'All unlocked!'}</span>
            </div>
          </div>
        </div>

        {/* Submit & Lock Button */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            id="lock-command-center-btn"
            className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm flex items-center gap-2 transition-all active:scale-[0.98]"
          >
            <Save className="w-4 h-4 fill-white" />
            <span>Lock Daily Command Parameters (+5 pts)</span>
          </button>
        </div>
      </form>
    </div>
  );
};
