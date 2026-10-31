import { AIMode, AppState, PerformanceSession } from '../types';

export interface PerformanceAiRequest {
  session: PerformanceSession;
  state: AppState;
  message: string;
  mode: AIMode;
}

export interface PerformanceAiResponse {
  reply: string;
  mode: AIMode;
  requiresApproval: boolean;
  proposedAction?: {
    type: 'REQUEST_EXTENSION' | 'ATTACH_ARTIFACT' | 'RECORD_NOTE' | 'NONE';
    payload?: Record<string, any>;
  };
  scopedContext: {
    sessionId: string;
    activityId: string;
    objective: string;
    currentStep?: string;
    remainingMinutes: number;
    artifactCount: number;
    evidenceCount: number;
  };
  provider: 'GEMINI' | 'DETERMINISTIC';
}

export interface PerformanceAiProvider {
  generate(input: {
    system: string;
    user: string;
    mode: AIMode;
  }): Promise<string>;
}

class GeminiPerformanceAiProvider implements PerformanceAiProvider {
  async generate(input: { system: string; user: string; mode: AIMode }): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
    const module: any = await import('@google/genai');
    const ai = new module.GoogleGenAI({ apiKey });
    const model = process.env.HEE_AI_MODEL || 'gemini-2.5-flash';
    const response = await ai.models.generateContent({
      model,
      contents: `${input.system}\n\nUSER:\n${input.user}`,
    });
    const text = typeof response?.text === 'string'
      ? response.text
      : typeof response?.text === 'function'
        ? response.text()
        : response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
    if (!text) throw new Error('AI provider returned an empty response.');
    return text.trim();
  }
}

class DeterministicPerformanceAiProvider implements PerformanceAiProvider {
  async generate(input: { system: string; user: string; mode: AIMode }): Promise<string> {
    if (input.mode === 'SILENT') return 'AI assistance is disabled for this performance environment.';
    if (input.mode === 'OBSERVER') {
      return 'I will remain observational: keep the objective visible, capture concrete progress, and close with truthful evidence.';
    }
    if (input.mode === 'COACH') {
      return `Keep the current objective singular. For "${input.user}", identify the smallest concrete next action, execute it, then capture the result before changing context.`;
    }
    if (input.mode === 'COPILOT') {
      return `I can help structure "${input.user}" within this session. Break it into one immediate deliverable, one verification step, and one artifact or note that proves progress.`;
    }
    return 'I can propose bounded digital actions, but any schedule, governance, protected-commitment, or external side effect requires explicit approval.';
  }
}

export class PerformanceAiPartner {
  constructor(
    private readonly provider: PerformanceAiProvider | null = null
  ) {}

  private buildScopedContext(session: PerformanceSession) {
    const current = session.stepExecutions[session.currentStepIndex];
    const elapsedMinutes = Math.floor(session.activeDurationSeconds / 60);
    return {
      sessionId: session.id,
      activityId: session.activityInstanceId,
      objective: session.objective,
      currentStep: current?.title,
      remainingMinutes: Math.max(0, session.targetDurationMinutes - elapsedMinutes),
      artifactCount: session.artifacts.length,
      evidenceCount: session.evidence.filter(e => e.isValid).length,
    };
  }

  async respond(request: PerformanceAiRequest): Promise<PerformanceAiResponse> {
    const { session, message, mode } = request;
    const scopedContext = this.buildScopedContext(session);

    if (session.environmentConfig.aiMode === 'SILENT' || mode === 'SILENT') {
      return {
        reply: 'AI assistance is disabled for this performance environment.',
        mode: 'SILENT',
        requiresApproval: false,
        proposedAction: { type: 'NONE' },
        scopedContext,
        provider: 'DETERMINISTIC',
      };
    }

    const allowedMode: AIMode =
      session.environmentType === 'EXTERNAL' || session.environmentType === 'PHYSICAL'
        ? 'OBSERVER'
        : mode;

    const system = [
      'You are the HEE-011 Execution Partner inside an active Execution OS PerformanceSession.',
      'Use only the scoped session context below. Do not infer unrelated personal context.',
      `Objective: ${session.objective}`,
      `Environment: ${session.environmentType}`,
      `Mode: ${allowedMode}`,
      `Current step: ${scopedContext.currentStep || 'none'}`,
      `Remaining minutes: ${scopedContext.remainingMinutes}`,
      `Artifacts: ${scopedContext.artifactCount}; Evidence: ${scopedContext.evidenceCount}`,
      'Never claim authority to alter governance, protected commitments, trading rules, or schedule.',
      'If more time or another consequential change is needed, recommend that the user request it through HEE.',
      'Be concise and execution-focused.',
    ].join('\n');

    let provider: PerformanceAiProvider;
    let providerName: 'GEMINI' | 'DETERMINISTIC';
    if (this.provider) {
      provider = this.provider;
      providerName = 'DETERMINISTIC';
    } else if (process.env.GEMINI_API_KEY) {
      provider = new GeminiPerformanceAiProvider();
      providerName = 'GEMINI';
    } else {
      provider = new DeterministicPerformanceAiProvider();
      providerName = 'DETERMINISTIC';
    }

    let reply: string;
    try {
      reply = await provider.generate({ system, user: message.trim(), mode: allowedMode });
    } catch {
      provider = new DeterministicPerformanceAiProvider();
      providerName = 'DETERMINISTIC';
      reply = await provider.generate({ system, user: message.trim(), mode: allowedMode });
    }

    const asksForTime = /more time|extend|extension|another \d+\s*(min|minute)/i.test(message);
    return {
      reply,
      mode: allowedMode,
      requiresApproval: asksForTime || allowedMode === 'EXECUTOR',
      proposedAction: asksForTime
        ? { type: 'REQUEST_EXTENSION', payload: { reason: message.trim() } }
        : { type: 'NONE' },
      scopedContext,
      provider: providerName,
    };
  }
}

export const performanceAiPartner = new PerformanceAiPartner();
