/**
 * Autonomous Personal Execution Standalone System (Execution OS)
 * Pure standalone life and routine operating system with time anchors,
 * 3-tier failure protocols, Next Action dispatch, trading gatekeeper, 7-pillar engine,
 * Day-matched color palettes, and strict time-bound discipline accountability.
 */

import React, { useState, useEffect } from 'react';
import { AppState, RoutineTask } from './types';
import { DEFAULT_APP_STATE } from './data/defaultData';
import { 
  loadAppState, 
  saveAppState, 
  calculate7Pillars, 
  checkNeverMissTwice,
  PENALTY_POINTS_MISSED_WINDOW,
  getCurrentTimeMinutes
} from './services/storageService';
import { getActiveDayTheme } from './services/dayThemeService';
import { Header } from './components/Header';
import { NavigationTabs } from './components/NavigationTabs';
import { MobileBottomNav } from './components/MobileBottomNav';
import { NowView } from './components/NowView';
import { TodayView } from './components/TodayView';
import { TomorrowPlannerView } from './components/TomorrowPlannerView';
import { ReviewWorkspaceView } from './components/ReviewWorkspaceView';
import { SystemWorkspaceView } from './components/SystemWorkspaceView';
import { MorningPrimeView } from './components/MorningPrimeView';
import { CommandCenterView } from './components/CommandCenterView';
import { DeepWorkView } from './components/DeepWorkView';
import { TradingProtocolView } from './components/TradingProtocolView';
import { FamilyLifeView } from './components/FamilyLifeView';
import { RewardEngineView } from './components/RewardEngineView';
import { AdaptationProposalsView } from './components/AdaptationProposalsView';
import { EventAuditLedgerView } from './components/EventAuditLedgerView';
import { BackgroundSchedulerHUD } from './components/BackgroundSchedulerHUD';
import { CrossDeviceSyncView } from './components/CrossDeviceSyncView';
import { OperationsCenterView } from './components/OperationsCenterView';
import { PerformanceWorkspaceView } from './components/PerformanceWorkspaceView';
import { DisciplineModal } from './components/DisciplineModal';
import { AccessibleConfirmModal } from './components/ui/AccessibleConfirmModal';
import { Download, Upload, RotateCcw } from 'lucide-react';
import { sound } from './services/soundService';
import { defaultApplicationService } from './services/executionApplicationService';
import { AcceptDisciplinePenaltyCommand } from './commands';
import { reconcileLifecycleState } from './services/reconciliationEngine';
import { defaultCrossDeviceSyncEngine } from './services/crossDeviceSyncEngine';

export default function App() {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadAppState();
    // Deterministic instant reconciliation upon client hydration
    const reconciled = reconcileLifecycleState(loaded, undefined, { triggerOrigin: 'CLIENT_HYDRATION' });
    return reconciled.state;
  });
  const [disciplineTaskToReview, setDisciplineTaskToReview] = useState<RoutineTask | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Automatically persist state changes to localStorage
  useEffect(() => {
    saveAppState(state);
  }, [state]);

  // Periodic Cross-Device Background Sync
  useEffect(() => {
    defaultCrossDeviceSyncEngine.startPeriodicSync(4000, updatedState => {
      setState(updatedState);
    });

    return () => {
      defaultCrossDeviceSyncEngine.stopPeriodicSync();
    };
  }, []);

  const sevenPillarsData = calculate7Pillars(state);
  const neverMissTwiceAlert = checkNeverMissTwice(state);
  const activeTheme = getActiveDayTheme(state);
  const currentMinutes = getCurrentTimeMinutes(state);

  const handleUpdateState = (updater: (prev: AppState) => AppState) => {
    setState(prev => updater(prev));
  };

  const handleNavigateToView = (view: AppState['activeView']) => {
    sound.playChime('tick');
    setState(prev => ({ ...prev, activeView: view }));
  };

  const handleRequestDisciplineCheck = (task: RoutineTask) => {
    setDisciplineTaskToReview(task);
  };

  const handleSelectTaskFromTimeline = (task: RoutineTask) => {
    // Contextual routing based on task type
    if (task.anchorId === 'ANCHOR_2_PRIME' || task.id.includes('prime') || task.id.includes('light') || task.id.includes('workout')) {
      handleNavigateToView('MORNING_PRIME');
    } else if (task.anchorId === 'ANCHOR_3_COMMAND') {
      handleNavigateToView('COMMAND_CENTER');
    } else if (task.anchorId === 'ANCHOR_5_DEEPWORK_BUILD' || task.category === 'DEEP_WORK') {
      handleNavigateToView('DEEP_WORK');
    } else if (task.id === 'task-trading-prep' || task.category === 'TRADING') {
      handleNavigateToView('TRADING');
    } else if (task.anchorId === 'ANCHOR_8_HUMAN_LIFE' || task.category === 'LIFE' || task.id === 'task-family-life') {
      handleNavigateToView('FAMILY');
    } else if (task.anchorId === 'ANCHOR_10_REVIEW' || task.category === 'EVENING') {
      handleNavigateToView('REVIEW');
    } else {
      handleNavigateToView('NOW');
    }
  };

  const handleAcceptPenaltyAndComplete = async (task: RoutineTask) => {
    sound.playChime('penalty');
    const result = await defaultApplicationService.dispatch(
      new AcceptDisciplinePenaltyCommand({
        taskId: task.id,
        penaltyPoints: PENALTY_POINTS_MISSED_WINDOW,
      }),
      state
    );

    if (result.success && result.state) {
      setState(result.state);
    } else {
      // Fallback
      setState(prev => {
        const updatedTasks = prev.tasks.map(t =>
          t.id === task.id ? { 
            ...t, 
            completed: true, 
            completedAtMinutes: currentMinutes,
            executionStatus: 'MISSED_LATE' as const,
            missedWindow: true,
            penaltyCutPoints: PENALTY_POINTS_MISSED_WINDOW,
          } : t
        );

        const nextPoints = Math.max(0, prev.rewardPoints - PENALTY_POINTS_MISSED_WINDOW);
        const nextPenaltiesCount = (prev.disciplinePenaltiesCount || 0) + 1;

        return {
          ...prev,
          tasks: updatedTasks,
          rewardPoints: nextPoints,
          disciplinePenaltiesCount: nextPenaltiesCount,
        };
      });
    }

    setDisciplineTaskToReview(null);
  };

  const handleExportBackup = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `execution_os_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setState({
          ...DEFAULT_APP_STATE,
          ...parsed,
        });
        sound.playChime('success');
      } catch (err) {
        sound.playChime('warning');
      }
    };
    reader.readAsText(file);
  };

  const handleResetToDefaults = () => {
    setState(DEFAULT_APP_STATE);
    setShowResetConfirm(false);
    sound.playChime('start');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col selection:bg-slate-200 selection:text-slate-900 font-sans pb-16 sm:pb-0">
      {/* 1. Header with Mode Switcher, Day Palette indicator & Time Simulator */}
      <Header
        state={state}
        onUpdateState={handleUpdateState}
        sevenPillarsData={sevenPillarsData}
        neverMissTwiceAlert={neverMissTwiceAlert}
      />

      {/* 2. Navigation Tabs (Desktop) */}
      <NavigationTabs
        state={state}
        activeView={state.activeView}
        onSelectView={handleNavigateToView}
        uncompletedCounts={{}}
      />

      {/* 3. Main Dynamic Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        
        {/* Core Execution Workspace Views */}
        {(state.activeView === 'NOW' || state.activeView === 'DASHBOARD') && (
          <NowView
            state={state}
            onUpdateState={handleUpdateState}
            onNavigateToView={handleNavigateToView}
            onRequestDisciplineModal={handleRequestDisciplineCheck}
          />
        )}

        {(state.activeView === 'TODAY' || state.activeView === 'ALL_TASKS') && (
          <TodayView
            state={state}
            onSelectTask={handleSelectTaskFromTimeline}
            onRequestDisciplineModal={handleRequestDisciplineCheck}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'TOMORROW_PLANNER' && (
          <TomorrowPlannerView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {(state.activeView === 'REVIEW' || state.activeView === 'EVENING') && (
          <ReviewWorkspaceView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {/* HEE-011 Human Performance Workspace */}
        {state.activeView === 'PERFORMANCE' && (
          <PerformanceWorkspaceView
            state={state}
            onPrepareSession={sessionId => {
              defaultApplicationService.execute({
                type: 'PreparePerformanceSession',
                payload: { sessionId }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onReadySession={sessionId => {
              defaultApplicationService.execute({
                type: 'ReadyPerformanceSession',
                payload: { sessionId }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onStartSession={sessionId => {
              defaultApplicationService.execute({
                type: 'StartPerformanceSession',
                payload: { sessionId }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onPauseSession={sessionId => {
              defaultApplicationService.execute({
                type: 'PausePerformanceSession',
                payload: { sessionId }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onResumeSession={sessionId => {
              defaultApplicationService.execute({
                type: 'ResumePerformanceSession',
                payload: { sessionId }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onAdvanceStep={(sessionId, stepIndex, payload) => {
              defaultApplicationService.execute({
                type: 'AdvancePerformanceStep',
                payload: { sessionId, stepIndex, ...payload }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onAttachArtifact={(sessionId, artifact) => {
              defaultApplicationService.execute({
                type: 'AttachPerformanceArtifact',
                payload: { sessionId, ...artifact }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onRecordEvidence={(sessionId, evidence) => {
              defaultApplicationService.execute({
                type: 'RecordPerformanceEvidence',
                payload: { sessionId, type: evidence.type, source: 'USER', trustLevel: 'E1', payload: evidence.payload }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onRequestExtension={(sessionId, requestedMinutes, reason) => {
              defaultApplicationService.execute({
                type: 'RequestPerformanceExtension',
                payload: { sessionId, requestedMinutes, reason }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onCloseSession={(sessionId, outcome, quality, reason) => {
              defaultApplicationService.execute({
                type: 'ClosePerformanceSession',
                payload: { sessionId, outcome, qualityAssessment: quality, reason }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onCancelSession={(sessionId, reason) => {
              defaultApplicationService.execute({
                type: 'CancelPerformanceSession',
                payload: { sessionId, reason }
              }).then(res => { if (res.success && res.state) setState(res.state); });
            }}
            onNavigateToNow={() => handleNavigateToView('NOW')}
          />
        )}

        {/* System Workspace View */}
        {state.activeView === 'SYSTEM' && (
          <SystemWorkspaceView
            state={state}
            onUpdateState={handleUpdateState}
            onRequestDisciplineCheck={handleRequestDisciplineCheck}
          />
        )}

        {/* Contextual Execution Suites */}
        {state.activeView === 'MORNING_PRIME' && (
          <MorningPrimeView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'COMMAND_CENTER' && (
          <CommandCenterView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'DEEP_WORK' && (
          <DeepWorkView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'TRADING' && (
          <TradingProtocolView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'FAMILY' && (
          <FamilyLifeView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {/* Specialized Hub Direct Views (if launched directly) */}
        {state.activeView === 'OPERATIONS' && (
          <OperationsCenterView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'BACKGROUND_WORKER' && (
          <BackgroundSchedulerHUD
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'CROSS_DEVICE_SYNC' && (
          <CrossDeviceSyncView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'REWARDS' && (
          <RewardEngineView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'ADAPTATION_LAB' && (
          <AdaptationProposalsView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}

        {state.activeView === 'EVENT_AUDIT' && (
          <EventAuditLedgerView
            state={state}
            onUpdateState={handleUpdateState}
          />
        )}
      </main>

      {/* 4. Strict Discipline Violation & Accountability Modal */}
      {disciplineTaskToReview && (
        <DisciplineModal
          task={disciplineTaskToReview}
          currentMinutes={currentMinutes}
          onAcceptPenaltyAndComplete={handleAcceptPenaltyAndComplete}
          onClose={() => setDisciplineTaskToReview(null)}
        />
      )}

      {/* 5. Accessible Reset Confirmation Modal */}
      <AccessibleConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetToDefaults}
        title="Reset Execution State?"
        message="This will reset today's routine tasks and allocations back to the initial defaults."
        confirmText="Reset Now"
        variant="danger"
      />

      {/* 6. Mobile Bottom Navigation */}
      <MobileBottomNav
        activeView={state.activeView}
        onSelectView={handleNavigateToView}
      />

      {/* 7. Footer System Bar (Desktop) */}
      <footer className="hidden sm:block border-t border-slate-200/80 bg-white py-3.5 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div 
              className="w-2 h-2 rounded-full" 
              style={{ backgroundColor: activeTheme.colorHex }}
            />
            <span className="text-slate-600">
              Execution OS • Mode: <strong className="text-slate-800 font-semibold">{state.currentMode}</strong> • Day: <strong className="text-slate-800 font-semibold">{activeTheme.dayName}</strong> • Strictness: <strong className="text-emerald-700 font-semibold">Active</strong>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportBackup}
              className="hover:text-slate-900 flex items-center gap-1 transition-colors text-slate-600"
              title="Export state as JSON file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
            </button>

            <label className="hover:text-slate-900 flex items-center gap-1 cursor-pointer transition-colors text-slate-600">
              <Upload className="w-3.5 h-3.5" />
              <span>Import</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>

            <button
              onClick={() => setShowResetConfirm(true)}
              className="hover:text-red-600 flex items-center gap-1 transition-colors text-slate-500"
              title="Reset state to initial routine defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
