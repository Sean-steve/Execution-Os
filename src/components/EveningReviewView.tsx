import React, { useState } from 'react';
import { 
  Moon, 
  CheckCircle2, 
  Shield, 
  HelpCircle, 
  Sparkles, 
  Calendar, 
  ArrowRight, 
  HeartHandshake, 
  Zap, 
  Tv,
  Check,
  X
} from 'lucide-react';
import { AppState, DailyReview, TomorrowPlan, DayHistoryRecord, PillarKey } from '../types';
import { calculate7Pillars } from '../services/storageService';
import { evaluateTomorrowFeasibility } from '../services/tomorrowPlanningEngine';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';
import { upsertDailyPerformanceRecord, reconcileWeeklyPerformance, generateWeeklyAdaptationRecommendations } from '../services/weeklyPerformanceIntelligence';

interface EveningReviewViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const EveningReviewView: React.FC<EveningReviewViewProps> = ({
  state,
  onUpdateState,
}) => {
  const pillarsResult = calculate7Pillars(state);

  // 6-Question Form state
  const [accomplished, setAccomplished] = useState(state.dailyReview.accomplished || '');
  const [failed, setFailed] = useState(state.dailyReview.failed || '');
  const [why, setWhy] = useState(state.dailyReview.why || '');
  const [learned, setLearned] = useState(state.dailyReview.learned || '');
  const [priorityTomorrow, setPriorityTomorrow] = useState(state.dailyReview.priorityTomorrow || '');
  const [gratitude, setGratitude] = useState(state.dailyReview.gratitude || '');

  // Tomorrow Blueprint state
  const [tomorrowTop1, setTomorrowTop1] = useState(state.tomorrowPlan.top3[0] || '');
  const [tomorrowTop2, setTomorrowTop2] = useState(state.tomorrowPlan.top3[1] || '');
  const [tomorrowTop3, setTomorrowTop3] = useState(state.tomorrowPlan.top3[2] || '');
  const [scheduleFocus, setScheduleFocus] = useState(state.tomorrowPlan.scheduleFocus || '');
  const [companyPriority, setCompanyPriority] = useState(state.tomorrowPlan.companyPriority || '');
  const [familyActivity, setFamilyActivity] = useState(state.tomorrowPlan.familyActivity || '');

  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();

    const review: DailyReview = {
      date: new Date().toISOString().split('T')[0],
      accomplished,
      failed,
      why,
      learned,
      priorityTomorrow,
      gratitude,
      completedAt: new Date().toISOString(),
    };

    const updatedTomorrowPlan: TomorrowPlan = {
      ...state.tomorrowPlan,
      top3: [tomorrowTop1, tomorrowTop2, tomorrowTop3],
      scheduleFocus,
      companyPriority,
      familyActivity,
      lastPlannedAt: new Date().toISOString(),
    };
    updatedTomorrowPlan.lastFeasibilityResult = evaluateTomorrowFeasibility(updatedTomorrowPlan, state);

    const pillarsMap: Record<PillarKey, boolean> = {
      morning: false,
      body: false,
      mission: false,
      business: false,
      wealthTrading: false,
      family: false,
      eveningShutdown: true,
    };
    pillarsResult.pillars.forEach(p => { pillarsMap[p.key] = p.satisfied; });

    const newHistoryRecord: DayHistoryRecord = {
      date: review.date,
      score: pillarsResult.score,
      mode: state.currentMode,
      dayType: state.dayType,
      pillars: pillarsMap,
      topVictory: accomplished.slice(0, 80) || state.victoryQuestionAnswer,
    };

    let workingState: AppState = {
      ...state,
      dailyReview: review,
      tomorrowPlan: updatedTomorrowPlan,
      history: [newHistoryRecord, ...state.history.filter(h => h.date !== review.date)],
    };

    for (const taskId of ['task-daily-analysis', 'task-tomorrow-plan']) {
      const task = workingState.tasks.find(t => t.id === taskId);
      if (!task || task.completed) continue;
      const result = await defaultApplicationService.completeActivity({ taskId, executionStatus: 'ON_TIME' }, workingState);
      if (result.success && result.state) workingState = result.state;
    }

    workingState = upsertDailyPerformanceRecord(workingState, review.date);
    workingState = reconcileWeeklyPerformance(workingState, review.date);
    workingState = {
      ...workingState,
      weeklyAdaptationRecommendations: generateWeeklyAdaptationRecommendations(workingState),
    };

    sound.playChime('success');
    try { confetti({ particleCount: 50, spread: 70, origin: { y: 0.5 } }); } catch {}
    onUpdateState(() => workingState);
    setSavedSuccess(true);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* View Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-indigo-600 font-mono text-xs uppercase tracking-wider font-bold">
          <Moon className="w-4 h-4" />
          <span>Anchor 10 • 8:00 PM – 9:00 PM Shutdown & Blueprint</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mt-1">
          Daily Analysis, 7 Pillars Score & Tomorrow Blueprint
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          "This is not another productivity shift. It is your transition out of builder mode."
        </p>
      </div>

      {/* 7-Pillars Live Scorecard */}
      <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-base font-bold text-slate-900 font-mono">
                7-Pillar Daily Execution Scorecard
              </h3>
              <p className="text-xs text-slate-600">
                Score the 7 immutable pillars. Never miss twice.
              </p>
            </div>
          </div>

          <div className={`px-3 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-2 ${pillarsResult.ratingBadgeColor}`}>
            <span className="text-sm">{pillarsResult.score} / {pillarsResult.total}</span>
            <span>({pillarsResult.ratingText})</span>
          </div>
        </div>

        {/* Pillars Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          {pillarsResult.pillars.map(p => (
            <div
              key={p.key}
              className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2 transition-all ${
                p.satisfied
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold font-mono">{p.label}</span>
                {p.satisfied ? (
                  <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-[10px] font-bold border border-emerald-300">
                    ✓
                  </span>
                ) : (
                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-[10px] font-mono">
                    ✗
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-600 leading-snug">
                {p.neutralNote || p.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 6-Question Reflection Form */}
      <form onSubmit={handleSubmitReview} className="space-y-6">
        
        <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900 font-mono">
              The 6-Question Daily Analysis
            </h3>
            <span className="text-xs font-mono text-indigo-600 font-bold">Deep Reflection</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Q1 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                1. What did I accomplish today?
              </label>
              <input
                type="text"
                value={accomplished}
                onChange={e => setAccomplished(e.target.value)}
                placeholder="Core breakthroughs, finished tasks, commitments met..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Q2 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                2. What did I fail to accomplish?
              </label>
              <input
                type="text"
                value={failed}
                onChange={e => setFailed(e.target.value)}
                placeholder="Unfinished tasks, delays, leaks..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Q3 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                3. Why did it happen? (Root Cause)
              </label>
              <input
                type="text"
                value={why}
                onChange={e => setWhy(e.target.value)}
                placeholder="Distraction leak, inaccurate estimation, unexpected meeting..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Q4 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                4. What did I learn?
              </label>
              <input
                type="text"
                value={learned}
                onChange={e => setLearned(e.target.value)}
                placeholder="Key insight or principle to encode into system..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Q5 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                5. What deserves primary attention tomorrow?
              </label>
              <input
                type="text"
                value={priorityTomorrow}
                onChange={e => setPriorityTomorrow(e.target.value)}
                placeholder="The single non-negotiable mission..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            {/* Q6 */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                6. What am I deeply grateful for?
              </label>
              <input
                type="text"
                value={gratitude}
                onChange={e => setGratitude(e.target.value)}
                placeholder="Family health, baby smile, peaceful home, clear mind..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>

        {/* Tomorrow Blueprint Planner */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <span>Tomorrow's Blueprint Generator</span>
            </h3>
            <span className="text-xs font-mono text-slate-500 font-medium">Pre-computation</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <label className="text-[11px] font-mono text-amber-800 uppercase font-bold">
                1. Tomorrow's Business Top 1:
              </label>
              <input
                type="text"
                value={tomorrowTop1}
                onChange={e => setTomorrowTop1(e.target.value)}
                placeholder="Core venture outcome..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <label className="text-[11px] font-mono text-indigo-800 uppercase font-bold">
                2. Tomorrow's Personal/AI Top 2:
              </label>
              <input
                type="text"
                value={tomorrowTop2}
                onChange={e => setTomorrowTop2(e.target.value)}
                placeholder="Core system build..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <label className="text-[11px] font-mono text-purple-800 uppercase font-bold">
                3. Tomorrow's Family Top 3:
              </label>
              <input
                type="text"
                value={tomorrowTop3}
                onChange={e => setTomorrowTop3(e.target.value)}
                placeholder="Dedicated family activity..."
                className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
              />
            </div>
          </div>
        </div>

        {/* Permitted Entertainment Window (8:00 - 9:30 PM) */}
        <div className="rounded-2xl bg-white border border-slate-200 p-5 flex items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
              <Tv className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900 font-mono">
                Permitted Entertainment & Leisure Window (8:00 PM – 9:30 PM)
              </h4>
              <p className="text-[11px] text-slate-600">
                You are permitted to deliberately enjoy books, films, conversation, or relaxation with zero guilt.
              </p>
            </div>
          </div>

          <span className="text-[10px] font-mono bg-indigo-50 text-indigo-800 px-2.5 py-1 rounded-md border border-indigo-200 uppercase font-bold shrink-0">
            Guilt-Free Mode
          </span>
        </div>

        {/* Submit Review */}
        <div className="flex items-center justify-between pt-2">
          {savedSuccess && (
            <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Review Locked & 7-Pillars Scored
            </span>
          )}

          <button
            type="submit"
            id="lock-evening-review-btn"
            className="ml-auto px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm shadow-sm flex items-center gap-2 transition-all"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Lock Daily Review & Score Today (+15 pts)</span>
          </button>
        </div>

      </form>
    </div>
  );
};
