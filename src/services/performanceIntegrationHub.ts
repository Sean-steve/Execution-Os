import { AppState, EvidenceLevel, PerformanceSession } from '../types';

export interface IntegrationEvidenceInput {
  adapterId: string;
  payload: Record<string, any>;
}

export interface IntegrationEvidenceResult {
  valid: boolean;
  evidenceType: string;
  trustLevel: EvidenceLevel;
  normalizedPayload: Record<string, any>;
  reason: string;
}

export interface PerformanceEvidenceAdapter {
  id: string;
  name: string;
  trustLevel: EvidenceLevel;
  canRead: boolean;
  canWrite: boolean;
  validate(session: PerformanceSession, state: AppState, payload: Record<string, any>): IntegrationEvidenceResult;
}

const manualArtifactAdapter: PerformanceEvidenceAdapter = {
  id: 'manual-artifact',
  name: 'Manual Artifact Evidence',
  trustLevel: 'E2',
  canRead: true,
  canWrite: false,
  validate(session, _state, payload) {
    const title = String(payload.title || '').trim();
    const ref = String(payload.uriOrRef || payload.reference || '').trim();
    const valid = Boolean(title && (ref || payload.contentSnippet));
    return {
      valid,
      evidenceType: 'ARTIFACT_REFERENCE',
      trustLevel: 'E2',
      normalizedPayload: { title, uriOrRef: ref || undefined, contentSnippet: payload.contentSnippet },
      reason: valid ? 'Artifact metadata is sufficient for application-level evidence.' : 'Artifact title and reference/content are required.',
    };
  },
};

const gitCommitAdapter: PerformanceEvidenceAdapter = {
  id: 'git-commit',
  name: 'Git Commit Evidence',
  trustLevel: 'E2',
  canRead: true,
  canWrite: false,
  validate(session, _state, payload) {
    const sha = String(payload.sha || '').trim();
    const repository = String(payload.repository || '').trim();
    const validSha = /^[a-f0-9]{7,40}$/i.test(sha);
    const valid = validSha && repository.includes('/');
    return {
      valid,
      evidenceType: 'COMMIT_HASH',
      trustLevel: 'E2',
      normalizedPayload: { sha, repository, sessionObjective: session.objective },
      reason: valid ? 'Commit reference is structurally valid application evidence.' : 'A repository owner/name and 7–40 character commit SHA are required.',
    };
  },
};

const tradingAdapter: PerformanceEvidenceAdapter = {
  id: 'trading-gate',
  name: 'Trading Gate Evidence',
  trustLevel: 'E2',
  canRead: true,
  canWrite: false,
  validate(_session, state) {
    const p = state.tradingProtocol;
    const disciplinedNoTrade = p.marketAnalyzed && p.closedTerminal && p.noSetupJustified && !p.executed;
    const validTrade = p.marketAnalyzed && p.setupDetected && p.strategyCriteriaMet && p.riskLimitsSatisfied && p.stopLossDefined && p.closedTerminal;
    const valid = disciplinedNoTrade || validTrade;
    return {
      valid,
      evidenceType: 'TRADE_GATE_RECORD',
      trustLevel: 'E2',
      normalizedPayload: {
        marketAnalyzed: p.marketAnalyzed,
        setupDetected: p.setupDetected,
        noSetupJustified: p.noSetupJustified,
        executed: p.executed,
        closedTerminal: p.closedTerminal,
      },
      reason: valid ? 'Trading protocol reached a governed terminal outcome.' : 'Trading protocol has not reached a valid terminal outcome.',
    };
  },
};

export class PerformanceIntegrationHub {
  private adapters = new Map<string, PerformanceEvidenceAdapter>();

  constructor(adapters: PerformanceEvidenceAdapter[] = [manualArtifactAdapter, gitCommitAdapter, tradingAdapter]) {
    adapters.forEach(adapter => this.adapters.set(adapter.id, adapter));
  }

  listAdapters() {
    return [...this.adapters.values()].map(({ id, name, trustLevel, canRead, canWrite }) => ({
      id, name, trustLevel, canRead, canWrite,
    }));
  }

  collectEvidence(
    session: PerformanceSession,
    state: AppState,
    input: IntegrationEvidenceInput
  ): IntegrationEvidenceResult {
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter) {
      return {
        valid: false,
        evidenceType: 'UNKNOWN',
        trustLevel: 'E0',
        normalizedPayload: {},
        reason: `Unknown performance evidence adapter: ${input.adapterId}`,
      };
    }
    return adapter.validate(session, state, input.payload || {});
  }
}

export const performanceIntegrationHub = new PerformanceIntegrationHub();
