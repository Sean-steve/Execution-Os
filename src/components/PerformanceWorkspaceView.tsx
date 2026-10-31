import React, { useState, useEffect } from 'react';
import {
  AppState,
  PerformanceSession,
  PerformanceStepExecution,
  PerformanceProtocol,
  ExecutionEnvironmentType,
  AIMode,
  RoutineTask
} from '../types';
import {
  Play,
  Pause,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Flame,
  Shield,
  Bot,
  FileText,
  Plus,
  ChevronRight,
  ExternalLink,
  Lock,
  ArrowRight,
  XCircle,
  HelpCircle,
  Sparkles,
  Zap,
  Coffee,
  CheckSquare
} from 'lucide-react';
import { CANONICAL_PERFORMANCE_PROTOCOLS } from '../data/performanceProtocols';
import { defaultApiClient } from '../services/apiClient';

interface PerformanceWorkspaceViewProps {
  state: AppState;
  onPrepareSession: (sessionId: string) => void;
  onReadySession: (sessionId: string) => void;
  onStartSession: (sessionId: string) => void;
  onPauseSession: (sessionId: string) => void;
  onResumeSession: (sessionId: string) => void;
  onAdvanceStep: (sessionId: string, stepIndex: number, payload?: { quantity?: number; branchSelectedId?: string; notes?: string }) => void;
  onAttachArtifact: (sessionId: string, artifact: { artifactType: 'NOTE' | 'CODE_COMMIT' | 'DOCUMENT' | 'TRADE_RECORD' | 'PLAN' | 'METRIC'; title: string; uriOrRef?: string; contentSnippet?: string }) => void;
  onRecordEvidence: (sessionId: string, evidence: { type: string; payload: Record<string, any> }) => void;
  onRequestExtension: (sessionId: string, requestedMinutes: number, reason: string) => void;
  onCloseSession: (sessionId: string, outcome: 'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED', quality?: any, reason?: string) => void;
  onCancelSession: (sessionId: string, reason: string) => void;
  onNavigateToNow: () => void;
}

export const PerformanceWorkspaceView: React.FC<PerformanceWorkspaceViewProps> = ({
  state,
  onPrepareSession,
  onReadySession,
  onStartSession,
  onPauseSession,
  onResumeSession,
  onAdvanceStep,
  onAttachArtifact,
  onRecordEvidence,
  onRequestExtension,
  onCloseSession,
  onCancelSession,
  onNavigateToNow
}) => {
  const activeSessionId = state.activePerformanceSessionId;
  const sessions = state.performanceSessions || [];
  const currentSession = sessions.find(s => s.id === activeSessionId) || sessions[sessions.length - 1];

  const [activeTask, setActiveTask] = useState<RoutineTask | undefined>(undefined);
  const [protocol, setProtocol] = useState<PerformanceProtocol | undefined>(undefined);

  // Local UI states
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showExtensionModal, setShowExtensionModal] = useState(false);
  const [showArtifactModal, setShowArtifactModal] = useState(false);
  const [showBlockerModal, setShowBlockerModal] = useState(false);

  // Form states
  const [extensionMinutes, setExtensionMinutes] = useState(15);
  const [extensionReason, setExtensionReason] = useState('Need more time to finalize deliverables');
  const [artifactTitle, setArtifactTitle] = useState('');
  const [artifactSnippet, setArtifactSnippet] = useState('');
  const [artifactType, setArtifactType] = useState<'NOTE' | 'CODE_COMMIT' | 'DOCUMENT' | 'TRADE_RECORD'>('NOTE');
  const [blockerReason, setBlockerReason] = useState('');

  // Close modal states
  const [selectedOutcome, setSelectedOutcome] = useState<'COMPLETED' | 'PARTIAL' | 'BLOCKED' | 'ABANDONED'>('COMPLETED');
  const [focusDepth, setFocusDepth] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [reflectionText, setReflectionText] = useState('');

  // Ritual checklist tracking for PREPARING state
  const [completedRituals, setCompletedRituals] = useState<Record<string, boolean>>({});

  // Session-scoped HEE-011 AI execution partner
  const [aiMode, setAiMode] = useState<AIMode>(currentSession?.environmentConfig.aiMode || 'COACH');
  const [aiChatInput, setAiChatInput] = useState('');
  const [aiChatMessages, setAiChatMessages] = useState<Array<{ sender: 'AI' | 'USER'; text: string; time: string }>>([
    {
      sender: 'AI',
      text: `Performance environment initialized. I am your execution partner in ${currentSession?.environmentType || 'ASSISTED'} mode. What is the immediate first sub-task?`,
      time: 'Now'
    }
  ]);

  useEffect(() => {
    if (currentSession) {
      const task = state.tasks.find(t => t.id === currentSession.activityInstanceId);
      setActiveTask(task);

      const proto = CANONICAL_PERFORMANCE_PROTOCOLS.find(p => p.id === currentSession.protocolId);
      setProtocol(proto);
      setAiMode(currentSession.environmentConfig.aiMode);
    }
  }, [currentSession, state.tasks]);

  // Authoritative live timer ticking
  useEffect(() => {
    if (!currentSession) return;

    const interval = setInterval(() => {
      if (currentSession.status === 'ACTIVE' && currentSession.resumedAtUtc) {
        const resumeTime = new Date(currentSession.resumedAtUtc).getTime();
        const now = Date.now();
        const delta = Math.max(0, Math.floor((now - resumeTime) / 1000));
        setElapsedSeconds(currentSession.activeDurationSeconds + delta);
      } else {
        setElapsedSeconds(currentSession.activeDurationSeconds);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentSession]);

  if (!currentSession) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 shadow-xl">
          <Shield className="w-12 h-12 text-indigo-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-100 mb-2">No Active Performance Session</h2>
          <p className="text-slate-400 text-sm mb-6 max-w-md mx-auto">
            The Human Performance Engine activates when you launch an execution session from the NOW view or Timeline.
          </p>
          <button
            onClick={onNavigateToNow}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition shadow-lg shadow-indigo-600/20"
          >
            Return to NOW Command
          </button>
        </div>
      </div>
    );
  }

  const formatTimer = (totalSecs: number) => {
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const targetSecs = (currentSession.targetDurationMinutes || 30) * 60;
  const progressPercent = Math.min(100, Math.round((elapsedSeconds / Math.max(1, targetSecs)) * 100));

  const handleSendAiMessage = async () => {
    if (!aiChatInput.trim() || !currentSession) return;
    const userMsg = aiChatInput.trim();
    setAiChatMessages(prev => [
      ...prev,
      { sender: 'USER', text: userMsg, time: 'Just now' }
    ]);
    setAiChatInput('');

    try {
      const response = await defaultApiClient.sendPerformanceAiMessage(currentSession.id, userMsg, aiMode);
      const data = response.data;
      setAiChatMessages(prev => [
        ...prev,
        {
          sender: 'AI',
          text: data.requiresApproval && data.proposedAction?.type !== 'NONE'
            ? `${data.reply}\n\nA governed HEE action is required before that change can take effect.`
            : data.reply,
          time: 'Just now'
        }
      ]);
    } catch (error: any) {
      setAiChatMessages(prev => [
        ...prev,
        {
          sender: 'AI',
          text: `Execution Partner unavailable: ${error?.message || 'Could not reach the scoped AI service.'}`,
          time: 'Just now'
        }
      ]);
    }
  };

  const handleToggleRitual = (ritualText: string) => {
    setCompletedRituals(prev => {
      const next = { ...prev, [ritualText]: !prev[ritualText] };
      const rituals = protocol?.preparationRituals || [];
      const allDone = rituals.length > 0 && rituals.every(r => next[r]);
      if (allDone && currentSession.status === 'PREPARING') {
        onReadySession(currentSession.id);
      }
      return next;
    });
  };

  const isExternalPresence = currentSession.environmentType === 'EXTERNAL';

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* 1. TOP HEADER & TELEMETRY */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className={`px-2.5 py-1 text-xs font-semibold rounded-full uppercase tracking-wider ${
                currentSession.status === 'ACTIVE'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : currentSession.status === 'PAUSED'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : currentSession.status === 'PREPARING'
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                {currentSession.status}
              </span>
              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                ENV: {currentSession.environmentType}
              </span>
              {protocol && (
                <span className="px-2.5 py-1 text-xs text-indigo-300 bg-indigo-950/60 border border-indigo-800/40 rounded-full">
                  {protocol.name}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              {currentSession.title}
            </h1>
            <p className="text-slate-400 text-sm max-w-2xl">
              {currentSession.objective}
            </p>
          </div>

          {/* AUTHORITATIVE SESSION TIMER */}
          <div className="flex items-center gap-6 bg-slate-950/70 border border-slate-800/80 rounded-2xl px-6 py-4">
            <div>
              <div className="text-xs uppercase font-medium tracking-wider text-slate-400">Active Duration</div>
              <div className="text-3xl sm:text-4xl font-mono font-bold text-indigo-400 tracking-tight">
                {formatTimer(elapsedSeconds)}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                Target: {currentSession.targetDurationMinutes}m | Min: {currentSession.minimumDurationMinutes}m
              </div>
            </div>

            {/* QUICK ACTIONS */}
            <div className="flex items-center gap-2">
              {currentSession.status === 'CREATED' && (
                <button
                  onClick={() => onPrepareSession(currentSession.id)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition flex items-center gap-2 shadow-lg shadow-indigo-600/20"
                >
                  <Sparkles className="w-4 h-4" /> Prepare Ritual
                </button>
              )}

              {(currentSession.status === 'PREPARING' || currentSession.status === 'READY_TO_START') && (
                <button
                  onClick={() => onStartSession(currentSession.id)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Play className="w-4 h-4 fill-current" /> Start Execution
                </button>
              )}

              {currentSession.status === 'ACTIVE' && (
                <button
                  onClick={() => onPauseSession(currentSession.id)}
                  className="px-4 py-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/40 rounded-xl text-sm font-medium transition flex items-center gap-2"
                >
                  <Pause className="w-4 h-4" /> Pause
                </button>
              )}

              {currentSession.status === 'PAUSED' && (
                <button
                  onClick={() => onResumeSession(currentSession.id)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-medium transition flex items-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Play className="w-4 h-4 fill-current" /> Resume
                </button>
              )}

              {currentSession.status === 'ACTIVE' && (
                <button
                  onClick={() => setShowCloseModal(true)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-sm font-medium transition flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Close
                </button>
              )}
            </div>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div className="mt-4 pt-2">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5 font-mono">
            <span>Progress: {progressPercent}%</span>
            <span>Allocated Window: {currentSession.effectiveAllocationStartMinutes}m – {currentSession.effectiveAllocationEndMinutes}m</span>
          </div>
          <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                progressPercent >= 100 ? 'bg-emerald-500' : 'bg-indigo-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* 2. SPECIAL SCREEN-AWAY / EXTERNAL BANNER */}
      {isExternalPresence && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-2xl p-6 text-amber-200 flex items-start gap-4 shadow-lg">
          <Shield className="w-6 h-6 text-amber-400 shrink-0 mt-1" />
          <div className="space-y-1">
            <h3 className="font-semibold text-amber-100">Protected External Presence Mode</h3>
            <p className="text-xs text-amber-300/80 leading-relaxed">
              This block is protected for family presence, offline focus, or physical engagement.
              All digital notifications and AI prompts are silenced. Be fully present in your life.
            </p>
            <div className="pt-2">
              <button
                onClick={() => setShowCloseModal(true)}
                className="px-3.5 py-1.5 bg-amber-600/30 hover:bg-amber-600/40 border border-amber-500/40 text-amber-100 text-xs font-semibold rounded-lg transition"
              >
                I'm Back / Record Presence Return
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. MAIN WORKSPACE GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT/CENTER: PROTOCOL & EXECUTION STEPS */}
        <div className="lg:col-span-2 space-y-6">
          {/* PREPARATION RITUALS (if PREPARING or READY) */}
          {(currentSession.status === 'PREPARING' || currentSession.status === 'READY_TO_START') && protocol?.preparationRituals && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                  <CheckSquare className="w-5 h-5 text-indigo-400" /> Preparation Rituals
                </h3>
                <span className="text-xs text-slate-400">Complete all rituals to unlock focus</span>
              </div>
              <div className="space-y-2.5">
                {protocol.preparationRituals.map((ritual, idx) => {
                  const isDone = !!completedRituals[ritual];
                  return (
                    <div
                      key={idx}
                      onClick={() => handleToggleRitual(ritual)}
                      className={`p-3.5 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                        isDone
                          ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                          isDone ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 bg-slate-900'
                        }`}>
                          {isDone && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                        <span className="text-sm font-medium">{ritual}</span>
                      </div>
                      <span className="text-xs text-slate-500">{isDone ? 'Ready' : 'Pending'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SEQUENTIAL STEPS & CHECKPOINTS */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                <Zap className="w-5 h-5 text-indigo-400" /> Execution Protocol Steps
              </h3>
              <span className="text-xs text-slate-400">
                Step {currentSession.currentStepIndex + 1} of {currentSession.stepExecutions.length}
              </span>
            </div>

            <div className="space-y-3">
              {currentSession.stepExecutions.map((step, idx) => {
                const isCurrent = idx === currentSession.currentStepIndex && currentSession.status === 'ACTIVE';
                const isSatisfied = step.status === 'SATISFIED';
                const isPending = step.status === 'PENDING';

                return (
                  <div
                    key={step.stepId}
                    className={`p-4 rounded-xl border transition ${
                      isCurrent
                        ? 'bg-indigo-950/30 border-indigo-700/60 shadow-lg shadow-indigo-950/30'
                        : isSatisfied
                        ? 'bg-slate-950/40 border-emerald-900/30 text-slate-400'
                        : 'bg-slate-950/60 border-slate-800/80 text-slate-500'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
                            isSatisfied
                              ? 'bg-emerald-600 text-white'
                              : isCurrent
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {idx + 1}
                          </span>
                          <span className={`font-semibold text-sm ${
                            isCurrent ? 'text-indigo-200' : isSatisfied ? 'text-slate-300 line-through' : 'text-slate-400'
                          }`}>
                            {step.title}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-800/80 text-slate-400 border border-slate-700">
                            {step.stepType}
                          </span>
                        </div>
                        {step.notes && (
                          <p className="text-xs text-slate-400 pl-7">{step.notes}</p>
                        )}
                      </div>

                      {/* STEP ACTIONS */}
                      {isCurrent && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onAdvanceStep(currentSession.id, idx, { notes: 'Step completed' })}
                            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1 shadow-md shadow-indigo-600/20"
                          >
                            Mark Done <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ARTIFACTS & EVIDENCE SECTION */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-semibold text-slate-100 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-400" /> Output Artifacts & Evidence
              </h3>
              <button
                onClick={() => setShowArtifactModal(true)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition flex items-center gap-1 border border-slate-700"
              >
                <Plus className="w-3.5 h-3.5" /> Attach Output
              </button>
            </div>

            {currentSession.artifacts.length === 0 && currentSession.evidence.length === 0 ? (
              <div className="text-center py-6 text-slate-500 text-xs">
                No tangible artifacts or evidence captured yet. Output commits, notes, or milestones to satisfy completion criteria.
              </div>
            ) : (
              <div className="space-y-2.5">
                {currentSession.artifacts.map(art => (
                  <div key={art.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                          {art.artifactType}
                        </span>
                        <span className="text-sm font-medium text-slate-200">{art.title}</span>
                      </div>
                      {art.contentSnippet && (
                        <p className="text-xs text-slate-400 italic pl-1">{art.contentSnippet}</p>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{new Date(art.createdAtUtc).toLocaleTimeString()}</span>
                  </div>
                ))}

                {currentSession.evidence.map(ev => (
                  <div key={ev.id} className="p-3 bg-emerald-950/10 border border-emerald-900/30 rounded-xl flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span className="font-mono text-emerald-300 font-semibold">{ev.type}</span>
                      <span className="text-slate-400">({ev.source} / {ev.trustLevel})</span>
                    </div>
                    <span className="text-slate-500">{new Date(ev.capturedAtUtc).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: AI EXECUTION PARTNER / EXTENSION & GOVERNANCE */}
        <div className="space-y-6">
          {/* AI EXECUTION PARTNER PANEL */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4 flex flex-col h-[460px]">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400" />
                <h3 className="font-semibold text-slate-100 text-sm">AI Execution Partner</h3>
              </div>
              <select
                value={aiMode}
                onChange={e => setAiMode(e.target.value as AIMode)}
                className="bg-slate-950 border border-slate-700 text-xs text-slate-300 rounded-lg px-2 py-1 focus:outline-none"
              >
                <option value="COACH">Mode: Coach</option>
                <option value="COPILOT">Mode: Copilot</option>
                <option value="EXECUTOR">Mode: Executor</option>
                <option value="OBSERVER">Mode: Observer</option>
                <option value="SILENT">Mode: Silent</option>
              </select>
            </div>

            {/* CHAT MESSAGES */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
              {aiChatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-xl ${
                    msg.sender === 'AI'
                      ? 'bg-slate-950 border border-slate-800 text-slate-300'
                      : 'bg-indigo-950/50 border border-indigo-800/40 text-indigo-200 ml-4'
                  }`}
                >
                  <div className="flex items-center justify-between text-slate-500 font-mono text-[10px] mb-1">
                    <span>{msg.sender === 'AI' ? 'Executive AI' : 'You'}</span>
                    <span>{msg.time}</span>
                  </div>
                  <p className="leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>

            {/* CHAT INPUT */}
            <div className="pt-2 border-t border-slate-800 flex items-center gap-2">
              <input
                type="text"
                value={aiChatInput}
                onChange={e => setAiChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendAiMessage()}
                placeholder={aiMode === 'SILENT' ? 'AI partner is silenced' : 'Ask for synthesis, outline, or breakdown...'}
                disabled={aiMode === 'SILENT'}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
              />
              <button
                onClick={handleSendAiMessage}
                disabled={aiMode === 'SILENT' || !aiChatInput.trim()}
                className="p-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl transition"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* GOVERNED EXTENSION & TIME MANAGEMENT */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
            <h3 className="font-semibold text-slate-100 text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-400" /> Schedule Governance & Adjustments
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              If execution requires more time, request an extension. The schedule engine evaluates downstream commitments and protects family / hard anchors.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => setShowExtensionModal(true)}
                className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-indigo-400" /> Request Focus Extension (+15m / +30m)
              </button>

              <button
                onClick={() => setShowBlockerModal(true)}
                className="w-full py-2 bg-amber-950/30 hover:bg-amber-950/50 text-amber-300 border border-amber-800/40 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Report Execution Blocker
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL: EXTENSION REQUEST */}
      {showExtensionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-indigo-400" /> Request Performance Extension
            </h3>
            <p className="text-xs text-slate-400">
              Select desired extension duration. Governance will verify that no downstream protected blocks are violated.
            </p>

            <div className="space-y-3">
              <div className="flex gap-2">
                {[15, 30, 45].map(mins => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setExtensionMinutes(mins)}
                    className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                      extensionMinutes === mins
                        ? 'bg-indigo-600 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    +{mins} Minutes
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Reason for Extension</label>
                <input
                  type="text"
                  value={extensionReason}
                  onChange={e => setExtensionReason(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowExtensionModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRequestExtension(currentSession.id, extensionMinutes, extensionReason);
                  setShowExtensionModal(false);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition"
              >
                Evaluate & Extend
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ATTACH ARTIFACT */}
      {showArtifactModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <FileText className="w-5 h-5 text-indigo-400" /> Attach Tangible Output Artifact
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Artifact Type</label>
                <select
                  value={artifactType}
                  onChange={e => setArtifactType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="NOTE">Notes / Architectural Decision</option>
                  <option value="CODE_COMMIT">Code Commit / PR</option>
                  <option value="DOCUMENT">Document / Deliverable</option>
                  <option value="TRADE_RECORD">Trade Execution Record</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Artifact Title</label>
                <input
                  type="text"
                  placeholder="e.g., PerformanceEngine v1 implementation"
                  value={artifactTitle}
                  onChange={e => setArtifactTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Snippet or Summary</label>
                <textarea
                  rows={3}
                  placeholder="Key milestones completed, commit hash, or thesis summary..."
                  value={artifactSnippet}
                  onChange={e => setArtifactSnippet(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowArtifactModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                disabled={!artifactTitle.trim()}
                onClick={() => {
                  onAttachArtifact(currentSession.id, {
                    artifactType,
                    title: artifactTitle,
                    contentSnippet: artifactSnippet
                  });
                  onRecordEvidence(currentSession.id, {
                    type: 'NOTE_BODY',
                    payload: { title: artifactTitle, type: artifactType }
                  });
                  setArtifactTitle('');
                  setArtifactSnippet('');
                  setShowArtifactModal(false);
                }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition"
              >
                Record Artifact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REPORT BLOCKER */}
      {showBlockerModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-amber-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Report Execution Blocker
            </h3>
            <p className="text-xs text-slate-400">
              State the reason execution cannot continue. The session will transition to BLOCKED and update the schedule.
            </p>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Blocker Reason</label>
              <textarea
                rows={3}
                placeholder="e.g. Missing database credentials, upstream dependency delayed..."
                value={blockerReason}
                onChange={e => setBlockerReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowBlockerModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                disabled={!blockerReason.trim()}
                onClick={() => {
                  onCloseSession(currentSession.id, 'BLOCKED', undefined, blockerReason);
                  setShowBlockerModal(false);
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold transition"
              >
                Mark Blocked & Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CLOSE SESSION ("Where did you get to?") */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Close Performance Session
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Where did you get to? Complete the debrief to evaluate outcome and release schedule capacity.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Outcome Status</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['COMPLETED', 'PARTIAL', 'BLOCKED', 'ABANDONED'] as const).map(out => (
                    <button
                      key={out}
                      type="button"
                      onClick={() => setSelectedOutcome(out)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-semibold border text-center transition ${
                        selectedOutcome === out
                          ? out === 'COMPLETED'
                            ? 'bg-emerald-600 border-emerald-500 text-white'
                            : out === 'PARTIAL'
                            ? 'bg-amber-600 border-amber-500 text-white'
                            : 'bg-rose-600 border-rose-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {out}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Focus Depth Assessment</label>
                <div className="flex gap-2">
                  {(['HIGH', 'MEDIUM', 'LOW'] as const).map(depth => (
                    <button
                      key={depth}
                      type="button"
                      onClick={() => setFocusDepth(depth)}
                      className={`flex-1 py-1.5 rounded-xl text-xs font-semibold border transition ${
                        focusDepth === depth
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      {depth}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Session Debrief & Reflection</label>
                <textarea
                  rows={3}
                  placeholder="What was produced? Any key observations or friction points?"
                  value={reflectionText}
                  onChange={e => setReflectionText(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={() => onCancelSession(currentSession.id, 'Session cancelled by user')}
                className="text-xs text-rose-400 hover:underline"
              >
                Surrender / Cancel Session
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCloseModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition"
                >
                  Return to Workspace
                </button>
                <button
                  onClick={() => {
                    onCloseSession(
                      currentSession.id,
                      selectedOutcome,
                      { focusDepth, userReflection: reflectionText },
                      reflectionText
                    );
                    setShowCloseModal(false);
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition shadow-lg shadow-emerald-600/20"
                >
                  Commit Outcome & Finish
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
