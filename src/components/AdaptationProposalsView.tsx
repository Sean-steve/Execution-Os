import React, { useState } from 'react';
import { 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  TrendingUp, 
  Activity, 
  ShieldCheck, 
  RotateCcw, 
  Layers, 
  AlertCircle,
  FileText,
  Zap,
  ArrowRight,
  Clock,
  History,
  GitBranch,
  ShieldAlert,
  Calendar,
  BarChart3,
  Undo2,
  Lock,
  ChevronRight,
  RefreshCw
} from 'lucide-react';
import { 
  AppState, 
  AdaptationProposal, 
  LongitudinalWindow, 
  AdaptationPattern,
  AdaptationVersionRecord 
} from '../types';
import { computeExecutionAnalytics } from '../services/analyticsService';
import { 
  applyAdaptationProposal, 
  rejectAdaptationProposal,
  rollbackAdaptationProposal,
  retainAdaptationProposal,
  measureAdaptationPerformance,
  scanLongitudinalAdaptations,
  getHistoricalDataForWindow
} from '../services/adaptationEngine';
import { getActiveDayTheme } from '../services/dayThemeService';
import { sound } from '../services/soundService';

interface AdaptationProposalsViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const AdaptationProposalsView: React.FC<AdaptationProposalsViewProps> = ({
  state,
  onUpdateState,
}) => {
  const [selectedWindow, setSelectedWindow] = useState<LongitudinalWindow>(state.longitudinalWindow || '30d');
  const [activeTab, setActiveTab] = useState<'PROPOSALS' | 'PATTERNS' | 'VERSIONS' | 'HISTORY'>('PROPOSALS');
  const [isScanning, setIsScanning] = useState(false);
  const [rollbackReason, setRollbackReason] = useState<{ [id: string]: string }>({});
  const [showRollbackPrompt, setShowRollbackPrompt] = useState<string | null>(null);

  const analytics = computeExecutionAnalytics(state);
  const activeTheme = getActiveDayTheme(state);
  const rawProposals: AdaptationProposal[] = state.adaptationProposals || [];
  const proposals: AdaptationProposal[] = Array.from(new Map<string, AdaptationProposal>(rawProposals.map(p => [p.id, p])).values());

  const rawPatterns: AdaptationPattern[] = state.adaptationPatterns || [];
  const patterns: AdaptationPattern[] = Array.from(new Map<string, AdaptationPattern>(rawPatterns.map(p => [p.id, p])).values());

  const rawVersionHistory: AdaptationVersionRecord[] = (state.adaptationVersionHistory as AdaptationVersionRecord[]) || [];
  const versionHistory: AdaptationVersionRecord[] = Array.from(new Map<string, AdaptationVersionRecord>(rawVersionHistory.map(v => [v.id, v])).values());
  const historicalDays = state.historicalDays || [];
  const windowData = getHistoricalDataForWindow(historicalDays, selectedWindow);
  const windowDays = windowData.filteredDays;
  const anomalyDays = windowDays.filter(d => d.anomalyDay);

  const pendingProposals = proposals.filter(p => p.status === 'PROPOSED');
  const activeProposals = proposals.filter(p => p.status === 'APPLIED' || p.status === 'ACTIVE_MEASURING' || p.status === 'MEASURING');
  const pastProposals = proposals.filter(p => p.status === 'RETAINED' || p.status === 'ROLLED_BACK' || p.status === 'REJECTED');

  const handleWindowChange = (win: LongitudinalWindow) => {
    setSelectedWindow(win);
    onUpdateState(prev => {
      const scanResult = scanLongitudinalAdaptations(prev, win);
      return {
        ...prev,
        longitudinalWindow: win,
        adaptationPatterns: scanResult.patterns,
        adaptationProposals: scanResult.proposals
      };
    });
  };

  const handleScan = () => {
    setIsScanning(true);
    sound.playChime('bell');
    setTimeout(() => {
      onUpdateState(prev => {
        const scanResult = scanLongitudinalAdaptations(prev, selectedWindow);
        return {
          ...prev,
          longitudinalWindow: selectedWindow,
          adaptationPatterns: scanResult.patterns,
          adaptationProposals: scanResult.proposals
        };
      });
      setIsScanning(false);
      sound.playChime('success');
    }, 400);
  };

  const handleApprove = (proposalId: string) => {
    sound.playChime('success');
    onUpdateState(prev => applyAdaptationProposal(prev, proposalId, 'USER'));
  };

  const handleReject = (proposalId: string) => {
    onUpdateState(prev => rejectAdaptationProposal(prev, proposalId));
  };

  const handleMeasure = (proposalId: string) => {
    sound.playChime('bell');
    onUpdateState(prev => measureAdaptationPerformance(prev, proposalId));
  };

  const handleRetain = (proposalId: string) => {
    sound.playChime('success');
    onUpdateState(prev => retainAdaptationProposal(prev, proposalId, 'USER'));
  };

  const handleRollback = (proposalId: string) => {
    const reason = rollbackReason[proposalId] || 'Reverted by human operator due to sub-optimal execution drift';
    sound.playChime('warning');
    onUpdateState(prev => rollbackAdaptationProposal(prev, proposalId, reason, 'USER'));
    setShowRollbackPrompt(null);
  };

  const windowLabels: { id: LongitudinalWindow; label: string; days: number }[] = [
    { id: '7d', label: '7 Days', days: 7 },
    { id: '30d', label: '30 Days', days: 30 },
    { id: '60d', label: '60 Days', days: 60 },
    { id: '90d', label: '90 Days', days: 90 },
  ];

  return (
    <div className="space-y-6">
      
      {/* Header & Window Controls Banner */}
      <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-md border border-slate-800 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                EOS-012 • EOS-006 Intelligence
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                Longitudinal Engine
              </span>
            </div>
            <h2 className="text-xl font-extrabold tracking-tight font-mono flex items-center gap-2.5">
              <Sparkles className="w-6 h-6 text-indigo-400" />
              <span>Longitudinal Execution Intelligence</span>
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Synthesizes execution evidence across 7 to 90-day windows. Discovers chronic lateness, fallback patterns, manual overrides, and optimal execution windows with automatic anomaly filtering.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleScan}
              disabled={isScanning}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold flex items-center gap-2 shadow-sm transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'Scanning...' : 'Scan Patterns'}</span>
            </button>
          </div>
        </div>

        {/* Window Selector Tabs */}
        <div className="pt-3 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-slate-800/80 border border-slate-700 w-fit">
            {windowLabels.map(win => (
              <button
                key={win.id}
                onClick={() => handleWindowChange(win.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-1.5 ${
                  selectedWindow === win.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>{win.label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{windowDays.length} Days in Window</span>
            </div>
            <span className="text-slate-600">•</span>
            <div className="flex items-center gap-1.5 text-amber-300">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>{anomalyDays.length} Anomaly Days Excluded</span>
            </div>
          </div>
        </div>
      </div>

      {/* One Bad Day Safeguard Banner */}
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3 shadow-xs">
        <ShieldCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div className="space-y-1 text-xs">
          <div className="font-bold flex items-center gap-2">
            <span>Non-Overreactive Governance Constraint</span>
            <span className="px-1.5 py-0.2 rounded bg-amber-200 text-amber-800 text-[10px] font-mono">
              Active Protection
            </span>
          </div>
          <p className="text-amber-800 leading-relaxed">
            <strong>"Do not allow one bad day to rewrite recurring routines."</strong> Outlier and high-deviation days ({anomalyDays.length} detected in {selectedWindow}) are isolated as non-systemic noise so emergency disruptions do not warp recurring baseline schedules.
          </p>
        </div>
      </div>

      {/* Analytics KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Detected Patterns</span>
            <Activity className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {patterns.length}
          </div>
          <p className="text-[10px] text-slate-500">
            Across {selectedWindow} execution window
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Active Proposals</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {proposals.length}
          </div>
          <p className="text-[10px] text-slate-500">
            {pendingProposals.length} pending review • {activeProposals.length} measuring
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Version History</span>
            <GitBranch className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {versionHistory.length}
          </div>
          <p className="text-[10px] text-slate-500">
            Versioned adaptation snapshots
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-1">
          <div className="text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>Nominal On-Time</span>
            <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="text-2xl font-extrabold text-slate-900 font-mono">
            {analytics.onTimeRate}%
          </div>
          <p className="text-[10px] text-slate-500">
            Baseline adherence rate
          </p>
        </div>
      </div>

      {/* Adaptation Lifecycle Visualizer */}
      <div className="p-5 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-mono font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-indigo-600" />
            <span>Adaptation Lifecycle Pipeline</span>
          </h3>
          <span className="text-[11px] font-mono text-slate-500">
            Durable 9-Stage Evolution Process
          </span>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5 text-center">
          {[
            { step: '1', label: 'Evidence', color: 'bg-slate-100 text-slate-700 border-slate-200' },
            { step: '2', label: 'Pattern', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
            { step: '3', label: 'Hypothesis', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
            { step: '4', label: 'Proposal', color: 'bg-blue-50 text-blue-700 border-blue-200' },
            { step: '5', label: 'Governance', color: 'bg-purple-50 text-purple-700 border-purple-200' },
            { step: '6', label: 'Approval', color: 'bg-amber-50 text-amber-700 border-amber-200' },
            { step: '7', label: 'New Version', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            { step: '8', label: 'Measure', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
            { step: '9', label: 'Keep/Rollback', color: 'bg-rose-50 text-rose-700 border-rose-200' },
          ].map(stage => (
            <div key={stage.step} className={`p-2 rounded-xl border ${stage.color} space-y-0.5`}>
              <div className="text-[10px] font-mono font-extrabold opacity-70">0{stage.step}</div>
              <div className="text-[11px] font-bold truncate">{stage.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Sub-View Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        {[
          { id: 'PROPOSALS' as const, label: 'Proposals & Governance', count: proposals.length },
          { id: 'PATTERNS' as const, label: 'Detected Patterns', count: patterns.length },
          { id: 'VERSIONS' as const, label: 'Version Tree & Rollbacks', count: versionHistory.length },
          { id: 'HISTORY' as const, label: 'Longitudinal Execution Days', count: windowDays.length },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 rounded-xl text-xs font-mono font-bold transition-colors flex items-center gap-1.5 ${
              activeTab === tab.id
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`px-1.5 py-0.2 text-[10px] rounded-full ${
              activeTab === tab.id ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* TAB 1: PROPOSALS & GOVERNANCE */}
      {activeTab === 'PROPOSALS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Adaptation Proposals ({proposals.length})</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Window: {selectedWindow} ({windowDays.length} days analyzed)
            </span>
          </div>

          {proposals.length === 0 ? (
            <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-2">
              <Sparkles className="w-8 h-8 text-indigo-400 mx-auto" />
              <div className="text-sm font-bold text-slate-800">No proposals detected for this window</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click "Scan Patterns" or switch window size to trigger longitudinal analysis.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map(proposal => {
                const isPending = proposal.status === 'PROPOSED';
                const isApplied = proposal.status === 'APPLIED';
                const isMeasuring = proposal.status === 'MEASURING';
                const isRetained = proposal.status === 'RETAINED';
                const isRolledBack = proposal.status === 'ROLLED_BACK';
                const isRejected = proposal.status === 'REJECTED';

                return (
                  <div
                    key={proposal.id}
                    className={`p-5 rounded-2xl border transition-all ${
                      isRetained
                        ? 'bg-emerald-50/50 border-emerald-300'
                        : isMeasuring || isApplied
                        ? 'bg-indigo-50/40 border-indigo-300'
                        : isRolledBack
                        ? 'bg-slate-100 border-slate-300 opacity-75'
                        : isRejected
                        ? 'bg-slate-50 border-slate-200 opacity-60'
                        : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                    }`}
                  >
                    <div className="space-y-3">
                      
                      {/* Proposal Header */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded uppercase ${
                            isRetained
                              ? 'bg-emerald-100 text-emerald-800'
                              : isMeasuring
                              ? 'bg-cyan-100 text-cyan-800'
                              : isApplied
                              ? 'bg-indigo-100 text-indigo-800'
                              : isRolledBack
                              ? 'bg-slate-200 text-slate-800'
                              : isRejected
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {proposal.status}
                          </span>

                          <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {proposal.windowDays || selectedWindow} Window
                          </span>

                          <span className="text-xs font-mono text-slate-500">
                            {proposal.evidenceCount} Evidence Points ({proposal.failureRatePercentage}% Failure)
                          </span>

                          {proposal.targetVersion && (
                            <span className="text-xs font-mono text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                              Version: {proposal.targetVersion}
                            </span>
                          )}
                        </div>

                        <span className="text-[11px] font-mono text-slate-400">
                          {proposal.governanceRequired ? 'Human Approval Required' : 'Autonomous Action'}
                        </span>
                      </div>

                      {/* Title & Hypothesis */}
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{proposal.title}</h4>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{proposal.hypothesis}</p>
                      </div>

                      {/* Change Spec Box */}
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 space-y-1">
                        <div className="text-slate-400 text-[11px]">Proposed Structural Change:</div>
                        <div className="flex items-center gap-2 font-bold text-indigo-700">
                          <span>{proposal.suggestedChange.activityId}</span>
                          <span>•</span>
                          <span>{proposal.suggestedChange.property}:</span>
                          <span className="text-slate-500 line-through">
                            {JSON.stringify(proposal.suggestedChange.fromValue)}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-indigo-500" />
                          <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            {JSON.stringify(proposal.suggestedChange.toValue)}
                          </span>
                        </div>
                      </div>

                      {/* Post-Adaptation Measurement Metrics (if active/measuring) */}
                      {proposal.measurement && (
                        <div className="p-3.5 rounded-xl bg-white border border-indigo-200 space-y-2 text-xs font-mono">
                          <div className="flex items-center justify-between text-indigo-900 font-bold">
                            <span className="flex items-center gap-1.5">
                              <BarChart3 className="w-4 h-4 text-indigo-600" />
                              <span>Post-Adaptation Measurement Result</span>
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              proposal.measurement.status === 'IMPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : proposal.measurement.status === 'DEGRADED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {proposal.measurement.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                              <div className="text-slate-400">Baseline Failure</div>
                              <div className="font-bold text-slate-800">{proposal.measurement.baselineFailureRate}%</div>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                              <div className="text-slate-400">Post-Adaptation Failure</div>
                              <div className="font-bold text-slate-800">{proposal.measurement.postAdaptationFailureRate}%</div>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                              <div className="text-slate-400">Improvement Delta</div>
                              <div className={`font-bold ${proposal.measurement.improvementDeltaPercentage > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {proposal.measurement.improvementDeltaPercentage > 0 ? '+' : ''}{proposal.measurement.improvementDeltaPercentage}%
                              </div>
                            </div>
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                              <div className="text-slate-400">Evaluation Window</div>
                              <div className="font-bold text-slate-800">{proposal.measurement.evaluationDays} Days</div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60">
                        <div className="text-[11px] font-mono text-slate-500">
                          {proposal.appliedAt && `Applied: ${new Date(proposal.appliedAt).toLocaleDateString()}`}
                          {proposal.rollbackReason && ` • Rolled back: ${proposal.rollbackReason}`}
                        </div>

                        <div className="flex items-center gap-2">
                          {isPending && (
                            <>
                              <button
                                onClick={() => handleReject(proposal.id)}
                                className="px-3 py-1.5 rounded-xl text-xs font-mono text-slate-500 hover:bg-slate-200 transition-colors"
                              >
                                Reject
                              </button>
                              <button
                                onClick={() => handleApprove(proposal.id)}
                                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-mono font-bold text-xs shadow-xs transition-colors flex items-center gap-1.5"
                              >
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Approve & Version</span>
                              </button>
                            </>
                          )}

                          {(isApplied || isMeasuring) && (
                            <>
                              <button
                                onClick={() => handleMeasure(proposal.id)}
                                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs font-bold transition-colors flex items-center gap-1"
                              >
                                <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
                                <span>Measure Efficacy</span>
                              </button>

                              <button
                                onClick={() => handleRetain(proposal.id)}
                                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold transition-colors flex items-center gap-1"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>Lock & Retain</span>
                              </button>

                              <button
                                onClick={() => setShowRollbackPrompt(proposal.id)}
                                className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-mono text-xs font-bold transition-colors flex items-center gap-1"
                              >
                                <Undo2 className="w-3.5 h-3.5" />
                                <span>Rollback</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Rollback Prompt Modal / Box */}
                      {showRollbackPrompt === proposal.id && (
                        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 space-y-2 text-xs">
                          <div className="font-bold text-rose-900">Confirm Rollback to Pre-Adaptation Configuration</div>
                          <p className="text-rose-800 text-[11px]">
                            This will atomically restore the previous activity schedule and cancel active telemetry monitoring.
                          </p>
                          <input
                            type="text"
                            placeholder="Reason for rollback (optional)..."
                            value={rollbackReason[proposal.id] || ''}
                            onChange={e => setRollbackReason({ ...rollbackReason, [proposal.id]: e.target.value })}
                            className="w-full px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-xs font-mono text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-rose-500"
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setShowRollbackPrompt(null)}
                              className="px-3 py-1 rounded-lg text-xs font-mono text-slate-600 hover:bg-slate-200"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleRollback(proposal.id)}
                              className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-mono font-bold text-xs"
                            >
                              Confirm Revert
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: DETECTED PATTERNS */}
      {activeTab === 'PATTERNS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 font-mono flex items-center gap-2">
              <Activity className="w-4 h-4 text-indigo-600" />
              <span>Detected Longitudinal Patterns ({patterns.length})</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Window: {selectedWindow}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {patterns.map(pattern => (
              <div
                key={pattern.id}
                className="p-4 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {pattern.patternType}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-700">
                    {Math.round((pattern.occurrences / (pattern.totalSampleSize || 30)) * 100)}% Frequency
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-900">{pattern.title}</h4>
                  <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{pattern.description}</p>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-3 gap-2 text-[11px] font-mono">
                  <div>
                    <span className="text-slate-400 block">Activity</span>
                    <span className="font-bold text-slate-800 truncate block">{pattern.activityId}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Occurrences</span>
                    <span className="font-bold text-slate-800 block">{pattern.occurrences} / {pattern.totalSampleSize || 30}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Confidence</span>
                    <span className="font-bold text-emerald-600 block">{Math.round((pattern.confidenceScore || 0.85) * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: VERSION TREE & ROLLBACKS */}
      {activeTab === 'VERSIONS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 font-mono flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-blue-600" />
              <span>Adaptation Version Tree & Governance Records ({versionHistory.length})</span>
            </h3>
          </div>

          {versionHistory.length === 0 ? (
            <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-2">
              <GitBranch className="w-8 h-8 text-slate-400 mx-auto" />
              <div className="text-sm font-bold text-slate-800">No versioned adaptations applied yet</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                When an adaptation proposal is approved, an immutable version snapshot is created here allowing instant single-click rollbacks.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {versionHistory.map(ver => (
                <div
                  key={ver.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    ver.isCurrentVersion
                      ? 'bg-indigo-50/50 border-indigo-300 shadow-xs'
                      : 'bg-white border-slate-200 opacity-80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
                          v{ver.version}
                        </span>
                        {ver.isCurrentVersion && (
                          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                            Active Baseline
                          </span>
                        )}
                        <span className="text-xs font-mono text-slate-500">
                          {ver.appliedAt ? new Date(ver.appliedAt).toLocaleString() : 'Applied'} • {ver.appliedBy || 'USER'}
                        </span>
                      </div>

                      <div className="text-sm font-bold text-slate-900">{ver.description}</div>
                    </div>

                    {!ver.isCurrentVersion && (
                      <button
                        onClick={() => handleRollback(ver.id)}
                        className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs font-bold transition-colors flex items-center gap-1.5 self-end sm:self-center"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Revert to this snapshot</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: LONGITUDINAL EXECUTION DAYS */}
      {activeTab === 'HISTORY' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 font-mono flex items-center gap-2">
              <Calendar className="w-4 h-4 text-indigo-600" />
              <span>Historical Execution Days ({windowDays.length} in {selectedWindow})</span>
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Total Recorded: {historicalDays.length} Days
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {windowDays.slice(0, 48).map(day => (
              <div
                key={day.date}
                className={`p-2.5 rounded-xl border text-xs font-mono space-y-1 ${
                  day.anomalyDay
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : day.adherenceScore >= 90
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-white border-slate-200 text-slate-800'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{day.date.slice(5)}</span>
                  <span className="font-bold">{day.mode}</span>
                </div>
                <div className="text-sm font-bold">{day.adherenceScore}%</div>
                <div className="text-[10px] truncate text-slate-500">
                  {day.anomalyDay ? 'Anomaly Day' : `${day.activitiesCompleted} done`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
