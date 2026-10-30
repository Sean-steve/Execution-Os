import React, { useState, useEffect } from 'react';
import {
  Activity,
  Shield,
  Clock,
  Layers,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  GitBranch,
  FileText,
  RefreshCw,
  Zap,
  HelpCircle,
  TrendingUp,
  Sliders,
  UserCheck,
  Sparkles,
  Inbox,
  XCircle,
  Eye
} from 'lucide-react';
import { AppState, SystemEvent, EventType } from '../types';
import { defaultDurableEventStore } from '../services/durableEventStore';
import { defaultExecutionAuditService, ExecutionExplanation, CausalNode } from '../services/executionAuditService';
import { defaultDeadLetterQueue, DeadLetterEntry } from '../services/deadLetterQueue';
import { defaultEventChainService } from '../services/eventChains';
import { defaultEventDispatcher } from '../services/eventDispatcher';

interface EventAuditLedgerViewProps {
  state: AppState;
  onUpdateState?: (updater: (prev: AppState) => AppState) => void;
}

export const EventAuditLedgerView: React.FC<EventAuditLedgerViewProps> = ({ state }) => {
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<SystemEvent | null>(null);
  const [explanation, setExplanation] = useState<ExecutionExplanation | null>(null);
  const [causalTree, setCausalTree] = useState<CausalNode | null>(null);
  const [activeTab, setActiveTab] = useState<'EVENTS' | 'CHAINS' | 'DLQ'>('EVENTS');
  const [dlqEntries, setDlqEntries] = useState<DeadLetterEntry[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const allEvents = await defaultDurableEventStore.getEvents({ limit: 200 });
      // If store is empty, initialize with state.events
      if (allEvents.length === 0 && state.events && state.events.length > 0) {
        await defaultDurableEventStore.appendBatch(state.events);
        const reloaded = await defaultDurableEventStore.getEvents({ limit: 200 });
        setEvents(reloaded.reverse());
      } else {
        setEvents([...allEvents].reverse());
      }

      const dlq = await defaultDeadLetterQueue.list();
      setDlqEntries(dlq);
    } catch (e) {
      console.error('Failed to load events:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const unsubscribe = defaultDurableEventStore.subscribe(() => {
      loadData();
    });
    return () => unsubscribe();
  }, []);

  const handleSelectEvent = async (event: SystemEvent) => {
    setSelectedEvent(event);
    setLoading(true);
    try {
      const exp = await defaultExecutionAuditService.synthesizeExplanation(event);
      setExplanation(exp);
      const tree = await defaultExecutionAuditService.getCausalTree(event.event_id);
      setCausalTree(tree);
    } catch (e) {
      console.error('Failed to explain event:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRunCriticalChain = async (chainType: string) => {
    setLoading(true);
    try {
      let result;
      switch (chainType) {
        case 'late-wake':
          result = defaultEventChainService.createLateWakeChain('06:35', state);
          break;
        case 'missed-activity':
          result = defaultEventChainService.createMissedActivityChain('task-cardio', 'Zone 2 Cardio Workout');
          break;
        case 'fallback':
          result = defaultEventChainService.createFallbackChain('task-meditation', 'Mindset & Meditation');
          break;
        case 'reallocation':
          result = defaultEventChainService.createReallocationChain();
          break;
        case 'trading-eligibility':
          result = defaultEventChainService.createTradingEligibilityChain(true);
          break;
        case 'human-override':
          result = defaultEventChainService.createHumanOverrideChain('task-deep-work-build', 'Urgent critical client hotfix');
          break;
        case 'adaptation-proposal':
          result = defaultEventChainService.createAdaptationProposalChain();
          break;
        case 'routine-change':
          result = defaultEventChainService.createRoutineChangeChain('RED');
          break;
        case 'tomorrow-activation':
          result = defaultEventChainService.createTomorrowActivationChain('Execution OS & Durable Contracts');
          break;
        default:
          return;
      }

      await defaultDurableEventStore.appendBatch(result.events);
      await defaultEventDispatcher.dispatchBatch(result.events);
      await loadData();

      // Automatically select the last event in the generated chain to show the full diagnosis
      const lastEvent = result.events[result.events.length - 1];
      if (lastEvent) {
        await handleSelectEvent(lastEvent);
      }

      setStatusMessage(`Successfully proved event chain: ${result.chainName} (${result.events.length} events emitted)`);
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage(`Error triggering chain: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter(e => {
    const matchesSearch =
      searchTerm === '' ||
      e.event_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.event_type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (e.correlation_id && e.correlation_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.causation_id && e.causation_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (typeof e.subject === 'string' && e.subject.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.metadata?.engine && e.metadata.engine.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (e.metadata?.policy && e.metadata.policy.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = selectedTypeFilter === 'ALL' || e.event_type === selectedTypeFilter;
    return matchesSearch && matchesType;
  });

  const uniqueEventTypes = Array.from(new Set(events.map(e => e.event_type))).sort();

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* View Header */}
      <div className="border-b border-slate-200 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-mono text-xs uppercase tracking-wider font-bold">
            <Layers className="w-4 h-4" />
            <span>EOS-005 • Durable Event & Execution Contracts</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            System Event Ledger & Explainability
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Durable append-only event contracts providing complete 6-question autonomous schedule explainability.
          </p>
        </div>

        {/* View Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start">
          <button
            onClick={() => setActiveTab('EVENTS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'EVENTS'
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Event Store ({events.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('CHAINS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'CHAINS'
                ? 'bg-white text-indigo-700 shadow-xs border border-indigo-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5 text-indigo-600" />
            <span>Critical Chains (9)</span>
          </button>
          <button
            onClick={() => setActiveTab('DLQ')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              activeTab === 'DLQ'
                ? 'bg-white text-amber-700 shadow-xs border border-amber-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>Dead Letter Queue ({dlqEntries.length})</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-xl text-xs font-medium flex items-center gap-2 animate-in fade-in">
          <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* TAB 1: EVENT STORE & 6-QUESTION EXPLAINER */}
      {activeTab === 'EVENTS' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Filterable Event List */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-3">
              {/* Search & Filter Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by ID, type, engine, or correlation..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <select
                  value={selectedTypeFilter}
                  onChange={e => setSelectedTypeFilter(e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                >
                  <option value="ALL">All Event Types ({events.length})</option>
                  {uniqueEventTypes.map(t => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadData}
                  className="p-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                  title="Refresh Events"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Event List Items */}
            <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
              {filteredEvents.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-slate-500 text-xs">
                  <Inbox className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                  No events match filter criteria.
                </div>
              ) : (
                filteredEvents.map(evt => {
                  const isSelected = selectedEvent?.event_id === evt.event_id;
                  const subjectStr = typeof evt.subject === 'string' ? evt.subject : evt.subject.title || evt.subject.id;

                  return (
                    <button
                      key={evt.event_id}
                      onClick={() => handleSelectEvent(evt)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? 'bg-indigo-50/70 border-indigo-300 shadow-xs ring-1 ring-indigo-500/20'
                          : 'bg-white border-slate-200/80 hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-indigo-700 bg-indigo-100/70 px-2 py-0.5 rounded">
                          {evt.event_type}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">
                          {new Date(evt.occurred_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>

                      <div className="text-xs font-semibold text-slate-800 mt-1.5 truncate">
                        {subjectStr}
                      </div>

                      <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 font-mono">
                        <span className="truncate">Eng: {evt.metadata?.engine || 'Kernel'}</span>
                        {evt.causation_id && (
                          <span className="text-indigo-600 font-medium">↳ Caused</span>
                        )}
                        <span className="ml-auto text-slate-400">v{evt.event_version}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: 6-Question Acceptance Diagnosis */}
          <div className="lg:col-span-7 space-y-4">
            {explanation ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6 animate-in fade-in">
                {/* Header with Event Identity */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-slate-400">
                      Authoritative Event Diagnosis
                    </span>
                    <h3 className="text-lg font-bold text-slate-900 font-mono flex items-center gap-2 mt-0.5">
                      <span>{explanation.eventType}</span>
                      <span className="text-xs text-slate-400 font-normal">({explanation.eventId})</span>
                    </h3>
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-xs font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 self-start">
                    DURABLE PERSISTED
                  </span>
                </div>

                {/* The 6 ACCEPTANCE QUESTIONS */}
                <div className="space-y-4">
                  {/* 1. WHAT HAPPENED? */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-500 uppercase tracking-wider">
                      <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
                      <span>1. What Happened?</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900">
                      {explanation.whatHappened}
                    </p>
                  </div>

                  {/* 2. WHY? */}
                  <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-100 space-y-1">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-indigo-700 uppercase tracking-wider">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                      <span>2. Why?</span>
                    </div>
                    <p className="text-xs text-indigo-950 leading-relaxed font-medium">
                      {explanation.why}
                    </p>
                  </div>

                  {/* 3. WHAT CAUSED IT? */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-500 uppercase tracking-wider">
                      <GitBranch className="w-3.5 h-3.5 text-purple-600" />
                      <span>3. What Caused It?</span>
                    </div>
                    <p className="text-xs text-slate-700 font-medium">
                      {explanation.whatCausedIt.triggerDescription}
                    </p>

                    {explanation.whatCausedIt.causalAncestry.length > 1 && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-bold">
                          Chronological Causation Ancestry:
                        </span>
                        <div className="space-y-1">
                          {explanation.whatCausedIt.causalAncestry.map((anc, idx) => (
                            <div
                              key={anc.eventId}
                              className={`flex items-center gap-2 text-xs font-mono p-1.5 rounded ${
                                anc.eventId === explanation.eventId
                                  ? 'bg-purple-100 text-purple-900 font-bold'
                                  : 'bg-white border border-slate-200 text-slate-600'
                              }`}
                            >
                              <span className="text-[10px] text-slate-400">#{idx + 1}</span>
                              <span className="font-semibold">{anc.eventType}</span>
                              <span className="text-[10px] text-slate-400 truncate">({anc.eventId})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4 & 5. ENGINE & POLICY GRID */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* 4. WHICH ENGINE DECIDED? */}
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        <span>4. Which Engine Decided?</span>
                      </div>
                      <p className="text-xs font-mono font-bold text-slate-900">
                        {explanation.whichEngineDecided}
                      </p>
                    </div>

                    {/* 5. WHICH POLICY ALLOWED IT? */}
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold text-slate-500 uppercase tracking-wider">
                        <Shield className="w-3.5 h-3.5 text-emerald-600" />
                        <span>5. Which Policy Allowed It?</span>
                      </div>
                      <p className="text-xs font-mono font-bold text-slate-900">
                        {explanation.whichPolicyAllowedIt}
                      </p>
                    </div>
                  </div>

                  {/* 6. WHAT STATE CHANGED? */}
                  <div className="p-4 rounded-xl bg-slate-900 text-slate-100 font-mono space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-3.5 h-3.5" />
                        <span>6. What State Changed?</span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-normal">State Diff Record</span>
                    </div>
                    <p className="text-xs text-slate-300 font-sans font-medium">
                      {explanation.whatStateChanged.summary}
                    </p>
                    <pre className="text-[11px] bg-slate-950/80 p-3 rounded-lg overflow-x-auto text-emerald-300/90 border border-slate-800">
                      {JSON.stringify(explanation.whatStateChanged.diff, null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Raw Event Envelope Collapsible */}
                <details className="text-xs font-mono text-slate-500 pt-2 border-t border-slate-100">
                  <summary className="cursor-pointer font-bold text-slate-700 hover:text-indigo-600">
                    View Complete Raw Event Envelope ({explanation.eventId})
                  </summary>
                  <pre className="mt-2 p-3 bg-slate-50 rounded-lg overflow-x-auto text-[10px] text-slate-800 border border-slate-200">
                    {JSON.stringify(explanation.rawEvent, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="p-12 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-slate-500 space-y-3">
                <Eye className="w-10 h-10 mx-auto text-slate-300" />
                <h4 className="text-sm font-bold text-slate-800 font-mono">Select an Event to Audit</h4>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Click any event on the left or run a critical chain to inspect the full 6-question autonomous explainability contract.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CRITICAL FLOWS / PROVE EVENT CHAINS */}
      {activeTab === 'CHAINS' && (
        <div className="space-y-6">
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl">
            <h3 className="text-sm font-bold text-indigo-950 font-mono flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              Critical Execution Flows Proof Engine
            </h3>
            <p className="text-xs text-indigo-800/90 mt-1">
              Trigger and verify all 9 mandatory domain event chains end-to-end. Every chain persists typed event envelopes with causation ancestry and state deltas.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Late Wake */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                    Chain 1
                  </span>
                  <Clock className="w-4 h-4 text-amber-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Late Wake Recovery</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Deviation detected (06:35 wake drift) → Routine transitioned to COMPRESSED → Allocations recalculated.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('late-wake')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Prove Late Wake Chain</span>
              </button>
            </div>

            {/* 2. Missed Activity */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded">
                    Chain 2
                  </span>
                  <XCircle className="w-4 h-4 text-rose-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Missed Activity</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Activity window missed → Deviation detected → Never Miss Twice discipline penalty recorded.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('missed-activity')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span>Prove Missed Activity Chain</span>
              </button>
            </div>

            {/* 3. Fallback */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                    Chain 3
                  </span>
                  <Sliders className="w-4 h-4 text-blue-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Fallback Execution</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Fallback evaluated → Tier 1 selected (5m MED) → Allocation updated → Fallback completed.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('fallback')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-blue-400" />
                <span>Prove Fallback Chain</span>
              </button>
            </div>

            {/* 4. Reallocation */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                    Chain 4
                  </span>
                  <Layers className="w-4 h-4 text-indigo-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Dynamic Reallocation</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Reallocation requested → Family block protected constraint checked → Plan committed.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('reallocation')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span>Prove Reallocation Chain</span>
              </button>
            </div>

            {/* 5. Trading Eligibility */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
                    Chain 5
                  </span>
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Trading Gatekeeper</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Pre-market analyzed → 3 prerequisites checked → Gate evaluated → Trading session authorized.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('trading-eligibility')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Prove Trading Gate Chain</span>
              </button>
            </div>

            {/* 6. Human Override */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded">
                    Chain 6
                  </span>
                  <UserCheck className="w-4 h-4 text-purple-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Human Override</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Override requested by user → Governance safety evaluated → Override granted with state delta.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('human-override')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-purple-400" />
                <span>Prove Override Chain</span>
              </button>
            </div>

            {/* 7. Adaptation Proposal */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded">
                    Chain 7
                  </span>
                  <Sparkles className="w-4 h-4 text-cyan-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Adaptation Proposal</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Energy dip pattern detected → Buffer proposal created → Approved → Applied to blueprint.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('adaptation-proposal')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Prove Adaptation Chain</span>
              </button>
            </div>

            {/* 8. Routine Change */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                    Chain 8
                  </span>
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Routine Change</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  System Mode switched to RED → Routine transitioned to RECOVERY_ONLY → Schedule stripped.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('routine-change')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-red-400" />
                <span>Prove Routine Change Chain</span>
              </button>
            </div>

            {/* 9. Tomorrow Activation */}
            <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-teal-600 bg-teal-50 px-2 py-0.5 rounded">
                    Chain 9
                  </span>
                  <CheckCircle2 className="w-4 h-4 text-teal-600" />
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-2">Tomorrow Activation</h4>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Tomorrow plan locked → Morning 05:30 ignition → Routine activated → Allocations committed.
                </p>
              </div>
              <button
                onClick={() => handleRunCriticalChain('tomorrow-activation')}
                className="w-full py-2 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-teal-400" />
                <span>Prove Tomorrow Activation</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DEAD LETTER QUEUE (DLQ) */}
      {activeTab === 'DLQ' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Dead Letter Queue & Consumer Error Visibility
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Events where subscriber retries exceeded the maximum limit are captured here for audit and redrive.
              </p>
            </div>
            {dlqEntries.length > 0 && (
              <button
                onClick={async () => {
                  await defaultDeadLetterQueue.purge();
                  loadData();
                }}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Purge All DLQ
              </button>
            )}
          </div>

          {dlqEntries.length === 0 ? (
            <div className="p-12 text-center text-slate-500 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800 font-mono">DLQ Clean: Zero Dead Letters</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                All event consumers are executing idempotently and reliably.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {dlqEntries.map(item => (
                <div key={item.id} className="p-4 rounded-xl bg-amber-50/50 border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-amber-800">
                      Consumer: {item.consumerName}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      Failed at: {new Date(item.lastFailedAt).toLocaleTimeString()} ({item.attempts} attempts)
                    </span>
                  </div>
                  <p className="text-xs font-medium text-rose-700 font-mono">
                    Error: {item.errorMessage}
                  </p>
                  <div className="text-[10px] font-mono text-slate-600 bg-white/80 p-2 rounded border border-amber-200/60">
                    Event Type: {item.event.event_type} | ID: {item.event.event_id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
