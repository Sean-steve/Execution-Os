import { AppState } from '../types';

export interface DomainExecutionPolicyResult {
  blocked: boolean;
  reasons: string[];
  blockingTaskIds?: string[];
  errorCode?: string;
  rule?: string;
}

export interface DomainExecutionPolicy {
  id: string;
  appliesTo(state: AppState, taskId: string): boolean;
  evaluateDependency?(state: AppState, taskId: string): DomainExecutionPolicyResult;
  evaluateStart?(state: AppState, taskId: string): DomainExecutionPolicyResult;
  evaluateCompletion?(state: AppState, taskId: string): DomainExecutionPolicyResult;
}

class DomainExecutionPolicyRegistry {
  private policies: DomainExecutionPolicy[] = [];

  register(policy: DomainExecutionPolicy) {
    if (!this.policies.some(p => p.id === policy.id)) this.policies.push(policy);
  }

  applicable(state: AppState, taskId: string) {
    return this.policies.filter(policy => policy.appliesTo(state, taskId));
  }

  evaluateDependency(state: AppState, taskId: string): DomainExecutionPolicyResult[] {
    return this.applicable(state, taskId)
      .map(policy => policy.evaluateDependency?.(state, taskId) || policy.evaluateStart?.(state, taskId))
      .filter((result): result is DomainExecutionPolicyResult => Boolean(result));
  }

  evaluateStart(state: AppState, taskId: string): DomainExecutionPolicyResult[] {
    return this.applicable(state, taskId)
      .map(policy => policy.evaluateStart?.(state, taskId))
      .filter((result): result is DomainExecutionPolicyResult => Boolean(result));
  }

  evaluateCompletion(state: AppState, taskId: string): DomainExecutionPolicyResult[] {
    return this.applicable(state, taskId)
      .map(policy => policy.evaluateCompletion?.(state, taskId))
      .filter((result): result is DomainExecutionPolicyResult => Boolean(result));
  }
}

export const domainExecutionPolicies = new DomainExecutionPolicyRegistry();
