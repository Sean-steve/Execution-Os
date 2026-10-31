import React, { useMemo } from 'react';
import { AppState, PerformanceDimensionKey } from '../types';
import {
  buildDailyPerformanceRecord,
  buildDayOfWeekPerformanceProfiles,
  buildWeeklyPerformanceRecord,
} from '../services/weeklyPerformanceIntelligence';
import { BarChart3, CalendarDays, ShieldCheck, Sparkles, Target, TrendingUp } from 'lucide-react';

interface WeeklyPerformanceViewProps {
  state: AppState;
}

const dimensionLabel: Record<PerformanceDimensionKey, string> = {
  PRIORITY_WEIGHTED_OUTCOMES: 'Outcomes',
  EXECUTION_RELIABILITY: 'Reliability',
  FOCUS_PERFORMANCE: 'Focus',
  PHYSICAL_EXECUTION: 'Physical',
  RECOVERY_EFFECTIVENESS: 'Recovery',
  PROTECTED_COMMITMENT_INTEGRITY: 'Protected Life',
  TRADING_DISCIPLINE: 'Trading Discipline',
  SCHEDULE_INTEGRITY: 'Schedule',
  LIFE_QUALITY_PROXY: 'Life Quality',
};

export const WeeklyPerformanceView: React.FC<WeeklyPerformanceViewProps> = ({ state }) => {
  const model = useMemo(() => {
    const activeDate = state.activeDate || new Date().toISOString().slice(0, 10);
    const existingToday = (state.dailyPerformanceRecords || []).find(r => r.localDate === activeDate);
    const daily = existingToday || buildDailyPerformanceRecord(state, activeDate);
    const enriched = existingToday
      ? state
      : { ...state, dailyPerformanceRecords: [...(state.dailyPerformanceRecords || []), daily] };
    return {
      daily,
      weekly: buildWeeklyPerformanceRecord(enriched, activeDate),
      profiles: buildDayOfWeekPerformanceProfiles(enriched),
    };
  }, [state]);

  const { daily, weekly, profiles } = model;
  const bestDay = weekly.bestDayDate
    ? (state.dailyPerformanceRecords || []).find(r => r.localDate === weekly.bestDayDate) || (daily.localDate === weekly.bestDayDate ? daily : undefined)
    : undefined;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Metric label="Weekly Performance" value={weekly.overallWeeklyPerformanceScore} suffix="/100" icon={BarChart3} />
        <Metric label="Outcomes" value={weekly.weeklyOutcomeAchievement} suffix="%" icon={Target} />
        <Metric label="Recovery" value={weekly.weeklyRecoveryEffectiveness} suffix="%" icon={TrendingUp} />
        <Metric label="Protected Life" value={weekly.protectedCommitmentIntegrity} suffix="%" icon={ShieldCheck} />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
          <Sparkles className="w-4 h-4" />
          Strongest day this week
        </div>
        <div className="mt-2 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="text-2xl font-bold text-slate-900">
              {weekly.bestDayDate || 'Not enough evidence yet'}
            </div>
            <div className="text-sm text-slate-600 mt-1">
              {bestDay
                ? `Adjusted strength ${bestDay.adjustedDayStrength}/100 · planned load ${bestDay.plannedLoadScore.value}/100`
                : 'Complete and reconcile daily execution to establish a weekly best day.'}
            </div>
          </div>
          <span className="text-xs rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            Confidence: {weekly.confidence}
          </span>
        </div>
        {bestDay && (
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {bestDay.topExplanatoryFactors.slice(0, 4).map(factor => (
              <li key={factor} className="flex gap-2">
                <span className="text-emerald-600">•</span>
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <CalendarDays className="w-4 h-4 text-indigo-600" />
              Day-of-week performance
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Longitudinal evidence. Strong claims require repeated comparable weeks.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {profiles.length ? profiles.map(profile => (
            <div key={profile.id} className="grid grid-cols-[88px_1fr_90px] items-center gap-3">
              <div className="text-xs font-semibold text-slate-700">{profile.weekdayLabel}</div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(2, Math.min(100, profile.medianAdjustedStrength))}%` }}
                />
              </div>
              <div className="text-right text-xs text-slate-600">
                {profile.medianAdjustedStrength} · n={profile.sampleCount}
              </div>
            </div>
          )) : (
            <div className="text-sm text-slate-500 py-6 text-center">
              Weekday profiles will appear after daily records accumulate.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">What should change next week?</h3>
        <div className="mt-3 space-y-3">
          {weekly.insights.length ? weekly.insights.map(insight => (
            <div key={insight.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{insight.finding}</div>
              <div className="text-xs text-slate-600 mt-1">{insight.whyItMatters}</div>
              {insight.recommendation && (
                <div className="text-xs text-indigo-700 mt-2 font-medium">{insight.recommendation}</div>
              )}
              <div className="text-[11px] text-slate-500 mt-2">
                {insight.confidence} confidence · sample {insight.sampleSize}
              </div>
            </div>
          )) : (
            <div className="text-sm text-slate-500">
              More execution evidence is needed before the OS recommends changes.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">Today by dimension</h3>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          {daily.dimensionScores.filter(d => d.weight > 0).map(score => (
            <div key={score.dimension} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">{dimensionLabel[score.dimension]}</span>
                <span className="font-bold text-slate-900">{score.value}</span>
              </div>
              <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden mt-2">
                <div className="h-full bg-slate-700" style={{ width: `${score.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const Metric: React.FC<{
  label: string;
  value: number;
  suffix: string;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, suffix, icon: Icon }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <Icon className="w-4 h-4 text-indigo-600" />
    <div className="text-2xl font-bold text-slate-900 mt-2">{Math.round(value)}{suffix}</div>
    <div className="text-xs text-slate-500 mt-1">{label}</div>
  </div>
);
