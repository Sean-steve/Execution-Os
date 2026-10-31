import {
  AppState,
  DailyPerformanceRecord,
  DayOfWeekPerformanceProfile,
  PerformanceConfidence,
  PerformanceDimensionKey,
  PerformanceDimensionScore,
  PlannedLoadScore,
  WeeklyAdaptationRecommendation,
  WeeklyInsight,
  WeeklyPerformanceRecord,
} from '../types';

const ALGORITHM_VERSION = 'wpi-1.0.0';
const WEIGHT_VERSION = 'wpi-default-1';

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number) => Math.round(value * 10) / 10;
const avg = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const variance = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return avg(values.map(v => Math.pow(v - mean, 2)));
};

const confidenceFor = (count: number): PerformanceConfidence => {
  if (count >= 10) return 'STRONG';
  if (count >= 6) return 'MODERATE';
  if (count >= 3) return 'EMERGING';
  return 'INSUFFICIENT';
};

const dateOnly = (iso?: string) => (iso || new Date().toISOString()).slice(0, 10);
const toUtcDate = (date: string) => new Date(`${date}T12:00:00.000Z`);
const plusDays = (date: string, days: number) => {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const mondayFor = (date: string) => {
  const d = toUtcDate(date);
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const weekIdFor = (date: string) => `week-${mondayFor(date)}`;

const taskPriorityWeight = (task: any) => {
  if (task.isNonNegotiable || task.isProtected) return 3;
  if (task.category === 'DEEP_WORK' || task.category === 'BUSINESS' || task.category === 'TRADING') return 2.5;
  return 1;
};

const comparableTasksForDate = (state: AppState) =>
  state.tasks.filter(task => task.modesAllowed?.includes(state.currentMode) !== false);

export function computePlannedLoadScore(state: AppState): PlannedLoadScore {
  const tasks = comparableTasksForDate(state);
  const priorityLoad = clamp(avg(tasks.map(t => taskPriorityWeight(t) * 25)));
  const cognitive = tasks.filter(t =>
    t.category === 'DEEP_WORK' ||
    t.category === 'BUSINESS' ||
    t.interactiveActionType === 'FOCUS_BLOCK' ||
    t.interactiveActionType === 'COMMAND_CENTER' ||
    t.interactiveActionType === 'TRADING_GATEKEEPER'
  );
  const physical = tasks.filter(t =>
    t.interactiveActionType === 'WORKOUT_TRACKER' ||
    t.interactiveActionType === 'OUTSIDE_TIMER' ||
    t.category === 'FITNESS'
  );
  const external = tasks.filter(t => t.isProtected || t.category === 'MEETING' || t.category === 'APPOINTMENT');
  const dependencies = state.dependencies || [];
  const allocations = state.dynamicAllocations || [];
  const compressed = allocations.filter(a => {
    const task = tasks.find(t => t.id === a.activityId);
    if (!task) return false;
    const original = Math.max(1, task.endMinutes - task.startMinutes);
    const effective = Math.max(0, a.allocatedEndMinutes - a.allocatedStartMinutes);
    return effective < original * 0.8;
  });

  const cognitiveLoad = clamp(cognitive.reduce((sum, t) => sum + Math.max(10, (t.allocatedEndMinutes ?? t.endMinutes) - (t.allocatedStartMinutes ?? t.startMinutes)), 0) / 3);
  const physicalLoad = clamp(physical.reduce((sum, t) => sum + Math.max(10, t.endMinutes - t.startMinutes), 0) / 2);
  const externalCommitmentLoad = clamp(external.length * 18);
  const dependencyComplexity = clamp(dependencies.length * 8);
  const compressionFactor = clamp(tasks.length ? (compressed.length / tasks.length) * 100 : 0);
  const protectedCommitmentDensity = clamp(tasks.length ? (tasks.filter(t => t.isProtected).length / tasks.length) * 100 : 0);
  const contextSwitchLoad = clamp(new Set(tasks.map(t => t.category || t.anchorId)).size * 8);
  const recoveryDemand = state.currentMode === 'RED' ? 90 : state.currentMode === 'YELLOW' ? 60 : state.routineState === 'RECOVERY' ? 75 : 20;

  const value = clamp(
    priorityLoad * 0.22 +
    cognitiveLoad * 0.22 +
    physicalLoad * 0.08 +
    externalCommitmentLoad * 0.12 +
    dependencyComplexity * 0.10 +
    compressionFactor * 0.08 +
    protectedCommitmentDensity * 0.08 +
    contextSwitchLoad * 0.06 +
    recoveryDemand * 0.04
  );

  return {
    value: round(value),
    priorityLoad: round(priorityLoad),
    cognitiveLoad: round(cognitiveLoad),
    physicalLoad: round(physicalLoad),
    externalCommitmentLoad: round(externalCommitmentLoad),
    dependencyComplexity: round(dependencyComplexity),
    compressionFactor: round(compressionFactor),
    protectedCommitmentDensity: round(protectedCommitmentDensity),
    contextSwitchLoad: round(contextSwitchLoad),
    recoveryDemand: round(recoveryDemand),
  };
}

function dimension(
  key: PerformanceDimensionKey,
  value: number,
  weight: number,
  evidenceCount: number,
  explanation: string
): PerformanceDimensionScore {
  return {
    dimension: key,
    value: round(clamp(value)),
    weight,
    evidenceCount,
    confidence: confidenceFor(evidenceCount),
    explanation,
  };
}

export function buildDailyPerformanceRecord(
  state: AppState,
  localDate: string = state.activeDate || dateOnly()
): DailyPerformanceRecord {
  const tasks = comparableTasksForDate(state);
  const completed = tasks.filter(t => t.completed);
  const totalWeight = tasks.reduce((sum, t) => sum + taskPriorityWeight(t), 0) || 1;
  const completedWeight = completed.reduce((sum, t) => sum + taskPriorityWeight(t), 0);
  const outcomeScore = clamp((completedWeight / totalWeight) * 100);

  const eligibleCompleted = completed.filter(t => t.executionStatus !== 'SKIPPED');
  const onTime = eligibleCompleted.filter(t => t.executionStatus === 'ON_TIME' || t.executionStatus === 'COMPLETED');
  const executionReliability = eligibleCompleted.length ? (onTime.length / eligibleCompleted.length) * 100 : 0;

  const sessions = (state.performanceSessions || []).filter(s =>
    dateOnly(s.endedAtUtc || s.updatedAtUtc || s.createdAtUtc) === localDate
  );
  const focusSessions = sessions.filter(s => s.environmentType === 'ASSISTED' || /deep work|focus/i.test(s.title));
  const focusOutcomeRate = focusSessions.length
    ? focusSessions.filter(s => s.completionResult?.outcome === 'COMPLETED').length / focusSessions.length
    : 0;
  const focusInterruptionPenalty = focusSessions.length
    ? clamp(avg(focusSessions.map(s => Math.min(100, (s.interruptions?.length || 0) * 18))))
    : 0;
  const focusPerformance = focusSessions.length ? clamp(focusOutcomeRate * 100 - focusInterruptionPenalty * 0.25) : 0;

  const physicalTasks = tasks.filter(t =>
    t.interactiveActionType === 'WORKOUT_TRACKER' ||
    t.interactiveActionType === 'OUTSIDE_TIMER' ||
    t.category === 'FITNESS'
  );
  const physicalExecution = physicalTasks.length
    ? (physicalTasks.filter(t => t.completed).length / physicalTasks.length) * 100
    : 100;

  const protectedTasks = tasks.filter(t => t.isProtected || t.interactiveActionType === 'FAMILY_OUTING');
  const protectedIntegrity = protectedTasks.length
    ? (protectedTasks.filter(t => t.completed && t.executionStatus !== 'MISSED_LATE').length / protectedTasks.length) * 100
    : 100;

  const deviations = (state.deviations || []).filter(d => dateOnly((d as any).timestamp || (d as any).detectedAt || localDate) === localDate);
  const resolved = deviations.filter(d => d.isResolved || d.resolvedAutonomously);
  const recovery = deviations.length ? (resolved.length / deviations.length) * 100 : 100;

  const tradingApplicable = state.tradingProtocol?.isTradingDay === true;
  const tradingDiscipline = tradingApplicable
    ? (state.tradingProtocol.closedTerminal && (state.tradingProtocol.executed || state.tradingProtocol.noSetupJustified) ? 100 : 40)
    : null;

  const allocated = tasks.filter(t => t.allocatedStartMinutes !== undefined || t.allocatedEndMinutes !== undefined);
  const scheduleIntegrity = allocated.length
    ? avg(allocated.map(t => {
        if (!t.completedAtMinutes) return t.completed ? 80 : 0;
        const start = t.allocatedStartMinutes ?? t.startMinutes;
        const end = t.allocatedEndMinutes ?? t.endMinutes;
        return t.completedAtMinutes >= start - 15 && t.completedAtMinutes <= end + 15 ? 100 : 55;
      }))
    : executionReliability;

  const familyProtected = protectedIntegrity;
  const overrunPenalty = sessions.filter(s =>
    s.activeDurationSeconds > Math.max(1, s.targetDurationMinutes) * 60 * 1.25
  ).length * 6;
  const sustainable = clamp(
    outcomeScore * 0.35 +
    recovery * 0.20 +
    familyProtected * 0.25 +
    scheduleIntegrity * 0.20 -
    overrunPenalty
  );

  const dimensions: PerformanceDimensionScore[] = [
    dimension('PRIORITY_WEIGHTED_OUTCOMES', outcomeScore, 0.30, tasks.length, 'High-value outcomes completed relative to the day plan.'),
    dimension('EXECUTION_RELIABILITY', executionReliability, 0.15, eligibleCompleted.length, 'Completed work that remained on-time or validly completed.'),
    dimension('FOCUS_PERFORMANCE', focusPerformance, 0.15, focusSessions.length, 'HEE-011 focus-session outcomes adjusted for interruptions.'),
    dimension('RECOVERY_EFFECTIVENESS', recovery, 0.10, Math.max(1, deviations.length), 'Meaningful outcomes preserved after deviations.'),
    dimension('PROTECTED_COMMITMENT_INTEGRITY', protectedIntegrity, 0.10, Math.max(1, protectedTasks.length), 'Protected family/commitment integrity.'),
    dimension('SCHEDULE_INTEGRITY', scheduleIntegrity, 0.08, Math.max(1, allocated.length), 'Actual execution aligned with effective allocations.'),
    dimension('PHYSICAL_EXECUTION', physicalExecution, 0.05, Math.max(1, physicalTasks.length), 'Configured physical commitments completed.'),
    dimension('TRADING_DISCIPLINE', tradingDiscipline ?? 100, tradingApplicable ? 0.05 : 0, tradingApplicable ? 1 : 0, tradingApplicable ? 'Trading gate discipline and terminal outcome.' : 'Not a trading day.'),
    dimension('LIFE_QUALITY_PROXY', protectedIntegrity, 0.02, Math.max(1, protectedTasks.length), 'Conservative proxy based on protected-life integrity.'),
  ];

  const activeDimensions = dimensions.filter(d => d.weight > 0);
  const weightTotal = activeDimensions.reduce((sum, d) => sum + d.weight, 0) || 1;
  const overall = activeDimensions.reduce((sum, d) => sum + d.value * d.weight, 0) / weightTotal;
  const load = computePlannedLoadScore(state);
  const loadNormalizationFactor = 0.9 + Math.min(0.2, load.value / 500);
  const adjustedDayStrength = clamp(overall * loadNormalizationFactor * (0.85 + sustainable / 666.7));

  const factors: string[] = [];
  if (outcomeScore >= 85) factors.push('High-value outcomes were strongly preserved.');
  if (focusPerformance >= 80) factors.push('Focus sessions produced strong objective completion with limited interruption.');
  if (protectedIntegrity >= 95) factors.push('Protected life commitments remained intact.');
  if (recovery >= 85 && deviations.length) factors.push('Disruptions were recovered without losing most intended outcomes.');
  if (scheduleIntegrity < 65) factors.push('Execution drifted materially from effective allocations.');
  if (!factors.length) factors.push('Performance evidence is still accumulating.');

  const evidenceCount = tasks.length + sessions.length + deviations.length;
  const now = new Date().toISOString();

  return {
    id: `daily-perf-${localDate}`,
    userId: 'user_primary',
    localDate,
    timezone: state.timezone || 'UTC',
    weekId: weekIdFor(localDate),
    routineVersionId: (state as any).routineVersionId,
    mode: state.currentMode,
    dayType: state.dayType,
    plannedLoadScore: load,
    dimensionScores: dimensions,
    priorityWeightedOutcomeScore: round(outcomeScore),
    executionReliabilityScore: round(executionReliability),
    focusPerformanceScore: round(focusPerformance),
    physicalExecutionScore: round(physicalExecution),
    protectedCommitmentIntegrityScore: round(protectedIntegrity),
    tradingDisciplineScore: tradingDiscipline === null ? null : round(tradingDiscipline),
    recoveryEffectivenessScore: round(recovery),
    scheduleIntegrityScore: round(scheduleIntegrity),
    lifeQualityProxyScore: round(protectedIntegrity),
    sustainablePerformanceIndex: round(sustainable),
    overallDailyPerformanceScore: round(overall),
    adjustedDayStrength: round(adjustedDayStrength),
    confidence: confidenceFor(evidenceCount),
    sourceEvidenceCount: evidenceCount,
    topExplanatoryFactors: factors.slice(0, 5),
    algorithmVersion: ALGORITHM_VERSION,
    weightVersion: WEIGHT_VERSION,
    createdAtUtc: now,
    finalizedAtUtc: now,
  };
}

export function upsertDailyPerformanceRecord(state: AppState, localDate?: string): AppState {
  const record = buildDailyPerformanceRecord(state, localDate);
  const records = [...(state.dailyPerformanceRecords || []).filter(r => r.localDate !== record.localDate), record]
    .sort((a, b) => b.localDate.localeCompare(a.localDate));
  return { ...state, dailyPerformanceRecords: records };
}

function bestDayByDimension(records: DailyPerformanceRecord[]) {
  const out: Partial<Record<PerformanceDimensionKey, string>> = {};
  const dimensions: PerformanceDimensionKey[] = [
    'PRIORITY_WEIGHTED_OUTCOMES','EXECUTION_RELIABILITY','FOCUS_PERFORMANCE','PHYSICAL_EXECUTION',
    'RECOVERY_EFFECTIVENESS','PROTECTED_COMMITMENT_INTEGRITY','TRADING_DISCIPLINE','SCHEDULE_INTEGRITY','LIFE_QUALITY_PROXY'
  ];
  for (const key of dimensions) {
    let best: { date: string; value: number } | null = null;
    for (const record of records) {
      const score = record.dimensionScores.find(d => d.dimension === key);
      if (!score || score.weight <= 0) continue;
      if (!best || score.value > best.value) best = { date: record.localDate, value: score.value };
    }
    if (best) out[key] = best.date;
  }
  return out;
}

function buildWeeklyInsights(weekId: string, records: DailyPerformanceRecord[]): WeeklyInsight[] {
  if (!records.length) return [];
  const sorted = [...records].sort((a, b) => b.adjustedDayStrength - a.adjustedDayStrength);
  const best = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const insights: WeeklyInsight[] = [{
    id: `insight-${weekId}-best`,
    weekId,
    finding: `${best.localDate} was the strongest adjusted execution day.`,
    whyItMatters: best.topExplanatoryFactors[0] || 'It preserved the most important outcomes relative to load.',
    evidenceWindow: `${records.length} recorded day(s)`,
    sampleSize: records.length,
    effectSize: round(best.adjustedDayStrength - avg(records.map(r => r.adjustedDayStrength))),
    confidence: confidenceFor(records.length),
    recommendation: 'Preserve the conditions that made this day work before increasing workload.',
  }];

  if (records.length > 1 && weakest.localDate !== best.localDate) {
    insights.push({
      id: `insight-${weekId}-lowest`,
      weekId,
      finding: `${weakest.localDate} had the lowest adjusted execution strength.`,
      whyItMatters: weakest.topExplanatoryFactors.find(f => /drift|accumulating/i.test(f)) || 'The day produced weaker outcomes relative to its planned load.',
      evidenceWindow: `${records.length} recorded day(s)`,
      sampleSize: records.length,
      effectSize: round(avg(records.map(r => r.adjustedDayStrength)) - weakest.adjustedDayStrength),
      confidence: confidenceFor(records.length),
      recommendation: 'Inspect load, timing and interruption conditions before moving important work into a similar window.',
    });
  }
  return insights.slice(0, 5);
}

export function buildWeeklyPerformanceRecord(
  state: AppState,
  anchorDate: string = state.activeDate || dateOnly()
): WeeklyPerformanceRecord {
  const startDate = mondayFor(anchorDate);
  const endDate = plusDays(startDate, 6);
  const weekId = weekIdFor(anchorDate);
  const records = (state.dailyPerformanceRecords || [])
    .filter(r => r.localDate >= startDate && r.localDate <= endDate)
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  const strengths = records.map(r => r.adjustedDayStrength);
  const best = records.length ? [...records].sort((a, b) => b.adjustedDayStrength - a.adjustedDayStrength)[0] : undefined;
  const lowest = records.length ? [...records].sort((a, b) => a.adjustedDayStrength - b.adjustedDayStrength)[0] : undefined;
  const tradingValues = records.map(r => r.tradingDisciplineScore).filter((v): v is number => v !== null);
  const insights = buildWeeklyInsights(weekId, records);
  const now = new Date().toISOString();

  return {
    id: `weekly-perf-${startDate}`,
    userId: 'user_primary',
    weekId,
    startDate,
    endDate,
    timezone: state.timezone || 'UTC',
    dailyRecordIds: records.map(r => r.id),
    overallWeeklyPerformanceScore: round(avg(records.map(r => r.overallDailyPerformanceScore))),
    weeklyPlannedLoad: round(avg(records.map(r => r.plannedLoadScore.value))),
    weeklyOutcomeAchievement: round(avg(records.map(r => r.priorityWeightedOutcomeScore))),
    weeklyRecoveryEffectiveness: round(avg(records.map(r => r.recoveryEffectivenessScore))),
    protectedCommitmentIntegrity: round(avg(records.map(r => r.protectedCommitmentIntegrityScore))),
    focusPerformance: round(avg(records.map(r => r.focusPerformanceScore))),
    physicalPerformance: round(avg(records.map(r => r.physicalExecutionScore))),
    tradingDiscipline: tradingValues.length ? round(avg(tradingValues)) : null,
    bestDayDate: best?.localDate,
    lowestDayDate: lowest?.localDate,
    bestDayByDimension: bestDayByDimension(records),
    confidence: confidenceFor(records.length),
    insights,
    recommendationIds: [],
    algorithmVersion: ALGORITHM_VERSION,
    createdAtUtc: now,
    finalizedAtUtc: records.length ? now : undefined,
  };
}

export function buildDayOfWeekPerformanceProfiles(state: AppState): DayOfWeekPerformanceProfile[] {
  const records = [...(state.dailyPerformanceRecords || [])];
  const labels = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const now = new Date().toISOString();
  const profiles: DayOfWeekPerformanceProfile[] = [];

  for (let weekday = 0; weekday < 7; weekday++) {
    const group = records.filter(r => toUtcDate(r.localDate).getUTCDay() === weekday);
    if (!group.length) continue;
    const strengths = group.map(r => r.adjustedDayStrength);
    profiles.push({
      id: `weekday-profile-${weekday}`,
      userId: 'user_primary',
      weekday,
      weekdayLabel: labels[weekday],
      windowStart: group.map(r => r.localDate).sort()[0],
      windowEnd: group.map(r => r.localDate).sort().slice(-1)[0],
      sampleCount: group.length,
      medianAdjustedStrength: round(median(strengths)),
      meanAdjustedStrength: round(avg(strengths)),
      variance: round(variance(strengths)),
      meanFocusPerformance: round(avg(group.map(r => r.focusPerformanceScore))),
      meanOutcomeAchievement: round(avg(group.map(r => r.priorityWeightedOutcomeScore))),
      meanRecoveryEffectiveness: round(avg(group.map(r => r.recoveryEffectivenessScore))),
      meanProtectedCommitmentIntegrity: round(avg(group.map(r => r.protectedCommitmentIntegrityScore))),
      confidence: confidenceFor(group.length),
      explanatoryFactors: group.flatMap(r => r.topExplanatoryFactors).slice(0, 3),
      updatedAtUtc: now,
    });
  }
  return profiles;
}

export function reconcileWeeklyPerformance(state: AppState, anchorDate?: string): AppState {
  const week = buildWeeklyPerformanceRecord(state, anchorDate);
  const weeks = [...(state.weeklyPerformanceRecords || []).filter(w => w.weekId !== week.weekId), week]
    .sort((a, b) => b.startDate.localeCompare(a.startDate));
  const insights = [
    ...(state.weeklyInsights || []).filter(i => i.weekId !== week.weekId),
    ...week.insights,
  ];
  const profiles = buildDayOfWeekPerformanceProfiles({ ...state, weeklyPerformanceRecords: weeks, weeklyInsights: insights });
  return {
    ...state,
    weeklyPerformanceRecords: weeks,
    weeklyInsights: insights,
    dayOfWeekPerformanceProfiles: profiles,
  };
}

export function generateWeeklyAdaptationRecommendations(state: AppState): WeeklyAdaptationRecommendation[] {
  const profiles = state.dayOfWeekPerformanceProfiles || buildDayOfWeekPerformanceProfiles(state);
  const strong = profiles.filter(p => p.confidence === 'STRONG' || p.confidence === 'MODERATE');
  if (!strong.length) return state.weeklyAdaptationRecommendations || [];

  const bestFocus = [...strong].sort((a, b) => b.meanFocusPerformance - a.meanFocusPerformance)[0];
  if (!bestFocus || bestFocus.meanFocusPerformance < 70) return state.weeklyAdaptationRecommendations || [];

  const insightId = `weekday-focus-${bestFocus.weekday}`;
  const existing = (state.weeklyAdaptationRecommendations || []).find(r => r.sourceInsightId === insightId);
  if (existing) return state.weeklyAdaptationRecommendations || [];

  const recommendation: WeeklyAdaptationRecommendation = {
    id: `weekly-rec-${bestFocus.weekday}-${Date.now()}`,
    sourceInsightId: insightId,
    targetEngine: 'HEE-003',
    proposedChange: `Prefer flexible high-cognitive-load work on ${bestFocus.weekdayLabel} when constraints allow.`,
    expectedBenefit: `Observed mean focus performance is ${bestFocus.meanFocusPerformance} across ${bestFocus.sampleCount} comparable day(s).`,
    risk: 'LOW',
    reversible: true,
    evidenceCount: bestFocus.sampleCount,
    status: 'PROPOSED',
    createdAtUtc: new Date().toISOString(),
  };
  return [...(state.weeklyAdaptationRecommendations || []), recommendation];
}
