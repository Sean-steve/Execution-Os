import React, { useState } from 'react';
import { 
  TrendingUp, 
  ShieldCheck, 
  AlertTriangle, 
  CheckSquare, 
  Square, 
  Lock, 
  FileText, 
  CheckCircle2,
  Sparkles,
  Info
} from 'lucide-react';
import { AppState, TradingProtocol } from '../types';
import { sound } from '../services/soundService';
import confetti from 'canvas-confetti';
import { defaultApplicationService } from '../services/executionApplicationService';
import { RecordTradingProtocolCommand } from '../commands';

interface TradingProtocolViewProps {
  state: AppState;
  onUpdateState: (updater: (prev: AppState) => AppState) => void;
}

export const TradingProtocolView: React.FC<TradingProtocolViewProps> = ({
  state,
  onUpdateState,
}) => {
  const protocol = state.tradingProtocol;
  const [setupName, setSetupName] = useState(protocol.setupName || '');
  const [notes, setNotes] = useState(protocol.tradeNotes || '');

  const updateProtocol = async (updates: Partial<TradingProtocol>) => {
    sound.playChime('start');
    const nextProtocol: TradingProtocol = { ...state.tradingProtocol, ...updates };

    const recorded = await defaultApplicationService.dispatch(
      new RecordTradingProtocolCommand({ protocol: updates }),
      state
    );
    if (!recorded.success || !recorded.state) return;

    let workingState = recorded.state;
    const isComplete =
      !nextProtocol.isTradingDay ||
      (nextProtocol.marketAnalyzed && nextProtocol.closedTerminal && nextProtocol.noSetupJustified && !nextProtocol.executed) ||
      (
        nextProtocol.marketAnalyzed &&
        nextProtocol.setupDetected &&
        nextProtocol.strategyCriteriaMet &&
        nextProtocol.riskLimitsSatisfied &&
        nextProtocol.stopLossDefined &&
        nextProtocol.closedTerminal
      );

    if (isComplete) {
      const target = workingState.tasks.find(t => t.id === 'task-trading-protocol') ||
        workingState.tasks.find(t => t.id === 'task-trading-prep');
      if (target && !target.completed) {
        const completed = await defaultApplicationService.completeActivity({
          taskId: target.id,
          executionStatus: 'ON_TIME',
        }, workingState);
        if (completed.success && completed.state) workingState = completed.state;
      }
    }

    onUpdateState(() => workingState);
  };

  const handleToggleStep = (field: keyof TradingProtocol) => {
    const currentVal = protocol[field];
    updateProtocol({ [field]: !currentVal });
  };

  const handleSaveNotes = (e: React.FormEvent) => {
    e.preventDefault();
    sound.playChime('success');
    updateProtocol({ setupName, tradeNotes: notes });
  };

  const handleAffirmNoSetup = () => {
    sound.playChime('success');
    try {
      confetti({ particleCount: 30, spread: 50, origin: { y: 0.6 } });
    } catch {
      // ignore
    }
    updateProtocol({
      marketAnalyzed: true,
      setupDetected: false,
      noSetupJustified: true,
      closedTerminal: true,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* View Header */}
      <div className="border-b border-slate-200 pb-4">
        <div className="flex items-center gap-2 text-emerald-600 font-mono text-xs uppercase tracking-wider font-bold">
          <TrendingUp className="w-4 h-4" />
          <span>Wealth & Capital Preservation Protocol</span>
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mt-1">
          Trading Protocol Gatekeeper
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          "Trading is an objective execution system, never an emotional habit. <span className="text-emerald-700 font-bold">No setup = No trade.</span>"
        </p>
      </div>

      {/* Core Protocol Rule Banner */}
      <div className="rounded-2xl bg-white border border-emerald-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <h4 className="font-bold text-slate-900 font-mono uppercase">
              The Golden Law of Capital Preservation
            </h4>
            <p className="text-slate-600 mt-0.5 leading-relaxed">
              A productive day is NOT measured by whether you placed a trade. If the market does not offer an A+ setup conforming to rules, stepping away with zero trades is a 100% victorious execution.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-slate-500 font-medium">Trading Day?</span>
          <button
            id="trading-day-toggle-btn"
            onClick={() => updateProtocol({ isTradingDay: !protocol.isTradingDay })}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold font-mono transition-all border ${
              protocol.isTradingDay
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-xs'
                : 'bg-slate-100 text-slate-600 border-slate-200'
            }`}
          >
            {protocol.isTradingDay ? 'ACTIVE TRADING DAY' : 'NON-TRADING DAY'}
          </button>
        </div>
      </div>

      {protocol.isTradingDay ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left: Step-by-Step Gatekeeper (7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2">
                  <span>Execution Gatekeeper Checklist</span>
                </h3>
                <span className="text-xs font-mono text-slate-500 font-medium">
                  Sequential Protocol
                </span>
              </div>

              {/* Step 1: Market Analysis */}
              <div
                onClick={() => handleToggleStep('marketAnalyzed')}
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  protocol.marketAnalyzed
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                }`}
              >
                {protocol.marketAnalyzed ? (
                  <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <h4 className="text-xs font-bold font-mono">1. Objective Market Analysis Complete</h4>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Analyzed higher timeframe trends, key support/resistance, macroeconomic releases, and volatility regimes.
                  </p>
                </div>
              </div>

              {/* Step 2: Setup Detected */}
              <div
                onClick={() => handleToggleStep('setupDetected')}
                className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                  protocol.setupDetected
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                    : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                }`}
              >
                {protocol.setupDetected ? (
                  <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                ) : (
                  <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <h4 className="text-xs font-bold font-mono">2. Valid Strategy Setup Detected</h4>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    Clear entry trigger present that matches predefined edge (breakout retest, mean reversion, liquidity sweep).
                  </p>
                </div>
              </div>

              {/* Fast Exit: No Setup Detected Rule */}
              {protocol.marketAnalyzed && !protocol.setupDetected && (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-800 font-mono">
                    <Info className="w-4 h-4 text-amber-600" />
                    <span>No Valid Setup in Market Today</span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    You have analyzed the market and no edge is present. Respect the rule, close charts, and protect capital.
                  </p>
                  <button
                    onClick={handleAffirmNoSetup}
                    className="mt-1 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs shadow-sm flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Affirm "No Setup = No Trade" & Close Gate (+5 pts)</span>
                  </button>
                </div>
              )}

              {/* Step 3: Strategy Criteria Met */}
              {protocol.setupDetected && (
                <>
                  <div
                    onClick={() => handleToggleStep('strategyCriteriaMet')}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      protocol.strategyCriteriaMet
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    {protocol.strategyCriteriaMet ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h4 className="text-xs font-bold font-mono">3. Full Strategy Confluence Confirmed</h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Minimum 3 independent confluence factors aligned. Not anticipating or guessing.
                      </p>
                    </div>
                  </div>

                  {/* Step 4: Risk Limits Satisfied */}
                  <div
                    onClick={() => handleToggleStep('riskLimitsSatisfied')}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      protocol.riskLimitsSatisfied
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    {protocol.riskLimitsSatisfied ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h4 className="text-xs font-bold font-mono">4. Risk Limits & Position Sizing Satisfied</h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Fixed risk per trade (&le; 1-2% of account). Stop loss mathematically determined, R:R &ge; 2:1.
                      </p>
                    </div>
                  </div>

                  {/* Step 5: Execution & Hard Stop */}
                  <div
                    onClick={() => handleToggleStep('executed')}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      protocol.executed
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    {protocol.executed ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h4 className="text-xs font-bold font-mono">5. Order Executed with Hard Stop Loss in Place</h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Stop loss and profit targets entered simultaneously. No manual widening of stops.
                      </p>
                    </div>
                  </div>

                  {/* Step 6: Hard Stop Terminal Close */}
                  <div
                    onClick={() => handleToggleStep('closedTerminal')}
                    className={`p-3.5 rounded-xl border flex items-start gap-3 cursor-pointer transition-all ${
                      protocol.closedTerminal
                        ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-100/60'
                    }`}
                  >
                    {protocol.closedTerminal ? (
                      <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h4 className="text-xs font-bold font-mono">6. HARD STOP: Close Charts & Step Away</h4>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        Do not stare at P&L or candlestick wiggles. Let the trade work or hit stop. Return to deep work.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Trade Journal & Parameters (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl bg-white border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-base font-bold text-slate-900 font-mono flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  <span>Trading Journal</span>
                </h3>
                <span className="text-xs font-mono text-slate-500 font-medium">Log Entry</span>
              </div>

              <form onSubmit={handleSaveNotes} className="space-y-3">
                <div>
                  <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                    Setup / Ticker / Asset:
                  </label>
                  <input
                    type="text"
                    value={setupName}
                    onChange={e => setSetupName(e.target.value)}
                    placeholder="e.g. EURUSD London Liquidity Sweep or BTC Retest"
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 font-semibold focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono text-slate-500 uppercase font-bold">
                    Trade Execution Notes & R:R Reasoning:
                  </label>
                  <textarea
                    rows={4}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Document entry price, stop level, take profit, thesis, and emotional discipline state..."
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 focus:bg-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 leading-relaxed resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all"
                >
                  Save to Trade Journal (+3 pts)
                </button>
              </form>

              {protocol.noSetupJustified && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-mono font-medium">
                  ✓ "No Setup = No Trade" status logged. Wealth Pillar satisfied today.
                </div>
              )}
            </div>
          </div>

        </div>
      ) : (
        /* Non-Trading Day Card */
        <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center max-w-xl mx-auto space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-500">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 font-mono">
            Non-Trading Day Configured
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed">
            Market screens remain closed. You are allocating 100% of your cognitive bandwidth to primary company systems, software engineering, and family.
          </p>
          <button
            onClick={() => updateProtocol({ isTradingDay: true })}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold border border-slate-200"
          >
            Switch to Active Trading Day
          </button>
        </div>
      )}
    </div>
  );
};
