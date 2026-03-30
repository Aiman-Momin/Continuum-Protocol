import React, { useState, useEffect } from 'react';
import { Wallet, RefreshCw } from 'lucide-react';
import { stellarService } from '../services/stellarService';

interface WalletBalanceProps {
  userAddress: string | null;
  pollInterval?: number;
}

export default function WalletBalance({ userAddress, pollInterval = 5000 }: WalletBalanceProps) {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!userAddress) return;

    const fetchBalance = async () => {
      setIsLoading(true);
      try {
        const bal = await stellarService.getBalance(userAddress);
        setBalance(bal);
      } catch (err) {
        console.error('Failed to fetch balance:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalance();
  }, [userAddress]);

  useEffect(() => {
    if (!userAddress) return;

    const interval = setInterval(async () => {
      try {
        const bal = await stellarService.getBalance(userAddress);
        setBalance(bal);
      } catch (err) {
        console.error('Balance polling failed:', err);
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [userAddress, pollInterval]);

  const handleRefresh = async () => {
    if (!userAddress) return;
    setIsRefreshing(true);
    try {
      const bal = await stellarService.getBalance(userAddress);
      setBalance(bal);
    } catch (err) {
      console.error('Manual refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Wallet Balance</h3>
            <p className="text-xs text-zinc-500">Stellar Testnet</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 text-zinc-400 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-6 bg-white/5 border border-white/10 rounded-xl">
        <div className="text-sm text-zinc-400 mb-2">XLM</div>
        <div className="text-4xl font-bold text-blue-400">
          {isLoading ? (
            <span className="animate-pulse">...</span>
          ) : balance !== null ? (
            balance.toFixed(7)
          ) : (
            <span className="text-zinc-600">N/A</span>
          )}
        </div>
        <div className="text-xs text-zinc-500 mt-2">
          {userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-8)}` : 'Not connected'}
        </div>
      </div>
    </div>
  );
}
