/**
 * Multi-condition inactivity detection service
 * 
 * A user is considered INACTIVE only if ALL of the following are true:
 * - No transaction in threshold period
 * - No contract interaction in threshold period
 * - No check-in in threshold period
 * - Time threshold exceeded
 */

import { TransactionRecord } from '../App';

export interface InactivityConditions {
  hasCheckIn: boolean;
  hasTransaction: boolean;
  hasContractInteraction: boolean;
  timeThresholdExceeded: boolean;
}

export interface InactivityStatus {
  isInactive: boolean;
  conditions: InactivityConditions;
  failedConditions: string[];
  lastCheckIn: number | null;
  lastTransaction: number | null;
  lastContractInteraction: number | null;
  timeRemaining: number; // ms
}

/**
 * Get the most recent check-in timestamp
 */
export function getLastCheckIn(history: TransactionRecord[]): number | null {
  const checkIns = history.filter(h => h.type === 'CHECK_IN' && h.status === 'SUCCESS');
  if (checkIns.length === 0) return null;
  const latest = checkIns.sort((a, b) => b.timestamp - a.timestamp)[0];
  return latest.timestamp;
}

/**
 * Get the most recent transaction (deposit or transfer)
 */
export function getLastTransaction(history: TransactionRecord[]): number | null {
  const transactions = history.filter(
    h => (h.type === 'TRANSFER' || h.type === 'DEPOSIT') && h.status === 'SUCCESS'
  );
  if (transactions.length === 0) return null;
  const latest = transactions.sort((a, b) => b.timestamp - a.timestamp)[0];
  return latest.timestamp;
}

/**
 * Get the most recent contract interaction (any successful transaction or check-in)
 */
export function getLastContractInteraction(history: TransactionRecord[]): number | null {
  const interactions = history.filter(h => h.status === 'SUCCESS');
  if (interactions.length === 0) return null;
  const latest = interactions.sort((a, b) => b.timestamp - a.timestamp)[0];
  return latest.timestamp;
}

/**
 * Calculate inactivity status based on multiple conditions
 * 
 * @param history - Transaction/activity history
 * @param threshold - Time threshold in milliseconds (default: 90 days)
 * @returns InactivityStatus object with detailed condition information
 */
export function calculateInactivityStatus(
  history: TransactionRecord[],
  threshold: number = 1000 * 60 * 60 * 24 * 90, // 90 days default
  lastActiveOverride?: number,
): InactivityStatus {
  const now = Date.now();

  // Get last activity timestamps from each source
  const lastCheckIn = getLastCheckIn(history);
  const lastTransaction = getLastTransaction(history);
  const lastContractInteraction = getLastContractInteraction(history);
  const lastActive = lastActiveOverride || 0;

  // Determine if each condition is met (activity detected within threshold)
  const hasCheckIn = lastCheckIn !== null && (now - lastCheckIn) < threshold;
  const hasTransaction = lastTransaction !== null && (now - lastTransaction) < threshold;
  const hasContractInteraction =
    (lastContractInteraction !== null && (now - lastContractInteraction) < threshold) ||
    (lastActive > 0 && (now - lastActive) < threshold);

  // Time threshold exceeded if no activity at all
  const latestActivity = Math.max(
    lastCheckIn || 0,
    lastTransaction || 0,
    lastContractInteraction || 0,
    lastActive,
  );
  const timeThresholdExceeded = latestActivity === 0 || now - latestActivity >= threshold;

  // Collect failed conditions (for display)
  const failedConditions: string[] = [];
  if (!hasCheckIn) failedConditions.push('No check-in');
  if (!hasTransaction) failedConditions.push('No transaction');
  if (!hasContractInteraction) failedConditions.push('No contract interaction');

  // Calculate time remaining in threshold
  const timeRemaining = Math.max(0, threshold - (now - latestActivity));

  // User is INACTIVE only if ALL conditions are false (no activity in any category)
  const isInactive =
    !hasCheckIn && !hasTransaction && !hasContractInteraction && timeThresholdExceeded;

  return {
    isInactive,
    conditions: {
      hasCheckIn,
      hasTransaction,
      hasContractInteraction,
      timeThresholdExceeded,
    },
    failedConditions,
    lastCheckIn,
    lastTransaction,
    lastContractInteraction,
    timeRemaining,
  };
}

/**
 * Format time remaining for display
 */
export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '0s';

  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / (60 * 60 * 24));
  const hours = Math.floor((seconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);
  const remainingSeconds = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${remainingSeconds}s`);

  return parts.join(' ');
}

/**
 * Get activity status badge color and text
 */
export function getActivityStatusDisplay(inactivityStatus: InactivityStatus) {
  if (inactivityStatus.isInactive) {
    return {
      color: 'bg-red-500/10 border-red-500/20',
      textColor: 'text-red-400',
      label: 'Inactive',
      description: 'Trigger conditions met',
    };
  }

  if (inactivityStatus.failedConditions.length > 0) {
    return {
      color: 'bg-orange-500/10 border-orange-500/20',
      textColor: 'text-orange-400',
      label: 'Partial Activity',
      description: `Missing: ${inactivityStatus.failedConditions.join(', ')}`,
    };
  }

  return {
    color: 'bg-emerald-500/10 border-emerald-500/20',
    textColor: 'text-emerald-400',
    label: 'Active',
    description: 'All activity types detected',
  };
}
