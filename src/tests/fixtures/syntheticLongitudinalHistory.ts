import { HistoricalExecutionDay, HistoricalActivityExecution } from '../../types';

/**
 * TEST-ONLY fixture generator.
 * Synthetic execution history must never be used by production adaptation intelligence.
 */
export function generateLongitudinalExecutionHistory(daysCount: number = 90): HistoricalExecutionDay[] {
  const history: HistoricalExecutionDay[] = [];
  const baseDate = new Date();

  for (let i = daysCount - 1; i >= 0; i--) {
    const dayDate = new Date(baseDate.getTime() - i * 86400000);
    const dateStr = dayDate.toISOString().split('T')[0];
    const dayOfWeek = dayDate.getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Simulate realistic execution variations
    const isSingleDayAnomaly = i === 14; // Exactly 1 isolated bad day 14 days ago
    const isHighEnergyDay = (i % 7 === 1 || i % 7 === 4) && !isSingleDayAnomaly;
    const isBuildHeavySprint = (i % 3 === 0) && !isWeekend && !isSingleDayAnomaly;

    const activities: HistoricalActivityExecution[] = [];

    // 1. Arise & Awaken (05:30)
    const awakenOnTime = !isSingleDayAnomaly;
    activities.push({
      id: `hist-awaken-${dateStr}`,
      activityId: 'task-awaken',
      activityTitle: 'Arise & Identity Reset',
      date: dateStr,
      scheduledStartMinutes: 330,
      scheduledEndMinutes: 335,
      actualStartMinutes: awakenOnTime ? 330 : 375,
      actualEndMinutes: awakenOnTime ? 335 : 380,
      plannedDuration: 5,
      actualDuration: 5,
      completed: true,
      executionStatus: awakenOnTime ? 'ON_TIME' : 'MISSED_LATE',
      fallbackTierLevel: 0,
      windowType: 'MORNING',
      routineStateAtExecution: isSingleDayAnomaly ? 'COMPRESSED' : 'STANDARD',
    });

    // 2. Morning Light (05:40)
    const lightCompleted = !isSingleDayAnomaly;
    activities.push({
      id: `hist-light-${dateStr}`,
      activityId: 'task-outside-light',
      activityTitle: 'Morning Light & Fresh Air',
      date: dateStr,
      scheduledStartMinutes: 340,
      scheduledEndMinutes: 350,
      actualStartMinutes: lightCompleted ? 340 : undefined,
      actualEndMinutes: lightCompleted ? 350 : undefined,
      plannedDuration: 10,
      actualDuration: lightCompleted ? 10 : 0,
      completed: lightCompleted,
      executionStatus: lightCompleted ? 'ON_TIME' : 'MISSED_LATE',
      fallbackTierLevel: 0,
      windowType: 'MORNING',
    });

    // 3. Whole Body Workout (05:50)
    const workoutFallback = (i % 5 === 0) && !isSingleDayAnomaly;
    activities.push({
      id: `hist-workout-${dateStr}`,
      activityId: 'task-workout-morning',
      activityTitle: 'Whole Body Movement (2 Sets)',
      date: dateStr,
      scheduledStartMinutes: 350,
      scheduledEndMinutes: 370,
      actualStartMinutes: isSingleDayAnomaly ? 400 : 350,
      actualEndMinutes: isSingleDayAnomaly ? 415 : 370,
      plannedDuration: 20,
      actualDuration: workoutFallback ? 10 : 20,
      completed: true,
      executionStatus: isSingleDayAnomaly ? 'MISSED_LATE' : 'ON_TIME',
      fallbackTierLevel: workoutFallback ? 1 : 0, // Fallback Tier 1 (1 set minimum)
      windowType: 'MORNING',
    });

    // 4. Meditation & Internal Listening (Planned at 05:40 originally, vs 06:25 post-workout)
    // RECURRING PATTERN: When meditation was scheduled before workout (days > 45), high failure rate (75%)
    // ALTERNATIVE WINDOW: When tested post-workout at 06:25, 100% on-time success!
    const isEarlyMeditationSlot = i > 30;
    const meditationFailed = isEarlyMeditationSlot ? (i % 3 !== 0) : (isSingleDayAnomaly);
    const meditationSlotMinutes = isEarlyMeditationSlot ? 350 : 385;

    activities.push({
      id: `hist-meditation-${dateStr}`,
      activityId: 'task-meditation',
      activityTitle: 'Meditation & Internal Listening',
      date: dateStr,
      scheduledStartMinutes: meditationSlotMinutes,
      scheduledEndMinutes: meditationSlotMinutes + 30,
      actualStartMinutes: meditationFailed ? undefined : meditationSlotMinutes,
      actualEndMinutes: meditationFailed ? undefined : meditationSlotMinutes + 30,
      plannedDuration: 30,
      actualDuration: meditationFailed ? 0 : 30,
      completed: !meditationFailed,
      executionStatus: meditationFailed ? 'MISSED_LATE' : 'ON_TIME',
      fallbackTierLevel: meditationFailed ? 2 : 0,
      manualAdjustmentsCount: isEarlyMeditationSlot ? 1 : 0,
      windowType: 'MORNING',
    });

    // 5. Deep Work Build Sprint (Planned 45m, but consistently overruns to 65m on build days)
    const deepWorkActualDuration = isBuildHeavySprint ? 65 : 45;
    const deepWorkOverran = deepWorkActualDuration > 45;
    activities.push({
      id: `hist-deep-work-${dateStr}`,
      activityId: 'task-deep-work-build',
      activityTitle: 'Deep Work Battlefield: Primary Build',
      date: dateStr,
      scheduledStartMinutes: 470, // 07:50 AM
      scheduledEndMinutes: 515,   // 08:35 AM
      actualStartMinutes: 470,
      actualEndMinutes: 470 + deepWorkActualDuration,
      plannedDuration: 45,
      actualDuration: deepWorkActualDuration,
      completed: true,
      executionStatus: deepWorkOverran ? 'COMPLETED_WITH_OVERRUN' : 'ON_TIME',
      fallbackTierLevel: 0,
      windowType: 'MORNING',
    });

    // 6. Operational Recovery & Buffer (Suffers when deep work overruns)
    const bufferCompressed = deepWorkOverran;
    activities.push({
      id: `hist-op-buffer-${dateStr}`,
      activityId: 'task-operational-buffer',
      activityTitle: 'Operational Recovery & Midday Buffer',
      date: dateStr,
      scheduledStartMinutes: 515,
      scheduledEndMinutes: 545,
      actualStartMinutes: bufferCompressed ? 535 : 515,
      actualEndMinutes: 545,
      plannedDuration: 30,
      actualDuration: bufferCompressed ? 10 : 30,
      completed: true,
      executionStatus: bufferCompressed ? 'DEGRADED_FALLBACK' : 'ON_TIME',
      fallbackTierLevel: bufferCompressed ? 1 : 0,
      manualAdjustmentsCount: bufferCompressed ? 1 : 0,
      windowType: 'MIDDAY',
    });

    // 7. Protected Family Block (16:00 - 19:30)
    const familyEncroached = (i % 6 === 2 || i === 5 || i === 19 || i === 42 || i === 71) && !isWeekend;
    activities.push({
      id: `hist-family-${dateStr}`,
      activityId: 'task-family-walk',
      activityTitle: 'Family Overlook Walk & Dinner',
      date: dateStr,
      scheduledStartMinutes: 960,
      scheduledEndMinutes: 1170,
      actualStartMinutes: familyEncroached ? 990 : 960,
      actualEndMinutes: 1170,
      plannedDuration: 210,
      actualDuration: familyEncroached ? 180 : 210,
      completed: true,
      executionStatus: familyEncroached ? 'ENCROACHED' : 'ON_TIME',
      conflictWithProtected: familyEncroached,
      windowType: 'EVENING',
    });

    const completedActivities = activities.filter(a => a.completed).length;
    const onTimeActivities = activities.filter(a => a.executionStatus === 'ON_TIME').length;
    const fallbackActivities = activities.filter(a => (a.fallbackTierLevel || 0) > 0).length;

    const completionRate = Math.round((completedActivities / activities.length) * 100);
    const onTimeRate = Math.round((onTimeActivities / activities.length) * 100);
    const score = isSingleDayAnomaly ? 3 : (completionRate >= 85 ? 7 : (completionRate >= 70 ? 6 : 5));

    history.push({
      date: dateStr,
      mode: isSingleDayAnomaly ? 'RED' : (isHighEnergyDay ? 'GREEN' : 'GREEN'),
      dayType: isWeekend ? 'STANDARD' : 'STANDARD',
      routineState: isSingleDayAnomaly ? 'COMPRESSED' : 'STANDARD',
      score,
      completionRate,
      onTimeRate,
      activities,
      deviationsCount: isSingleDayAnomaly ? 4 : (deepWorkOverran ? 1 : 0),
      overridesCount: isSingleDayAnomaly ? 2 : 0,
      fallbackCount: fallbackActivities,
      protectedCommitmentBreached: familyEncroached,
      notes: isSingleDayAnomaly
        ? 'Severe thunderstorm & wake disruption. Isolated anomaly; day recovery executed.'
        : undefined,
    });
  }

  return history;
}

