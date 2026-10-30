import React from 'react';
import { 
  Compass, 
  Clock, 
  Calendar, 
  Moon, 
  Settings, 
  Sparkles 
} from 'lucide-react';
import { AppState } from '../types';

interface MobileBottomNavProps {
  activeView: AppState['activeView'];
  onSelectView: (view: AppState['activeView']) => void;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeView,
  onSelectView,
}) => {
  const tabs = [
    {
      id: 'NOW' as const,
      matchingViews: ['NOW', 'DASHBOARD'],
      label: 'Now',
      icon: Compass,
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

  return (
    <div className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-1.5 flex items-center justify-around shadow-lg">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const isActive = tab.matchingViews.includes(activeView as string);
        return (
          <button
            key={tab.id}
            onClick={() => onSelectView(tab.id)}
            className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all min-w-[56px] ${
              isActive
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <Icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span className="text-[10px] mt-0.5 tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};
