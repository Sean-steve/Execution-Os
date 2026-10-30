import React, { useState } from 'react';
import { 
  Sun, 
  Target, 
  Cpu, 
  TrendingUp, 
  Heart, 
  Moon, 
  Award, 
  Flame, 
  Sparkles, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  ArrowRight,
  Zap,
  Lock,
  ShieldAlert,
  AlertTriangle,
  Layers,
  Activity
} from 'lucide-react';
import { AppState, RoutineTask } from '../types';
import { AutonomousControlHUD } from './AutonomousControlHUD';
import { AdaptiveTimelineView } from './AdaptiveTimelineView';
import { AdaptationProposalsView } from './AdaptationProposalsView';
import { calculate7Pillars, formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { getActiveDayTheme } from '../services/dayThemeService';

interface DashboardViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onNavigateToView: (view: AppState['activeView']) => void;
  onRequestDisciplineCheck: (task: RoutineTask) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  onUpdateState,
  onNavigateToView,
  onRequestDisciplineCheck,
}) => {
  const [dashboardTab, setDashboardTab] = useState<'OVERVIEW' | 'DYNAMIC_TIMELINE' | 'ADAPTATION_LAB'>('OVERVIEW');
  const pillarsData = calculate7Pillars(state);
  const currentMinutes = getCurrentTimeMinutes(state);
  const activeTheme = getActiveDayTheme(state);

  const completedCount = state.tasks.filter(t => t.completed).length;
  const totalCount = state.tasks.filter(t => t.modesAllowed.includes(state.currentMode)).length;
  const lateInfractions = state.tasks.filter(t => t.completed && t.missedWindow).length;

  const handleNavigateToInteractive = (task: RoutineTask) => {
    switch (task.interactiveActionType) {
      case 'IDENTITY_CHECK':
      case 'DREAM_JOURNAL':
      case 'OUTSIDE_TIMER':
      case 'WORKOUT_TRACKER':
      case 'MEDITATION_TIMER':
        onNavigateToView('MORNING_PRIME');
        break;
      case 'COMMAND_CENTER':
        onNavigateToView('COMMAND_CENTER');
        break;
      case 'FOCUS_BLOCK':
      case 'COMPANY_TARGET':
        onNavigateToView('DEEP_WORK');
        break;
      case 'TRADING_GATEKEEPER':
        onNavigateToView('TRADING');
        break;
      case 'FAMILY_OUTING':
        onNavigateToView('FAMILY');
        break;
      case 'EVENING_REVIEW':
        onNavigateToView('EVENING');
        break;
      default:
        break;
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      
      {/* 1. Autonomous Execution Kernel HUD: "WHAT SHOULD I DO NOW?" */}
      <AutonomousControlHUD
        state={state}
        onUpdateState={onUpdateState}
        onNavigateToInteractive={handleNavigateToInteractive}
        onRequestDisciplineModal={onRequestDisciplineCheck}
      />

      {/* Sub-Dashboard Navigation Switcher */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDashboardTab('OVERVIEW')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
              dashboardTab === 'OVERVIEW'
                ? `${activeTheme.classes.accentBg} text-white shadow-xs`
                : 'text-slate-600 hover:text-slate-900 bg-slate-100'
            }`}
          >
            Mission Hub & Suites
          </button>
          <button
            onClick={() => setDashboardTab('DYNAMIC_TIMELINE')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
              dashboardTab === 'DYNAMIC_TIMELINE'
                ? `${activeTheme.classes.accentBg} text-white shadow-xs`
                : 'text-slate-600 hover:text-slate-900 bg-slate-100'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Dynamic Allocation Timeline</span>
          </button>
          <button
            onClick={() => setDashboardTab('ADAPTATION_LAB')}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
              dashboardTab === 'ADAPTATION_LAB'
                ? `${activeTheme.classes.accentBg} text-white shadow-xs`
                : 'text-slate-600 hover:text-slate-900 bg-slate-100'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Evolution & Intelligence Lab</span>
          </button>
        </div>

        <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
          Autonomous Execution OS v2.0
        </span>
      </div>

      {/* View 1: Mission Hub & Suites */}
      {dashboardTab === 'OVERVIEW' && (
        <div className="space-y-8">
          {/* Today's Tactical Victory & 3 Fronts Snapshot */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Victory & Top 3 Card (7 Cols) */}
            <div className="lg:col-span-7 rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Target className={`w-4 h-4 ${activeTheme.classes.accentText}`} />
                  <h3 className="text-sm font-bold text-slate-900 font-mono">
                    Today's Definition of Victory (10:00 PM)
                  </h3>
                </div>
                <button
                  onClick={() => onNavigateToView('COMMAND_CENTER')}
                  className={`text-xs font-semibold font-mono flex items-center gap-1 ${activeTheme.classes.accentText} hover:underline`}
                >
                  Edit Command <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <p className="text-xs text-slate-800 italic font-mono bg-slate-50 p-3.5 rounded-xl border border-slate-200 leading-relaxed">
                "{state.victoryQuestionAnswer || 'Shipped core asset, maintained zero distraction leaks, unhurried presence with family.'}"
              </p>

              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-mono text-slate-500 uppercase font-semibold">
                  Top 3 Outcomes for {activeTheme.dayName}:
                </span>
                <div className="space-y-1.5">
                  {state.tomorrowPlan.top3.map((outcome, idx) => (
                    <div key={idx} className="flex items-center gap-2.5 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                      <span className={`w-5 h-5 rounded-md font-mono text-[10px] font-bold flex items-center justify-center shrink-0 border ${activeTheme.classes.badge}`}>
                        {idx + 1}
                      </span>
                      <span className="truncate font-medium">{outcome}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 7-Pillars Mini Score HUD (5 Cols) */}
            <div className="lg:col-span-5 rounded-2xl bg-white border border-slate-200 p-6 space-y-4 flex flex-col justify-between shadow-sm">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <h3 className="text-sm font-bold text-slate-900 font-mono">
                      7-Pillar Daily Score
                    </h3>
                  </div>
                  <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg border shadow-xs ${pillarsData.ratingBadgeColor}`}>
                    {pillarsData.score}/7 ({pillarsData.ratingText.split(' ')[1] || 'Status'})
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-4">
                  {pillarsData.pillars.map(p => (
                    <div
                      key={p.key}
                      className={`p-2 rounded-lg border text-[11px] font-mono flex items-center justify-between ${
                        p.satisfied
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-medium'
                          : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <span className="truncate">{p.label}</span>
                      <span className="font-bold">{p.satisfied ? '✓' : '✗'}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 font-mono font-medium">
                    Tasks: <strong className="text-slate-800">{completedCount}/{totalCount}</strong>
                  </span>
                  {lateInfractions > 0 && (
                    <span className="text-[10px] font-mono bg-red-50 text-red-700 px-1.5 py-0.5 rounded border border-red-200 font-bold">
                      {lateInfractions} Late
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onNavigateToView('EVENING')}
                  className={`text-xs font-mono flex items-center gap-1 font-bold ${activeTheme.classes.accentText} hover:underline`}
                >
                  Evening Review <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>

          </div>

          {/* The 6 Anchor Modules Hub */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold font-mono text-slate-800 uppercase tracking-wider">
                Anchor Suites & Specialized Battlefields
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                {activeTheme.dayName} Palette Active
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* Suite 1: Morning Prime */}
              <div
                onClick={() => onNavigateToView('MORNING_PRIME')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Sun className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 font-semibold">5:30 AM</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Morning Prime & Identity
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    4 Truths identity ritual, dream log, 10m outdoor light, 2-set workout & 432Hz meditation.
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  Open Prime Suite <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 2: Deep Work Battlefield */}
              <div
                onClick={() => onNavigateToView('DEEP_WORK')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 font-semibold">7:45 AM</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Deep Work & Company
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Battlefield focus timer, distraction shields, ambient sound & Company of the Day micro-actions.
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  Engage Focus <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 3: Trading Gatekeeper */}
              <div
                onClick={() => onNavigateToView('TRADING')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 font-semibold">Gatekeeper</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Trading Protocol Gatekeeper
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Objective market analysis, strict setup verification, risk limits & "No setup = No trade".
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  Open Protocol <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 4: Family & Outings */}
              <div
                onClick={() => onNavigateToView('FAMILY')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Heart className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 font-semibold">4:00 PM</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Human Life & Family
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    3-set physical workout, unhurried baby/family connection, and dynamic scenic outing generator.
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  Open Family Suite <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 5: Tomorrow Planner (Sprint 6) */}
              <div
                onClick={() => onNavigateToView('TOMORROW_PLANNER')}
                className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50/70 to-white hover:from-indigo-50 border border-indigo-200 hover:border-indigo-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center group-hover:scale-105 transition-transform shadow-xs">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-indigo-700 bg-indigo-100 font-bold px-2 py-0.5 rounded-md border border-indigo-200">
                    {state.tomorrowPlan?.lastFeasibilityResult ? `${state.tomorrowPlan.lastFeasibilityResult.feasibilityScore}/100 Score` : 'Feasibility'}
                  </span>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                    Tomorrow Planner & Activation
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Define tomorrow tonight. Real-time deterministic feasibility, conflict resolution & autonomous day activation.
                  </p>
                </div>
                <div className="pt-2 text-xs font-mono font-semibold flex items-center gap-1 text-indigo-600">
                  Open Planner & Activate <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 6: Evening Review */}
              <div
                onClick={() => onNavigateToView('EVENING')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 border border-purple-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Moon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 font-semibold">8:00 PM</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Evening Review & 7 Pillars
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    6-question analysis, 7-pillar calculation, tomorrow pre-planning blueprint, and guilt-free entertainment.
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  Start Review <ArrowRight className="w-3 h-3" />
                </div>
              </div>

              {/* Suite 6: Reward Vault */}
              <div
                onClick={() => onNavigateToView('REWARDS')}
                className="p-5 rounded-2xl bg-white hover:bg-slate-50/80 border border-slate-200 hover:border-slate-300 hover:shadow-md cursor-pointer transition-all space-y-3 group shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center group-hover:scale-105 transition-transform">
                    <Award className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-mono text-amber-800 font-bold bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">{state.rewardPoints} pts</span>
                </div>
                <div>
                  <h4 className={`text-sm font-bold text-slate-900 group-hover:${activeTheme.classes.accentText} transition-colors`}>
                    Human Reward Vault
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Redeem earned execution points for real-world adventures, fine dining, scenic trips, and milestones.
                  </p>
                </div>
                <div className={`pt-2 text-xs font-mono font-semibold flex items-center gap-1 ${activeTheme.classes.accentText}`}>
                  View Rewards <ArrowRight className="w-3 h-3" />
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

      {/* View 2: Dynamic Allocation Timeline */}
      {dashboardTab === 'DYNAMIC_TIMELINE' && (
        <AdaptiveTimelineView
          state={state}
          onSelectTask={handleNavigateToInteractive}
          onRequestDisciplineModal={onRequestDisciplineCheck}
        />
      )}

      {/* View 3: Autonomous Adaptation & Evolution Lab */}
      {dashboardTab === 'ADAPTATION_LAB' && (
        <AdaptationProposalsView
          state={state}
          onUpdateState={onUpdateState}
        />
      )}

    </div>
  );
};

