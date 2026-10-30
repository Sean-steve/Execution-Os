import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Clock, 
  Sparkles, 
  AlertTriangle, 
  Calendar, 
  Sliders, 
  RotateCcw,
  Zap,
  Flame,
  Sun,
  Cpu,
  Heart,
  TrendingUp,
  ShieldAlert,
  Palette,
  Laptop,
  Wifi,
  Volume2,
  VolumeX,
  Lock,
  Layers,
  HelpCircle
} from 'lucide-react';
import { AppState, SystemMode, DayType } from '../types';
import { formatMinutesToTime, getCurrentTimeMinutes } from '../services/storageService';
import { DAY_THEMES, getActiveDayTheme, getActiveDayIndex } from '../services/dayThemeService';
import { scanAndResolveDeviations } from '../services/deviationEngine';
import { sound } from '../services/soundService';
import { AccessibleConfirmModal } from './ui/AccessibleConfirmModal';
import { RealityChangeModal } from './ui/RealityChangeModal';

interface HeaderProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
  sevenPillarsData: {
    score: number;
    total: number;
    ratingText: string;
    ratingBadgeColor: string;
  };
  neverMissTwiceAlert: {
    hasAlert: boolean;
    message: string;
  };
}

export const Header: React.FC<HeaderProps> = ({
  state,
  onUpdateState,
  sevenPillarsData,
  neverMissTwiceAlert,
}) => {
  const [liveTimeString, setLiveTimeString] = useState('');
  const [showTimeTravelModal, setShowTimeTravelModal] = useState(false);
  const [showDaySelector, setShowDaySelector] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showRealityModal, setShowRealityModal] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setLiveTimeString(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentMinutes = getCurrentTimeMinutes(state);
  const currentTimeDisplay = state.isSimulatedTime 
    ? `${formatMinutesToTime(currentMinutes)} (Sim)`
    : liveTimeString || formatMinutesToTime(currentMinutes);

  const activeTheme = getActiveDayTheme(state);
  const activeDayIndex = getActiveDayIndex(state);
  const isAutoDay = state.selectedDayOverride === null || state.selectedDayOverride === undefined;

  const handleSetMode = (mode: SystemMode) => {
    onUpdateState(prev => ({ ...prev, currentMode: mode }));
  };

  const handleSetDayType = (dayType: DayType) => {
    const todayDayOfWeek = new Date().getDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = todayDayOfWeek === 0 || todayDayOfWeek === 6;

    if (dayType === 'STRONG_ENDS' && !isWeekend && state.selectedDayOverride !== 0 && state.selectedDayOverride !== 6) {
      sound.playChime('warning');
      setAlertMessage('Strong Ends is strictly reserved for weekends (Saturday & Sunday). On weekdays, use Standard Routine or Early Exit to protect core focus & enterprise production.');
      setShowAlertModal(true);
      return;
    }
    onUpdateState(prev => ({ ...prev, dayType }));
  };

  const handleSelectDayOverride = (dayIdx: number | null) => {
    onUpdateState(prev => ({
      ...prev,
      selectedDayOverride: dayIdx,
    }));
    setShowDaySelector(false);
  };

  const presetTimes = [
    { label: '5:30 AM Awaken', time: '05:30' },
    { label: '6:30 AM Command', time: '06:30' },
    { label: '7:45 AM Deep Work', time: '07:45' },
    { label: '12:30 PM Production', time: '12:30' },
    { label: '4:30 PM Family', time: '16:30' },
    { label: '8:00 PM Review', time: '20:00' },
    { label: '9:30 PM Live', time: '21:30' },
  ];

  const getDayIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sun': return <Sun className="w-3.5 h-3.5" />;
      case 'Zap': return <Zap className="w-3.5 h-3.5" />;
      case 'Flame': return <Flame className="w-3.5 h-3.5" />;
      case 'Cpu': return <Cpu className="w-3.5 h-3.5" />;
      case 'TrendingUp': return <TrendingUp className="w-3.5 h-3.5" />;
      case 'Heart': return <Heart className="w-3.5 h-3.5" />;
      default: return <Sparkles className="w-3.5 h-3.5" />;
    }
  };

  return (
    <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-40 shadow-xs">
      {/* Top Banner for Never Miss Twice Alert */}
      {neverMissTwiceAlert.hasAlert && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
            <span>{neverMissTwiceAlert.message}</span>
          </div>
          <span className="bg-amber-100 text-amber-800 font-mono text-[10px] px-2 py-0.5 rounded-md border border-amber-200 uppercase tracking-wider font-bold">
            High Priority Anchor
          </span>
        </div>
      )}

      {/* Main Header Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left: Brand & Day Accent */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-xs text-white transition-colors ${activeTheme.classes.accentBg}`}>
              {getDayIcon(activeTheme.iconName)}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-slate-900">
                  Execution OS
                </span>
                <button
                  onClick={() => setShowDaySelector(!showDaySelector)}
                  className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded border font-bold flex items-center gap-1 transition-all ${activeTheme.classes.badge} hover:brightness-95`}
                  title="Switch Day Theme Color Palette"
                >
                  <Palette className="w-2.5 h-2.5" />
                  <span>{activeTheme.shortName}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Mode Switcher Pill */}
          <div className="flex items-center bg-slate-100 border border-slate-200/80 rounded-xl p-0.5 text-xs">
            <button
              id="mode-green-btn"
              onClick={() => handleSetMode('GREEN')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                state.currentMode === 'GREEN'
                  ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Green Mode: Full standard routine"
            >
              Green
            </button>
            <button
              id="mode-yellow-btn"
              onClick={() => handleSetMode('YELLOW')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                state.currentMode === 'YELLOW'
                  ? 'bg-amber-500 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Yellow Mode: Minimum Viable Routine"
            >
              Yellow
            </button>
            <button
              id="mode-red-btn"
              onClick={() => handleSetMode('RED')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                state.currentMode === 'RED'
                  ? 'bg-red-600 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
              title="Red Mode: Crisis Recovery protocol"
            >
              Red
            </button>
          </div>
        </div>

        {/* Right: Quick Action, Simulation Clock & Stats */}
        <div className="flex items-center gap-2 flex-wrap justify-end w-full md:w-auto text-xs">
          
          {/* "Something Changed" Quick Reality Button */}
          <button
            onClick={() => setShowRealityModal(true)}
            id="header-reality-change-btn"
            className="px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Something changed</span>
          </button>

          {/* Time Display & Simulation Trigger */}
          <button
            id="time-travel-btn"
            onClick={() => setShowTimeTravelModal(!showTimeTravelModal)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all shadow-xs ${
              state.isSimulatedTime
                ? 'bg-amber-50 border-amber-300 text-amber-800 font-bold'
                : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
            }`}
            title="Click to simulate clock time"
          >
            <Clock className={`w-3.5 h-3.5 ${activeTheme.classes.accentText}`} />
            <span>{currentTimeDisplay}</span>
            <Sliders className="w-3 h-3 text-slate-400" />
          </button>

          {/* 7-Pillars Score */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium shadow-xs ${sevenPillarsData.ratingBadgeColor}`}
            title={`Daily Score: ${sevenPillarsData.score}/7`}
          >
            <Shield className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-mono font-bold">{sevenPillarsData.score}/7</span>
          </div>

          {/* Reward Points */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 shadow-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span className="font-mono font-bold">{state.rewardPoints} pts</span>
          </div>
        </div>
      </div>

      {/* Day Theme Drawer */}
      {showDaySelector && (
        <div className="bg-slate-900 text-white px-4 py-3 border-b border-slate-800 text-xs animate-in slide-in-from-top duration-150 shadow-xl">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div>
              <div className="font-bold text-slate-200 flex items-center gap-2">
                <Palette className="w-4 h-4 text-indigo-400" />
                <span>Day Color Palette Matching Engine</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Colors dynamically adapt to the day of the week. Select a day or keep Auto:
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => handleSelectDayOverride(null)}
                className={`px-3 py-1.5 rounded-xl border text-xs transition-all ${
                  isAutoDay
                    ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow-xs'
                    : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Auto (Today: {DAY_THEMES[new Date().getDay()]?.shortName})
              </button>

              {Object.values(DAY_THEMES).map(t => {
                const isSelected = activeDayIndex === t.dayIndex && !isAutoDay;
                return (
                  <button
                    key={t.dayIndex}
                    onClick={() => handleSelectDayOverride(t.dayIndex)}
                    className={`px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 transition-all ${
                      isSelected
                        ? 'bg-white text-slate-950 font-bold border-white shadow-md'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span 
                      className="w-2.5 h-2.5 rounded-full inline-block shrink-0" 
                      style={{ backgroundColor: t.colorHex }} 
                    />
                    <span>{t.shortName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Time Simulator Drawer */}
      {showTimeTravelModal && (
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-4 text-xs animate-in slide-in-from-top duration-150 shadow-inner space-y-3">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-700">
              <Clock className={`w-4 h-4 ${activeTheme.classes.accentText}`} />
              <span className="font-semibold text-slate-900">Time Phase Simulator:</span>
              <span className="text-slate-500 text-[11px]">Jump clock to evaluate autonomous reallocation:</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {presetTimes.map(preset => (
                <button
                  key={preset.time}
                  onClick={() => {
                    sound.playChime('tick');
                    onUpdateState(prev => {
                      const nextState = {
                        ...prev,
                        isSimulatedTime: true,
                        simulatedTime: preset.time,
                      };
                      const scan = scanAndResolveDeviations(nextState);
                      return scan.updatedState;
                    });
                  }}
                  className={`px-2.5 py-1 rounded-lg border text-[11px] font-mono transition-colors ${
                    state.isSimulatedTime && state.simulatedTime === preset.time
                      ? `${activeTheme.classes.accentBg} text-white ${activeTheme.classes.accentBorder} font-bold shadow-xs`
                      : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}

              <button
                onClick={() => {
                  onUpdateState(prev => {
                    const nextState = {
                      ...prev,
                      isSimulatedTime: false,
                    };
                    const scan = scanAndResolveDeviations(nextState);
                    return scan.updatedState;
                  });
                  setShowTimeTravelModal(false);
                }}
                className="px-3 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 border border-slate-300 flex items-center gap-1 text-[11px] font-medium font-mono"
              >
                <RotateCcw className="w-3 h-3" />
                Live Clock
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Accessible Modals */}
      <AccessibleConfirmModal
        isOpen={showAlertModal}
        onClose={() => setShowAlertModal(false)}
        onConfirm={() => setShowAlertModal(false)}
        title="Schedule Notice"
        message={alertMessage}
        confirmText="Understood"
        cancelText="Close"
        variant="warning"
      />

      <RealityChangeModal
        isOpen={showRealityModal}
        onClose={() => setShowRealityModal(false)}
        state={state}
        onUpdateState={onUpdateState}
      />
    </header>
  );
};
