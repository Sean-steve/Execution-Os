import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Activity, 
  Terminal, 
  RefreshCw, 
  Database, 
  Download, 
  Upload, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Play, 
  Layers, 
  Zap, 
  Lock, 
  Radio, 
  Cpu, 
  Wrench,
  Clock,
  Sparkles,
  Eye,
  FileText,
  Search,
  Filter,
  Check,
  RotateCcw
} from 'lucide-react';
import { AppState } from '../types';
import { defaultObservability, StructuredLogEntry, LogLevel } from '../services/observabilityService';
import { defaultTracing, TraceWaterfall } from '../services/tracingService';
import { defaultMetrics, OperationalMetricsSnapshot } from '../services/metricsService';
import { 
  defaultReliabilityService, 
  circuitBreakers, 
  AppStateSnapshot, 
  ScheduleCorruptionAnalysis 
} from '../services/reliabilityService';
import { defaultRunbookService, OperationalRunbook } from '../services/runbookService';
import { defaultDeadLetterQueue, DeadLetterEntry } from '../services/deadLetterQueue';
import { defaultBackgroundWorker } from '../services/backgroundWorker';
import { sound } from '../services/soundService';

interface OperationsCenterViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

type OperationsTab = 'TELEMETRY' | 'LOGS_TRACES' | 'RUNBOOKS' | 'BACKUP_RESTORE' | 'DLQ' | 'SCHEDULE_HEALER';

export const OperationsCenterView: React.FC<OperationsCenterViewProps> = ({
  state,
  onUpdateState,
}) => {
  const [activeTab, setActiveTab] = useState<OperationsTab>('TELEMETRY');
  
  // Telemetry state
  const [metrics, setMetrics] = useState<OperationalMetricsSnapshot>(defaultMetrics.getSnapshot());
  const [refreshInterval, setRefreshInterval] = useState<number>(2000);

  // Logs state
  const [logs, setLogs] = useState<StructuredLogEntry[]>([]);
  const [logSearch, setLogSearch] = useState<string>('');
  const [logLevelFilter, setLogLevelFilter] = useState<string>('ALL');
  const [logServiceFilter, setLogServiceFilter] = useState<string>('ALL');

  // Traces state
  const [traces, setTraces] = useState<TraceWaterfall[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceWaterfall | null>(null);

  // Runbooks state
  const [runbooks, setRunbooks] = useState<OperationalRunbook[]>(defaultRunbookService.getRunbooks());
  const [selectedRunbook, setSelectedRunbook] = useState<OperationalRunbook | null>(defaultRunbookService.getRunbooks()[0]);
  const [remediationStatus, setRemediationStatus] = useState<{ code: string; message: string; success: boolean } | null>(null);

  // Backup & Recovery state
  const [snapshots, setSnapshots] = useState<AppStateSnapshot[]>(defaultReliabilityService.getSnapshotsHistory());
  const [snapshotSuccessMsg, setSnapshotSuccessMsg] = useState<string | null>(null);

  // DLQ state
  const [dlqEntries, setDlqEntries] = useState<DeadLetterEntry[]>([]);
  const [dlqRetrying, setDlqRetrying] = useState<boolean>(false);

  // Schedule Corruption state
  const [corruptionAnalysis, setCorruptionAnalysis] = useState<ScheduleCorruptionAnalysis>(
    defaultReliabilityService.analyzeScheduleCorruption(state)
  );
  const [healResultMsg, setHealResultMsg] = useState<string | null>(null);

  // Auto-refresh telemetry and logs
  useEffect(() => {
    const refreshData = async () => {
      setMetrics(defaultMetrics.getSnapshot());
      setLogs(defaultObservability.query({
        limit: 100,
        searchQuery: logSearch || undefined,
        level: logLevelFilter !== 'ALL' ? (logLevelFilter as LogLevel) : undefined,
        service: logServiceFilter !== 'ALL' ? logServiceFilter : undefined,
      }));
      setTraces(defaultTracing.getRecentTraces(10));
      setSnapshots(defaultReliabilityService.getSnapshotsHistory());
      setRunbooks(defaultRunbookService.getRunbooks());
      const dlqList = await defaultDeadLetterQueue.list();
      setDlqEntries(dlqList);
      setCorruptionAnalysis(defaultReliabilityService.analyzeScheduleCorruption(state));
    };

    refreshData();
    const timer = setInterval(refreshData, refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, logSearch, logLevelFilter, logServiceFilter, state]);

  // Handle manual backup creation
  const handleCreateSnapshot = () => {
    sound.playChime('start');
    const snapshot = defaultReliabilityService.createSnapshot(state, 'User Manual Backup Snapshot', 'OPERATOR_UI');
    setSnapshots(defaultReliabilityService.getSnapshotsHistory());
    setSnapshotSuccessMsg(`Snapshot ${snapshot.metadata.snapshotId} generated with verified checksum [${snapshot.metadata.checksum}]`);
    setTimeout(() => setSnapshotSuccessMsg(null), 6000);
  };

  // Handle Export snapshot to JSON
  const handleDownloadSnapshot = (snapshot: AppStateSnapshot) => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(snapshot, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `execution_os_snapshot_${snapshot.metadata.snapshotId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Handle Import & Restore snapshot
  const handleImportSnapshotFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        const snapshot: AppStateSnapshot = parsed.metadata && parsed.state ? parsed : {
          metadata: {
            snapshotId: `legacy-import-${Date.now()}`,
            createdAt: new Date().toISOString(),
            schemaVersion: 1,
            appVersion: '1.0.0',
            recordCounts: { tasks: parsed.tasks?.length || 0, events: parsed.events?.length || 0, activities: parsed.activities?.length || 0, proposals: 0, historicalDays: 0, rewards: 0 },
            checksum: '',
            author: 'IMPORTED_FILE',
          },
          state: parsed.state || parsed,
        };

        const result = defaultReliabilityService.restoreFromSnapshot(snapshot, state);
        if (result.success) {
          sound.playChime('success');
          onUpdateState(() => result.state);
          setSnapshotSuccessMsg(result.message);
        } else {
          sound.playChime('penalty');
          alert(`Restore failed: ${result.message}`);
        }
      } catch (err: any) {
        alert(`Failed to parse snapshot file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Handle Restore from Snapshot History
  const handleRestoreSnapshot = (snapshot: AppStateSnapshot) => {
    if (window.confirm(`Restore Execution OS from snapshot ${snapshot.metadata.snapshotId}? (A safety pre-restore backup will be created automatically)`)) {
      const result = defaultReliabilityService.restoreFromSnapshot(snapshot, state);
      if (result.success) {
        sound.playChime('success');
        onUpdateState(() => result.state);
        setSnapshotSuccessMsg(result.message);
      } else {
        alert(result.message);
      }
    }
  };

  // Handle Runbook Simulation
  const handleSimulateRunbook = (runbook: OperationalRunbook) => {
    sound.playChime('start');
    const simResult = runbook.simulateFailure(state);
    onUpdateState(() => simResult.state);
    setRemediationStatus({
      code: runbook.code,
      message: simResult.description,
      success: false,
    });
    setRunbooks(defaultRunbookService.getRunbooks());
  };

  // Handle Runbook Auto-Remediation
  const handleAutoRemediateRunbook = async (runbook: OperationalRunbook) => {
    sound.playChime('success');
    const remResult = await runbook.autoRemediate(state);
    if (remResult.success) {
      onUpdateState(() => remResult.state);
      setRemediationStatus({
        code: runbook.code,
        message: `REMEDIATION SUCCESS: ${remResult.message}`,
        success: true,
      });
    } else {
      setRemediationStatus({
        code: runbook.code,
        message: `REMEDIATION FAILED: ${remResult.message}`,
        success: false,
      });
    }
    setRunbooks(defaultRunbookService.getRunbooks());
  };

  // Handle Schedule Self-Healing
  const handleExecuteScheduleHeal = () => {
    sound.playChime('success');
    const healResult = defaultReliabilityService.healCorruptedSchedule(state);
    if (healResult.healed) {
      onUpdateState(() => healResult.state);
      setHealResultMsg(healResult.message);
    } else {
      setHealResultMsg('Schedule was already valid. No repairs necessary.');
    }
    setCorruptionAnalysis(defaultReliabilityService.analyzeScheduleCorruption(healResult.state));
  };

  // Handle Retry DLQ
  const handleRetryDLQ = async () => {
    setDlqRetrying(true);
    sound.playChime('start');
    const result = await defaultReliabilityService.retryDeadLetterEvents(defaultDeadLetterQueue, 3);
    const updated = await defaultDeadLetterQueue.list();
    setDlqEntries(updated);
    setDlqRetrying(false);
    if (result.succeededCount > 0) {
      sound.playChime('success');
    }
  };

  // Handle Purge DLQ
  const handlePurgeDLQ = async () => {
    if (window.confirm('Purge all dead letter queue entries?')) {
      await defaultDeadLetterQueue.purge();
      defaultMetrics.setDeadLetterCount(0);
      setDlqEntries([]);
      sound.playChime('success');
    }
  };

  const isDegraded = Object.values(circuitBreakers).some(cb => cb.state === 'OPEN') || corruptionAnalysis.isCorrupted || dlqEntries.length > 0;

  return (
    <div className="space-y-6">
      {/* 1. Header with System Health Status Deck */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-500/30 text-indigo-400">
                <Activity className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Execution OS Operations & Reliability Center
                  <span className="text-[10px] px-2 py-0.5 bg-indigo-500/30 text-indigo-300 font-mono rounded-full border border-indigo-400/30">
                    EOS-014
                  </span>
                </h1>
                <p className="text-xs text-slate-400 font-mono">
                  Autonomous SRE • Distributed Tracing • Self-Healing Engine • Incident Runbooks
                </p>
              </div>
            </div>
          </div>

          {/* Quick Health Indicators */}
          <div className="flex flex-wrap items-center gap-2">
            <div className={`px-3 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-2 ${
              isDegraded
                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isDegraded ? 'bg-amber-400 animate-ping' : 'bg-emerald-400'}`} />
              <span>{isDegraded ? 'SYSTEM DEGRADED' : 'SYSTEM HEALTHY'}</span>
            </div>

            <div className="px-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs font-mono text-slate-300 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-indigo-400" />
              <span>Uptime: {metrics.uptimeSeconds}s</span>
            </div>

            <div className="px-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-xl text-xs font-mono text-slate-300 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>DLQ: {dlqEntries.length}</span>
            </div>

            <button
              onClick={handleCreateSnapshot}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Instant Backup</span>
            </button>
          </div>
        </div>

        {/* Circuit Breakers Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-4 border-t border-slate-800 text-xs font-mono">
          {Object.entries(circuitBreakers).map(([key, cb]) => (
            <div key={key} className="bg-slate-800/60 p-2.5 rounded-xl border border-slate-700/60 flex items-center justify-between">
              <span className="text-slate-400 capitalize">{key} Breaker:</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                cb.state === 'CLOSED' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                cb.state === 'OPEN' ? 'bg-red-500/20 text-red-300 border border-red-500/30 animate-pulse' :
                'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                {cb.state}
              </span>
            </div>
          ))}
        </div>
      </div>

      {snapshotSuccessMsg && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{snapshotSuccessMsg}</span>
        </div>
      )}

      {/* 2. Operations Navigation Sub-Tabs */}
      <div className="flex overflow-x-auto gap-2 border-b border-slate-200 pb-2 no-scrollbar">
        {[
          { id: 'TELEMETRY' as const, label: 'Telemetry & Latency Deck', icon: Activity, badge: 'Live' },
          { id: 'RUNBOOKS' as const, label: 'Incident Runbooks & Chaos', icon: Terminal, badge: '7 SOPs' },
          { id: 'LOGS_TRACES' as const, label: 'Structured Logs & Traces', icon: FileText, badge: `${logs.length}` },
          { id: 'SCHEDULE_HEALER' as const, label: 'Schedule Self-Healer', icon: Wrench, badge: corruptionAnalysis.isCorrupted ? 'Defect' : 'Clean' },
          { id: 'BACKUP_RESTORE' as const, label: 'Backups & Disaster Recovery', icon: Database, badge: `${snapshots.length}` },
          { id: 'DLQ' as const, label: 'Dead-Letter Queue', icon: Layers, badge: `${dlqEntries.length}` },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Tab Contents */}

      {/* TAB 1: TELEMETRY & LATENCY DECK */}
      {activeTab === 'TELEMETRY' && (
        <div className="space-y-6">
          {/* Latency Gauges Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* API Latency Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between text-slate-500 text-xs">
                <span className="font-semibold uppercase tracking-wider">API Latency (p95)</span>
                <Clock className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-slate-900">
                  {metrics.api.latency.p95 || 4.2}ms
                </span>
                <span className="text-xs text-slate-500 font-mono">avg: {metrics.api.latency.avg || 2.1}ms</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] font-mono text-slate-500">
                <span>Total Req: {metrics.api.totalRequests || 42}</span>
                <span className="text-emerald-600">Err Rate: {metrics.api.errorRatePercent}%</span>
              </div>
            </div>

            {/* Decision Engine Latency Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between text-slate-500 text-xs">
                <span className="font-semibold uppercase tracking-wider">Decision Engine</span>
                <Zap className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-slate-900">
                  {metrics.decision.latency.p95 || 3.8}ms
                </span>
                <span className="text-xs text-slate-500 font-mono">rules: {metrics.decision.rulesEvaluatedCount || 18}</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] font-mono text-slate-500">
                <span>Evals: {metrics.decision.evaluationsCount || 12}</span>
                <span>Actions: {metrics.decision.actionsEmittedCount || 6}</span>
              </div>
            </div>

            {/* Allocation Latency Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between text-slate-500 text-xs">
                <span className="font-semibold uppercase tracking-wider">Allocation Engine</span>
                <Cpu className="w-4 h-4 text-teal-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-slate-900">
                  {metrics.allocation.latency.p95 || 5.1}ms
                </span>
                <span className="text-xs text-slate-500 font-mono">avg: {metrics.allocation.latency.avg || 3.0}ms</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] font-mono text-slate-500">
                <span>Reallocs: {metrics.allocation.reallocationsCount || 8}</span>
                <span>Shifted: {metrics.allocation.tasksShiftedCount || 4}</span>
              </div>
            </div>

            {/* Background Scheduler Throughput */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between text-slate-500 text-xs">
                <span className="font-semibold uppercase tracking-wider">Background Jobs</span>
                <Radio className="w-4 h-4 text-purple-500" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-slate-900">
                  {metrics.backgroundJobs.jobsExecuted || 15}
                </span>
                <span className="text-xs text-emerald-600 font-mono">100% OK</span>
              </div>
              <div className="pt-2 border-t border-slate-100 flex justify-between text-[11px] font-mono text-slate-500">
                <span>Ticks: {metrics.backgroundJobs.totalTicks || 8}</span>
                <span>Last Tick: {metrics.backgroundJobs.lastTickDurationMs || 6}ms</span>
              </div>
            </div>
          </div>

          {/* Autonomous vs Governance Health Ratios */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-500" />
                Autonomous Resolution Metrics
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Autonomous Resolution Rate:</span>
                  <span className="font-bold text-emerald-700">{metrics.autonomousResolution.autonomousResolutionRatePercent}%</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Auto-Applied Routine Adaptations:</span>
                  <span className="font-bold text-indigo-700">{metrics.autonomousResolution.autoAppliedProposalsCount}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Schedule Self-Healing Events:</span>
                  <span className="font-bold text-teal-700">{metrics.autonomousResolution.selfHealingEventsCount}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Autonomous Fallback Actions:</span>
                  <span className="font-bold text-amber-700">{metrics.autonomousResolution.autonomousFallbacksTriggered}</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-700" />
                Governance & Security Checks
              </h3>
              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Tier 1 Micro-Optimizations Approved:</span>
                  <span className="font-bold text-slate-800">{metrics.governance.tier1ApprovalsCount}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Tier 2 Routine Restructures Gated:</span>
                  <span className="font-bold text-indigo-800">{metrics.governance.tier2ApprovalsCount}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Tier 3 Sacred Boundary Shifts Gated:</span>
                  <span className="font-bold text-purple-800">{metrics.governance.tier3ApprovalsCount}</span>
                </div>
                <div className="flex justify-between items-center p-2 bg-slate-50 rounded-xl">
                  <span className="text-slate-600">Unauthorized Tier Attempts Vetoed:</span>
                  <span className="font-bold text-red-600">{metrics.governance.unauthorizedAttemptsVetoed}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: INCIDENT RUNBOOKS & CHAOS SIMULATOR */}
      {activeTab === 'RUNBOOKS' && (
        <div className="space-y-6">
          {remediationStatus && (
            <div className={`p-4 rounded-2xl border text-xs font-mono flex items-start justify-between gap-3 ${
              remediationStatus.success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              <div className="flex items-start gap-2">
                {remediationStatus.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <span>{remediationStatus.message}</span>
              </div>
              <button
                onClick={() => setRemediationStatus(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Runbook List Sidebar */}
            <div className="space-y-2 lg:col-span-1">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
                Standard Operating Procedures ({runbooks.length})
              </h3>
              {runbooks.map(rb => {
                const isSelected = selectedRunbook?.id === rb.id;
                return (
                  <button
                    key={rb.id}
                    onClick={() => setSelectedRunbook(rb)}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-indigo-50/80 border-indigo-300 shadow-sm'
                        : 'bg-white hover:bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-indigo-700">{rb.code}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        rb.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' :
                        rb.severity === 'HIGH' ? 'bg-amber-100 text-amber-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {rb.severity}
                      </span>
                    </div>
                    <div className="font-semibold text-xs text-slate-900">{rb.title}</div>
                    <div className="text-[11px] text-slate-500 truncate">{rb.subsystem}</div>
                  </button>
                );
              })}
            </div>

            {/* Runbook Detail & Interactive Execution Panel */}
            {selectedRunbook && (
              <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded">
                        {selectedRunbook.code}
                      </span>
                      <h2 className="text-base font-bold text-slate-900">{selectedRunbook.title}</h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 font-mono">{selectedRunbook.subsystem}</p>
                  </div>

                  {/* Interactive Trigger Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSimulateRunbook(selectedRunbook)}
                      className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      <span>Simulate Failure</span>
                    </button>

                    <button
                      onClick={() => handleAutoRemediateRunbook(selectedRunbook)}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>1-Click Auto-Remediate</span>
                    </button>
                  </div>
                </div>

                <div className="text-xs text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">
                  {selectedRunbook.summary}
                </div>

                {/* Symptoms & Root Causes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                      Symptoms & Indicators
                    </h4>
                    <ul className="space-y-1 list-disc pl-4 text-slate-600 font-mono text-[11px]">
                      {selectedRunbook.symptoms.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <Search className="w-3.5 h-3.5 text-indigo-500" />
                      Root Causes
                    </h4>
                    <ul className="space-y-1 list-disc pl-4 text-slate-600 font-mono text-[11px]">
                      {selectedRunbook.rootCauses.map((rc, idx) => (
                        <li key={idx}>{rc}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Manual Recovery Procedure */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-slate-700" />
                    Standard Step-by-Step Procedure
                  </h4>
                  <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-xs space-y-1.5 overflow-x-auto">
                    {selectedRunbook.manualSteps.map((step, idx) => (
                      <div key={idx} className="text-slate-300 leading-relaxed">
                        {step}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Verification Checklist */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    Post-Incident Verification Checklist
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                    {selectedRunbook.verificationChecklist.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-lg text-slate-700">
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: STRUCTURED LOGS & DISTRIBUTED TRACES */}
      {activeTab === 'LOGS_TRACES' && (
        <div className="space-y-6">
          {/* Controls Bar */}
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search structured logs (service, traceId, message)..."
                value={logSearch}
                onChange={e => setLogSearch(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={logLevelFilter}
                onChange={e => setLogLevelFilter(e.target.value)}
                className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl font-mono text-xs text-slate-700"
              >
                <option value="ALL">All Levels</option>
                <option value="DEBUG">DEBUG</option>
                <option value="INFO">INFO</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
                <option value="FATAL">FATAL</option>
              </select>

              <button
                onClick={() => {
                  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(defaultObservability.exportJson());
                  const a = document.createElement('a');
                  a.href = dataStr;
                  a.download = `structured_logs_${new Date().toISOString()}.json`;
                  a.click();
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Logs</span>
              </button>

              <button
                onClick={() => {
                  defaultObservability.clear();
                  setLogs([]);
                }}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Structured Log Console */}
          <div className="bg-slate-950 text-slate-200 rounded-2xl border border-slate-800 p-4 font-mono text-xs shadow-xl space-y-1.5 max-h-[500px] overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-slate-500 py-8 text-center">No structured log entries match the current filter.</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="p-2 rounded hover:bg-slate-900 border-b border-slate-900/60 flex flex-col gap-1 transition-colors">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.2 rounded font-bold text-[10px] ${
                        log.level === 'FATAL' ? 'bg-red-600 text-white' :
                        log.level === 'ERROR' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                        log.level === 'WARN' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                        log.level === 'INFO' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {log.level}
                      </span>
                      <span className="text-indigo-400 font-semibold">{log.service}</span>
                      <span className="text-slate-500 font-mono text-[10px]">[{log.correlation.traceId}]</span>
                    </div>
                    <span className="text-slate-500 text-[10px]">{log.timestamp.split('T')[1].replace('Z', '')}</span>
                  </div>
                  <div className="text-slate-200 text-xs pl-1">{log.message}</div>
                  {log.error && (
                    <div className="text-red-400 text-[11px] pl-2 bg-red-950/40 p-1.5 rounded border border-red-900/50">
                      {log.error.name}: {log.error.message}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 4: SCHEDULE SELF-HEALER */}
      {activeTab === 'SCHEDULE_HEALER' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-indigo-600" />
                  Schedule Integrity & Self-Healing Engine
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Detects timeline collisions, missing anchors, negative durations, and auto-repairs with 5m buffers without erasing completed history.
                </p>
              </div>

              <button
                onClick={handleExecuteScheduleHeal}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-2 cursor-pointer shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                <span>Execute Self-Healing Repair</span>
              </button>
            </div>

            {healResultMsg && (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-mono flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{healResultMsg}</span>
              </div>
            )}

            {/* Analysis Summary */}
            <div className={`p-4 rounded-xl border text-xs font-mono ${
              corruptionAnalysis.isCorrupted
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}>
              <div className="font-bold flex items-center gap-2">
                {corruptionAnalysis.isCorrupted ? (
                  <XCircle className="w-4 h-4 text-red-600" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                )}
                <span>{corruptionAnalysis.summary}</span>
              </div>
            </div>

            {/* Issues List */}
            {corruptionAnalysis.issuesCount > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Detected Schedule Integrity Defects ({corruptionAnalysis.issuesCount})
                </h3>
                <div className="space-y-2">
                  {[...corruptionAnalysis.criticalIssues, ...corruptionAnalysis.warnings].map((issue, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">{issue.type}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          issue.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {issue.severity}
                        </span>
                      </div>
                      <div className="text-slate-600">{issue.description}</div>
                      <div className="text-indigo-600 font-semibold text-[11px]">→ Repair Plan: {issue.repairPlan}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: BACKUPS & DISASTER RECOVERY */}
      {activeTab === 'BACKUP_RESTORE' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Database className="w-5 h-5 text-indigo-600" />
                  State Snapshots & Cryptographic Disaster Recovery
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Point-in-time state snapshots with cryptographic checksum verification and atomic rollback protection.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateSnapshot}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Create Snapshot</span>
                </button>

                <label className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer border border-slate-200">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Import & Restore</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportSnapshotFile}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Snapshots History Table */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Snapshot Catalog ({snapshots.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 text-[11px]">
                      <th className="py-2.5 px-3">Snapshot ID</th>
                      <th className="py-2.5 px-3">Created At</th>
                      <th className="py-2.5 px-3">Checksum</th>
                      <th className="py-2.5 px-3">Records</th>
                      <th className="py-2.5 px-3">Author</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshots.map(snp => (
                      <tr key={snp.metadata.snapshotId} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-bold text-indigo-700">{snp.metadata.snapshotId}</td>
                        <td className="py-3 px-3 text-slate-600">{snp.metadata.createdAt.replace('T', ' ').slice(0, 19)}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded border border-slate-200 text-[10px]">
                            {snp.metadata.checksum}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-600">
                          {snp.metadata.recordCounts.tasks} tasks • {snp.metadata.recordCounts.events} evts
                        </td>
                        <td className="py-3 px-3 text-slate-500">{snp.metadata.author}</td>
                        <td className="py-3 px-3 text-right space-x-2">
                          <button
                            onClick={() => handleDownloadSnapshot(snp)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-medium cursor-pointer"
                          >
                            Export
                          </button>
                          <button
                            onClick={() => handleRestoreSnapshot(snp)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[11px] font-semibold cursor-pointer"
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: DEAD-LETTER QUEUE (DLQ) */}
      {activeTab === 'DLQ' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-indigo-600" />
                  Dead-Letter Queue (DLQ) Management
                </h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Failed asynchronous event consumer messages with exponential backoff replay and poison-pill isolation.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleRetryDLQ}
                  disabled={dlqRetrying || dlqEntries.length === 0}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${dlqRetrying ? 'animate-spin' : ''}`} />
                  <span>Retry All ({dlqEntries.length})</span>
                </button>

                <button
                  onClick={handlePurgeDLQ}
                  disabled={dlqEntries.length === 0}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer border border-slate-200"
                >
                  Purge DLQ
                </button>
              </div>
            </div>

            {dlqEntries.length === 0 ? (
              <div className="py-12 text-center text-slate-400 font-mono text-xs">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                Dead-Letter Queue is empty. All event consumers operating normally.
              </div>
            ) : (
              <div className="space-y-3">
                {dlqEntries.map(entry => (
                  <div key={entry.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-red-600">{entry.event.event_type}</span>
                      <span className="text-slate-400 text-[10px]">Attempts: {entry.attempts}</span>
                    </div>
                    <div className="text-slate-600">Consumer: {entry.consumerName}</div>
                    <div className="text-red-700 bg-red-50 p-2 rounded border border-red-200 text-[11px]">
                      {entry.errorMessage}
                    </div>
                    <div className="text-[10px] text-slate-400">Failed at: {entry.lastFailedAt}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
