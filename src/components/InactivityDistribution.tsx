import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Clock, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Nominee {
  id: string;
  address: string;
  role: string;
  percentage: string;
}

interface DistributionPhase {
  id: string;
  inactivityDays: number;
  distributions: Record<string, string>; // nomineeId -> percentage
}

interface InactivityDistributionProps {
  nominees: Nominee[];
  onSave: (phases: DistributionPhase[]) => void;
  initialPhases?: DistributionPhase[];
  locked?: boolean;
}

export default function InactivityDistribution({
  nominees,
  onSave,
  initialPhases,
  locked = false,
}: InactivityDistributionProps) {
  const [phases, setPhases] = useState<DistributionPhase[]>(initialPhases || []);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync editor when chain config loads
  useEffect(() => {
    setPhases(initialPhases || []);
    setError(null);
    setSuccessMessage(null);
  }, [initialPhases]);

  if (nominees.length === 0) {
    return (
      <div className="glass-card p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-slate-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">Inactivity-Based Distribution</h3>
            <p className="text-xs text-zinc-500">Set fund distribution phases based on inactivity days</p>
          </div>
        </div>
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <p className="text-sm text-blue-400">
            💡 Add nominees first to set up inactivity distribution phases
          </p>
        </div>
      </div>
    );
  }

  const handleAddPhase = () => {
    if (locked) return;
    const newPhase: DistributionPhase = {
      id: Date.now().toString(),
      inactivityDays: 90,
      distributions: nominees.reduce((acc, nom) => ({ ...acc, [nom.id]: '' }), {}),
    };
    setPhases([...phases, newPhase]);
  };

  const handleUpdatePhase = (
    id: string,
    field: 'inactivityDays' | 'distributions',
    value: any
  ) => {
    setPhases(
      phases.map(p =>
        p.id === id ? { ...p, [field]: value } : p
      )
    );
  };

  const handleUpdateDistribution = (phaseId: string, nomineeId: string, percentage: string) => {
    setPhases(
      phases.map(p =>
        p.id === phaseId
          ? {
              ...p,
              distributions: { ...p.distributions, [nomineeId]: percentage },
            }
          : p
      )
    );
  };

  const handleRemovePhase = (id: string) => {
    if (locked) return;
    setPhases(phases.filter(p => p.id !== id));
  };

  const getPhaseTotal = (phase: DistributionPhase): number => {
    return Object.values(phase.distributions).reduce((sum, pct) => {
      const val = parseFloat(pct) || 0;
      return sum + val;
    }, 0);
  };

  const getOverallTotal = (): number => {
    return phases.reduce((sum, phase) => sum + getPhaseTotal(phase), 0);
  };

  const handleSave = () => {
    setError(null);

    if (phases.length === 0) {
      setError('Add at least one distribution phase');
      return;
    }

    // Validate phase metadata
    for (const phase of phases) {
      if (phase.inactivityDays < 1) {
        setError('Inactivity days must be at least 1');
        return;
      }
    }

    const overallTotal = getOverallTotal();
    if (Math.abs(overallTotal - 100) > 0.01) {
      setError(
        `Total distribution across all phases must equal 100% (currently ${overallTotal.toFixed(2)}%)`
      );
      return;
    }

    // Check for duplicate days
    const days = phases.map(p => p.inactivityDays);
    if (new Set(days).size !== days.length) {
      setError('Duplicate inactivity days not allowed');
      return;
    }

    onSave(phases);
    setSuccessMessage('Distribution phases saved!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const overallTotal = getOverallTotal();
  const isValidOverallTotal = Math.abs(overallTotal - 100) < 0.01;

  return (
    <div className="glass-card p-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-slate-500/10 flex items-center justify-center">
          <Clock className="w-5 h-5 text-slate-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Inactivity-Based Distribution</h3>
          <p className="text-xs text-zinc-500">Set progressive fund distribution phases based on inactivity duration</p>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
        >
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-red-400">{error}</div>
        </motion.div>
      )}

      {successMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-start gap-3"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-emerald-400">{successMessage}</div>
        </motion.div>
      )}

      {phases.length > 0 && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          isValidOverallTotal
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-orange-500/10 border border-orange-500/20 text-orange-400'
        }`}>
          Total Across All Phases: <span className="font-semibold">{overallTotal.toFixed(2)}%</span>
        </div>
      )}

      <div className="space-y-6 mb-6">
        {phases.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="text-sm">No distribution phases added yet</p>
          </div>
        ) : (
          phases.map((phase, phaseIdx) => {
            const phaseTotal = getPhaseTotal(phase);
            const isValidPhase = Math.abs(phaseTotal - 100) < 0.01;

            return (
              <div key={phase.id} className="p-6 bg-white/5 border border-slate-500/20 rounded-lg">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="text-sm font-semibold text-zinc-300 mb-1">Phase {phaseIdx + 1}</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={phase.inactivityDays}
                        onChange={(e) => handleUpdatePhase(phase.id, 'inactivityDays', parseInt(e.target.value))}
                        className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-slate-500/50"
                      />
                      <span className="text-xs text-zinc-400">days of inactivity</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemovePhase(phase.id)}
                    className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                    style={{ display: locked ? 'none' : undefined }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className={`mb-4 p-2 rounded text-xs ${
                  isValidPhase
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    : 'bg-orange-500/10 border border-orange-500/20 text-orange-400'
                }`}>
                  Total: {phaseTotal.toFixed(2)}%
                </div>

                <div className="space-y-3">
                  {nominees.map((nominee) => (
                    <div key={nominee.id} className="flex items-center gap-3 p-3 bg-white/5 rounded border border-white/10">
                      <div className="flex-1">
                        <div className="text-xs text-zinc-400 mb-1">
                          {nominee.address.slice(0, 10)}... ({nominee.role})
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={phase.distributions[nominee.id] || ''}
                          onChange={(e) =>
                            handleUpdateDistribution(phase.id, nominee.id, e.target.value)
                          }
                          placeholder="0"
                          className="w-20 px-2 py-1 bg-white/5 border border-white/10 rounded text-sm text-white text-right focus:outline-none focus:border-slate-500/50"
                        />
                        <span className="text-xs text-zinc-400 w-4">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAddPhase}
          className="flex-1 px-4 py-2 bg-slate-500/15 border border-slate-500/30 hover:bg-slate-500/25 rounded-lg text-slate-400 transition-colors flex items-center justify-center gap-2"
          style={{ display: locked ? 'none' : undefined }}
        >
          <Plus className="w-4 h-4" />
          Add Phase
        </button>
        <button
          onClick={handleSave}
          disabled={phases.length === 0}
          className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {locked ? 'Update Distributions' : 'Save Distributions'}
        </button>
      </div>
    </div>
  );
}
