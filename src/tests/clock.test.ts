import { describe, it, expect } from 'vitest';
import { ProductionClock, SimulationClock, TestClock, getClockForState, parseTimeToMinutes, formatMinutesTo12Hour } from '../clock';
import { DEFAULT_APP_STATE } from '../data/defaultData';

describe('HEE Clock Abstraction & Decoupling', () => {
  it('ProductionClock returns valid system time and minutes', () => {
    const clock = new ProductionClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    const mins = clock.getCurrentTimeMinutes();
    expect(mins).toBeGreaterThanOrEqual(0);
    expect(mins).toBeLessThan(1440);
    expect(clock.toISOString()).toBeDefined();
    expect(clock.getTimeString()).toMatch(/^\d{2}:\d{2}$/);
    expect(clock.formatTime12Hour()).toMatch(/AM|PM/);
  });

  it('SimulationClock correctly reflects and advances simulated time', () => {
    const clock = new SimulationClock('06:30');
    expect(clock.getCurrentTimeMinutes()).toBe(390); // 6 * 60 + 30
    expect(clock.getTimeString()).toBe('06:30');
    expect(clock.formatTime12Hour()).toBe('6:30 AM');

    clock.advanceMinutes(45);
    expect(clock.getCurrentTimeMinutes()).toBe(435);
    expect(clock.getTimeString()).toBe('07:15');
    expect(clock.formatTime12Hour()).toBe('7:15 AM');

    clock.setTime('20:00');
    expect(clock.getCurrentTimeMinutes()).toBe(1200);
    expect(clock.getTimeString()).toBe('20:00');
    expect(clock.formatTime12Hour()).toBe('8:00 PM');
  });

  it('TestClock provides fully deterministic and settable time control', () => {
    const clock = new TestClock('05:30');
    expect(clock.getCurrentTimeMinutes()).toBe(330);
    expect(clock.getTimeString()).toBe('05:30');

    clock.advanceMinutes(70);
    expect(clock.getCurrentTimeMinutes()).toBe(400); // 06:40
    expect(clock.getTimeString()).toBe('06:40');

    clock.setTime('16:00');
    expect(clock.getCurrentTimeMinutes()).toBe(960);
    expect(clock.formatTime12Hour()).toBe('4:00 PM');
  });

  it('getClockForState returns SimulationClock when isSimulatedTime is true', () => {
    const simState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: true,
      simulatedTime: '14:30',
    };
    const clock = getClockForState(simState);
    expect(clock.getCurrentTimeMinutes()).toBe(870); // 14 * 60 + 30
    expect(clock.getTimeString()).toBe('14:30');
  });

  it('getClockForState returns ProductionClock when isSimulatedTime is false', () => {
    const prodState = {
      ...DEFAULT_APP_STATE,
      isSimulatedTime: false,
    };
    const clock = getClockForState(prodState);
    expect(clock instanceof ProductionClock).toBe(true);
  });

  it('parseTimeToMinutes and formatMinutesTo12Hour correctly convert across 24-hour cycle', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('05:30')).toBe(330);
    expect(parseTimeToMinutes('12:00')).toBe(720);
    expect(parseTimeToMinutes('23:59')).toBe(1439);

    expect(formatMinutesTo12Hour(0)).toBe('12:00 AM');
    expect(formatMinutesTo12Hour(330)).toBe('5:30 AM');
    expect(formatMinutesTo12Hour(720)).toBe('12:00 PM');
    expect(formatMinutesTo12Hour(960)).toBe('4:00 PM');
    expect(formatMinutesTo12Hour(1200)).toBe('8:00 PM');
  });
});
