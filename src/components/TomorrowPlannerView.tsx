import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Calendar,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Trash2,
  Play,
  Moon,
  Sun,
  Activity,
  Heart,
  TrendingUp,
  Briefcase,
  Plane,
  Flame,
  Coffee,
  Check,
  RotateCcw,
  Zap,
  ArrowRight
} from 'lucide-react';
import {
  AppState,
  TomorrowPlan,
  TomorrowAppointment,
  TomorrowDesiredActivity,
  TomorrowDeadline,
  TomorrowDesiredRoutine,
  TomorrowSpecialCondition,
  TomorrowFeasibilityResult,
  DayActivationResult,
  LateWakeRecoveryResult
} from '../types';
import {
  evaluateTomorrowFeasibility,
  activateTomorrowIntent,
  executeLateWakeRecovery
} from '../services/tomorrowPlanningEngine';
import { formatMinutesTo12Hour, parseTimeToMinutes } from '../clock';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';

interface TomorrowPlannerViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  onExecuteCommand?: (command: any) => Promise<any>;
}

export const TomorrowPlannerView: React.FC<TomorrowPlannerViewProps> = ({
  state,
  onUpdateState,
  onExecuteCommand,
}) => {
  // Plan form state initialized from state.tomorrowPlan
  const [wakeTime, setWakeTime] = useState(state.tomorrowPlan.desiredWakeTime || '05:30');
  const [definitionOfVictory, setDefinitionOfVictory] = useState(
    state.tomorrowPlan.definitionOfVictory || 'Ship core architecture & protect 4:00 PM family time'
  );
  const [top1, setTop1] = useState(state.tomorrowPlan.top3?.[0] || '');
  const [top2, setTop2] = useState(state.tomorrowPlan.top3?.[1] || '');
  const [top3, setTop3] = useState(state.tomorrowPlan.top3?.[2] || '');

  const [appointments, setAppointments] = useState<TomorrowAppointment[]>(
    state.tomorrowPlan.appointments || []
  );
  const [hasDeparture, setHasDeparture] = useState(
    state.tomorrowPlan.departureTravelConstraints?.hasDeparture || false
  );
  const [departureTime, setDepartureTime] = useState(
    state.tomorrowPlan.departureTravelConstraints?.departureTime || '09:00'
  );
  const [departureBuffer, setDepartureBuffer] = useState(
    state.tomorrowPlan.departureTravelConstraints?.travelBufferMinutes || 30
  );
  const [departureDestination, setDepartureDestination] = useState(
    state.tomorrowPlan.departureTravelConstraints?.destination || 'Downtown Office'
  );

  const [desiredActivities, setDesiredActivities] = useState<TomorrowDesiredActivity[]>(
    state.tomorrowPlan.desiredActivities || []
  );
  const [deadlines, setDeadlines] = useState<TomorrowDeadline[]>(
    state.tomorrowPlan.deadlines || []
  );

  const [companyName, setCompanyName] = useState(
    state.tomorrowPlan.companyPriorities?.companyName || state.companyOfTheDay.companyName || 'NFlake Revenue Engine'
  );
  const [companyObjective, setCompanyObjective] = useState(
    state.tomorrowPlan.companyPriorities?.objective || state.companyOfTheDay.objective || 'Complete 3 outreach actions'
  );
  const [companyAction1, setCompanyAction1] = useState(
    state.tomorrowPlan.companyPriorities?.actions?.[0] || 'Contact 10 targeted enterprise prospects'
  );
  const [companyAction2, setCompanyAction2] = useState(
    state.tomorrowPlan.companyPriorities?.actions?.[1] || 'Follow up with 5 active pipeline leads'
  );
  const [companyAction3, setCompanyAction3] = useState(
    state.tomorrowPlan.companyPriorities?.actions?.[2] || 'Deliver 2 customized proposals'
  );

  const [familyActivity, setFamilyActivity] = useState(
    state.tomorrowPlan.familyCommitments?.activity || state.tomorrowPlan.familyActivity || 'Sunset park walk & unhurried dinner'
  );
  const [isTradingDay, setIsTradingDay] = useState(
    state.tomorrowPlan.tradingIntention?.isTradingDay ?? true
  );
  const [tradingFocus, setTradingFocus] = useState(
    state.tomorrowPlan.tradingIntention?.setupFocus || 'A+ Liquidity sweep setup in London/NY Open'
  );

  const [desiredRoutine, setDesiredRoutine] = useState<TomorrowDesiredRoutine>(
    state.tomorrowPlan.desiredRoutine || 'STANDARD'
  );
  const [specialCondition, setSpecialCondition] = useState<TomorrowSpecialCondition>(
    state.tomorrowPlan.specialDayConditions || 'NONE'
  );

  // New appointment input modal/inline state
  const [newAptTitle, setNewAptTitle] = useState('');
  const [newAptStart, setNewAptStart] = useState('11:00');
  const [newAptEnd, setNewAptEnd] = useState('11:30');
  const [newAptLocation, setNewAptLocation] = useState('');
  const [showAddApt, setShowAddApt] = useState(false);

  // New desired activity modal/inline state
  const [newActTitle, setNewActTitle] = useState('');
  const [newActDuration, setNewActDuration] = useState(60);
  const [newActCategory, setNewActCategory] = useState<TomorrowDesiredActivity['category']>('DEEP_WORK');
  const [showAddAct, setShowAddAct] = useState(false);

  // Status banners
  const [bannerMessage, setBannerMessage] = useState<{ type: 'SUCCESS' | 'ERROR' | 'INFO'; text: string } | null>(null);
  const [activationResult, setActivationResult] = useState<DayActivationResult | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<LateWakeRecoveryResult | null>(null);

  // Construct working plan object
  const currentPlan: TomorrowPlan = useMemo(() => {
    const wakeMins = parseTimeToMinutes(wakeTime) || 330;
    return {
      desiredWakeTime: wakeTime,
      desiredWakeMinutes: wakeMins,
      definitionOfVictory,
      top3: [top1, top2, top3],
      appointments,
      departureTravelConstraints: {
        hasDeparture,
        departureTime,
        departureMinutes: parseTimeToMinutes(departureTime) || 540,
        travelBufferMinutes: departureBuffer,
        destination: departureDestination,
      },
      desiredActivities,
      deadlines,
      companyPriorities: {
        companyName,
        objective: companyObjective,
        actions: [companyAction1, companyAction2, companyAction3].filter(Boolean),
      },
      familyCommitments: {
        activity: familyActivity,
        startMinutes: 960,
        endMinutes: 1170,
        isProtected: true,
      },
      protectedCommitments: [
        { id: 'commit-family', title: 'Protected Family Block', startMinutes: 960, endMinutes: 1170, isStrict: true },
        { id: 'commit-night', title: 'Sleep Rest Block', startMinutes: 1320, endMinutes: 1440, isStrict: true },
      ],
      tradingIntention: {
        isTradingDay,
        setupFocus: tradingFocus,
        requirePrepCheck: true,
      },
      desiredRoutine,
      specialDayConditions: specialCondition,
      knownConstraints: ['Screen cutoff at 20:00', 'Zero distractions during 4:00 PM family time'],
      scheduleFocus: top1 ? `Deep Work on ${top1}` : 'Core System Infrastructure',
      plannedMeal: 'High protein breakfast + slow carbs lunch from Meals Engine',
      workoutType: 'Full-body compound sets (arms, chest, core, legs)',
      companyPriority: companyName,
      familyActivity,
      tradingConditions: tradingFocus,
    };
  }, [
    wakeTime,
    definitionOfVictory,
    top1,
    top2,
    top3,
    appointments,
    hasDeparture,
    departureTime,
    departureBuffer,
    departureDestination,
    desiredActivities,
    deadlines,
    companyName,
    companyObjective,
    companyAction1,
    companyAction2,
    companyAction3,
    familyActivity,
    isTradingDay,
    tradingFocus,
    desiredRoutine,
    specialCondition,
  ]);

  // Real-time Feasibility Prediction
  const feasibility: TomorrowFeasibilityResult = useMemo(() => {
    return evaluateTomorrowFeasibility(currentPlan, state);
  }, [currentPlan, state]);

  // Add Appointment handler
  const handleAddAppointment = () => {
    if (!newAptTitle.trim()) return;
    const startM = parseTimeToMinutes(newAptStart) || 660;
    const endM = parseTimeToMinutes(newAptEnd) || 690;
    const newApt: TomorrowAppointment = {
      id: `apt-${Date.now()}`,
      title: newAptTitle.trim(),
      startMinutes: startM,
      endMinutes: endM,
      location: newAptLocation.trim() || undefined,
      isProtected: false,
    };
    setAppointments(prev => [...prev, newApt]);
    setNewAptTitle('');
    setNewAptLocation('');
    setShowAddApt(false);
  };

  const handleRemoveAppointment = (id: string) => {
    setAppointments(prev => prev.filter(a => a.id !== id));
  };

  // Add Desired Activity handler
  const handleAddActivity = () => {
    if (!newActTitle.trim()) return;
    const newAct: TomorrowDesiredActivity = {
      id: `des-${Date.now()}`,
      title: newActTitle.trim(),
      durationMinutes: newActDuration,
      category: newActCategory,
      isNonNegotiable: newActCategory === 'DEEP_WORK',
    };
    setDesiredActivities(prev => [...prev, newAct]);
    setNewActTitle('');
    setShowAddAct(false);
  };

  const handleRemoveActivity = (id: string) => {
    setDesiredActivities(prev => prev.filter(a => a.id !== id));
  };

  // Save Blueprint Action
  const handleSaveBlueprint = () => {
    sound.playChime('success');
    onUpdateState(prev => ({
      ...prev,
      tomorrowPlan: {
        ...currentPlan,
        lastPlannedAt: new Date().toISOString(),
        lastFeasibilityResult: feasibility,
      },
    }));

    setBannerMessage({
      type: 'SUCCESS',
      text: `Tomorrow's Blueprint saved and validated! Feasibility score: ${feasibility.feasibilityScore}/100 (${feasibility.predictedMode} Mode).`,
    });
    setTimeout(() => setBannerMessage(null), 5000);
  };

  // Autonomous Day Activation Action
  const handleActivateDay = () => {
    sound.playChime('success');
    try {
      confetti({ particleCount: 60, spread: 80, origin: { y: 0.4 } });
    } catch {
      // ignore
    }

    const { state: nextState, result } = activateTomorrowIntent(state, currentPlan);
    onUpdateState(() => nextState);
    setActivationResult(result);
    setRecoveryResult(null);
    setBannerMessage({
      type: 'SUCCESS',
      text: `Autonomous Day Activated! ${result.instantiatedTasksCount} tasks scheduled. Current Mode: ${result.activatedMode}. Next: ${result.nextAction.phaseTitle}.`,
    });
  };

  // Simulate Late Wake Recovery (+30m, +60m, +90m)
  const handleSimulateLateWake = (offsetMinutes: number) => {
    const plannedWakeMins = currentPlan.desiredWakeMinutes || 330;
    const simulatedActualWake = plannedWakeMins + offsetMinutes;

    sound.playChime('warning');
    const { state: nextState, result } = executeLateWakeRecovery(state, simulatedActualWake);
    onUpdateState(() => nextState);
    setRecoveryResult(result);
    setActivationResult(null);

    setBannerMessage({
      type: 'INFO',
      text: `Late Wake Recovery simulated (+${offsetMinutes}m drift). Routine state shifted to ${result.compressedRoutineState}. ${result.fallbacksApplied.length} morning anchors compressed.`,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Top Banner Alert */}
      {bannerMessage && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-sm font-medium ${
            bannerMessage.type === 'SUCCESS'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : bannerMessage.type === 'ERROR'
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerMessage.type === 'SUCCESS' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            className="text-xs px-2 py-1 rounded bg-black/5 hover:bg-black/10 transition"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="border-b border-slate-200 pb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-mono text-xs uppercase tracking-wider font-bold">
            <Moon className="w-4 h-4" />
            <span>Autonomous Execution OS • Sprint 6 Engine</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mt-1">
            Tomorrow Planning & Autonomous Day Activation
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Define tomorrow tonight. Execution OS evaluates mathematical feasibility, resolves conflicts, and autonomously instantiates tomorrow's schedule without manual rebuilding.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            id="btn-save-blueprint"
            onClick={handleSaveBlueprint}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:border-slate-400 bg-white text-slate-800 text-sm font-semibold shadow-sm hover:bg-slate-50 transition flex items-center gap-2"
          >
            <Shield className="w-4 h-4 text-slate-600" />
            <span>Save Blueprint</span>
          </button>

          <button
            id="btn-activate-tomorrow"
            onClick={handleActivateDay}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md shadow-indigo-200 transition flex items-center gap-2"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Activate Tomorrow</span>
          </button>
        </div>
      </div>

      {/* Real-time Feasibility HUD */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Feasibility Score Card */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                Feasibility Prediction
              </span>
              <span
                className={`px-2.5 py-1 rounded-full text-xs font-mono font-bold uppercase border ${
                  feasibility.predictedMode === 'GREEN'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : feasibility.predictedMode === 'YELLOW'
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-rose-50 border-rose-200 text-rose-700'
                }`}
              >
                {feasibility.predictedMode} MODE • {feasibility.predictedDayType}
              </span>
            </div>

            <div className="mt-4 flex items-baseline gap-3">
              <div className="text-4xl font-black font-mono text-slate-900">
                {feasibility.feasibilityScore}
                <span className="text-lg text-slate-400 font-normal">/100</span>
              </div>
              <div className="text-xs font-medium text-slate-500">
                {feasibility.isFeasible ? 'Deterministic Pass' : 'Intervention Needed'}
              </div>
            </div>

            {/* Score Bar */}
            <div className="w-full bg-slate-100 rounded-full h-2.5 mt-3 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  feasibility.feasibilityScore >= 75
                    ? 'bg-emerald-500'
                    : feasibility.feasibilityScore >= 50
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${feasibility.feasibilityScore}%` }}
              />
            </div>

            <p className="text-xs text-slate-600 mt-4 leading-relaxed">
              {feasibility.summary}
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-xs font-mono text-slate-500 flex justify-between">
            <span>Predicted Routine:</span>
            <span className="font-bold text-slate-800">{feasibility.predictedRoutineState}</span>
          </div>
        </div>

        {/* Capacity Breakdown */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500">
                Awake Capacity Math
              </span>
              <span className="text-xs font-mono font-bold text-slate-700">
                {feasibility.capacity.awakeMinutesAvailable}m Total
              </span>
            </div>

            <div className="mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  Mandatory Anchors:
                </span>
                <span className="font-mono font-semibold text-slate-800">
                  {feasibility.capacity.mandatoryAnchorMinutes}m
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Heart className="w-3.5 h-3.5 text-rose-500" />
                  Protected Family (4-7:30 PM):
                </span>
                <span className="font-mono font-semibold text-slate-800">
                  {feasibility.capacity.protectedFamilyMinutes}m
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-indigo-500" />
                  Appointments & Commitments:
                </span>
                <span className="font-mono font-semibold text-slate-800">
                  {feasibility.capacity.appointmentsMinutes}m
                </span>
              </div>

              <div className="flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-500" />
                  Custom Deep Work / Workout:
                </span>
                <span className="font-mono font-semibold text-slate-800">
                  {feasibility.capacity.customActivitiesMinutes}m
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700">Operational Buffer:</span>
            <span
              className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                feasibility.capacity.bufferPercentage >= 15
                  ? 'bg-emerald-100 text-emerald-800'
                  : feasibility.capacity.bufferPercentage >= 5
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-rose-100 text-rose-800'
              }`}
            >
              {feasibility.capacity.bufferMinutes}m ({feasibility.capacity.bufferPercentage}%)
            </span>
          </div>
        </div>

        {/* Conflict & Violation Alert Panel */}
        <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Detected Conflicts ({feasibility.conflicts.length})
              </span>
              {feasibility.conflicts.length === 0 && (
                <span className="text-xs font-mono text-emerald-600 font-bold">Zero Conflicts</span>
              )}
            </div>

            <div className="mt-3 space-y-2 max-h-48 overflow-y-auto pr-1">
              {feasibility.conflicts.length === 0 ? (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>No schedule collisions or governance violations detected. Schedule is cleanly executable.</span>
                </div>
              ) : (
                feasibility.conflicts.map(c => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-xl border text-xs space-y-1 ${
                      c.severity === 'CRITICAL'
                        ? 'bg-rose-50 border-rose-200 text-rose-900'
                        : c.severity === 'HIGH'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="font-semibold">{c.message}</div>
                    {c.resolutionOptions && c.resolutionOptions.length > 0 && (
                      <div className="text-[11px] opacity-80 pt-1">
                        <span className="font-medium">Recommended:</span> {c.resolutionOptions[0]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
            Protected Governance: Family 4:00 PM – 7:30 PM is strictly preserved.
          </div>
        </div>
      </div>

      {/* Autonomous Late Wake Testing Harness */}
      <div className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-950 text-white p-6 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-400 font-mono text-xs uppercase tracking-wider font-bold">
              <Zap className="w-4 h-4" />
              <span>Autonomous Drift & Late Wake Engine</span>
            </div>
            <h3 className="text-lg font-bold mt-1 text-white">
              Simulate Next-Morning Late Wake Recovery
            </h3>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              When waking up late, the user does NOT rebuild the schedule manually. Execution OS detects the time delta, engages Minimum Viable Routine fallbacks, compresses morning anchors, and protects deep work, departures, and 4:00 PM family time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              id="btn-simulate-late-30m"
              onClick={() => handleSimulateLateWake(30)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
              <span>+30m Late Wake</span>
            </button>

            <button
              id="btn-simulate-late-60m"
              onClick={() => handleSimulateLateWake(60)}
              className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-semibold text-white transition flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-300" />
              <span>+60m Late Wake</span>
            </button>

            <button
              id="btn-simulate-late-90m"
              onClick={() => handleSimulateLateWake(90)}
              className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/30 text-xs font-semibold text-amber-200 transition flex items-center gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>+90m Severe Drift</span>
            </button>
          </div>
        </div>

        {/* Recovery Result Banner */}
        {recoveryResult && (
          <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <span className="text-slate-400 block">Drift Detected:</span>
              <span className="text-amber-300 font-bold text-sm">+{recoveryResult.driftMinutes}m Late</span>
              <span className="text-slate-400 block text-[11px] mt-0.5">
                Planned: {formatMinutesTo12Hour(recoveryResult.plannedWakeMinutes)} → Actual: {formatMinutesTo12Hour(recoveryResult.actualWakeMinutes)}
              </span>
            </div>

            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <span className="text-slate-400 block">Compressed State:</span>
              <span className="text-emerald-300 font-bold text-sm">{recoveryResult.compressedRoutineState}</span>
              <span className="text-slate-400 block text-[11px] mt-0.5">
                {recoveryResult.fallbacksApplied.length} Anchors Compressed via Fallbacks
              </span>
            </div>

            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
              <span className="text-slate-400 block">Governance Protection:</span>
              <span className="text-indigo-200 font-bold text-sm">Family 4:00 PM Locked</span>
              <span className="text-slate-400 block text-[11px] mt-0.5">
                Trading: {recoveryResult.tradingGovernanceStatus}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Main Form: Detailed Tomorrow Intent Specification */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column: Anchors, Wake, Top 3 & Special Conditions */}
        <div className="space-y-6">
          {/* Core Anchors & Wake Time */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-500" />
              <span>Wake Time & Core Anchors</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Desired Wake Time
                </label>
                <input
                  type="time"
                  value={wakeTime}
                  onChange={e => setWakeTime(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  12h: {formatMinutesTo12Hour(parseTimeToMinutes(wakeTime) || 330)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Desired Routine Preset
                </label>
                <select
                  value={desiredRoutine}
                  onChange={e => setDesiredRoutine(e.target.value as TomorrowDesiredRoutine)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="STANDARD">STANDARD (Full 12 Anchors)</option>
                  <option value="ATHLETIC">ATHLETIC (Extended Training)</option>
                  <option value="DEEP_BUILD">DEEP_BUILD (Max Deep Work)</option>
                  <option value="COMPRESSED">COMPRESSED (Rapid Prime)</option>
                  <option value="RECOVERY">RECOVERY (Restoration & Sleep)</option>
                  <option value="MINIMUM_VIABLE">MINIMUM_VIABLE (High Constraint)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Special-Day Condition
              </label>
              <select
                value={specialCondition}
                onChange={e => setSpecialCondition(e.target.value as TomorrowSpecialCondition)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="NONE">None (Nominal Day)</option>
                <option value="TRAVEL">Travel / Flight Day</option>
                <option value="EARLY_DEPARTURE">Early Departure (Strict Exit)</option>
                <option value="STRONG_ENDS">Strong Ends (Heavy Morning & Evening Focus)</option>
                <option value="FASTING">Fasting / Low Digestive Load</option>
                <option value="INVESTOR_PITCH">Investor Pitch / High-Stakes Sync</option>
                <option value="SPRINT">Product Sprint Freeze</option>
                <option value="SICK_DAY">Sick / Physiological Recovery</option>
              </select>
            </div>
          </div>

          {/* Definition of Victory & Top 3 Priorities */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <span>Definition of Victory & Top 3 High-Impact Actions</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                10:00 PM Definition of Victory Standard
              </label>
              <input
                type="text"
                value={definitionOfVictory}
                onChange={e => setDefinitionOfVictory(e.target.value)}
                placeholder="What must happen for tomorrow to be an indisputable victory?"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Top 3 Daily High-Impact Commitments
              </label>
              <div className="space-y-2">
                <input
                  type="text"
                  value={top1}
                  onChange={e => setTop1(e.target.value)}
                  placeholder="Priority 1 (Primary Deep Work Build)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={top2}
                  onChange={e => setTop2(e.target.value)}
                  placeholder="Priority 2 (Company / Outreach Milestone)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <input
                  type="text"
                  value={top3}
                  onChange={e => setTop3(e.target.value)}
                  placeholder="Priority 3 (Personal Vitality / Family Connection)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Company Priorities & Trading Intentions */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-indigo-600" />
              <span>Company of the Day & Trading Governance</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Designated Venture
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Venture Objective
                </label>
                <input
                  type="text"
                  value={companyObjective}
                  onChange={e => setCompanyObjective(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="block text-xs font-semibold text-slate-700">
                3 Concrete Micro-Actions
              </label>
              <input
                type="text"
                value={companyAction1}
                onChange={e => setCompanyAction1(e.target.value)}
                placeholder="Action 1"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={companyAction2}
                onChange={e => setCompanyAction2(e.target.value)}
                placeholder="Action 2"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <input
                type="text"
                value={companyAction3}
                onChange={e => setCompanyAction3(e.target.value)}
                placeholder="Action 3"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Trading Toggle */}
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span>Trading Intention (Rule Gatekeeper)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setIsTradingDay(!isTradingDay)}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isTradingDay ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                      isTradingDay ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {isTradingDay && (
                <input
                  type="text"
                  value={tradingFocus}
                  onChange={e => setTradingFocus(e.target.value)}
                  placeholder="Trading setup criteria (e.g. Liquidity sweep only)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Appointments, Departure Constraints & Family Commitments */}
        <div className="space-y-6">
          {/* Fixed Appointments */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-indigo-600" />
                <span>Appointments & Syncs ({appointments.length})</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAddApt(!showAddApt)}
                className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Appointment</span>
              </button>
            </div>

            {/* Add Appointment Inline Form */}
            {showAddApt && (
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                <input
                  type="text"
                  placeholder="Appointment Title (e.g. Sync with VP of Engineering)"
                  value={newAptTitle}
                  onChange={e => setNewAptTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-slate-500 block">Start Time</label>
                    <input
                      type="time"
                      value={newAptStart}
                      onChange={e => setNewAptStart(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-300 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 block">End Time</label>
                    <input
                      type="time"
                      value={newAptEnd}
                      onChange={e => setNewAptEnd(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-300 text-xs font-mono"
                    />
                  </div>
                </div>
                <input
                  type="text"
                  placeholder="Location or Virtual Link (Optional)"
                  value={newAptLocation}
                  onChange={e => setNewAptLocation(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddApt(false)}
                    className="px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddAppointment}
                    className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium"
                  >
                    Save Appointment
                  </button>
                </div>
              </div>
            )}

            {/* Appointments List */}
            <div className="space-y-2">
              {appointments.length === 0 ? (
                <p className="text-xs text-slate-500 italic py-2">
                  No fixed appointments scheduled. Clean runway for deep work.
                </p>
              ) : (
                appointments.map(apt => (
                  <div
                    key={apt.id}
                    className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-800">{apt.title}</span>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {formatMinutesTo12Hour(apt.startMinutes)} – {formatMinutesTo12Hour(apt.endMinutes)} ({apt.endMinutes - apt.startMinutes}m)
                        {apt.location && ` • ${apt.location}`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAppointment(apt.id)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Departure & Travel Constraints */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Plane className="w-5 h-5 text-indigo-600" />
                <span>Departure & Travel Constraints</span>
              </h3>
              <button
                type="button"
                onClick={() => setHasDeparture(!hasDeparture)}
                className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  hasDeparture ? 'bg-indigo-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out ${
                    hasDeparture ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {hasDeparture && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Departure Time
                  </label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={e => setDepartureTime(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Buffer (mins)
                  </label>
                  <input
                    type="number"
                    value={departureBuffer}
                    onChange={e => setDepartureBuffer(Number(e.target.value))}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Destination
                  </label>
                  <input
                    type="text"
                    value={departureDestination}
                    onChange={e => setDepartureDestination(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Protected Family Commitment */}
          <div className="rounded-2xl bg-white border border-slate-200 p-6 shadow-sm space-y-4">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Heart className="w-5 h-5 text-rose-500" />
              <span>Protected Family Commitment (4:00 PM – 7:30 PM)</span>
            </h3>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Family Activity & Human Connection
              </label>
              <input
                type="text"
                value={familyActivity}
                onChange={e => setFamilyActivity(e.target.value)}
                placeholder="e.g. Sunset park walk, unhurried picnic, baby play"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Strict governance: The 4:00 PM – 7:30 PM window is locked. Zero meetings or builder work permitted.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
