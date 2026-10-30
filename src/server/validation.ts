/**
 * Server-Side Request & Event Schema Validation Engine (EOS-007)
 * Strictly verifies schema structure, valid types, ranges, strings, and disallows malformed attacks.
 */

import { Request, Response, NextFunction } from 'express';
import { ValidationError } from './errors';

export class SchemaValidator {
  /**
   * Validates that required non-empty string fields exist in req.body
   */
  static requireBodyFields(fields: string[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return next(new ValidationError('Request body must be a valid JSON object'));
      }

      for (const field of fields) {
        const val = body[field];
        if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
          return next(new ValidationError(`Missing or empty required field: "${field}"`, { field }));
        }
      }
      next();
    };
  }

  /**
   * Validates System Mode value
   */
  static validateSystemMode(mode: any): boolean {
    return ['GREEN', 'YELLOW', 'RED'].includes(mode);
  }

  /**
   * Validates Day Type value
   */
  static validateDayType(dayType: any): boolean {
    return ['STANDARD', 'EARLY_DEPARTURE', 'STRONG_ENDS'].includes(dayType);
  }

  /**
   * Validates Autonomy Level value (0 to 5)
   */
  static validateAutonomyLevel(level: any): boolean {
    return typeof level === 'number' && Number.isInteger(level) && level >= 0 && level <= 5;
  }

  /**
   * Validates simulated time string (HH:MM or H:MM)
   */
  static validateTimeString(timeStr: any): boolean {
    if (typeof timeStr !== 'string') return false;
    const match = timeStr.trim().match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/);
    return !!match;
  }

  /**
   * Validates SystemEvent structure for event ingestion / audit
   */
  static validateSystemEvent(event: any): { valid: boolean; error?: string } {
    if (!event || typeof event !== 'object') {
      return { valid: false, error: 'Event must be a valid non-null object' };
    }
    if (!event.id || typeof event.id !== 'string') {
      return { valid: false, error: 'Event missing valid "id" string' };
    }
    if (!event.type || typeof event.type !== 'string') {
      return { valid: false, error: 'Event missing valid "type" string' };
    }
    if (!event.timestamp || typeof event.timestamp !== 'string') {
      return { valid: false, error: 'Event missing valid "timestamp" ISO string' };
    }
    if (!event.source || !['USER', 'AUTONOMOUS_SYSTEM', 'GATEKEEPER', 'SYNC_RECONCILER'].includes(event.source)) {
      return { valid: false, error: `Invalid event source: "${event.source}"` };
    }
    if (event.payload === undefined) {
      return { valid: false, error: 'Event missing payload' };
    }
    return { valid: true };
  }

  /**
   * Validates TomorrowPlan payload structure
   */
  /**
   * Validates TomorrowPlan payload structure
   */
  static validateTomorrowPlan(plan: any): { valid: boolean; error?: string } {
    if (!plan || typeof plan !== 'object') {
      return { valid: false, error: 'Tomorrow plan must be an object' };
    }
    if (plan.wakeTime && !this.validateTimeString(plan.wakeTime)) {
      return { valid: false, error: `Invalid wakeTime format: "${plan.wakeTime}". Expected HH:MM.` };
    }
    if (plan.desiredWakeTime && !this.validateTimeString(plan.desiredWakeTime)) {
      return { valid: false, error: `Invalid desiredWakeTime format: "${plan.desiredWakeTime}". Expected HH:MM.` };
    }
    if (plan.targetMode && !this.validateSystemMode(plan.targetMode)) {
      return { valid: false, error: `Invalid targetMode in tomorrow plan: "${plan.targetMode}".` };
    }
    return { valid: true };
  }

  /**
   * Validates full AppState structure
   */
  static validateAppState(state: any): { isValid: boolean; errors: { path: string; message: string }[] } {
    const errors: { path: string; message: string }[] = [];
    if (!state || typeof state !== 'object') {
      return { isValid: false, errors: [{ path: 'root', message: 'AppState must be an object' }] };
    }
    if (!Array.isArray(state.tasks)) {
      errors.push({ path: 'tasks', message: 'AppState.tasks must be an array' });
    }
    if (state.currentMode && !this.validateSystemMode(state.currentMode)) {
      errors.push({ path: 'currentMode', message: `Invalid currentMode: "${state.currentMode}"` });
    }
    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

