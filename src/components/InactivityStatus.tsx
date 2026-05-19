import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Activity } from 'lucide-react';
import { InactivityStatus as InactivityStatusType } from '../services/inactivityService';
import { getActivityStatusDisplay, formatTimeRemaining } from '../services/inactivityService';

interface InactivityStatusProps {
  status: InactivityStatusType;
  threshold?: number;
}

export default function InactivityStatus({ status, threshold }: InactivityStatusProps) {
  const display = getActivityStatusDisplay(status);
  const [displayTimeRemaining, setDisplayTimeRemaining] = useState(status.timeRemaining);
  const hasThreshold = typeof threshold === 'number' && threshold > 0;
  const thresholdDays = hasThreshold ? Math.floor(threshold / (1000 * 60 * 60 * 24)) : 0;

  useEffect(() => {
    setDisplayTimeRemaining(status.timeRemaining);
  }, [status.timeRemaining]);

  useEffect(() => {
    if (!hasThreshold || status.timeRemaining <= 0) return;

    const interval = window.setInterval(() => {
      setDisplayTimeRemaining(prev => Math.max(0, prev - 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [hasThreshold, status.timeRemaining]);

  return (
    <div className={`glass-card p-8 border ${display.color}`}>
      <div className="flex items-start gap-4 mb-6">
        {status.isInactive ? (
          <AlertTriangle className={`w-8 h-8 ${display.textColor} flex-shrink-0 mt-1`} />
        ) : status.failedConditions.length > 0 ? (
          <Clock className={`w-8 h-8 ${display.textColor} flex-shrink-0 mt-1`} />
        ) : (
          <CheckCircle2 className={`w-8 h-8 ${display.textColor} flex-shrink-0 mt-1`} />
        )}
        <div className="flex-1">
          <div className={`text-2xl font-bold ${display.textColor} mb-1`}>
            {display.label}
          </div>
          <p className="text-sm text-zinc-400">
            {display.description}
          </p>
        </div>
      </div>

      {/* Conditions Grid */}
      <div className="grid grid-cols-3 gap-4 mb-8 p-4 bg-white/5 rounded-lg border border-white/10">
        <div className="text-center">
          <div className={`text-sm font-semibold mb-2 ${
            status.conditions.hasCheckIn ? 'text-emerald-400' : 'text-zinc-500'
          }`}>
            {status.conditions.hasCheckIn ? '✓' : '✗'} Check-in
          </div>
          <div className="text-xs text-zinc-600">
            {status.lastCheckIn 
              ? new Date(status.lastCheckIn).toLocaleDateString()
              : 'Never'
            }
          </div>
        </div>

        <div className="text-center border-l border-r border-white/5">
          <div className={`text-sm font-semibold mb-2 ${
            status.conditions.hasTransaction ? 'text-emerald-400' : 'text-zinc-500'
          }`}>
            {status.conditions.hasTransaction ? '✓' : '✗'} Transaction
          </div>
          <div className="text-xs text-zinc-600">
            {status.lastTransaction 
              ? new Date(status.lastTransaction).toLocaleDateString()
              : 'Never'
            }
          </div>
        </div>

        <div className="text-center">
          <div className={`text-sm font-semibold mb-2 ${
            status.conditions.hasContractInteraction ? 'text-emerald-400' : 'text-zinc-500'
          }`}>
            {status.conditions.hasContractInteraction ? '✓' : '✗'} Contract
          </div>
          <div className="text-xs text-zinc-600">
            {status.lastContractInteraction 
              ? new Date(status.lastContractInteraction).toLocaleDateString()
              : 'Never'
            }
          </div>
        </div>
      </div>

      {/* Detailed Status */}
      <div className="space-y-3 text-sm">
        {hasThreshold && (
          <div className="flex items-center justify-between">
            <div className="text-zinc-400">Threshold</div>
            <div className="font-semibold text-white">{thresholdDays} days</div>
          </div>
        )}
        {hasThreshold && (
          <div className="flex items-center justify-between">
            <div className="text-zinc-400">Time Remaining</div>
            <div className={`font-semibold ${
              displayTimeRemaining < threshold! / 4 ? 'text-orange-400' : 'text-emerald-400'
            }`}>
              {formatTimeRemaining(displayTimeRemaining)}
            </div>
          </div>
        )}

        {status.isInactive && (
          <div className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="text-red-400 font-semibold text-sm">
              ⚠ Inactivity Trigger Conditions Met
            </div>
            <p className="text-xs text-red-300 mt-2">
              User has no activity in any category
              {hasThreshold ? ` within the ${thresholdDays}-day threshold` : ''}.
              Automated distribution may be initiated.
            </p>
          </div>
        )}

        {status.failedConditions.length > 0 && !status.isInactive && (
          <div className="mt-6 p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg">
            <div className="text-orange-400 font-semibold text-sm">
              ℹ Partial Activity Detected
            </div>
            <p className="text-xs text-orange-300 mt-2">
              Missing activity types: {status.failedConditions.join(', ')}
            </p>
          </div>
        )}

        {status.failedConditions.length === 0 && !status.isInactive && (
          <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
            <div className="text-emerald-400 font-semibold text-sm">
              ✓ Fully Active
            </div>
            <p className="text-xs text-emerald-300 mt-2">
              All activity types detected{hasThreshold ? ' within threshold' : ''}. Account remains secure.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
