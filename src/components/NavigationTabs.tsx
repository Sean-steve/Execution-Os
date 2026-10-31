import React from 'react';
import { 
  Compass, 
  Clock, 
  Calendar, 
  Moon, 
  Settings, 
  Sparkles,
  Sun,
  Cpu,
  TrendingUp,
  Heart,
  ChevronLeft
} from 'lucide-react';
import { AppState } from '../types';
import { getActiveDayTheme } from '../services/dayThemeService';

interface NavigationTabsProps {
  state: AppState;
  activeView: AppState['activeView'];
  onSelectView: (view: AppState['activeView']) => void;
  uncompletedCounts?: Record<string, number>;
}

export const NavigationTabs: React.FC<NavigationTabsProps> = ({
  state,
  activeView,
  onSelectView,
}) => {
  const activeTheme = getActiveDayTheme(state);

  // Check if we are in an active Contextual Execution Suite
  const isContextualSuite = 
    activeView === 'PERFORMANCE' ||
    activeView === 'MORNING_PRIME' || 
    activeView === 'DEEP_WORK' || 
    activeView === 'TRADING' || 
    activeView === 'FAMILY' || 
    activeView === 'COMMAND_CENTER';

  const primaryTabs = [
    {
      id: 'NOW' as const,
      matchingViews: ['NOW', 'DASHBOARD'],
      label: 'Now',
      icon: Compass,
      badge: 'Active',
    },
    {
      id: 'TODAY' as const,
      matchingViews: ['TODAY', 'ALL_TASKS'],
      label: 'Today',
      icon: Clock,
    },
    {
      id: 'TOMORROW_PLANNER' as const,
      matchingViews: ['TOMORROW_PLANNER'],
      label: 'Tomorrow',
      icon: Calendar,
    },
    {
      id: 'REVIEW' as const,
      matchingViews: ['REVIEW', 'EVENING'],
      label: 'Review',
      icon: Moon,
    },
    {
      id: 'SYSTEM' as const,
      matchingViews: ['SYSTEM', 'OPERATIONS', 'CROSS_DEVICE_SYNC', 'BACKGROUND_WORKER', 'ADAPTATION_LAB', 'EVENT_AUDIT', 'REWARDS'],
      label: 'System',
      icon: Settings,
    },
  ];

  const contextualSuites = [
    { id: 'MORNING_PRIME' as const, label: 'Morning Prime', icon: Sun },
    { id: 'DEEP_WORK' as const, label: 'Focus & Build', icon: Cpu },
    { id: 'TRADING' as const, label: 'Trading Gate', icon: TrendingUp },
    { id: 'FAMILY' as const, label: 'Family Sanctuary', icon: Heart },
  ];

  return (
    <nav aria-label="Main Navigation" className="w-full border-b border-slate-200/80 bg-white/90 backdrop-blur-xs sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        
        {/* Left: Primary Workspace Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {primaryTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.matchingViews.includes(activeView as string);
            return (
              <button
                key={tab.id}
                id={`nav-tab-${tab.id.toLowerCase()}`}
                onClick={() => onSelectView(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0 ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Right: Contextual Execution Suite Indicator (If Active) */}
        {isContextualSuite ? (
          <div className="hidden sm:flex items-center gap-2 bg-indigo-50 border border-indigo-200/80 px-3 py-1 rounded-xl text-xs">
            <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse" />
            <span className="font-semibold text-indigo-900">
              {activeView.replace('_', ' ')}
            </span>
            <button
              onClick={() => onSelectView('NOW')}
              className="ml-2 text-indigo-600 hover:text-indigo-950 font-bold underline text-[11px]"
            >
              Return to Now
            </button>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1">
            {contextualSuites.map(suite => {
              const Icon = suite.icon;
              return (
                <button
                  key={suite.id}
                  onClick={() => onSelectView(suite.id)}
                  title={`Launch ${suite.label}`}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
};
