import React, { useState } from 'react';
import { 
  Cpu, 
  Play, 
  Pause, 
  RefreshCw, 
  Bell, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Sparkles, 
  ShieldCheck, 
  ArrowRight, 
  Moon, 
  Sun, 
  Zap,
  Activity,
  History,
  Check
} from 'lucide-react';
import { AppState, BackgroundJobRecord, BackgroundJobType, ExecutionNotification } from '../types';
import { defaultApiClient } from '../services/apiClient';
import { formatMinutesTo12Hour } from '../clock';

interface BackgroundSchedulerHUDProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onDispatchEvent?: (eventName: string, payload: any) => void;
}

export const BackgroundSchedulerHUD: React.FC<BackgroundSchedulerHUDProps> = ({
  state,
  onUpdateState,
}) => {
  const [isTickLoading, setIsTickLoading] = useState(false);
  const [isOfflineSimLoading, setIsOfflineSimLoading] = useState(false);
  const [runningJobId, setRunningJobId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'JOBS' | 'OFFLINE_SCENARIO' | 'NOTIFICATIONS'>('JOBS');
  const [simulatedWakeTime, setSimulatedWakeTime] = useState<string>('08:30');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const scheduler = state.scheduler || {
    enabled: true,
    isRunning: true,
    mode: 'ACTIVE',
    lastTickAt: null,
    nextScheduledTickAt: null,
    tickIntervalMs: 30000,
    timezone: state.timezone || 'UTC',
    jobs: [],
    lastReconciliation: null,
    totalJobsExecuted: 0,
    successfulJobsCount: 0,
    failedJobsCount: 0,
  };

  const notifications = state.notifications || [];
  const unreadNotifications = notifications.filter(n => !n.read);

  // Manual Trigger: Single-pass Authoritative Reconciliation
  const handleTriggerTick = async () => {
    setIsTickLoading(true);
    setStatusMessage('Executing single-pass authoritative reconciliation...');
    try {
      const res = await defaultApiClient.triggerSchedulerTick();
      if (res.data?.state) {
        onUpdateState(() => res.data.state);
      }
      setStatusMessage(`Reconciliation complete: ${res.data?.result?.summary || 'State aligned'}`);
    } catch (err: any) {
      setStatusMessage(`Tick failed: ${err.message}`);
    } finally {
      setIsTickLoading(false);
    }
  };

  // Run a specific background job
  const handleRunJob = async (job: BackgroundJobRecord) => {
    setRunningJobId(job.id);
    setStatusMessage(`Running job: ${job.name}...`);
    try {
      const res = await defaultApiClient.runSchedulerJob(job.type);
      setStatusMessage(`Job completed: ${res.data?.summary || 'Success'}`);
      // Refresh state
      const stateRes = await defaultApiClient.getFullState();
      if (stateRes.data) {
        onUpdateState(() => stateRes.data);
      }
    } catch (err: any) {
      setStatusMessage(`Job failed: ${err.message}`);
    } finally {
      setRunningJobId(null);
    }
  };

  // Toggle Background Worker
  const handleToggleWorker = async () => {
    const nextEnabled = !scheduler.enabled;
    try {
      const res = await defaultApiClient.toggleScheduler(nextEnabled);
      onUpdateState(prev => ({
        ...prev,
        scheduler: {
          ...(prev.scheduler || scheduler),
          enabled: nextEnabled,
          isRunning: nextEnabled,
        },
      }));
      setStatusMessage(`Background worker ${nextEnabled ? 'enabled' : 'paused'}.`);
    } catch (err: any) {
      setStatusMessage(`Toggle failed: ${err.message}`);
    }
  };

  // Simulate Offline Scenario
  const handleSimulateOffline = async () => {
    setIsOfflineSimLoading(true);
    setStatusMessage('Simulating offline night transition (Plan at 9PM -> Sleep -> Wake at ' + simulatedWakeTime + ')...');
    try {
      const [hours, mins] = simulatedWakeTime.split(':').map(Number);
      const wakeMinutes = hours * 60 + mins;
      const res = await defaultApiClient.simulateOfflineScenario(wakeMinutes);
      if (res.data?.state) {
        onUpdateState(() => res.data.state);
      }
      setStatusMessage(`Offline recovery verified! Reconciled: ${res.data?.reconciliation?.summary}`);
    } catch (err: any) {
      setStatusMessage(`Simulation error: ${err.message}`);
    } finally {
      setIsOfflineSimLoading(false);
    }
  };

  const handleMarkRead = async (notifId: string) => {
    try {
      await defaultApiClient.markNotificationRead(notifId);
      onUpdateState(prev => ({
        ...prev,
        notifications: (prev.notifications || []).map(n =>
          n.id === notifId ? { ...n, read: true } : n
        ),
      }));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header Banner & Status */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 relative overflow-hidden border border-slate-800 shadow-xl">
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Cpu className="w-48 h-48 text-indigo-400" />
        </div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
                <Cpu className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-white">
                Background Execution OS & Scheduler (EOS-014)
              </h2>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider ${
                scheduler.enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}>
                <span className={`w-2 h-2 rounded-full ${scheduler.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {scheduler.enabled ? 'Governed 24/7 Engine Active' : 'Standby / Paused'}
              </span>
            </div>
            <p className="text-sm text-slate-300 max-w-2xl leading-relaxed">
              Execution correctness does not depend on a browser tab being open. The governed background worker manages 
              day-boundary transitions, autonomous day activation, tomorrow plan evaluation, expired allocation detection, 
              and offline state catch-up 24 hours a day.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="btn-reconcile-tick"
              onClick={handleTriggerTick}
              disabled={isTickLoading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isTickLoading ? 'animate-spin' : ''}`} />
              Reconcile State Now
            </button>
            <button
              id="btn-toggle-worker"
              onClick={handleToggleWorker}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all ${
                scheduler.enabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500'
              }`}
            >
              {scheduler.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {scheduler.enabled ? 'Pause Daemon' : 'Resume Daemon'}
            </button>
          </div>
        </div>

        {/* Telemetry Bar */}
        <div className="mt-6 pt-6 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <span className="text-slate-400 block">Cadence / Mode</span>
            <span className="text-slate-200 font-semibold">{scheduler.tickIntervalMs / 1000}s Adaptive · {scheduler.mode}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Timezone Scope</span>
            <span className="text-slate-200 font-semibold">{scheduler.timezone}</span>
          </div>
          <div>
            <span className="text-slate-400 block">Jobs Executed</span>
            <span className="text-emerald-400 font-semibold">{scheduler.totalJobsExecuted} ({scheduler.successfulJobsCount} passed)</span>
          </div>
          <div>
            <span className="text-slate-400 block">Active Date Context</span>
            <span className="text-slate-200 font-semibold">{state.activeDate || 'Today'}</span>
          </div>
        </div>

        {statusMessage && (
          <div className="mt-4 p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-indigo-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* 2. Navigation Tabs for Worker HUD */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('JOBS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'JOBS'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Layers className="w-4 h-4" />
          Governed Background Jobs ({scheduler.jobs?.length || 0})
        </button>

        <button
          onClick={() => setActiveTab('OFFLINE_SCENARIO')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
            activeTab === 'OFFLINE_SCENARIO'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          Offline Scenario Harness
        </button>

        <button
          onClick={() => setActiveTab('NOTIFICATIONS')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all relative ${
            activeTab === 'NOTIFICATIONS'
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
        >
          <Bell className="w-4 h-4" />
          Notifications & Alerts
          {unreadNotifications.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500 text-white ml-1">
              {unreadNotifications.length}
            </span>
          )}
        </button>
      </div>

      {/* 3. TAB CONTENT */}

      {/* TAB A: Governed Background Jobs Table */}
      {activeTab === 'JOBS' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Autonomous Lifecycle Jobs Registry
            </h3>
            <span className="text-xs text-slate-500">
              Idempotent · Retry-Safe · Observable · User-Scoped
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {(scheduler.jobs || []).map((job) => {
              const isJobRunning = runningJobId === job.id;
              return (
                <div
                  key={job.id}
                  id={`job-card-${job.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between shadow-xs hover:border-slate-300 transition-all"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-mono font-bold text-indigo-600 px-2 py-0.5 rounded bg-indigo-50 border border-indigo-100">
                        {job.type}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
                        job.status === 'COMPLETED'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        {job.status}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-sm font-bold text-slate-900 leading-snug">{job.name}</h4>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{job.description}</p>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-[11px] font-mono space-y-1">
                      <div className="flex justify-between text-slate-600">
                        <span>Runs: <strong className="text-slate-800">{job.executionCount}</strong></span>
                        <span>Retries: <strong className="text-slate-800">{job.retryCount}</strong></span>
                      </div>
                      <div className="text-slate-500 truncate" title={job.lastResultSummary}>
                        Outcome: <span className="text-slate-800">{job.lastResultSummary || 'Awaiting tick'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] text-slate-400 font-mono">
                      {job.lastRunAt ? new Date(job.lastRunAt).toLocaleTimeString() : 'Not run yet'}
                    </span>
                    <button
                      id={`btn-run-job-${job.id}`}
                      onClick={() => handleRunJob(job)}
                      disabled={isJobRunning}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      <Play className={`w-3 h-3 ${isJobRunning ? 'animate-spin' : ''}`} />
                      {isJobRunning ? 'Executing...' : 'Run Job'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB B: Offline Scenario Simulator */}
      {activeTab === 'OFFLINE_SCENARIO' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-8">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-700 font-bold text-sm uppercase tracking-wider">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Governed Offline Transition & Feasibility Reconciler
            </div>
            <h3 className="text-xl font-bold text-slate-900">
              Zero Tab-Dependency Verification
            </h3>
            <p className="text-sm text-slate-600 max-w-3xl leading-relaxed">
              Demonstrates the offline lifecycle guarantee: The user plans tomorrow at 9:00 PM, closes the app, 
              sleeps through midnight, and opens the application at a later wake time. The Execution OS reconciles 
              yesterday's 7 Pillars history, activates today's plan, applies late wake compression if drifted, and establishes 
              what remains feasible—without needing any tab to remain open.
            </p>
          </div>

          {/* Step-by-step Flowchart */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 relative">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500">
                <span>Phase 1</span>
                <Moon className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="font-bold text-slate-900 text-sm">9:00 PM Evening</div>
              <p className="text-xs text-slate-600">
                User plans tomorrow anchors and definition of victory. Durable plan written to store.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500">
                <span>Phase 2</span>
                <Pause className="w-4 h-4 text-amber-500" />
              </div>
              <div className="font-bold text-slate-900 text-sm">App Closed (Sleep)</div>
              <p className="text-xs text-slate-600">
                Zero client code executes. Browser tab closed. No active polling or memory leaks.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500">
                <span>Phase 3</span>
                <Zap className="w-4 h-4 text-indigo-500" />
              </div>
              <div className="font-bold text-slate-900 text-sm">Midnight Boundary</div>
              <p className="text-xs text-slate-600">
                Server daemon or deterministic hydration archives yesterday & promotes tomorrow plan.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono font-bold text-emerald-700">
                <span>Phase 4</span>
                <Sun className="w-4 h-4 text-amber-500" />
              </div>
              <div className="font-bold text-emerald-900 text-sm">User Re-opens App</div>
              <p className="text-xs text-emerald-700">
                State reconciles instantly. Late wake drift compressed, 4:00 PM family boundary safeguarded.
              </p>
            </div>
          </div>

          {/* Interactive Simulation Panel */}
          <div className="p-6 rounded-xl bg-slate-900 text-white space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h4 className="text-base font-bold text-white">Execute Offline Scenario Test</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Advances the authoritative clock across the midnight boundary to the specified wake time.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                  <Clock className="w-4 h-4 text-slate-400" />
                  <span className="text-xs text-slate-300">Wake Time:</span>
                  <input
                    type="time"
                    id="input-sim-wake-time"
                    value={simulatedWakeTime}
                    onChange={e => setSimulatedWakeTime(e.target.value)}
                    className="bg-transparent text-white font-mono text-xs font-bold focus:outline-none"
                  />
                </div>

                <button
                  id="btn-execute-offline-sim"
                  onClick={handleSimulateOffline}
                  disabled={isOfflineSimLoading}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/30 transition-all disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 ${isOfflineSimLoading ? 'animate-spin' : ''}`} />
                  {isOfflineSimLoading ? 'Simulating...' : 'Run Offline Simulation'}
                </button>
              </div>
            </div>

            {scheduler.lastReconciliation && (
              <div className="p-4 rounded-lg bg-slate-800/90 border border-slate-700 space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-emerald-400">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Check className="w-4 h-4" /> Latest Reconciliation Output
                  </span>
                  <span>{new Date(scheduler.lastReconciliation.reconciledAt).toLocaleTimeString()}</span>
                </div>
                <p className="text-xs text-slate-200 font-mono leading-relaxed">
                  {scheduler.lastReconciliation.summary}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] font-mono text-slate-400 border-t border-slate-700/60">
                  <div>Boundary: <strong className="text-white">{scheduler.lastReconciliation.dayBoundaryCrossed ? 'Crossed' : 'No'}</strong></div>
                  <div>Day Active: <strong className="text-white">{scheduler.lastReconciliation.dayActivated ? 'Yes' : 'No'}</strong></div>
                  <div>Drift: <strong className="text-white">+{scheduler.lastReconciliation.timeDriftMinutes}m</strong></div>
                  <div>Expired Tasks: <strong className="text-white">{scheduler.lastReconciliation.expiredAllocationsCount}</strong></div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB C: Notification Feed */}
      {activeTab === 'NOTIFICATIONS' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Bell className="w-4 h-4 text-indigo-600" />
              Durable Notification Feed ({notifications.length})
            </h3>
            <span className="text-xs text-slate-500 font-mono">
              Governed Broadcast Dispatcher
            </span>
          </div>

          {notifications.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              No notifications dispatched yet.
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-4 rounded-xl border transition-all flex items-start justify-between gap-4 ${
                    notif.read
                      ? 'bg-slate-50 border-slate-200 text-slate-600'
                      : 'bg-white border-indigo-200 shadow-xs text-slate-900'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                        notif.priority === 'HIGH' || notif.type === 'TIME_CRITICAL'
                          ? 'bg-rose-100 text-rose-800'
                          : notif.type === 'DAY_ACTIVATION'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-indigo-100 text-indigo-800'
                      }`}>
                        {notif.type}
                      </span>
                      <h4 className="text-xs font-bold">{notif.title}</h4>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(notif.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">{notif.message}</p>
                  </div>

                  {!notif.read && (
                    <button
                      onClick={() => handleMarkRead(notif.id)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-all shrink-0"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
