import { AppState } from '../types';

export interface IClock {
  now(): Date;
  getCurrentTimeMinutes(): number;
  toISOString(): string;
  getTimeString(): string; // "HH:MM" in 24-hour format
  formatTime12Hour(): string; // "H:MM AM/PM"
}

/**
 * ProductionClock: reads actual wall-clock time
 */
export class ProductionClock implements IClock {
  now(): Date {
    return new Date();
  }

  getCurrentTimeMinutes(): number {
    const d = this.now();
    return d.getHours() * 60 + d.getMinutes();
  }

  toISOString(): string {
    return this.now().toISOString();
  }

  getTimeString(): string {
    const d = this.now();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  formatTime12Hour(): string {
    return formatMinutesTo12Hour(this.getCurrentTimeMinutes());
  }
}

/**
 * SimulationClock: deterministic clock based on simulated state or explicit offset
 */
export class SimulationClock implements IClock {
  private simulatedMinutes: number;

  constructor(timeOrMinutes: string | number = '06:30') {
    if (typeof timeOrMinutes === 'number') {
      this.simulatedMinutes = ((timeOrMinutes % 1440) + 1440) % 1440;
    } else {
      this.simulatedMinutes = parseTimeToMinutes(timeOrMinutes);
    }
  }

  setTime(timeOrMinutes: string | number): void {
    if (typeof timeOrMinutes === 'number') {
      this.simulatedMinutes = ((timeOrMinutes % 1440) + 1440) % 1440;
    } else {
      this.simulatedMinutes = parseTimeToMinutes(timeOrMinutes);
    }
  }

  advanceMinutes(minutes: number): void {
    this.simulatedMinutes = ((this.simulatedMinutes + minutes) % 1440 + 1440) % 1440;
  }

  now(): Date {
    const d = new Date();
    const hours = Math.floor(this.simulatedMinutes / 60);
    const mins = this.simulatedMinutes % 60;
    d.setHours(hours, mins, 0, 0);
    return d;
  }

  getCurrentTimeMinutes(): number {
    return this.simulatedMinutes;
  }

  toISOString(): string {
    return this.now().toISOString();
  }

  getTimeString(): string {
    const h = String(Math.floor(this.simulatedMinutes / 60)).padStart(2, '0');
    const m = String(this.simulatedMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  formatTime12Hour(): string {
    return formatMinutesTo12Hour(this.simulatedMinutes);
  }
}

/**
 * TestClock: fully controllable deterministic clock for test fixtures and assertions
 */
export class TestClock implements IClock {
  private currentMinutes: number;
  private customDate: Date;

  constructor(initialTime: string | number | Date = '05:30') {
    if (initialTime instanceof Date) {
      this.customDate = new Date(initialTime);
      this.currentMinutes = initialTime.getHours() * 60 + initialTime.getMinutes();
    } else if (typeof initialTime === 'number') {
      this.currentMinutes = ((initialTime % 1440) + 1440) % 1440;
      this.customDate = new Date(2026, 7, 22, Math.floor(this.currentMinutes / 60), this.currentMinutes % 60, 0);
    } else {
      this.currentMinutes = parseTimeToMinutes(initialTime);
      this.customDate = new Date(2026, 7, 22, Math.floor(this.currentMinutes / 60), this.currentMinutes % 60, 0);
    }
  }

  setTime(time: string | number | Date): this {
    if (time instanceof Date) {
      this.customDate = new Date(time);
      this.currentMinutes = time.getHours() * 60 + time.getMinutes();
    } else if (typeof time === 'number') {
      this.currentMinutes = ((time % 1440) + 1440) % 1440;
      this.customDate = new Date(2026, 7, 22, Math.floor(this.currentMinutes / 60), this.currentMinutes % 60, 0);
    } else {
      this.currentMinutes = parseTimeToMinutes(time);
      this.customDate = new Date(2026, 7, 22, Math.floor(this.currentMinutes / 60), this.currentMinutes % 60, 0);
    }
    return this;
  }

  advanceMinutes(mins: number): this {
    this.currentMinutes = ((this.currentMinutes + mins) % 1440 + 1440) % 1440;
    this.customDate = new Date(this.customDate.getTime() + mins * 60 * 1000);
    return this;
  }

  now(): Date {
    return new Date(this.customDate);
  }

  getCurrentTimeMinutes(): number {
    return this.currentMinutes;
  }

  toISOString(): string {
    return this.customDate.toISOString();
  }

  getTimeString(): string {
    const h = String(Math.floor(this.currentMinutes / 60)).padStart(2, '0');
    const m = String(this.currentMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  formatTime12Hour(): string {
    return formatMinutesTo12Hour(this.currentMinutes);
  }
}

/**
 * Clock provider utility: extracts or creates clock from state
 */
export const defaultClock: IClock = new ProductionClock();

export function getClockForState(state?: Partial<AppState> | null, overrideClock?: IClock): IClock {
  if (overrideClock) return overrideClock;
  if (state?.isSimulatedTime && state?.simulatedTime) {
    return new SimulationClock(state.simulatedTime);
  }
  return defaultClock;
}

/**
 * Helper to parse "HH:MM" into minutes from midnight (0..1439)
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.trim().split(':');
  const hours = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return ((hours * 60 + mins) % 1440 + 1440) % 1440;
}

/**
 * Helper to format minutes from midnight into 12-hour AM/PM string
 */
export function formatMinutesTo12Hour(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  const displayMins = mins < 10 ? `0${mins}` : mins;
  return `${displayHours}:${displayMins} ${period}`;
}
