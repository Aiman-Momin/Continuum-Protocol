import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getData, getLastActive } from '../services/contractService';
import { WalletType } from '../services/stellarService';

interface ContractInteractionProps {
  userAddress: string;
  selectedWallet: WalletType;
  signTransaction: (xdr: string) => Promise<string>;
  pollInterval?: number;
}

export default function ContractInteraction({
  userAddress,
  selectedWallet,
  signTransaction,
  pollInterval = 5000
}: ContractInteractionProps) {
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load contract data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        await getData(userAddress);
        await getLastActive(userAddress);
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    };
    loadData();
  }, [userAddress]);

  // Setup polling for real-time updates
  useEffect(() => {
    if (!isPolling || !userAddress) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    const pollData = async () => {
      try {
        await getData(userAddress);
        await getLastActive(userAddress);
        setLastUpdateTime(Date.now());
      } catch (err) {
        console.error('Polling failed:', err);
      }
    };

    pollData();
    pollIntervalRef.current = setInterval(pollData, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isPolling, userAddress, pollInterval]);

  return (
    <div className="glass-card p-8">
      {/* Status Messages */}
      {txStatus === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-3 mb-4"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-emerald-400">Success!</div>
            <div className="text-emerald-300/80 text-xs mt-1">Transaction confirmed</div>
            {txHash && (
              <div className="text-xs text-emerald-300/60 mt-1 font-mono truncate">
                Hash: {txHash.slice(0, 16)}...
              </div>
            )}
          </div>
        </motion.div>
      )}

      {txStatus === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3 mb-4"
        >
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-red-400">Error</div>
            <div className="text-red-300/80 text-xs mt-1">{txError}</div>
          </div>
        </motion.div>
      )}

      {txStatus === 'pending' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-3 mb-4"
        >
          <RefreshCw className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-spin" />
          <div className="text-sm">
            <div className="font-semibold text-blue-400">Processing</div>
            <div className="text-blue-300/80 text-xs mt-1">Waiting for confirmation...</div>
          </div>
        </motion.div>
      )}

      {/* Polling Status Info */}
      <div className="p-4 bg-white/[0.02] border border-white/5 rounded-lg">
        <div className="flex items-center justify-between text-xs">
          <div>
            <div className="text-zinc-400 font-medium mb-1">Polling Status</div>
            <div className={`text-[11px] ${isPolling ? 'text-blue-400' : 'text-zinc-600'}`}>
              {isPolling ? `✓ Active (${(pollInterval / 1000).toFixed(1)}s interval)` : 'Disabled'}
            </div>
          </div>
          {isPolling && (
            <div className="text-zinc-600 text-[10px]">
              {lastUpdateTime && `Last: ${new Date(lastUpdateTime).toLocaleTimeString()}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
