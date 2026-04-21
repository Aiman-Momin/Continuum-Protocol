import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, Clock, Users, Activity, AlertTriangle, ChevronRight,
  Heart, CheckCircle2, ArrowRightLeft, Wallet, ExternalLink,
  ArrowUpRight, RefreshCw, RotateCcw, X, Cpu, Database, History,
  Info, Plus, Settings, Lock
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
  nominees: (k: string) => `continuum:nominees:${k}`,
  timeline: (k: string) => `continuum:timeline:${k}`,
  distributions: (k: string) => `continuum:distributions:${k}`,
  history: (k: string) => `continuum:history:${k}`,
  inactivityDailyNotice: (k: string) => `continuum:inactivity-notice-day:${k}`,
  inactivityCycleLastActive: (k: string) => `continuum:inactivity-cycle-last-active:${k}`,
};

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

const XLM_TO_STROOPS = 10_000_000;

const ROLE_ID_TO_SYMBOL: Record<string, string> = {
  executor: 'EXEC', beneficiary: 'BENF', trustee: 'TRUS', advisor: 'ADVS',
};
const ROLE_SYMBOL_TO_ID: Record<string, string> = {
  EXEC: 'executor', BENF: 'beneficiary', TRUS: 'trustee', ADVS: 'advisor',
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
    const xlm = Number(v) / XLM_TO_STROOPS;
    return Number.isFinite(xlm) ? xlm.toFixed(2) : '0.00';
  } catch {
    const n = Number(stroops);
    return Number.isFinite(n) ? (n / XLM_TO_STROOPS).toFixed(2) : '0.00';
  }
}
function xlmToStroopsString(xlm: string): string {
  const n = parseFloat(xlm);
  if (!Number.isFinite(n)) return '0';
  return String(BigInt(Math.round(n * XLM_TO_STROOPS)));
}
function unixSecondsToDatetimeLocalString(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

/* ═══════════════════════════════════════════════════════════════════
   APP
═══════════════════════════════════════════════════════════════════ */
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

  const [showSendModal, setShowSendModal] = useState(false);
  const [destAddress, setDestAddress] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [txStatus, setTxStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const [depositXlm, setDepositXlm] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);
  const [isExecutingDistribution, setIsExecutingDistribution] = useState(false);
  const [vaultBalanceStroops, setVaultBalanceStroops] = useState<string>('0');
  const autoDistributionTriggeredRef = useRef(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [stagedNominees, setStagedNominees] = useState<Record<string, any[]>>({});
  const [stagedTimeline, setStagedTimeline] = useState<Record<string, any[]>>({});
  const [stagedDistributions, setStagedDistributions] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!publicKey) return;
    const sN = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.nominees(publicKey)));
    const sT = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.timeline(publicKey)));
    const sD = safeJsonParse<any[]>(localStorage.getItem(STORAGE_KEYS.distributions(publicKey)));
    const sH = safeJsonParse<TransactionRecord[]>(localStorage.getItem(STORAGE_KEYS.history(publicKey)));
    if (sN) setStagedNominees(p => ({ ...p, [publicKey]: sN }));
    if (sT) setStagedTimeline(p => ({ ...p, [publicKey]: sT }));
    if (sD) setStagedDistributions(p => ({ ...p, [publicKey]: sD }));
    if (sH) setHistory(sH);
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const load = async () => {
      const bal = await contractService.getVaultBalance(publicKey);
      if (!cancelled) setVaultBalanceStroops(bal);
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [publicKey]);

  useEffect(() => {
    if (!publicKey) return;
    let cancelled = false;
    const wallet = selectedWallet || WalletType.FREIGHTER;
    const load = async () => {
      try {
        const [nominees, timeline, distributions] = await Promise.all([
          contractService.getNominees(publicKey),
          contractService.getTimeline(publicKey),
          contractService.getDistributions(publicKey),
        ]);
        if (cancelled) return;
        if (nominees.length) {
          const ui = nominees.map(n => ({ id: `${n.address}:${roleSymbolToId(n.role)}`, address: n.address, role: roleSymbolToId(n.role), percentage: (n.bps / 100).toFixed(2) }));
          setStagedNominees(p => ({ ...p, [publicKey]: ui }));
          localStorage.setItem(STORAGE_KEYS.nominees(publicKey), JSON.stringify(ui));
        }
        if (timeline.length) {
          const ui = timeline.map(s => ({ id: `t-${s.when}-${s.amount}`, date: unixSecondsToDatetimeLocalString(s.when), amount: stroopsToXlmString(String(s.amount)), description: s.memo === "NONE" ? "" : String(s.memo) }));
          setStagedTimeline(p => ({ ...p, [publicKey]: ui }));
          localStorage.setItem(STORAGE_KEYS.timeline(publicKey), JSON.stringify(ui));
        }
        if (distributions.length) {
          const addrToId: Record<string, string> = {};
          nominees.forEach(n => { addrToId[n.address] = `${n.address}:${roleSymbolToId(n.role)}`; });
          const ui = distributions.map(p => ({ id: `p-${p.inactivity_days}`, inactivityDays: p.inactivity_days, distributions: p.entries.reduce((acc: Record<string, string>, e) => { const id = addrToId[e.address]; if (id) acc[id] = (e.bps / 100).toFixed(2); return acc; }, {}) }));
          setStagedDistributions(p => ({ ...p, [publicKey]: ui }));
          localStorage.setItem(STORAGE_KEYS.distributions(publicKey), JSON.stringify(ui));
        }
      } catch (e) { console.error("[App] load config:", e); }
    };
    load();
    return () => { cancelled = true; };
  }, [publicKey, selectedWallet]);

  const currentNominees = publicKey ? (stagedNominees[publicKey] || []) : [];
  const currentTimeline = publicKey ? (stagedTimeline[publicKey] || []) : [];
  const currentDistributions = publicKey ? (stagedDistributions[publicKey] || []) : [];

  const nomineesTotalPct = currentNominees.reduce((s: number, n: any) => s + (parseFloat(String(n.percentage)) || 0), 0);
  const isNomineesLocked = currentNominees.length > 0 && Math.abs(nomineesTotalPct - 100) < 0.01;
  const distributionsTotalPct = currentDistributions.reduce((s: number, p: any) => s + (Object.values(p.distributions || {}) as any[]).reduce((ps: number, pct: any) => ps + (parseFloat(String(pct)) || 0), 0), 0);
  const isDistributionsLocked = currentDistributions.length > 0 && Math.abs(distributionsTotalPct - 100) < 0.01;
  const isTimelineLocked = currentTimeline.length > 0;

  const configuredInactivityDays = currentDistributions.length ? Math.min(...currentDistributions.map((p: any) => p.inactivityDays)) : null;
  const inactivityThresholdMs = configuredInactivityDays ? configuredInactivityDays * 86400000 : null;
  const inactivityStatus = vault && inactivityThresholdMs ? calculateInactivityStatus(history, inactivityThresholdMs, vault.lastActive) : null;

  const elapsedChainDays = vault?.lastActive ? Math.floor((Date.now() - vault.lastActive) / 86400000) : null;
  const hasEligibleDistributionPhase = elapsedChainDays !== null ? currentDistributions.some((p: any) => elapsedChainDays >= Number(p.inactivityDays)) : false;
  const distributionReady = Boolean(vault?.lastActive && currentDistributions.length > 0 && hasEligibleDistributionPhase);

  const addToast = useCallback((toast: Omit<Toast, 'id'> & { id?: string }) => {
    const id = toast.id || Math.random().toString(36).substr(2, 9);
    const t: Toast = { ...toast, id, autoHideDelay: toast.autoHideDelay || (toast.status === 'pending' ? 0 : 5000) };
    setToasts(prev => [...prev, t]);
    if (t.autoHideDelay && t.autoHideDelay > 0) setTimeout(() => removeToast(id), t.autoHideDelay);
    return id;
  }, []);
  const removeToast = useCallback((id: string) => setToasts(p => p.filter(t => t.id !== id)), []);
  const updateToast = useCallback((id: string, updates: Partial<Toast>) => setToasts(p => p.map(t => t.id === id ? { ...t, ...updates } : t)), []);

  const handleConnect = () => setShowWalletModal(true);

  const connectToWallet = async (type: WalletType) => {
    setError(null); setIsConnecting(true); setShowWalletModal(false);
    try {
      let avail = type === WalletType.FREIGHTER ? await stellarService.checkFreighter() : await stellarService.checkMetaMask();
      if (!avail) { setError(`${type} wallet not detected. Please install the extension.`); setIsConnecting(false); return; }
      const address = await stellarService.connectWallet(type);
      if (address) { setPublicKey(address); setSelectedWallet(type); await refreshAccountData(address); }
    } catch (err: any) { setError(err.message || "Connection failed."); }
    finally { setIsConnecting(false); }
  };

  const refreshAccountData = async (address: string) => {
    const bal = await stellarService.getAccountBalance(address);
    const lastActive = await contractService.getLastActive(address);
    setBalance(bal);
    setVault({ owner: address, lastActive: lastActive || 0, threshold: 86400000 * 90, status: lastActive && lastActive > 0 ? VaultStatus.Active : VaultStatus.InactivityDetected, beneficiaries: [{ address: "GB...9Y2", percentage: 50, name: "Legacy Trust" }], balance: bal });
  };

  const handleDisconnect = () => { setPublicKey(null); setSelectedWallet(null); setBalance(0); setVault(null); setHistory([]); setError(null); setDepositXlm(''); setVaultBalanceStroops('0'); };

  useEffect(() => {
    if (!publicKey) return;
    localStorage.setItem(STORAGE_KEYS.history(publicKey), JSON.stringify(history));
  }, [publicKey, history]);

  const handleDeposit = async () => {
    if (!publicKey) return;
    const n = parseFloat(depositXlm);
    if (!Number.isFinite(n) || n <= 0) { addToast({ status: 'failed', message: 'Invalid amount', detail: 'Enter a positive XLM amount' }); return; }
    const wallet = selectedWallet || WalletType.FREIGHTER;
    setIsDepositing(true);
    try {
      const res = await contractService.deposit(publicKey, xlmToStroopsString(depositXlm), (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
      if (res.success) {
        addToast({ status: 'success', message: 'Deposit successful', detail: `${depositXlm} XLM deposited`, hash: res.hash });
        setDepositXlm('');
        const bal = await contractService.getVaultBalance(publicKey);
        setVaultBalanceStroops(bal);
        const lastActive = await contractService.getLastActive(publicKey);
        if (lastActive && lastActive > 0) { setVault(p => p ? { ...p, lastActive, status: VaultStatus.Active } : p); }
        else {
          const ci = await contractService.checkIn(publicKey, (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
          if (ci.success) { setVault(p => p ? { ...p, lastActive: Date.now(), status: VaultStatus.Active } : p); addToast({ status: 'success', message: 'Activity recorded', detail: 'Proof-of-life set after deposit', hash: ci.hash }); }
          else addToast({ status: 'warning', message: 'No activity recorded', detail: 'Deposit succeeded but check-in failed. Click Check In manually.' });
        }
      } else addToast({ status: 'failed', message: 'Deposit failed', detail: res.error || 'Could not deposit' });
    } catch (e: any) { addToast({ status: 'failed', message: 'Deposit error', detail: e?.message }); }
    finally { setIsDepositing(false); }
  };

  const handleSendXLM = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !destAddress || !sendAmount) return;
    const n = parseFloat(sendAmount);
    if (isNaN(n) || n <= 0) { setTxError('Valid amount required'); return; }
    if (!destAddress.startsWith('G') || destAddress.length !== 56) { setTxError('Invalid Stellar address'); return; }
    if (n > balance) { setTxError('Insufficient balance'); return; }
    setTxStatus('pending'); setTxError(null);
    const toastId = addToast({ id: `tx-${Date.now()}`, status: 'pending', message: 'Transfer processing', detail: `Sending ${sendAmount} XLM…` });
    const result = await stellarService.sendXLM(publicKey, destAddress, sendAmount, selectedWallet || WalletType.FREIGHTER);
    if (result.success) {
      setTxStatus('success'); setTxHash(result.hash || null);
      setBalance(await stellarService.getAccountBalance(publicKey));
      updateToast(toastId, { status: 'success', message: 'Transfer complete', detail: `${sendAmount} XLM sent`, hash: result.hash });
      setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'TRANSFER', amount: sendAmount, dest: destAddress, status: 'SUCCESS', timestamp: Date.now(), hash: result.hash }, ...p]);
    } else {
      setTxStatus('error'); setTxError(result.error || 'Transaction failed');
      updateToast(toastId, { status: 'failed', message: 'Transfer failed', detail: result.error });
      setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'TRANSFER', amount: sendAmount, dest: destAddress, status: 'FAILED', timestamp: Date.now() }, ...p]);
    }
  };

  const handleResetActivity = async () => {
    if (!publicKey) return;
    setIsResetting(true);
    const toastId = addToast({ id: `reset-${Date.now()}`, status: 'pending', message: 'Resetting activity…', detail: 'Updating proof-of-life signal' });
    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.checkIn(publicKey, (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
      if (result.success && vault) {
        setVault({ ...vault, lastActive: Date.now(), status: VaultStatus.Active });
        setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'CHECK_IN', status: 'SUCCESS', timestamp: Date.now(), hash: result.hash }, ...p]);
        updateToast(toastId, { status: 'success', message: 'Activity reset', detail: 'Inactivity clock restarted', hash: result.hash });
      } else updateToast(toastId, { status: 'failed', message: 'Reset failed', detail: 'Unable to reset activity' });
    } catch (e: any) { updateToast(toastId, { status: 'failed', message: 'Reset error', detail: e.message }); }
    finally { setIsResetting(false); }
  };

  const handleCheckIn = async () => {
    if (!publicKey) return;
    setIsCheckingIn(true);
    const toastId = addToast({ id: `ci-${Date.now()}`, status: 'pending', message: 'Sending heartbeat…', detail: 'Proof-of-life signal transmitted' });
    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.checkIn(publicKey, (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
      if (result.success && vault) {
        setVault({ ...vault, lastActive: Date.now(), status: VaultStatus.Active });
        updateToast(toastId, { status: 'success', message: 'Check-in confirmed', detail: 'Inactivity clock reset', hash: result.hash });
        setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'CHECK_IN', status: 'SUCCESS', timestamp: Date.now(), hash: result.hash }, ...p]);
      } else {
        updateToast(toastId, { status: 'failed', message: 'Check-in failed', detail: 'Could not send proof-of-life' });
        setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'CHECK_IN', status: 'FAILED', timestamp: Date.now() }, ...p]);
      }
    } catch (e: any) {
      updateToast(toastId, { status: 'failed', message: 'Check-in error', detail: e.message });
      setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'CHECK_IN', status: 'FAILED', timestamp: Date.now() }, ...p]);
    }
    finally { setIsCheckingIn(false); }
  };

  const handleExecuteDistribution = useCallback(async () => {
    if (!publicKey) return;
    const lastActive = await contractService.getLastActive(publicKey);
    if (!lastActive || lastActive === 0) { addToast({ status: 'failed', message: 'No activity recorded', detail: 'Perform a check-in or deposit first.' }); return; }
    if (vault?.lastActive !== lastActive) setVault(p => p ? { ...p, lastActive } : p);
    if (currentDistributions.length === 0) { addToast({ status: 'failed', message: 'No distributions configured', detail: 'Set up distribution phases first.' }); return; }
    const elapsed = lastActive ? Math.floor((Date.now() - lastActive) / 86400000) : 0;
    if (!currentDistributions.some((p: any) => Number(p.inactivityDays) <= elapsed)) { addToast({ status: 'failed', message: 'Not ready', detail: `${elapsed} day(s) elapsed; no phase triggered yet.` }); return; }
    setIsExecutingDistribution(true);
    const toastId = addToast({ id: `dist-${Date.now()}`, status: 'pending', message: 'Executing distribution…', detail: 'Submitting contract transaction' });
    try {
      const wallet = selectedWallet || WalletType.FREIGHTER;
      const result = await contractService.executeDistribution(publicKey, (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
      if (result.success) {
        updateToast(toastId, { status: 'success', message: 'Distribution executed', detail: 'Funds distributed per your phases', hash: result.hash });
        setHistory(p => [{ id: Math.random().toString(36).substr(2, 9), type: 'TRANSFER', amount: 'AUTO-DISTRIBUTION', status: 'SUCCESS', timestamp: Date.now(), hash: result.hash }, ...p]);
      } else updateToast(toastId, { status: 'failed', message: 'Distribution failed', detail: result.error });
    } catch (e: any) { updateToast(toastId, { status: 'failed', message: 'Distribution error', detail: e.message }); }
    finally { setIsExecutingDistribution(false); }
  }, [publicKey, selectedWallet, addToast, currentDistributions, vault]);

  useEffect(() => {
    if (!publicKey || !inactivityStatus?.isInactive || !vault || vault.lastActive === 0 || autoDistributionTriggeredRef.current) return;
    autoDistributionTriggeredRef.current = true;
    handleExecuteDistribution();
  }, [publicKey, inactivityStatus?.isInactive, handleExecuteDistribution, vault]);

  useEffect(() => { if (!publicKey) autoDistributionTriggeredRef.current = false; }, [publicKey]);

  const handleRefreshBalance = async () => {
    if (!publicKey) return;
    setIsRefreshing(true);
    try { setBalance(await stellarService.getAccountBalance(publicKey)); }
    catch (e) { console.error(e); }
    finally { setTimeout(() => setIsRefreshing(false), 500); }
  };

  const daysSinceActive = vault ? Math.floor((Date.now() - vault.lastActive) / 86400000) : 0;
  const daysRemaining = vault && inactivityThresholdMs ? Math.max(0, Math.floor((inactivityThresholdMs - (Date.now() - vault.lastActive)) / 86400000)) : null;

  useEffect(() => {
    if (!publicKey || daysRemaining === null || !vault) return;
    const cycleKey = STORAGE_KEYS.inactivityCycleLastActive(publicKey);
    const dailyKey = STORAGE_KEYS.inactivityDailyNotice(publicKey);
    const lastActive = Number(vault.lastActive || 0);
    const stored = Number(localStorage.getItem(cycleKey) || 0);
    if (lastActive > stored) { localStorage.setItem(cycleKey, String(lastActive)); localStorage.removeItem(dailyKey); }
    if (daysRemaining > 5 || daysRemaining < 0) return;
    const todayKey = getLocalDateKey();
    if (localStorage.getItem(dailyKey) === todayKey) return;
    addToast({ status: 'pending', message: 'Inactivity reminder', detail: daysRemaining === 0 ? 'Timer at 0 days. Check in now.' : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining.`, autoHideDelay: 8000 });
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const show = () => { try { new Notification('Continuum', { body: daysRemaining === 0 ? 'Timer at 0 days.' : `${daysRemaining} days remaining.` }); } catch { } };
      if (Notification.permission === 'granted') show();
      else if (Notification.permission === 'default') Notification.requestPermission().then(p => { if (p === 'granted') show(); }).catch(() => {});
    }
    fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: publicKey, type: 'inactivity_warning', message: `${daysRemaining} day(s) remaining.` }) }).catch(() => {});
    localStorage.setItem(dailyKey, todayKey);
  }, [publicKey, vault, daysRemaining, addToast]);

  /* ── LANDING PAGE ─────────────────────────────────────────────── */
  if (!publicKey) {
    return (
      <div className="min-h-screen" style={{ background: 'var(--paper)', color: 'var(--cream)', fontFamily: 'var(--font-body)' }}>

        {/* Nav */}
        <nav style={{ borderBottom: '1px solid var(--border)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50, background: 'rgba(19,18,15,0.9)', backdropFilter: 'blur(12px)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: 32, height: 32, background: 'var(--gold)', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={16} color="var(--ink)" strokeWidth={2.5} />
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>Continuum</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
            <div className="hidden md:flex" style={{ gap: '2rem' }}>
              {['Features', 'How it works', 'Why'].map(l => (
                <a key={l} href={`#${l.toLowerCase().replace(/\s/g,'-')}`} className="label-caps" style={{ color: 'var(--ash)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--ash)')}>{l}</a>
              ))}
            </div>
            <button onClick={handleConnect} disabled={isConnecting} className="btn-primary" style={{ padding: '0.5rem 1.25rem' }}>
              {isConnecting ? <RefreshCw size={14} className="animate-spin" /> : null}
              {isConnecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          </div>
        </nav>

        {/* Hero */}
        <section style={{ position: 'relative', overflow: 'hidden', padding: '6rem 2rem 4rem', maxWidth: 1100, margin: '0 auto' }}>
          <div className="hero-grid-bg" />
          <div style={{ position: 'absolute', top: '20%', right: '-10%', width: 400, height: 400, background: 'radial-gradient(circle, rgba(214,175,100,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />

          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}>
            <div className="label-gold" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 20, height: 1, background: 'var(--gold-dim)' }} />
              On-Chain Inheritance Protocol · Stellar Testnet
            </div>
          </motion.div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'center' }} className="lg:grid-cols-2">
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(3rem, 6vw, 5.5rem)', lineHeight: 0.95, letterSpacing: '-0.02em', marginBottom: '1.5rem', color: 'var(--cream)' }}>
                Your assets<br />
                <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>outlive</em><br />
                your keys.
              </h1>
              <p style={{ color: 'var(--ash)', fontSize: '1.0625rem', lineHeight: 1.7, maxWidth: 480, marginBottom: '2.5rem' }}>
                Continuum is a programmable inheritance layer built on Stellar. If your wallet goes quiet, your pre-configured release phases execute — automatically, on-chain, without a middleman.
              </p>
              <div style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={handleConnect} disabled={isConnecting} className="btn-primary">
                  {isConnecting ? <RefreshCw size={14} className="animate-spin" /> : <Wallet size={14} />}
                  {isConnecting ? 'Connecting…' : 'Open the Vault'}
                </button>
                <span className="label-caps" style={{ color: 'var(--smoke)' }}>Non-custodial · Verifiable · Open source</span>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.65, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}>
              <div className="protocol-card">
                <div className="label-gold" style={{ marginBottom: '1.25rem' }}>Protocol state · live model</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {[
                    { icon: Activity, label: 'Heartbeat Verified', sub: 'Wallet activity detected on-chain', color: '#4ade80' },
                    { icon: Clock, label: 'Inactivity Countdown', sub: 'Trigger windows tracked per phase', color: 'var(--gold)' },
                    { icon: ArrowRightLeft, label: 'Distribution Ready', sub: 'Nominee phases queued for release', color: 'var(--amber)' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start', padding: '0.875rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 2 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 2, background: `${item.color}12`, border: `1px solid ${item.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <item.icon size={15} color={item.color} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--cream)', marginBottom: 2 }}>{item.label}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--ash)' }}>{item.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Problem / Solution */}
        <section id="Why" style={{ padding: '5rem 2rem', maxWidth: 1100, margin: '0 auto' }}>
          <div className="ornament" style={{ marginBottom: '3rem' }}>
            <span className="label-caps">The Problem</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem' }}>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '1.5rem' }}>
                Crypto assets disappear<br />
                <em style={{ color: 'var(--ash)', fontStyle: 'italic' }}>with their owners.</em>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {['No inheritance mechanism exists for self-custody wallets.', 'Lost keys mean permanently inaccessible funds.', 'Traditional estate planning cannot touch on-chain assets.'].map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <AlertTriangle size={15} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: '0.9375rem', color: 'var(--ash)', lineHeight: 1.6 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: '1.5rem' }}>
                Continuum makes your<br />
                <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>intentions permanent.</em>
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {['Proof-of-life check-ins keep your vault active.', 'Inactivity triggers automated phased distribution.', 'Smart contracts enforce your will — no lawyers needed.'].map((t, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                    <CheckCircle2 size={15} color="#4ade80" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: '0.9375rem', color: 'var(--ash)', lineHeight: 1.6 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" style={{ padding: '5rem 2rem', maxWidth: 1100, margin: '0 auto', borderTop: '1px solid var(--border)' }}>
          <div className="ornament" style={{ marginBottom: '3rem' }}>
            <span className="label-caps">How it works</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
            {[
              { n: '01', title: 'Connect', desc: 'Link your Freighter or MetaMask Stellar wallet.' },
              { n: '02', title: 'Configure', desc: 'Set nominees, inactivity thresholds, and distribution phases.' },
              { n: '03', title: 'Stay active', desc: 'Periodic check-ins reset your inactivity clock.' },
              { n: '04', title: 'Auto-execute', desc: 'If inactivity is detected, assets distribute per your phases.' },
            ].map((step, i) => (
              <div key={i} className="vault-card animate-fade-up" style={{ padding: '1.5rem', animationDelay: `${i * 0.08}s` }}>
                <div className="label-gold" style={{ fontSize: '2rem', fontFamily: 'var(--font-display)', marginBottom: '0.875rem', opacity: 0.5 }}>{step.n}</div>
                <div style={{ fontWeight: 600, fontSize: '0.9375rem', marginBottom: '0.5rem' }}>{step.title}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--ash)', lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section style={{ padding: '5rem 2rem 7rem', maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2.5rem, 5vw, 4rem)', letterSpacing: '-0.02em', lineHeight: 1.05, marginBottom: '1.25rem' }}>
            Your legacy deserves<br />
            <em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>a contingency plan.</em>
          </h2>
          <p style={{ color: 'var(--ash)', fontSize: '1rem', lineHeight: 1.7, marginBottom: '2.5rem' }}>
            Set it up once. Let the protocol handle the rest.
          </p>
          <button onClick={handleConnect} disabled={isConnecting} className="btn-primary" style={{ padding: '0.875rem 2.5rem', fontSize: '0.9375rem' }}>
            {isConnecting ? <RefreshCw size={15} className="animate-spin" /> : <Shield size={15} />}
            {isConnecting ? 'Connecting…' : 'Open the Vault'}
          </button>
        </section>

        {/* Footer */}
        <footer style={{ borderTop: '1px solid var(--border)', padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={14} color="var(--gold)" />
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1rem' }}>Continuum</span>
            <span className="label-caps" style={{ marginLeft: '0.5rem' }}>© 2026</span>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            {['Docs', 'Audit', 'Terms'].map(l => <a key={l} href="#" className="label-caps" style={{ color: 'var(--smoke)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--ash)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--smoke)')}>{l}</a>)}
          </div>
          <span className="label-caps" style={{ color: 'var(--smoke)' }}>Stellar Testnet · v1.0.4</span>
        </footer>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} style={{ position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 200 }}>
              <div className="vault-card" style={{ padding: '1rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', borderLeft: '3px solid #f87171', maxWidth: 400 }}>
                <AlertTriangle size={15} color="#f87171" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: '0.875rem', color: 'var(--ash)', flex: 1 }}>{error}</span>
                <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--smoke)', padding: 4 }}><X size={14} /></button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Wallet modal */}
        <AnimatePresence>{showWalletModal && <WalletModal onClose={() => setShowWalletModal(false)} onConnect={connectToWallet} />}</AnimatePresence>
      </div>
    );
  }

  /* ── DASHBOARD ────────────────────────────────────────────────── */
  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--cream)', fontFamily: 'var(--font-body)' }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid var(--border)', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2rem', position: 'sticky', top: 0, zIndex: 50, background: 'rgba(19,18,15,0.95)', backdropFilter: 'blur(12px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, background: 'var(--gold)', borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Shield size={14} color="var(--ink)" strokeWidth={2.5} />
          </div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>Continuum</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.375rem 0.875rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 2 }}>
            <span className="status-dot" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--ash)' }}>{publicKey.slice(0, 6)}…{publicKey.slice(-6)}</span>
            {selectedWallet && <span className="tag tag-gold">{selectedWallet}</span>}
          </div>
          <button onClick={handleDisconnect} className="label-caps" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--smoke)', transition: 'color 0.2s' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--ash)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--smoke)')}>Disconnect</button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '2.5rem 2rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '2rem' }}>

          {/* ── Left column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Hero status card */}
            <div className="vault-card" style={{ padding: '2.5rem', position: 'relative', overflow: 'hidden' }}>
              {/* watermark */}
              <div style={{ position: 'absolute', right: '-1rem', top: '-1rem', opacity: 0.03, pointerEvents: 'none' }}>
                <Shield size={220} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2rem', alignItems: 'start', position: 'relative' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                    <span className="tag tag-gold">Protocol Active</span>
                    <span className="label-caps" style={{ color: 'var(--smoke)' }}>ID: CTN-{publicKey.slice(-4).toUpperCase()}</span>
                  </div>
                  <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(2rem, 4vw, 3rem)', lineHeight: 1.05, letterSpacing: '-0.02em', marginBottom: '0.875rem', color: 'var(--cream)' }}>
                    Your legacy<br /><em style={{ color: 'var(--gold)', fontStyle: 'italic' }}>is secured.</em>
                  </h1>
                  <p style={{ fontSize: '0.875rem', color: 'var(--ash)', lineHeight: 1.7, maxWidth: 420, marginBottom: '1.75rem' }}>
                    Continuum is monitoring your Stellar account. Assets are programmed for automatic transition upon inactivity.
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button onClick={handleCheckIn} disabled={isCheckingIn} className="btn-primary">
                      {isCheckingIn ? <RefreshCw size={14} className="animate-spin" /> : <Heart size={14} />}
                      {isCheckingIn ? 'Sending…' : 'Check In'}
                    </button>
                    <button onClick={handleResetActivity} disabled={isResetting} className="btn-ghost">
                      {isResetting ? <RefreshCw size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                      Reset
                    </button>
                    <button onClick={() => setShowSendModal(true)} className="btn-ghost">
                      <ArrowUpRight size={14} /> Transfer
                    </button>
                  </div>
                </div>

                {/* Days counter */}
                <div style={{ textAlign: 'center', paddingLeft: '2rem', borderLeft: '1px solid var(--border)' }}>
                  <div className="label-caps" style={{ marginBottom: '0.75rem' }}>Days Remaining</div>
                  <div className="vault-number">{daysRemaining ?? '—'}</div>
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--ash)' }}>
                    {daysRemaining === null ? 'Set inactivity threshold' : 'until trigger'}
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <WalletBalance userAddress={publicKey} pollInterval={5000} />
              <div className="vault-card" style={{ padding: '1.5rem' }}>
                <div className="label-caps" style={{ marginBottom: '1.25rem' }}>Nominees</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '3rem', lineHeight: 1, color: 'var(--cream)', marginBottom: '0.5rem' }}>{currentNominees.length}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--ash)' }}>
                  {currentNominees.length === 0 ? 'No nominees configured' : `${nomineesTotalPct.toFixed(0)}% allocated`}
                </div>
              </div>
            </div>

            {/* Inactivity status */}
            {inactivityStatus && inactivityThresholdMs && (
              <div>
                <InactivityStatus status={inactivityStatus} threshold={inactivityThresholdMs} />
                {inactivityStatus.isInactive && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={handleExecuteDistribution} disabled={isExecutingDistribution} className="btn-primary">
                      {isExecutingDistribution ? <RefreshCw size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
                      {isExecutingDistribution ? 'Executing…' : 'Execute Distribution'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Config sections */}
            <Nominees initialNominees={currentNominees} locked={isNomineesLocked} onSave={async (nominees) => {
              if (!publicKey) return;
              const wallet = selectedWallet || WalletType.FREIGHTER;
              setStagedNominees(p => ({ ...p, [publicKey]: nominees }));
              localStorage.setItem(STORAGE_KEYS.nominees(publicKey), JSON.stringify(nominees));
              const res = await contractService.setNominees(publicKey, nominees.map((n: any) => ({ address: n.address, role: roleIdToSymbol(String(n.role || 'beneficiary')), bps: Math.round((parseFloat(n.percentage) || 0) * 100) })), (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet));
              addToast(res.success ? { status: 'success', message: 'Nominees saved', detail: `${nominees.length} nominees stored on-chain` } : { status: 'failed', message: 'Save failed', detail: res.error });
            }} />

            <StagedReleaseTimeline initialStages={currentTimeline} locked={isTimelineLocked} onSave={(stages) => {
              if (!publicKey) return;
              setStagedTimeline(p => ({ ...p, [publicKey]: stages }));
              localStorage.setItem(STORAGE_KEYS.timeline(publicKey), JSON.stringify(stages));
              const wallet = selectedWallet || WalletType.FREIGHTER;
              contractService.setTimeline(publicKey, stages.map((s: any) => ({ when: Math.floor(new Date(s.date).getTime() / 1000), amount: xlmToStroopsString(String(s.amount || '0')), memo: s.description?.trim() ? String(s.description).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 12) : 'NONE' })), (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet)).then(res => addToast(res.success ? { status: 'success', message: 'Timeline saved', detail: `${stages.length} stages on-chain` } : { status: 'failed', message: 'Save failed', detail: res.error }));
            }} />

            <div>
              <InactivityDistribution nominees={currentNominees} initialPhases={currentDistributions} locked={isDistributionsLocked} onSave={(distributions) => {
                if (!publicKey) return;
                setStagedDistributions(p => ({ ...p, [publicKey]: distributions }));
                localStorage.setItem(STORAGE_KEYS.distributions(publicKey), JSON.stringify(distributions));
                const minDays = Math.min(...distributions.map((p: any) => p.inactivityDays));
                setVault(p => p ? { ...p, threshold: minDays * 86400000 } : p);
                const wallet = selectedWallet || WalletType.FREIGHTER;
                contractService.setDistributions(publicKey, distributions.map((p: any) => ({ inactivity_days: Number(p.inactivityDays), entries: Object.entries(p.distributions || {}).map(([id, pct]) => { const n = currentNominees.find((x: any) => x.id === id); if (!n) return null; const bps = Math.round((parseFloat(String(pct)) || 0) * 100); return bps > 0 ? { address: n.address, bps } : null; }).filter(Boolean) })), (xdr: string) => stellarService.signXDR(xdr, publicKey, wallet)).then(res => addToast(res.success ? { status: 'success', message: 'Distribution saved', detail: `${distributions.length} phases on-chain` } : { status: 'failed', message: 'Save failed', detail: res.error }));
              }} />
              <p style={{ fontSize: '0.75rem', color: 'var(--ash)', marginTop: '0.5rem', paddingLeft: '0.25rem' }}>Earliest phase determines the inactivity trigger.</p>
            </div>
          </div>

          {/* ── Right sidebar ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Account */}
            <div className="vault-card" style={{ padding: '1.25rem' }}>
              <div className="label-caps" style={{ marginBottom: '1rem' }}>Connected Account</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: 2, background: selectedWallet === WalletType.METAMASK ? 'rgba(232,147,74,0.1)' : 'rgba(74,222,128,0.08)', border: `1px solid ${selectedWallet === WalletType.METAMASK ? 'rgba(232,147,74,0.2)' : 'rgba(74,222,128,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {selectedWallet === WalletType.METAMASK ? <Cpu size={15} color="var(--amber)" /> : <Wallet size={15} color="#4ade80" />}
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--cream)', wordBreak: 'break-all' }}>{publicKey}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--ash)', marginTop: 2 }}>{selectedWallet === WalletType.METAMASK ? 'MetaMask Stellar Snap' : 'Freighter · Stellar Network'}</div>
                </div>
              </div>
            </div>

            {/* Vault deposit */}
            <div className="vault-card" style={{ padding: '1.25rem' }}>
              <div className="label-caps" style={{ marginBottom: '0.625rem' }}>Vault Deposit</div>
              <p style={{ fontSize: '0.75rem', color: 'var(--ash)', lineHeight: 1.6, marginBottom: '0.875rem' }}>
                Auto-distribution only acts on funds deposited into the contract vault.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--ash)' }}>Vault balance</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--cream)' }}>{stroopsToXlmString(vaultBalanceStroops)} XLM</span>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input type="number" step="0.01" min="0" value={depositXlm} onChange={e => setDepositXlm(e.target.value)} placeholder="Amount (XLM)" className="vault-input" style={{ flex: 1, fontSize: '0.8125rem', padding: '0.625rem 0.75rem' }} />
                <button onClick={handleDeposit} disabled={isDepositing || !depositXlm.trim()} className="btn-primary" style={{ padding: '0.625rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  {isDepositing ? <RefreshCw size={12} className="animate-spin" /> : null}
                  {isDepositing ? '…' : 'Deposit'}
                </button>
              </div>
            </div>

            {/* Protocol health */}
            <div className="vault-card" style={{ padding: '1.25rem' }}>
              <div className="label-caps" style={{ marginBottom: '1rem' }}>Protocol Health</div>
              {[
                { label: 'Soroban Runtime', val: 'Operational', color: '#4ade80' },
                { label: 'Inactivity Clock', val: 'Synced', color: '#4ade80' },
                { label: 'Distribution Key', val: 'Encrypted', color: 'var(--gold)' },
                { label: 'Network Latency', val: '12 ms', color: 'var(--ash)' },
              ].map((r, i) => (
                <div key={i} className="stat-row">
                  <span style={{ fontSize: '0.8rem', color: 'var(--ash)' }}>{r.label}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: r.color }}>{r.val}</span>
                </div>
              ))}
            </div>

            {/* Activity log */}
            <div className="vault-card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div className="label-caps">Activity Log</div>
                <History size={13} color="var(--smoke)" />
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {history.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem 0', fontSize: '0.8125rem', color: 'var(--smoke)', fontStyle: 'italic' }}>No activity yet.</div>
                ) : history.map(tx => {
                  const isSuccess = tx.status === 'SUCCESS';
                  const isFail = tx.status === 'FAILED';
                  return (
                    <div key={tx.id} className="log-entry">
                      <div style={{ width: 30, height: 30, borderRadius: 2, background: isSuccess ? 'rgba(74,222,128,0.06)' : isFail ? 'rgba(248,113,113,0.06)' : 'rgba(214,175,100,0.06)', border: `1px solid ${isSuccess ? 'rgba(74,222,128,0.15)' : isFail ? 'rgba(248,113,113,0.15)' : 'rgba(214,175,100,0.15)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {tx.status === 'PENDING' && <RefreshCw size={12} className="animate-spin" color="var(--gold)" />}
                        {tx.status === 'SUCCESS' && <CheckCircle2 size={12} color="#4ade80" />}
                        {tx.status === 'FAILED' && <AlertTriangle size={12} color="#f87171" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--cream)' }}>{tx.type === 'CHECK_IN' ? 'Check-In' : tx.type === 'DEPOSIT' ? 'Deposit' : 'Transfer'}</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--ash)' }}>{new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--ash)' }}>{tx.amount ? `${tx.amount} XLM` : 'Proof-of-life'}</div>
                        {tx.hash && <a href={`https://stellar.expert/explorer/testnet/tx/${tx.hash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.65rem', color: 'var(--gold-dim)', textDecoration: 'none', marginTop: 3 }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--gold)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--gold-dim)')}><ExternalLink size={10} /> Explorer</a>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tip */}
            <div style={{ padding: '1rem', background: 'rgba(214,175,100,0.04)', border: '1px solid var(--border-warm)', borderRadius: 2, borderLeft: '3px solid var(--gold-dim)' }}>
              <div className="label-gold" style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 6 }}><Info size={12} /> Tip</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--ash)', lineHeight: 1.65, margin: 0 }}>
                Regular check-ins keep the protocol in Active state. When the trigger reaches 0, distribution initiates automatically.
              </p>
            </div>

            {/* Contract + Conditional Remittance */}
            <ConditionalRemittance onSave={(c) => addToast({ status: 'success', message: 'Conditions saved', detail: `${c.length} conditions configured` })} />
            <ContractInteraction userAddress={publicKey} selectedWallet={selectedWallet || WalletType.FREIGHTER} signTransaction={async (xdr: string) => stellarService.signXDR(xdr, publicKey, selectedWallet || WalletType.FREIGHTER)} />

            {/* Nominees summary */}
            {currentNominees.length > 0 && (
              <div className="vault-card" style={{ padding: '1.25rem' }}>
                <div className="label-caps" style={{ marginBottom: '1rem' }}>Nominee Summary</div>
                {currentNominees.map((n: any, i: number) => (
                  <div key={n.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.625rem 0', borderBottom: i < currentNominees.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--cream)' }}>{n.address.slice(0, 10)}…</div>
                      <div style={{ fontSize: '0.65rem', color: 'var(--ash)', textTransform: 'capitalize', marginTop: 1 }}>{n.role}</div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.375rem', color: 'var(--gold)' }}>{n.percentage}%</span>
                  </div>
                ))}
              </div>
            )}

            {/* Distribution phases summary */}
            {currentDistributions.length > 0 && (
              <div className="vault-card" style={{ padding: '1.25rem' }}>
                <div className="label-caps" style={{ marginBottom: '1rem' }}>Distribution Phases</div>
                {[...currentDistributions].sort((a: any, b: any) => a.inactivityDays - b.inactivityDays).map((p: any, i: number) => (
                  <div key={p.id} style={{ padding: '0.75rem 0', borderBottom: i < currentDistributions.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--cream)', marginBottom: '0.375rem' }}>Phase {i + 1} — {p.inactivityDays}d inactive</div>
                    {Object.entries(p.distributions as Record<string, string>).filter(([_, pct]) => parseFloat(pct) > 0).map(([id, pct]) => {
                      const n = currentNominees.find((x: any) => x.id === id);
                      return <div key={id} style={{ fontSize: '0.75rem', color: 'var(--ash)', display: 'flex', justifyContent: 'space-between' }}><span>{n ? n.address.slice(0, 10) + '…' : id}</span><span style={{ color: 'var(--gold-dim)' }}>{pct}%</span></div>;
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border)', padding: '1.5rem 2rem', marginTop: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={13} color="var(--gold)" />
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '0.9375rem' }}>Continuum</span>
        </div>
        <span className="label-caps" style={{ color: 'var(--smoke)' }}>Stellar Testnet · v1.0.4</span>
      </footer>

      {/* Modals */}
      <AnimatePresence>{showWalletModal && <WalletModal onClose={() => setShowWalletModal(false)} onConnect={connectToWallet} />}</AnimatePresence>

      <AnimatePresence>
        {showSendModal && (
          <Modal onClose={() => { setShowSendModal(false); setTxStatus('idle'); setDestAddress(''); setSendAmount(''); }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '1.75rem' }}>Transfer Assets</div>

            {txStatus === 'idle' && (
              <form onSubmit={handleSendXLM} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <div className="label-caps" style={{ marginBottom: '0.5rem' }}>Recipient address</div>
                  <input type="text" required value={destAddress} onChange={e => setDestAddress(e.target.value)} placeholder="G…" className="vault-input" />
                </div>
                <div>
                  <div className="label-caps" style={{ marginBottom: '0.5rem' }}>Amount (XLM)</div>
                  <input type="number" step="0.0000001" required value={sendAmount} onChange={e => setSendAmount(e.target.value)} placeholder="0.00" className="vault-input" />
                </div>
                {txError && <div style={{ fontSize: '0.8125rem', color: '#f87171' }}>{txError}</div>}
                <button type="submit" className="btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.875rem' }}>Confirm Transfer</button>
              </form>
            )}

            {txStatus === 'pending' && (
              <div style={{ textAlign: 'center', padding: '3rem 0' }}>
                <RefreshCw size={40} className="animate-spin" color="var(--gold)" style={{ margin: '0 auto 1.25rem' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', marginBottom: '0.5rem' }}>Processing…</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--ash)' }}>Awaiting wallet signature.</div>
              </div>
            )}

            {txStatus === 'success' && (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <CheckCircle2 size={48} color="#4ade80" style={{ margin: '0 auto 1.25rem' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.75rem' }}>Transfer Complete</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--ash)', marginBottom: '1.75rem' }}>{sendAmount} XLM sent successfully.</div>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                  {txHash && <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" className="btn-ghost" style={{ textDecoration: 'none', fontSize: '0.8125rem' }}><ExternalLink size={13} /> Explorer</a>}
                  <button onClick={() => { setShowSendModal(false); setTxStatus('idle'); setDestAddress(''); setSendAmount(''); }} className="btn-primary" style={{ fontSize: '0.8125rem' }}>Done</button>
                </div>
              </div>
            )}

            {txStatus === 'error' && (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <AlertTriangle size={48} color="#f87171" style={{ margin: '0 auto 1.25rem' }} />
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.75rem' }}>Transfer Failed</div>
                <div style={{ fontSize: '0.875rem', color: '#f87171', marginBottom: '1.75rem' }}>{txError}</div>
                <button onClick={() => setTxStatus('idle')} className="btn-ghost">Try Again</button>
              </div>
            )}
          </Modal>
        )}
      </AnimatePresence>

      <TransactionToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SHARED MODAL WRAPPER
═══════════════════════════════════════════════════════════════════ */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }} />
      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.97 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }} style={{ position: 'relative', zIndex: 1, background: 'var(--surface)', border: '1px solid var(--border-warm)', borderRadius: 4, padding: '2rem', width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--smoke)', padding: 4 }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--ash)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--smoke)')}><X size={16} /></button>
        {children}
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WALLET MODAL
═══════════════════════════════════════════════════════════════════ */
function WalletModal({ onClose, onConnect }: { onClose: () => void; onConnect: (t: WalletType) => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', marginBottom: '0.375rem' }}>Connect Wallet</div>
      <div style={{ fontSize: '0.8125rem', color: 'var(--ash)', marginBottom: '1.75rem' }}>Choose your Stellar wallet to continue.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {[
          { type: WalletType.FREIGHTER, label: 'Freighter', sub: 'Native Stellar wallet', icon: Shield, color: '#4ade80' },
          { type: WalletType.METAMASK, label: 'MetaMask', sub: 'Via Stellar Snap', icon: Cpu, color: 'var(--amber)' },
        ].map(w => (
          <button key={w.type} onClick={() => onConnect(w.type)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'var(--raised)', border: '1px solid var(--border)', borderRadius: 2, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s, background 0.2s' }} onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-warm)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface)'; }} onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--raised)'; }}>
            <div style={{ width: 40, height: 40, borderRadius: 2, background: `${w.color}12`, border: `1px solid ${w.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <w.icon size={18} color={w.color} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--cream)' }}>{w.label}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ash)', marginTop: 2 }}>{w.sub}</div>
            </div>
            <ChevronRight size={15} color="var(--smoke)" />
          </button>
        ))}
      </div>
      <p style={{ marginTop: '1.25rem', fontSize: '0.75rem', color: 'var(--smoke)', textAlign: 'center', lineHeight: 1.6 }}>
        By connecting, you agree to our Terms of Service.
      </p>
    </Modal>
  );
}
