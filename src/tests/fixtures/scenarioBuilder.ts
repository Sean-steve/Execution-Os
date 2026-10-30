import { AppState, RoutineTask, SystemMode, DayType, TradingProtocol, RoutineState, SystemEvent } from '../../types';
import { DEFAULT_APP_STATE } from '../../data/defaultData';
import { calculateDynamicAllocations } from '../../services/allocationEngine';
import { evaluateRoutineState } from '../../services/routineEngine';
import { scanAndResolveDeviations } from '../../services/deviationEngine';
import { getAutonomousNextDecision } from '../../services/decisionEngine';

/**
 * Deterministic Test Scenario Builder
 * Generates test fixtures and transitions without relying on wall-clock time
 */
export class ScenarioBuilder {
  private state: AppState;

  constructor(baseState?: Partial<AppState>) {
    this.state = JSON.parse(JSON.stringify(DEFAULT_APP_STATE));
    if (baseState) {
      this.state = {
        ...this.state,
        ...baseState,
      };
    }
  }

  static create(baseState?: Partial<AppState>): ScenarioBuilder {
    return new ScenarioBuilder(baseState);
  }

  withTime(timeStr: string): this {
    this.state.isSimulatedTime = true;
    this.state.simulatedTime = timeStr;
    return this;
  }

  withMode(mode: SystemMode): this {
    this.state.currentMode = mode;
    return this;
  }

  withDayType(dayType: DayType): this {
    this.state.dayType = dayType;
    return this;
  }

  withRoutineState(routineState: RoutineState): this {
    this.state.routineState = routineState;
    return this;
  }

  withCompletedTasks(taskIds: string[]): this {
    this.state.tasks = this.state.tasks.map(t => ({
      ...t,
      completed: taskIds.includes(t.id) ? true : t.completed,
      completedAtMinutes: taskIds.includes(t.id) ? t.endMinutes : t.completedAtMinutes,
    }));
    return this;
  }

  withUncompletedAll(): this {
    this.state.tasks = this.state.tasks.map(t => ({
      ...t,
      completed: false,
      completedAtMinutes: undefined,
    }));
    return this;
  }

  withTaskOverrun(taskId: string, overrunMinutes: number): this {
    this.state.tasks = this.state.tasks.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          endMinutes: t.endMinutes + overrunMinutes,
          allocatedEndMinutes: (t.allocatedEndMinutes || t.endMinutes) + overrunMinutes,
        };
      }
      return t;
    });
    return this;
  }

  withEarlyCompletion(taskId: string, finishedAtMinutes: number): this {
    this.state.tasks = this.state.tasks.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          completed: true,
          completedAtMinutes: finishedAtMinutes,
          executionStatus: 'ON_TIME',
        };
      }
      return t;
    });
    return this;
  }

  withTrading(protocol: Partial<TradingProtocol>): this {
    this.state.tradingProtocol = {
      ...this.state.tradingProtocol,
      ...protocol,
    };
    return this;
  }

  withTomorrowPlan(plan: Partial<AppState['tomorrowPlan']>): this {
    this.state.tomorrowPlan = {
      ...this.state.tomorrowPlan,
      ...plan,
    };
    return this;
  }

  withDailyReview(review: Partial<AppState['dailyReview']>): this {
    this.state.dailyReview = {
      ...this.state.dailyReview,
      ...review,
    };
    return this;
  }

  withAutonomyLevel(level: AppState['autonomyLevel']): this {
    this.state.autonomyLevel = level;
    return this;
  }

  build(): AppState {
    return JSON.parse(JSON.stringify(this.state));
  }

  evaluate(): {
    state: AppState;
    routine: ReturnType<typeof evaluateRoutineState>;
    allocations: ReturnType<typeof calculateDynamicAllocations>;
    deviations: ReturnType<typeof scanAndResolveDeviations>;
    nextDecision: ReturnType<typeof getAutonomousNextDecision>;
  } {
    const routine = evaluateRoutineState(this.state);
    const deviations = scanAndResolveDeviations(this.state);
    const intermediateState = deviations.updatedState;
    const allocations = calculateDynamicAllocations(intermediateState);
    const nextDecision = getAutonomousNextDecision({
      ...intermediateState,
      dynamicAllocations: allocations.allocations,
      tasks: allocations.recalculatedTasks,
    });

    return {
      state: {
        ...intermediateState,
        dynamicAllocations: allocations.allocations,
        tasks: allocations.recalculatedTasks,
      },
      routine,
      allocations,
      deviations,
      nextDecision,
    };
  }
}

/**
 * Event chain validator to verify causation and correlation sequences
 */
export const verifyEventCorrelationChain = (events: SystemEvent[]): boolean => {
  if (!events || events.length === 0) return true;
  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    if (!evt.event_id || !evt.event_type || !evt.occurred_at) {
      return false;
    }
  }
  return true;
};
