import React, { useState } from 'react';
import { AppState } from '../types';
import { EveningReviewView } from './EveningReviewView';
import { WeeklyPerformanceView } from './WeeklyPerformanceView';
import { CalendarDays, Moon } from 'lucide-react';

interface ReviewWorkspaceViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const ReviewWorkspaceView: React.FC<ReviewWorkspaceViewProps> = ({ state, onUpdateState }) => {
  const [tab, setTab] = useState<'TODAY' | 'WEEK'>('TODAY');

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          onClick={() => setTab('TODAY')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${tab === 'TODAY' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <Moon className="w-3.5 h-3.5" />
          Today
        </button>
        <button
          onClick={() => setTab('WEEK')}
          className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${tab === 'WEEK' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
        >
          <CalendarDays className="w-3.5 h-3.5" />
          Week
        </button>
      </div>

      {tab === 'TODAY'
        ? <EveningReviewView state={state} onUpdateState={onUpdateState} />
        : <WeeklyPerformanceView state={state} />}
    </div>
  );
};
