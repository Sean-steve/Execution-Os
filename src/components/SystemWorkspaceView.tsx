import React, { useState } from 'react';
import { 
  Terminal, 
  Cpu, 
  Laptop, 
  Sparkles, 
  Layers, 
  Award, 
  ListOrdered, 
  Shield, 
  Sliders, 
  Database, 
  RotateCcw,
  CheckCircle2,
  FileDown,
  FileUp,
  Settings,
  Flame,
  Activity,
  History
} from 'lucide-react';
import { AppState, AutonomyLevel, SystemMode } from '../types';
import { OperationsCenterView } from './OperationsCenterView';
import { CrossDeviceSyncView } from './CrossDeviceSyncView';
import { BackgroundSchedulerHUD } from './BackgroundSchedulerHUD';
import { AdaptationProposalsView } from './AdaptationProposalsView';
import { EventAuditLedgerView } from './EventAuditLedgerView';
import { RewardEngineView } from './RewardEngineView';
import { TimelineRoutineView } from './TimelineRoutineView';
import { getActiveDayTheme } from '../services/dayThemeService';
import { sound } from '../services/soundService';
import { AccessibleConfirmModal } from './ui/AccessibleConfirmModal';

export type SystemSubTab = 
  | 'ROUTINES'
  | 'GOVERNANCE'
  | 'INSIGHTS'
  | 'REWARDS'
  | 'CONTINUITY'
  | 'BACKGROUND'
  | 'OPERATIONS'
  | 'EVENT_LEDGER'
  | 'SETTINGS';

interface SystemWorkspaceViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onRequestDisciplineCheck: (task: any) => void;
  initialSubTab?: SystemSubTab;
}

export const SystemWorkspaceView: React.FC<SystemWorkspaceViewProps> = ({
  state,
  onUpdateState,
  onRequestDisciplineCheck,
  initialSubTab = 'ROUTINES',
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SystemSubTab>(initialSubTab);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const activeTheme = getActiveDayTheme(state);

  const subTabs = [
    { id: 'ROUTINES' as const, label: 'Routines & Anchors', icon: ListOrdered },
    { id: 'GOVERNANCE' as const, label: 'Governance & Autonomy', icon: Shield },
    { id: 'INSIGHTS' as const, label: 'Insights & Evolution', icon: Sparkles },
    { id: 'REWARDS' as const, label: 'Reward Vault', icon: Award },
    { id: 'CONTINUITY' as const, label: 'Continuity OS', icon: Laptop },
    { id: 'BACKGROUND' as const, label: 'Background OS', icon: Cpu },
    { id: 'OPERATIONS' as const, label: 'Operations & SRE', icon: Terminal },
    { id: 'EVENT_LEDGER' as const, label: 'Event Ledger', icon: Layers },
    { id: 'SETTINGS' as const, label: 'Settings & Backup', icon: Settings },
  ];

  const handleExportState = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `execution-os-backup-${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 3000);
  };

  const handleImportState = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported && Array.isArray(imported.tasks)) {
          onUpdateState(() => imported);
          sound.playChime('success');
        }
      } catch (err) {
        sound.playChime('warning');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-200">
      
      {/* System Workspace Header */}
      <div className="border-b border-slate-200/80 pb-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <Settings className="w-3.5 h-3.5" />
          <span>System Workspace</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
          System Governance, Evolution & Operations
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Deep configuration, telemetry, multi-device continuity, and longitudinal adaptation intelligence.
        </p>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-4">
          {subTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all shrink-0 ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sub-View Content */}
      <div className="min-h-[500px]">
        {activeSubTab === 'ROUTINES' && (
          <TimelineRoutineView
            state={state}
            onUpdateState={onUpdateState}
            onSelectTask={() => {}}
            onRequestDisciplineModal={onRequestDisciplineCheck}
          />
        )}

        {activeSubTab === 'GOVERNANCE' && (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Autonomy & Execution Governance
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Configure how aggressively the Autonomous OS recalculates deviations and enforces schedule boundaries.
                </p>
              </div>

              {/* Autonomy Level Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  { level: 4 as AutonomyLevel, title: 'Full Autonomous', desc: 'OS resolves 100% of deviations automatically without prompting unless strict conflicts arise.' },
                  { level: 2 as AutonomyLevel, title: 'Assisted Autonomy', desc: 'OS suggests optimal realignments with one-click approval prompts.' },
                  { level: 0 as AutonomyLevel, title: 'Manual Only', desc: 'User manually approves all timeline reflows and fallbacks.' },
                ].map(item => (
                  <button
                    key={item.level}
                    onClick={() => {
                      sound.playChime('start');
                      onUpdateState(prev => ({ ...prev, autonomyLevel: item.level }));
                    }}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      state.autonomyLevel === item.level
                        ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="text-sm font-bold text-slate-900">{item.title}</div>
                    <div className="text-xs text-slate-500 mt-1">{item.desc}</div>
                  </button>
                ))}
              </div>

              {/* Strict Enforcement Toggle */}
              <div className="p-4 rounded-xl border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Strict Time Enforcement</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Requires discipline justification modal if tasks are checked off late.
                  </div>
                </div>
                <button
                  onClick={() => {
                    sound.playChime('start');
                    onUpdateState(prev => ({ ...prev, strictTimeEnforcement: !prev.strictTimeEnforcement }));
                  }}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    state.strictTimeEnforcement
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {state.strictTimeEnforcement ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'INSIGHTS' && (
          <AdaptationProposalsView
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'REWARDS' && (
          <RewardEngineView
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'CONTINUITY' && (
          <CrossDeviceSyncView
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'BACKGROUND' && (
          <BackgroundSchedulerHUD
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'OPERATIONS' && (
          <OperationsCenterView
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'EVENT_LEDGER' && (
          <EventAuditLedgerView
            state={state}
            onUpdateState={onUpdateState}
          />
        )}

        {activeSubTab === 'SETTINGS' && (
          <div className="space-y-6">
            {/* Backup & Export */}
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Data Backup & Portability
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Export complete execution state, longitudinal history, and custom blueprints.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={handleExportState}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-2"
                >
                  <FileDown className="w-4 h-4" />
                  <span>{exportSuccess ? 'Downloaded!' : 'Export JSON Backup'}</span>
                </button>

                <label className="px-4 py-2.5 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer">
                  <FileUp className="w-4 h-4 text-slate-500" />
                  <span>Restore from Backup</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportState}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {/* Reset Defaults */}
            <div className="p-6 rounded-2xl bg-white border border-rose-200/80 shadow-xs space-y-4">
              <div>
                <h3 className="text-base font-bold text-rose-950">
                  Reset System State
                </h3>
                <p className="text-xs text-rose-700 mt-0.5">
                  Reset tasks and schedule allocations to standard clean daily defaults.
                </p>
              </div>

              <button
                onClick={() => setShowResetConfirm(true)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                Reset to Default Routine
              </button>
            </div>
          </div>
        )}
      </div>

      <AccessibleConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={() => {
          localStorage.removeItem('execution_os_state');
          window.location.reload();
        }}
        title="Reset Execution State?"
        message="This will reset today's tasks and allocations back to the initial standard routine defaults."
        confirmText="Reset Now"
        variant="danger"
      />
    </div>
  );
};
