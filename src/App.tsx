import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Shield, 
  Clock, 
  Users, 
  Activity, 
  AlertTriangle, 
  ChevronRight, 
  Plus, 
  Settings, 
  Lock,
  Heart,
  CheckCircle2,
  ArrowRightLeft,
  Wallet,
  ExternalLink,
  ArrowUpRight,
  RefreshCw,
  RotateCcw,
  Info,
  X,
  Terminal,
  Cpu,
  Database,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { VaultStatus, VaultState, Beneficiary } from './types';
import { stellarService, WalletType } from './services/stellarService';
import { contractService } from './services/contractService';
import ContractInteraction from './components/ContractInteraction';
import WalletBalance from './components/WalletBalance';
import StagedReleaseTimeline from './components/StagedReleaseTimeline';
import ConditionalRemittance from './components/ConditionalRemittance';
import Nominees from './components/Nominees';
import InactivityStatus from './components/InactivityStatus';
import InactivityDistribution from './components/InactivityDistribution';
import { TransactionToastContainer, Toast } from './components/TransactionToastContainer';
import { calculateInactivityStatus } from './services/inactivityService';

const STORAGE_KEYS = {
  nominees: (pubKey: string) => `continuum:nominees:${pubKey}`,
  timeline: (pubKey: string) => `continuum:timeline:${pubKey}`,
  distributions: (pubKey: string) => `continuum:distributions:${pubKey}`,
  history: (pubKey: string) => `continuum:history:${pubKey}`,
  inactivityDailyNotice: (pubKey: string) => `continuum:inactivity-notice-day:${pubKey}`,
  inactivityCycleLastActive: (pubKey: string) => `continuum:inactivity-cycle-last-active:${pubKey}`,
};

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

const XLM_TO_STROOPS = 10_000_000;

// UI role ids -> on-chain Symbol strings (stored in contract as `Symbol`)
const ROLE_ID_TO_SYMBOL: Record<string, string> = {
  executor: 'EXEC',
  beneficiary: 'BENF',
  trustee: 'TRUS',
  advisor: 'ADVS',
};

const ROLE_SYMBOL_TO_ID: Record<string, string> = {
  EXEC: 'executor',
  BENF: 'beneficiary',
  TRUS: 'trustee',
  ADVS: 'advisor',
};

function roleSymbolToId(symbol: string): string {
  const s = String(symbol || '').toUpperCase().trim();
  return ROLE_SYMBOL_TO_ID[s] || ROLE_SYMBOL_TO_ID[s.slice(0, 4)] || 'beneficiary';
}

function roleIdToSymbol(roleId: string): string {
  return ROLE_ID_TO_SYMBOL[roleId] || 'BENF';
}

function stroopsToXlmString(stroops: string): string {
  try {
    const v = BigInt(stroops);
    // toFixed needs number, but the value is just for UI; safe enough after scaling
    const xlm = Number(v) / XLM_TO_STROOPS;
    return Number.isFinite(xlm) ? xlm.toFixed(2) : '0.00';
  } catch {
    const n = Number(stroops);
    if (!Number.isFinite(n)) return '0.00';
    return (n / XLM_TO_STROOPS).toFixed(2);
  }
}

function xlmToStroopsString(xlm: string): string {
  const n = parseFloat(xlm);
  if (!Number.isFinite(n)) return '0';
  // Keep integer stroops (contract expects i128)
  return String(BigInt(Math.round(n * XLM_TO_STROOPS)));
}

function unixSecondsToDatetimeLocalString(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function getLocalDateKey(now = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface TransactionRecord {
  id: string;
  type: 'TRANSFER' | 'CHECK_IN' | 'DEPOSIT';
  amount?: string;
  dest?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  timestamp: number;
  hash?: string;
}

export default function App() {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState<WalletType | null>(null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<TransactionRecord[]>([]);
  
  // Transaction State
  const [showSendModal, setShowSendModal] = useState(false);
  const [destAddress, setDestAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  // Vault Deposit State (required for auto-distribution)
  const [depositXlm, setDepositXlm] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isExecutingDistribution, setIsExecutingDistribution] = useState(false);
  const [vaultBalanceStroops, setVaultBalanceStroops] = useState<string>('0');
  const autoDistributionTriggeredRef = useRef(false);
  
  // Toast Notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Staged Data - stored by account publicKey
  const [stagedNominees, setStagedNominees] = useState<Record<string, any[]>>({});
  const [stagedTimeline, setStagedTimeline] = useState<Record<string, any[]>>({});
  const [stagedDistributions, setStagedDistributions] = useState<Record<string, any[]>>({});

  // Load staged config and activity history from durable storage whenever account changes
  useEffect(() => {
    if (!publicKey) return;

    const savedNominees = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.nominees(publicKey)));
    const savedTimeline = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.timeline(publicKey)));
    const savedDistributions = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.distributions(publicKey)));
    const savedHistory = safeJsonParse<TransactionRecord[]>(localStorage.getItem(STORAGE_KEYS.history(publicKey)));

    if (savedNominees) setStagedNominees(prev => ({ ...prev, [publicKey]: savedNominees }));
    if (savedTimeline) setStagedTimeline(prev => ({ ...prev, [publicKey]: savedTimeline }));
    if (savedDistributions) setStagedDistributions(prev => ({ ...prev, [publicKey]: savedDistributions }));
    if (savedHistory) setHistory(savedHistory);
  }, [publicKey]);

  // Poll contract vault balance
  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;

    const load = async () => {
      const bal = await contractService.getVaultBalance(publicKey);
      if (!cancelled) setVaultBalanceStroops(bal);
    };

    load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [publicKey]);

  // Load config from chain on login (and cache locally)
  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;

    const wallet = selectedWallet || WalletType.FREIGHTER;
    const sign = (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet);

    const load = async () => {
      try {
        const [nominees, timeline, distributions] = await Promise.all([
          contractService.getNominees(publicKey),
          contractService.getTimeline(publicKey),
          contractService.getDistributions(publicKey),
        ]);

        if (cancelled) return;

        if (nominees.length) {
          const uiNominees = nominees.map((n) => {
            const roleId = roleSymbolToId(n.role);
            return {
              id: `${n.address}:${roleId}`,
              address: n.address,
              role: roleId,
              // bps is basis points: 10000 = 100%
              percentage: (n.bps / 100).toFixed(2),
            };
          });
          setStagedNominees((prev) => ({ ...prev, [publicKey]: uiNominees }));
          localStorage.setItem(STORAGE_KEYS.nominees(publicKey), JSON.stringify(uiNominees));
        }

        if (timeline.length) {
          const uiTimeline = timeline.map((s) => ({
            id: `t-${s.when}-${s.amount}`,
            // Convert unix seconds -> `datetime-local` compatible string
            date: unixSecondsToDatetimeLocalString(s.when),
            // contract stores i128 amount in stroops (integer)
            amount: stroopsToXlmString(String(s.amount)),
            description: s.memo === "NONE" ? "" : String(s.memo),
          }));
          setStagedTimeline((prev) => ({ ...prev, [publicKey]: uiTimeline }));
          localStorage.setItem(STORAGE_KEYS.timeline(publicKey), JSON.stringify(uiTimeline));
        }

        if (distributions.length) {
          // Need nominee ids to match the UI editor keys.
          const addressToNomineeId: Record<string, string> = {};
          const uiNomineesForMap = nominees.map((n) => {
            const roleId = roleSymbolToId(n.role);
            return { address: n.address, id: `${n.address}:${roleId}` };
          });
          for (const n of uiNomineesForMap) addressToNomineeId[n.address] = n.id;

          const uiDistributions = distributions.map((p) => ({
            id: `p-${p.inactivity_days}`,
            inactivityDays: p.inactivity_days,
            distributions: p.entries.reduce(
              (acc: Record<string, string>, e) => {
                const nomineeId = addressToNomineeId[e.address];
                if (!nomineeId) return acc;
                acc[nomineeId] = (e.bps / 100).toFixed(2);
                return acc;
              },
              {},
            ),
          }));
          setStagedDistributions((prev) => ({ ...prev, [publicKey]: uiDistributions }));
          localStorage.setItem(STORAGE_KEYS.distributions(publicKey), JSON.stringify(uiDistributions));
        }
      } catch (e) {
        console.error("[App] Failed to load on-chain config:", e);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [publicKey, selectedWallet]);

  // Get current account's saved nominees/timeline/distributions (empty if account has none)
  const currentNominees = publicKey ? (stagedNominees[publicKey] || []) : [];
  const currentTimeline = publicKey ? (stagedTimeline[publicKey] || []) : [];
  const currentDistributions = publicKey ? (stagedDistributions[publicKey] || []) : [];

  const nomineesTotalPct = currentNominees.reduce((sum: number, n: any) => {
    const pct = parseFloat(String(n.percentage)) || 0;
    return sum + pct;
  }, 0);

  const isNomineesLocked = currentNominees.length > 0 && Math.abs(nomineesTotalPct - 100) < 0.01;

  const distributionsTotalPct = currentDistributions.reduce((sum: number, phase: any) => {
    const phaseTotal: number = (Object.values(phase.distributions || {}) as any[]).reduce(
      (s: number, pct: any) => s + (parseFloat(String(pct)) || 0),
      0,
    );
    return sum + phaseTotal;
  }, 0);

  const isDistributionsLocked =
    currentDistributions.length > 0 && Math.abs(distributionsTotalPct - 100) < 0.01;

  const isTimelineLocked = currentTimeline.length > 0;

  // Calculate inactivity status based on multi-condition logic
  const configuredInactivityDays = currentDistributions.length
    ? Math.min(...currentDistributions.map((phase: any) => phase.inactivityDays))
    : null;
  const inactivityThresholdMs = configuredInactivityDays
    ? configuredInactivityDays * 24 * 60 * 60 * 1000
    : null;
  const inactivityStatus = vault && inactivityThresholdMs
    ? calculateInactivityStatus(history, inactivityThresholdMs, vault.lastActive)
    : null;

  const elapsedChainDays = vault && vault.lastActive
    ? Math.floor((Date.now() - vault.lastActive) / (1000 * 60 * 60 * 24))
    : null;
  const distributionPhaseCandidates = currentDistributions
    .filter((phase: any) => phase.inactivityDays !== null && phase.inactivityDays !== undefined);
  const hasEligibleDistributionPhase = elapsedChainDays !== null
    ? distributionPhaseCandidates.some((phase: any) => elapsedChainDays >= Number(phase.inactivityDays))
    : false;
  const hasDistributionConfig = currentDistributions.length > 0;
  const distributionReady = Boolean(vault && vault.lastActive && hasDistributionConfig && hasEligibleDistributionPhase);

  // Toast Management
  const addToast = useCallback((toast: Omit<Toast, 'id'> & { id?: string }) => {
    const id = toast.id || Math.random().toString(36).substr(2, 9);
    const newToast: Toast = {
      ...toast,
      id,
      autoHideDelay: toast.autoHideDelay || (toast.status === 'pending' ? 0 : 5000),
    };
    setToasts(prev => [...prev, newToast]);
    
    if (newToast.autoHideDelay && newToast.autoHideDelay > 0) {
      setTimeout(() => removeToast(id), newToast.autoHideDelay);
    }
    
    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const updateToast = useCallback((id: string, updates: Partial<Toast>) => {
    setToasts(prev =>
      prev.map(t => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  // Connect Wallet Handler
  const handleConnect = () => {
    setShowWalletModal(true);
  };

  const connectToWallet = async (type: WalletType) => {
    setError(null);
    setIsConnecting(true);
    setShowWalletModal(false);
    
    try {
      let isAvailable = false;
      if (type === WalletType.FREIGHTER) {
        isAvailable = await stellarService.checkFreighter();
      } else if (type === WalletType.METAMASK) {
        isAvailable = await stellarService.checkMetaMask();
      }

      if (!isAvailable) {
        setError(`${type.charAt(0).toUpperCase() + type.slice(1)} wallet not detected. Please install the extension.`);
        setIsConnecting(false);
        return;
      }

      const address = await stellarService.connectWallet(type);
      if (address) {
        setPublicKey(address);
        setSelectedWallet(type);
        await refreshAccountData(address);
      }
    } catch (err: any) {
      setError(err.message || "Connection rejected or failed. Please try again.");
      console.error("[App] Connection error:", err);
    } finally {
      setIsConnecting(false);
    }
  };

  const refreshAccountData = async (address: string) => {
    const bal = await stellarService.getAccountBalance(address);
    const lastActive = await contractService.getLastActive(address);
    setBalance(bal);
    setVault({
      owner: address,
      lastActive: lastActive || 0,
      threshold: 1000 * 60 * 60 * 24 * 90,
      status: lastActive && lastActive > 0 ? VaultStatus.Active : VaultStatus.InactivityDetected,
      beneficiaries: [
        { address: "GB...9Y2", percentage: 50, name: "Legacy Trust" }
      ],
      balance: bal
    });
  };

  const handleFundWallet = async () => {
    if (!publicKey) return;
    setIsFunding(true);
    try {
      const result = await stellarService.fundAccount(publicKey);
      if (result.success) {
        await refreshAccountData(publicKey);
      } else {
        setError("Funding failed: " + result.error);
      }
    } catch (err) {
      console.error("Funding error", err);
    } finally {
      setIsFunding(false);
    }
  };

  const handleDisconnect = () => {
    setPublicKey(null);
    setSelectedWallet(null);
    setBalance(0);
    setVault(null);
    setHistory([]);
    setError(null);
    setDepositXlm('');
    setVaultBalanceStroops('0');
  };

  // Persist history changes across refreshes for the active wallet
  useEffect(() => {
    if (!publicKey) return;
    localStorage.setItem(STORAGE_KEYS.history(publicKey), JSON.stringify(history));
  }, [publicKey, history]);

  const handleDeposit = async () => {
    if (!publicKey) return;
    const amountNum = parseFloat(depositXlm);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      addToast({
        status: 'failed',
        message: 'Invalid deposit amount',
        detail: 'Enter a positive XLM amount',
      });
      return;
    }

    const wallet = selectedWallet || WalletType.FREIGHTER;
    setIsDepositing(true);
    try {
      const res = await contractService.deposit(
        publicKey,
        xlmToStroopsString(depositXlm),
        (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet),
      );

      if (res.success) {
        addToast({
          status: 'success',
          message: 'Deposit submitted',
          detail: `${depositXlm} XLM deposited into contract vault`,
          hash: res.hash,
        });
        setDepositXlm('');
        const bal = await contractService.getVaultBalance(publicKey);
        setVaultBalanceStroops(bal);

        const lastActive = await contractService.getLastActive(publicKey);
        if (lastActive && lastActive > 0) {
          setVault(prev => prev ? { ...prev, lastActive, status: VaultStatus.Active } : prev);
        } else {
          const sign = (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet);
          const checkInRes = await contractService.checkIn(publicKey, sign);
          if (checkInRes.success) {
            setVault(prev => prev ? { ...prev, lastActive: Date.now(), status: VaultStatus.Active } : prev);
            addToast({
              status: 'success',
              message: 'Activity Recorded',
              detail: 'Proof-of-life recorded after deposit',
              hash: checkInRes.hash,
            });
          } else {
            addToast({
              status: 'warning',
              message: 'Activity Not Recorded',
              detail: 'Deposit succeeded but no on-chain activity was detected. Please click Check In once.',
            });
          }
        }
      } else {
        addToast({
          status: 'failed',
          message: 'Deposit failed',
          detail: res.error || 'Could not deposit into vault',
        });
      }
    } catch (e: any) {
      addToast({
        status: 'failed',
        message: 'Deposit error',
        detail: e?.message || 'Unexpected error',
      });
    } finally {
      setIsDepositing(false);
    }
  };

  const handleSendXLM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !destAddress || !sendAmount) return;
    
    const amountNum = parseFloat(sendAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setTxError('Please enter a valid amount');
      addToast({
        status: 'failed',
        message: 'Invalid Amount',
        detail: 'Please enter a valid amount greater than 0',
      });
      return;
    }

    if (!destAddress.startsWith('G') || destAddress.length !== 56) {
      setTxError('Invalid Stellar address format');
      addToast({
        status: 'failed',
        message: 'Invalid Address',
        detail: 'Please enter a valid Stellar address (starting with G)',
      });
      return;
    }

    if (amountNum > balance) {
      setTxError('Insufficient balance');
      addToast({
        status: 'failed',
        message: 'Insufficient Balance',
        detail: `You have ${balance.toFixed(4)} XLM available`,
      });
      return;
    }

    setTxStatus('pending');
    setTxError(null);
    
    // Show pending toast
    const toastId = addToast({
      id: `tx-${Date.now()}`,
      status: 'pending',
      message: 'Transfer Processing',
      detail: `Sending ${sendAmount} XLM to ${destAddress.slice(0, 6)}...`,
    });
    
    const result = await stellarService.sendXLM(publicKey, destAddress, sendAmount, selectedWallet || WalletType.FREIGHTER);
    
    if (result.success) {
      setTxStatus('success');
      setTxHash(result.hash || null);
      const newBal = await stellarService.getAccountBalance(publicKey);
      setBalance(newBal);
      
      // Update pending toast to success
      updateToast(toastId, {
        status: 'success',
        message: 'Transfer Complete',
        detail: `${sendAmount} XLM sent successfully`,
        hash: result.hash,
      });
      
      // Add to history
      const newTx: TransactionRecord = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'TRANSFER',
        amount: sendAmount,
        dest: destAddress,
        status: 'SUCCESS',
        timestamp: Date.now(),
        hash: result.hash
      };
      setHistory(prev => [newTx, ...prev]);
    } else {
      setTxStatus('error');
      setTxError(result.error || 'Transaction failed');
      
      // Update pending toast to error
      updateToast(toastId, {
        status: 'failed',
        message: 'Transfer Failed',
        detail: result.error || 'An error occurred while processing the transfer',
      });
      
      const failedTx: TransactionRecord = {
        id: Math.random().toString(36).substr(2, 9),
        type: 'TRANSFER',
        amount: sendAmount,
        dest: destAddress,
        status: 'FAILED',
        timestamp: Date.now()
      };
      setHistory(prev => [failedTx, ...prev]);
    }
  };

  const handleResetActivity = async () => {
    if (!publicKey) return;
    setIsResetting(true);
    
    const toastId = addToast({
      id: `reset-${Date.now()}`,
      status: 'pending',
      message: 'Resetting Activity...',
      detail: 'Updating your proof-of-life signal...',
    });
    
    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.checkIn(publicKey, (xdr: string) =>
        stellarService.signXDR(xdr, publicKey, wallet),
      );
      
      if (result.success && vault) {
        setVault({ ...vault, lastActive: Date.now(), status: VaultStatus.Active });
        setHistory(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          type: 'CHECK_IN',
          status: 'SUCCESS',
          timestamp: Date.now(),
          hash: result.hash
        }, ...prev]);
        
        updateToast(toastId, {
          status: 'success',
          message: 'Activity Reset Successfully',
          detail: 'Inactivity status has been reset to Active',
          hash: result.hash,
        });
      } else {
        updateToast(toastId, {
          status: 'failed',
          message: 'Reset Failed',
          detail: 'Unable to reset activity status',
        });
      }
    } catch (e: any) {
      console.error("Activity reset failed:", e);
      updateToast(toastId, {
        status: 'failed',
        message: 'Reset Error',
        detail: e.message || 'An unexpected error occurred',
      });
    } finally {
      setIsResetting(false);
    }
  };

  const handleCheckIn = async () => {
    if (!publicKey) return;
    setIsCheckingIn(true);
    
    // Show pending toast
    const toastId = addToast({
      id: `checkin-${Date.now()}`,
      status: 'pending',
      message: 'Proof of Life',
      detail: 'Sending heartbeat signal to the protocol...',
    });
    
    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.checkIn(publicKey, (xdr: string) =>
        stellarService.signXDR(xdr, publicKey, wallet),
      );
      
      if (result.success && vault) {
        setVault({ ...vault, lastActive: Date.now(), status: VaultStatus.Active });
        
        // Update toast to success
        updateToast(toastId, {
          status: 'success',
          message: 'Check-in Successful',
          detail: 'Your inactivity clock has been reset',
          hash: result.hash,
        });
        
        setHistory(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          type: 'CHECK_IN',
          status: 'SUCCESS',
          timestamp: Date.now(),
          hash: result.hash
        }, ...prev]);
      } else {
        // Check-in failed
        updateToast(toastId, {
          status: 'failed',
          message: 'Check-in Failed',
          detail: 'Unable to send proof of life signal',
        });
        
        setHistory(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          type: 'CHECK_IN',
          status: 'FAILED',
          timestamp: Date.now(),
        }, ...prev]);
      }
    } catch (e: any) {
      console.error("Check-in failed:", e);
      updateToast(toastId, {
        status: 'failed',
        message: 'Check-in Error',
        detail: e.message || 'An unexpected error occurred',
      });
      
      setHistory(prev => [{
        id: Math.random().toString(36).substr(2, 9),
        type: 'CHECK_IN',
        status: 'FAILED',
        timestamp: Date.now(),
      }, ...prev]);
    } finally {
      setIsCheckingIn(false);
    }
  };

  const handleExecuteDistribution = useCallback(async () => {
    if (!publicKey) return;
    const lastActive = await contractService.getLastActive(publicKey);
    if (!lastActive || lastActive === 0) {
      addToast({
        status: 'failed',
        message: 'Distribution Not Available',
        detail: 'No on-chain activity has been recorded yet. Please perform a proof-of-life or deposit first.',
      });
      return;
    }

    if (vault?.lastActive !== lastActive) {
      setVault((prev) => prev ? { ...prev, lastActive } : prev);
    }

    if (currentDistributions.length === 0) {
      addToast({
        status: 'failed',
        message: 'Distribution Not Available',
        detail: 'No distribution phases are configured on-chain yet.',
      });
      return;
    }

    const elapsedDaysSinceActive = lastActive
      ? Math.floor((Date.now() - lastActive) / (1000 * 60 * 60 * 24))
      : 0;
    const hasPhaseReady = currentDistributions.some((phase: any) =>
      Number(phase.inactivityDays) <= elapsedDaysSinceActive,
    );
    if (!hasPhaseReady) {
      addToast({
        status: 'failed',
        message: 'Distribution Not Ready',
        detail: `Owner inactivity is ${elapsedDaysSinceActive} day(s); no phase is ready yet.`,
      });
      return;
    }

    setIsExecutingDistribution(true);
    const toastId = addToast({
      id: `dist-${Date.now()}`,
      status: 'pending',
      message: 'Executing Inactivity Distribution',
      detail: 'Submitting contract distribution transaction...',
    });

    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.executeDistribution(publicKey, (xdr: string) =>
        stellarService.signXDR(xdr, publicKey, wallet),
      );

      if (result.success) {
        updateToast(toastId, {
          status: 'success',
          message: 'Distribution Executed',
          detail: 'Funds have been distributed according to your phases',
          hash: result.hash,
        });

        setHistory(prev => [{
          id: Math.random().toString(36).substr(2, 9),
          type: 'TRANSFER',
          amount: 'AUTO-DISTRIBUTION',
          status: 'SUCCESS',
          timestamp: Date.now(),
          hash: result.hash,
        }, ...prev]);
      } else {
        updateToast(toastId, {
          status: 'failed',
          message: 'Distribution Failed',
          detail: result.error || 'No eligible distribution was executed',
        });
      }
    } catch (e: any) {
      console.error('Distribution execution failed:', e);
      updateToast(toastId, {
        status: 'failed',
        message: 'Distribution Error',
        detail: e.message || 'An unexpected error occurred',
      });
    } finally {
      setIsExecutingDistribution(false);
    }
  }, [publicKey, selectedWallet, addToast, currentDistributions, vault]);

  useEffect(() => {
    if (!publicKey) {
      autoDistributionTriggeredRef.current = false;
      return;
    }

    if (!inactivityStatus?.isInactive) {
      autoDistributionTriggeredRef.current = false;
      return;
    }

    if (!vault || vault.lastActive === 0) {
      autoDistributionTriggeredRef.current = false;
      return;
    }

    if (autoDistributionTriggeredRef.current) return;
    autoDistributionTriggeredRef.current = true;
    handleExecuteDistribution();
  }, [publicKey, inactivityStatus?.isInactive, handleExecuteDistribution, vault]);

  const handleRefreshBalance = async () => {
    if (!publicKey) return;
    setIsRefreshing(true);
    try {
      const bal = await stellarService.getAccountBalance(publicKey);
      setBalance(bal);
    } catch (err) {
      console.error("Refresh failed", err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const daysSinceActive = vault ? Math.floor((Date.now() - vault.lastActive) / (1000 * 60 * 60 * 24)) : 0;
  const daysRemaining = vault && inactivityThresholdMs
    ? Math.max(0, Math.floor((inactivityThresholdMs - (Date.now() - vault.lastActive)) / (1000 * 60 * 60 * 24)))
    : null;

  // Automatic inactivity reminders:
  // - start when <= 5 days remaining
  // - send once per day
  // - reset reminder cycle after successful check-in (lastActive changes)
  useEffect(() => {
    if (!publicKey || daysRemaining === null || !vault) return;

    const cycleKey = STORAGE_KEYS.inactivityCycleLastActive(publicKey);
    const dailyKey = STORAGE_KEYS.inactivityDailyNotice(publicKey);
    const lastActive = Number(vault.lastActive || 0);
    const storedCycleActive = Number(localStorage.getItem(cycleKey) || 0);

    // Any new activity/check-in starts a fresh reminder cycle.
    if (lastActive > storedCycleActive) {
      localStorage.setItem(cycleKey, String(lastActive));
      localStorage.removeItem(dailyKey);
    }

    // Notify only in the warning window.
    if (daysRemaining > 5 || daysRemaining < 0) return;

    const todayKey = getLocalDateKey();
    const lastNotifiedDay = localStorage.getItem(dailyKey);
    if (lastNotifiedDay === todayKey) return;

    addToast({
      status: 'pending',
      message: 'Inactivity Reminder',
      detail:
        daysRemaining === 0
          ? 'Your inactivity timer has reached 0 days. Check in now.'
          : `Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining. Check in to reset your timer.`,
      autoHideDelay: 8000,
    });

    // Best-effort browser notification (if allowed).
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const showBrowserNotification = () => {
        try {
          new Notification('Continuum Inactivity Reminder', {
            body:
              daysRemaining === 0
                ? 'Your inactivity timer has reached 0 days. Open Continuum and check in.'
                : `You have ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining. Check in to stay active.`,
          });
        } catch (err) {
          console.warn('[Reminder] Browser notification failed:', err);
        }
      };

      if (Notification.permission === 'granted') {
        showBrowserNotification();
      } else if (Notification.permission === 'default') {
        Notification.requestPermission()
          .then((permission) => {
            if (permission === 'granted') showBrowserNotification();
          })
          .catch(() => {});
      }
    }

    // Best-effort backend ping (currently mock endpoint).
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: publicKey, // placeholder identifier until user email profile exists
        type: 'inactivity_warning',
        message:
          daysRemaining === 0
            ? 'Inactivity timer reached 0 days. Check in immediately.'
            : `${daysRemaining} day(s) remaining in inactivity timer.`,
      }),
    }).catch(() => {});

    localStorage.setItem(dailyKey, todayKey);
  }, [publicKey, vault, daysRemaining, addToast]);

  const fadeUp = {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0 }
  };
  const staggerContainer = {
    hidden: {},
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.08 } }
  };

  if (!publicKey) {
    return (
      <div className="min-h-screen bg-[#09090B] text-white flex flex-col font-sans selection:bg-blue-500/30">
        {/* Navigation */}
        <nav className="px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 bg-blue-500/15 border border-blue-500/30 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-blue-400" />
            </div>
            <span className="font-bold tracking-tight text-xl sm:text-2xl text-white truncate">CONTINUUM</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-xs font-semibold uppercase tracking-wider text-gray-400">
            <a href="#features" className="hover:text-blue-400 transition-colors duration-300">Features</a>
            <a href="#how" className="hover:text-blue-400 transition-colors duration-300">How it works</a>
            <a href="#why" className="hover:text-blue-400 transition-colors duration-300">Why Continuum</a>
            <button 
              onClick={handleConnect}
              disabled={isConnecting}
              className="px-5 py-2.5 btn-primary text-sm"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          </div>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="md:hidden px-4 py-2 btn-primary text-xs sm:text-sm"
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </button>
        </nav>

        {/* Hero Section */}
        <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 lg:px-8 py-16 sm:py-20 relative overflow-hidden">
          <div className="hero-grid-bg" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(800px,120vw)] h-[min(800px,120vw)] bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
          
          <motion.div
            initial="hidden"
            animate="show"
            variants={staggerContainer}
            className="w-full max-w-6xl relative z-10"
          >
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7">
                <motion.div variants={fadeUp} transition={{ duration: 0.45 }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 mb-8">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
                  <span className="text-xs font-bold uppercase tracking-widest text-blue-300">Smart Contract Protocol</span>
                </motion.div>
                <motion.h1 variants={fadeUp} transition={{ duration: 0.45, delay: 0.05 }} className="text-5xl sm:text-6xl md:text-7xl xl:text-8xl font-black tracking-tight mb-8 leading-[0.95] text-white">
                  Inheritance
                  <br />
                  for Self-Custody.
                </motion.h1>
                <motion.p variants={fadeUp} transition={{ duration: 0.45, delay: 0.1 }} className="text-lg md:text-xl text-gray-300 mb-10 font-light tracking-wide leading-relaxed max-w-2xl">
                  Continuum turns wallet activity into programmable legacy execution, without giving custody to a third party.
                </motion.p>
                <motion.div variants={fadeUp} transition={{ duration: 0.45, delay: 0.15 }} className="flex flex-col sm:flex-row items-start gap-4">
                  <button
                    onClick={handleConnect}
                    disabled={isConnecting}
                    className="w-full sm:w-auto px-8 py-4 btn-primary text-base font-bold flex items-center justify-center gap-3 tracking-wider uppercase"
                  >
                    {isConnecting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Wallet className="w-5 h-5" />}
                    Launch App
                  </button>
                  <div className="text-xs text-zinc-400 uppercase tracking-[0.2em] mt-2 sm:mt-0 sm:self-center">
                    Non-custodial · On Stellar · Verifiable
                  </div>
                </motion.div>
              </div>
              <motion.div variants={fadeUp} transition={{ duration: 0.45, delay: 0.2 }} className="lg:col-span-5">
                <div className="glass-card p-6 md:p-8 relative overflow-hidden">
                  <div className="protocol-orbit absolute inset-0" />
                  <div className="relative z-10 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-blue-300">Protocol Flow</span>
                      <span className="text-[10px] font-mono text-zinc-500">LIVE MODEL</span>
                    </div>
                    {[
                      { icon: Activity, title: 'Heartbeat Verified', subtitle: 'Owner wallet activity detected', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
                      { icon: Clock, title: 'Inactivity Countdown', subtitle: 'Trigger windows tracked on schedule', tone: 'text-blue-300 border-blue-500/30 bg-blue-500/10' },
                      { icon: ArrowRightLeft, title: 'Distribution Ready', subtitle: 'Nominee phases queued for release', tone: 'text-purple-300 border-purple-500/30 bg-purple-500/10' }
                    ].map((item, i) => {
                      const RowIcon = item.icon;
                      return (
                        <div key={i} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 flex items-start gap-3">
                          <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${item.tone}`}>
                            <RowIcon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{item.title}</div>
                            <div className="text-xs text-zinc-400 mt-1">{item.subtitle}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>

          {/* Features Grid */}
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={staggerContainer}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 max-w-6xl w-full mt-20 sm:mt-28 relative z-10"
            id="features"
          >
            {[
              {
                title: "Smart Inactivity Detection",
                desc: "Programmable triggers that monitor your on-chain pulse without compromising privacy.",
                icon: Activity,
                color: "blue"
              },
              {
                title: "Automated Distribution",
                desc: "Seamlessly transition assets to beneficiaries via Soroban smart contracts.",
                icon: Cpu,
                color: "emerald"
              },
              {
                title: "Institutional Security",
                desc: "Built on Stellar's robust infrastructure with multi-sig and time-lock capabilities.",
                icon: Shield,
                color: "slate"
              }
            ].map((feature, i) => {
              const colorMap = {
                blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: 'text-blue-400', title: 'text-blue-300' },
                emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', icon: 'text-emerald-400', title: 'text-emerald-300' },
                slate: { bg: 'bg-slate-500/10', border: 'border-slate-500/20', icon: 'text-slate-400', title: 'text-slate-300' }
              };
              const colors = colorMap[feature.color];
              return (
                <motion.div key={i} variants={fadeUp} transition={{ duration: 0.4 }} className={`glass-card p-8 group border ${colors.border} ${colors.bg}`}>
                  <div className={`w-12 h-12 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center mb-6 group-hover:shadow-lg transition-all`}>
                    <feature.icon className={`w-6 h-6 ${colors.icon} group-hover:scale-110 transition-transform`} />
                  </div>
                  <h3 className={`text-lg font-bold mb-3 ${colors.title}`}>{feature.title}</h3>
                  <p className="text-gray-300 text-sm leading-relaxed">{feature.desc}</p>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Protocol Positioning Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="max-w-6xl w-full mt-24 relative z-10"
            id="why"
          >
            <div className="section-eyebrow">Core Thesis</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="glass-card p-6 md:col-span-2">
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-4">
                  Your Crypto Shouldn't
                  <br />
                  <span className="text-gradient">Disappear With Lost Keys.</span>
                </h2>
                <p className="text-zinc-300 leading-relaxed max-w-2xl">
                  Continuum introduces a programmable life-signal layer. If activity stops, your pre-defined release phases execute exactly as configured.
                </p>
              </div>
              <div className="glass-card p-6">
                <div className="micro-label mb-4">Why teams choose Continuum</div>
                <div className="space-y-4 text-sm text-zinc-300">
                  <div className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />Audit-friendly on-chain logic</div>
                  <div className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />No custodial key escrow model</div>
                  <div className="flex items-start gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />Configurable staged distribution</div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Problem & Solution Sections */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="max-w-6xl w-full mt-20 relative z-10"
            id="problem"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center mb-24">
              <div>
                <div className="inline-block px-4 py-2 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
                  <span className="text-red-400 text-sm font-bold uppercase tracking-wider">Problem</span>
                </div>
                <h3 className="text-4xl font-bold mb-6 leading-tight">Crypto Inheritance is Broken</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">People lose access to wallets</div>
                      <div className="text-sm text-zinc-400">No way to recover assets if something happens</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">No inheritance in crypto</div>
                      <div className="text-sm text-zinc-400">Traditional estate planning doesn't work</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">Funds get locked forever</div>
                      <div className="text-sm text-zinc-400">Assets become permanently inaccessible</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="relative h-80">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/20 to-transparent rounded-2xl blur-xl" />
                <div className="absolute inset-0 glass-card flex items-center justify-center">
                  <Lock className="w-24 h-24 text-red-500/30" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
              <div className="relative h-80 order-2 md:order-1">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent rounded-2xl blur-xl" />
                <div className="absolute inset-0 glass-card flex items-center justify-center">
                  <CheckCircle2 className="w-24 h-24 text-emerald-500/30" />
                </div>
              </div>
              <div className="order-1 md:order-2">
                <div className="inline-block px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6">
                  <span className="text-emerald-400 text-sm font-bold uppercase tracking-wider">Solution</span>
                </div>
                <h3 className="text-4xl font-bold mb-6 leading-tight">Smart Legacy Management</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">Proof-of-Life system</div>
                      <div className="text-sm text-zinc-400">Regular check-ins prove you're active</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">Smart contract inheritance</div>
                      <div className="text-sm text-zinc-400">Automated transfers when inactive</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-1" />
                    <div>
                      <div className="font-semibold mb-1">Automated distribution</div>
                      <div className="text-sm text-zinc-400">Assets go to your chosen beneficiaries</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

          {/* How It Works Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="max-w-6xl w-full mt-28 relative z-10"
            id="how"
          >
            <div className="text-center mb-12">
              <div className="inline-block px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 mb-4">
                <span className="text-blue-400 text-sm font-bold uppercase tracking-wider">How It Works</span>
              </div>
              <h2 className="text-4xl font-bold mb-2">4 Simple Steps</h2>
            </div>
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.25 }}
              variants={staggerContainer}
              className="grid grid-cols-1 md:grid-cols-4 gap-6"
            >
              {[
                { step: "1", title: "Connect Wallet", desc: "Link your Stellar wallet securely", icon: Wallet },
                { step: "2", title: "Set Beneficiaries", desc: "Choose who receives your assets", icon: Users },
                { step: "3", title: "Stay Active", desc: "Regular check-ins keep funds secure", icon: Activity },
                { step: "4", title: "Auto Distribution", desc: "Assets transfer if you go inactive", icon: CheckCircle2 }
              ].map((item, i) => {
                const StepIcon = item.icon;
                return (
                <motion.div key={i} variants={fadeUp} transition={{ duration: 0.4 }} className="glass-card p-6">
                  <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center mb-4 relative">
                    <StepIcon className="w-5 h-5 text-blue-300" />
                    <span className="absolute -right-2 -top-2 w-5 h-5 rounded-full bg-[#09090B] border border-blue-500/40 text-[10px] font-bold text-blue-300 flex items-center justify-center">{item.step}</span>
                  </div>
                  <h4 className="font-bold mb-2">{item.title}</h4>
                  <p className="text-sm text-zinc-400">{item.desc}</p>
                </motion.div>
              )})}
            </motion.div>
          </motion.div>

          {/* Final CTA */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="max-w-3xl w-full mt-32 text-center relative z-10"
          >
            <div className="glass-card p-12 border border-blue-500/20 bg-gradient-to-br from-blue-500/10 to-transparent">
              <h3 className="text-4xl font-bold mb-4">Start Securing Your Legacy Today</h3>
              <p className="text-lg text-zinc-300 mb-8">Join thousands protecting their digital assets</p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button 
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold flex items-center justify-center gap-2 transition-all"
                >
                  {isConnecting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                  Launch App
                </button>
              </div>
            </div>
          </motion.div>
        </main>

        {/* Footer */}
        <footer className="px-4 sm:px-6 lg:px-8 py-10 sm:py-12 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-6 sm:gap-8 text-zinc-500 text-sm">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" />
            <span className="font-semibold text-white">Continuum</span>
            <span className="mx-2">© 2026</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-8">
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
            <a href="#" className="hover:text-white transition-colors">Audit Report</a>
            <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
          </div>
        </footer>

        {/* Error Toast */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-4 right-4 sm:bottom-8 sm:right-8 z-50 glass-card p-4 flex items-center gap-4 bg-red-500/10 border-red-500/20 max-w-[calc(100vw-2rem)] sm:max-w-md"
            >
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <div className="text-sm min-w-0">
                <span className="font-bold block">Connection Error</span>
                <span className="text-zinc-400 break-words">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:bg-white/5 rounded">
                <X className="w-4 h-4 text-zinc-500" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet Selection Modal */}
        <AnimatePresence>
          {showWalletModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
              <motion.div 
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowWalletModal(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-md"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="relative z-10 w-full max-w-md glass-card p-6 sm:p-10 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-bold tracking-tight">Connect Wallet</h2>
                  <button onClick={() => setShowWalletModal(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                    <X className="w-6 h-6 text-zinc-500" />
                  </button>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => connectToWallet(WalletType.FREIGHTER)}
                    className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4 hover:bg-white/10 hover:border-blue-500/30 transition-all group text-left"
                  >
                    <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20 group-hover:bg-blue-500/20 transition-colors">
                      <Shield className="w-6 h-6 text-blue-500" />
                    </div>
                    <div>
                      <div className="font-bold text-lg">Freighter</div>
                      <div className="text-xs text-zinc-500">Native Stellar Wallet</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-700 ml-auto group-hover:text-white transition-colors" />
                  </button>

                  <button 
                    onClick={() => connectToWallet(WalletType.METAMASK)}
                    className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4 hover:bg-white/10 hover:border-orange-500/30 transition-all group text-left"
                  >
                    <div className="w-12 h-12 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20 group-hover:bg-orange-500/20 transition-colors">
                      <Cpu className="w-6 h-6 text-orange-500" />
                    </div>
                    <div>
                      <div className="font-bold text-lg">MetaMask</div>
                      <div className="text-xs text-zinc-500">Via Stellar Snap</div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-zinc-700 ml-auto group-hover:text-white transition-colors" />
                  </button>
                </div>

                <p className="mt-8 text-center text-xs text-zinc-600 leading-relaxed">
                  By connecting your wallet, you agree to our Terms of Service and Privacy Policy.
                </p>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090B] text-white font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-xl">Continuum</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6 min-w-0">
            <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/10">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full shadow-[0_0_8px_#10b981]" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-zinc-400">{publicKey.slice(0, 6)}...{publicKey.slice(-6)}</span>
                {selectedWallet && (
                  <span className="px-1.5 py-0.5 bg-white/10 border border-white/10 rounded text-[9px] text-zinc-300 font-bold uppercase tracking-tighter">
                    {selectedWallet}
                  </span>
                )}
              </div>
            </div>
            <button 
              onClick={handleDisconnect} 
              className="text-xs font-semibold text-zinc-500 hover:text-white transition-colors uppercase tracking-wider"
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Main Panel */}
          <div className="lg:col-span-8 space-y-8">
            
            {/* Status Panel */}
            <div className="glass-card p-6 sm:p-10 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 opacity-[0.02] group-hover:opacity-[0.05] transition-opacity">
                <Shield className="w-64 h-64" />
              </div>
              
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-8">
                  <div className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-[10px] font-bold text-blue-400 uppercase tracking-widest">
                    Protocol Active
                  </div>
                  <div className="text-[10px] font-mono text-zinc-600">ID: CTN-992-X</div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16">
                  <div>
                    <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-6 leading-[1.1]">
                      Your Legacy <br /> is Secured.
                    </h1>
                    <p className="text-zinc-400 text-sm leading-relaxed mb-10">
                      Continuum is monitoring your Stellar account. Your digital assets are programmed for automated transition upon inactivity.
                    </p>
                    <div className="flex flex-wrap gap-4">
                      <button 
                        onClick={handleCheckIn}
                        disabled={isCheckingIn}
                        className="px-8 py-4 btn-primary flex items-center gap-3"
                      >
                        {isCheckingIn ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Heart className="w-5 h-5" />}
                        Check In
                      </button>
                      <button 
                        onClick={handleResetActivity}
                        disabled={isResetting}
                        className="px-8 py-4 btn-secondary flex items-center gap-3"
                      >
                        {isResetting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <RotateCcw className="w-5 h-5" />}
                        Reset Activity
                      </button>
                      <button 
                        onClick={() => setShowSendModal(true)}
                        className="px-8 py-4 btn-secondary flex items-center gap-3"
                      >
                        <ArrowUpRight className="w-5 h-5" />
                        Transfer
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center justify-center border-t md:border-t-0 border-white/5 pt-10 md:pt-0 md:border-l md:pl-16">
                    <div className="text-center">
                      <div className="micro-label mb-4">Inactivity Trigger</div>
                      <div className="text-6xl sm:text-8xl font-bold tracking-tighter mb-2">{daysRemaining ?? '--'}</div>
                      <div className="text-xs font-medium text-zinc-500 uppercase tracking-[0.2em]">
                        {daysRemaining === null ? 'Set inactivity days to activate' : 'Days Remaining'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Matrix Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <WalletBalance userAddress={publicKey} pollInterval={5000} />

              <div className="glass-card p-8">
                <div className="flex items-center justify-between mb-8">
                  <div className="micro-label">Beneficiary Load</div>
                  <Users className="w-4 h-4 text-zinc-600" />
                </div>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="text-4xl font-bold tracking-tight">{currentNominees.length}</div>
                    <div className="flex -space-x-3">
                      {[1, 2].map(i => (
                        <div key={i} className="w-10 h-10 rounded-full bg-zinc-800 border-4 border-[#121217] flex items-center justify-center">
                          <Users className="w-4 h-4 text-zinc-500" />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs font-medium text-zinc-500 uppercase tracking-widest">Allocation: 100%</div>
                </div>
              </div>
            </div>

            {/* Inactivity Status Section */}
            {inactivityStatus && inactivityThresholdMs && (
              <>
                <InactivityStatus status={inactivityStatus} threshold={inactivityThresholdMs} />
                {inactivityStatus.isInactive && publicKey && (
                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={handleExecuteDistribution}
                      disabled={isExecutingDistribution}
                      className="px-6 py-3 btn-primary flex items-center gap-2"
                    >
                      {isExecutingDistribution ? <RefreshCw className="w-5 h-5 animate-spin" /> : <ArrowRightLeft className="w-5 h-5" />}
                      {isExecutingDistribution ? 'Executing Distribution' : 'Execute Distribution'}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Nominees & Distribution Section */}
            <Nominees
              initialNominees={currentNominees}
              locked={isNomineesLocked}
              onSave={async (nominees) => {
                if (!publicKey) return;
                const wallet = selectedWallet || WalletType.FREIGHTER;

                setStagedNominees((prev) => ({ ...prev, [publicKey]: nominees }));
                localStorage.setItem(STORAGE_KEYS.nominees(publicKey), JSON.stringify(nominees));

                const onChainNominees = nominees.map((n: any) => ({
                  address: n.address,
                  role: roleIdToSymbol(String(n.role || "beneficiary")),
                  bps: Math.round((parseFloat(n.percentage) || 0) * 100),
                }));

                const res = await contractService.setNominees(
                  publicKey,
                  onChainNominees,
                  (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet),
                );

                if (res.success) {
                  addToast({
                    status: 'success',
                    title: 'Nominees Saved On-Chain',
                    description: `${nominees.length} nominees stored in contract`,
                  });
                } else {
                  addToast({
                    status: 'failed',
                    message: 'On-chain save failed',
                    detail: res.error || 'Could not save nominees to contract',
                  });
                }
              }}
            />

            {/* Staged Release Timeline + Configured Schedule */}
            <div className="space-y-8">
              <StagedReleaseTimeline
                initialStages={currentTimeline}
                locked={isTimelineLocked}
                onSave={(stages) => {
                if (publicKey) {
                  setStagedTimeline(prev => ({ ...prev, [publicKey]: stages }));
                  localStorage.setItem(STORAGE_KEYS.timeline(publicKey), JSON.stringify(stages));
                  console.log('Timeline saved for', publicKey, ':', stages);
                  const wallet = selectedWallet || WalletType.FREIGHTER;
                  contractService
                    .setTimeline(
                      publicKey,
                      stages.map((s: any) => ({
                        when: Math.floor(new Date(s.date).getTime() / 1000),
                        // Contract stores `amount` as integer stroops.
                        amount: xlmToStroopsString(String(s.amount || "0")),
                        memo: s.description && String(s.description).trim()
                          ? String(s.description)
                              .trim()
                              .toUpperCase()
                              .replace(/[^A-Z0-9_]/g, '')
                              .slice(0, 12)
                          : "NONE",
                      })),
                      (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet),
                    )
                    .then((res) => {
                      if (res.success) {
                        addToast({
                          status: 'success',
                          title: 'Timeline Saved On-Chain',
                          description: `${stages.length} stages stored in contract`,
                        });
                      } else {
                        addToast({
                          status: 'failed',
                          message: 'On-chain save failed',
                          detail: res.error || 'Could not save timeline to contract',
                        });
                      }
                    });
                }
              }} />

            </div>

            {/* Inactivity Distribution + Configured Phases */}
            <div className="space-y-8">
              <div className="space-y-3">
                <InactivityDistribution 
                  nominees={currentNominees}
                  initialPhases={currentDistributions}
                  locked={isDistributionsLocked}
                  onSave={(distributions) => {
                    if (publicKey) {
                      setStagedDistributions(prev => ({ ...prev, [publicKey]: distributions }));
                      localStorage.setItem(STORAGE_KEYS.distributions(publicKey), JSON.stringify(distributions));
                      const minDays = Math.min(...distributions.map((phase: any) => phase.inactivityDays));
                      setVault(prev => prev ? { ...prev, threshold: minDays * 24 * 60 * 60 * 1000 } : prev);
                      console.log('Distributions saved for', publicKey, ':', distributions);

                      const wallet = selectedWallet || WalletType.FREIGHTER;
                      contractService
                        .setDistributions(
                          publicKey,
                          distributions.map((p: any) => ({
                            inactivity_days: Number(p.inactivityDays),
                            entries: Object.entries(p.distributions || {})
                              .map(([nomineeId, pct]) => {
                                const nominee = currentNominees.find((n: any) => n.id === nomineeId);
                                if (!nominee) return null;

                                const bps = Math.round((parseFloat(String(pct)) || 0) * 100);
                                if (bps <= 0) return null;

                                return {
                                  address: nominee.address,
                                  bps,
                                };
                              })
                              .filter(Boolean),
                          })),
                          (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet),
                        )
                        .then((res) => {
                          if (res.success) {
                            addToast({
                              status: 'success',
                              title: 'Distribution Saved On-Chain',
                              description: `${distributions.length} phases stored in contract`,
                            });
                          } else {
                            addToast({
                              status: 'failed',
                              message: 'On-chain save failed',
                              detail: res.error || 'Could not save distributions to contract',
                            });
                          }
                        });
                    }
                  }}
                />
                <p className="text-xs text-zinc-500 px-1">
                  Earliest configured inactivity phase is used as the inactivity trigger.
                </p>
              </div>

            </div>

          </div>

          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-8">
            <div className="glass-card p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="micro-label">Connected Account</div>
                {selectedWallet && (
                  <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] text-zinc-400 font-bold uppercase tracking-tighter">
                    {selectedWallet}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                  selectedWallet === WalletType.METAMASK 
                    ? 'bg-orange-500/10 border-orange-500/20' 
                    : 'bg-emerald-500/10 border-emerald-500/20'
                }`}>
                  {selectedWallet === WalletType.METAMASK ? (
                    <Cpu className="w-5 h-5 text-orange-500" />
                  ) : (
                    <Wallet className="w-5 h-5 text-emerald-500" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold truncate">{publicKey}</div>
                  <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-widest mt-0.5">
                    {selectedWallet === WalletType.METAMASK ? 'MetaMask Stellar Snap' : 'Stellar Network Node'}
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card p-8">
              <div className="micro-label mb-4">Vault Deposit</div>
              <p className="text-xs text-zinc-500 mb-4 leading-relaxed">
                Auto-distribution only works for funds deposited into the contract vault.
              </p>
              <div className="flex items-center justify-between text-xs mb-4">
                <span className="text-zinc-500">Vault Balance</span>
                <span className="text-zinc-300 font-mono">{stroopsToXlmString(vaultBalanceStroops)} XLM</span>
              </div>
              <div className="flex gap-3">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={depositXlm}
                  onChange={(e) => setDepositXlm(e.target.value)}
                  placeholder="Amount (XLM)"
                  className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50"
                />
                <button
                  onClick={handleDeposit}
                  disabled={isDepositing || !depositXlm.trim()}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                >
                  {isDepositing ? 'Depositing...' : 'Deposit'}
                </button>
              </div>
            </div>

            <div className="glass-card p-8">
              <div className="micro-label mb-8">Protocol Health</div>
              <div className="space-y-5">
                {[
                  { label: "Soroban Runtime", status: "Operational", color: "text-emerald-500" },
                  { label: "Inactivity Clock", status: "Synced", color: "text-emerald-500" },
                  { label: "Distribution Key", status: "Encrypted", color: "text-blue-500" },
                  { label: "Network Latency", status: "12ms", color: "text-zinc-500" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-medium">
                    <span className="text-zinc-500">{item.label}</span>
                    <span className={item.color}>{item.status}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card p-8">
              <div className="flex items-center justify-between mb-8">
                <div className="micro-label">Activity Log</div>
                <History className="w-4 h-4 text-zinc-600" />
              </div>
              <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {history.length === 0 ? (
                  <div className="text-center py-12 text-zinc-600 text-xs italic">
                    No recent activity recorded.
                  </div>
                ) : (
                  history.map((tx) => {
                    const statusConfig = {
                      PENDING: { color: 'text-blue-500', bg: 'bg-blue-500/10', label: 'Processing' },
                      SUCCESS: { color: 'text-emerald-500', bg: 'bg-emerald-500/10', label: 'Confirmed' },
                      FAILED: { color: 'text-red-500', bg: 'bg-red-500/10', label: 'Failed' }
                    };
                    const status = statusConfig[tx.status];
                    
                    return (
                      <div key={tx.id} className="flex gap-4 group">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center border shrink-0 group-hover:opacity-100 transition-all ${status.bg} border-white/10 group-hover:bg-white/10`}>
                          {tx.status === 'PENDING' && <RefreshCw className={`w-4 h-4 animate-spin ${status.color}`} />}
                          {tx.status === 'SUCCESS' && <CheckCircle2 className={`w-4 h-4 ${status.color}`} />}
                          {tx.status === 'FAILED' && <AlertTriangle className={`w-4 h-4 ${status.color}`} />}
                          {(tx.type === 'TRANSFER' || tx.type === 'DEPOSIT') && tx.status !== 'PENDING' && <ArrowRightLeft className="w-4 h-4 text-zinc-400" />}
                          {tx.type === 'CHECK_IN' && tx.status !== 'PENDING' && <Heart className="w-4 h-4 text-zinc-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-bold truncate">{tx.type}</span>
                            <span className="text-[10px] text-zinc-600">
                              {new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className={`text-[11px] truncate ${status.color}`}>
                            {status.label} • {tx.amount ? `${tx.amount} XLM` : 'Protocol Signal'}
                          </div>
                          {tx.hash && (
                            <a 
                              href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-400 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Explorer
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Configuration Section Header */}
            <div className="border-t border-white/5 pt-8">
              <div className="macro-label text-white/60 mb-8">Configuration & Staging</div>
            </div>

            {/* Configuration Panels */}
            <div className="grid grid-cols-1 gap-8">
              <ConditionalRemittance onSave={(conditions) => {
                console.log('Conditional Remittance saved:', conditions);
                addToast({
                  status: 'success',
                  title: 'Conditions Saved',
                  description: `${conditions.length} conditions configured`
                });
              }} />
            </div>

            <ContractInteraction 
              userAddress={publicKey}
              selectedWallet={selectedWallet || WalletType.FREIGHTER}
              signTransaction={async (xdr: string) => {
                return await stellarService.signXDR(xdr, publicKey, selectedWallet || WalletType.FREIGHTER);
              }}
            />

            <div className="p-8 rounded-3xl bg-blue-600/5 border border-blue-600/10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                  <Info className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-xs font-bold text-blue-500 uppercase tracking-widest">Protocol Tip</div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Regular life signals ensure the protocol remains in 'ACTIVE' state. If the trigger reaches 0, the distribution sequence initiates automatically.
              </p>
            </div>

            {/* Staged Nominees Display */}
            {currentNominees.length > 0 && (
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold">Configured Nominees</h3>
                    <p className="text-xs text-zinc-500">Your staged beneficiary distribution</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {currentNominees.map((nominee, idx) => (
                    <div key={nominee.id} className="p-3 bg-white/5 border border-purple-500/20 rounded-lg">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-300 mb-1">Nominee {idx + 1}</div>
                          <div className="text-[11px] font-mono text-purple-400 truncate">{nominee.address}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-purple-500">{nominee.percentage}%</div>
                          <div className="text-[11px] text-zinc-500 capitalize">{nominee.role}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Staged Timeline Display */}
            {currentTimeline.length > 0 && (
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold">Configured Release Schedule</h3>
                    <p className="text-xs text-zinc-500">{currentTimeline.length} stage(s) configured</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {currentTimeline.map((stage, idx) => (
                    <div key={stage.id} className="p-3 bg-white/5 border border-blue-500/20 rounded-lg">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-zinc-300 mb-1">Stage {idx + 1}</div>
                          <div className="text-[11px] text-zinc-400 mb-1">{new Date(stage.date).toLocaleDateString()} at {new Date(stage.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                          {stage.description && <div className="text-[11px] text-zinc-500 italic truncate">{stage.description}</div>}
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold text-blue-500">{stage.amount}</div>
                          <div className="text-[11px] text-zinc-500">XLM</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Configured Distribution Phases Display */}
            {currentDistributions.length > 0 && (
              <div className="glass-card p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-9 h-9 rounded-lg bg-slate-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-slate-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold">Configured Distribution Phases</h3>
                    <p className="text-xs text-zinc-500">{currentDistributions.length} phase(s) configured</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {currentDistributions
                    .sort((a, b) => a.inactivityDays - b.inactivityDays)
                    .map((phase, idx) => {
                      const distributions = phase.distributions as Record<string, string>;
                      const phaseTotal = Object.values(distributions).reduce(
                        (sum: number, pct: string) => sum + (parseFloat(pct) || 0),
                        0
                      );
                      return (
                        <div key={phase.id} className="p-3 bg-white/5 border border-slate-500/20 rounded-lg">
                          <div className="text-xs font-semibold text-zinc-300 mb-2">
                            Phase {idx + 1}: If inactive for {phase.inactivityDays} days
                          </div>
                          <div className="space-y-1">
                            {Object.entries(distributions)
                              .filter(([_, pct]) => parseFloat(pct) > 0)
                              .map(([nomineeId, pct]) => {
                                const nominee = currentNominees.find(n => n.id === nomineeId);
                                return (
                                  <div key={nomineeId} className="text-[11px] text-zinc-400">
                                    {nominee ? `${nominee.address.slice(0, 10)}... (${nominee.role})` : nomineeId}: 
                                    <span className="text-slate-400 font-semibold"> {pct}%</span>
                                  </div>
                                );
                              })}
                          </div>
                          <div className="mt-2 text-[11px] font-mono bg-white/5 px-2 py-1 rounded text-zinc-500">
                            Total: {phaseTotal.toFixed(2)}%
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Wallet Selection Modal */}
      <AnimatePresence>
        {showWalletModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowWalletModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative z-10 w-full max-w-md glass-card p-6 sm:p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold tracking-tight">Connect Wallet</h2>
                <button onClick={() => setShowWalletModal(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6 text-zinc-500" />
                </button>
              </div>

              <div className="space-y-4">
                <button 
                  onClick={() => connectToWallet(WalletType.FREIGHTER)}
                  className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4 hover:bg-white/10 hover:border-blue-500/30 transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center border border-blue-500/20 group-hover:bg-blue-500/20 transition-colors">
                    <Shield className="w-6 h-6 text-blue-500" />
                  </div>
                  <div>
                    <div className="font-bold text-lg">Freighter</div>
                    <div className="text-xs text-zinc-500">Native Stellar Wallet</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-700 ml-auto group-hover:text-white transition-colors" />
                </button>

                <button 
                  onClick={() => connectToWallet(WalletType.METAMASK)}
                  className="w-full p-6 bg-white/5 border border-white/10 rounded-2xl flex items-center gap-4 hover:bg-white/10 hover:border-orange-500/30 transition-all group text-left"
                >
                  <div className="w-12 h-12 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20 group-hover:bg-orange-500/20 transition-colors">
                    <Cpu className="w-6 h-6 text-orange-500" />
                  </div>
                  <div>
                    <div className="font-bold text-lg">MetaMask</div>
                    <div className="text-xs text-zinc-500">Via Stellar Snap</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-zinc-700 ml-auto group-hover:text-white transition-colors" />
                </button>
              </div>

              <p className="mt-8 text-center text-xs text-zinc-600 leading-relaxed">
                By connecting your wallet, you agree to our Terms of Service and Privacy Policy.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showSendModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowSendModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative z-10 w-full max-w-lg glass-card p-6 sm:p-10 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-10">
                <h2 className="text-2xl font-bold tracking-tight">Transfer Assets</h2>
                <button onClick={() => setShowSendModal(false)} className="p-2 hover:bg-white/5 rounded-full transition-colors">
                  <X className="w-6 h-6 text-zinc-500" />
                </button>
              </div>

              {txStatus === 'idle' && (
                <form onSubmit={handleSendXLM} className="space-y-8">
                  <div className="space-y-6">
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Recipient Address</label>
                      <input 
                        type="text" 
                        required
                        value={destAddress}
                        onChange={(e) => setDestAddress(e.target.value)}
                        placeholder="G..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-widest mb-3">Amount (XLM)</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          step="0.0000001"
                          required
                          value={sendAmount}
                          onChange={(e) => setSendAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-zinc-700"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-600">XLM</div>
                      </div>
                    </div>
                  </div>

                  <button 
                    type="submit"
                    className="w-full py-5 btn-primary text-base flex items-center justify-center gap-3"
                  >
                    Confirm Transfer
                  </button>
                </form>
              )}

              {txStatus === 'pending' && (
                <div className="py-20 text-center">
                  <div className="relative w-24 h-24 mx-auto mb-10">
                    <RefreshCw className="w-24 h-24 text-blue-500 animate-spin opacity-20" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Database className="w-10 h-10 text-blue-500" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-bold mb-3 tracking-tight">Processing...</h3>
                  <p className="text-zinc-500 text-sm">Awaiting signature from your wallet extension.</p>
                </div>
              )}

              {txStatus === 'success' && (
                <div className="py-12 text-center">
                  <div className="w-24 h-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-10 border border-emerald-500/20">
                    <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                  </div>
                  <h3 className="text-3xl font-bold mb-4 tracking-tight">Transfer Complete</h3>
                  <div className="p-6 bg-white/5 border border-white/5 rounded-2xl mb-10 text-left space-y-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Status</span>
                      <span className="text-emerald-500 font-bold">Confirmed</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Amount</span>
                      <span className="text-white font-bold">{sendAmount} XLM</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Network</span>
                      <span className="text-white">Stellar Testnet</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4">
                    <a 
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="w-full py-4 btn-secondary text-sm flex items-center justify-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      View on Explorer
                    </a>
                    <button 
                      onClick={() => {
                        setShowSendModal(false);
                        setTxStatus('idle');
                        setDestAddress('');
                        setSendAmount('');
                      }}
                      className="w-full py-4 btn-primary text-sm"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}

              {txStatus === 'error' && (
                <div className="py-12 text-center">
                  <div className="w-24 h-24 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto mb-10 border border-red-500/20">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                  </div>
                  <h3 className="text-3xl font-bold mb-4 tracking-tight">Transfer Failed</h3>
                  <div className="p-6 bg-red-500/5 border border-red-500/10 rounded-2xl mb-10 text-left">
                    <div className="text-xs font-bold text-red-400 uppercase tracking-widest mb-2">Error Details</div>
                    <p className="text-sm text-red-400/80 leading-relaxed">{txError}</p>
                  </div>
                  <button 
                    onClick={() => setTxStatus('idle')}
                    className="w-full py-4 btn-secondary text-sm"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="border-t border-white/5 py-12 sm:py-16 bg-black/20 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-10 sm:gap-12">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-white rounded flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-black" />
            </div>
            <span className="font-bold tracking-tight text-lg">Continuum</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-12 text-sm font-medium text-zinc-500">
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
            <a href="#" className="hover:text-white transition-colors">Audit</a>
            <a href="#" className="hover:text-white transition-colors">Security</a>
          </div>
          <div className="text-xs font-mono text-zinc-700 uppercase tracking-[0.2em]">
            Stellar_Testnet // v1.0.4
          </div>
        </div>
      </footer>
      
      {/* Transaction Toast Notifications */}
      <TransactionToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}
