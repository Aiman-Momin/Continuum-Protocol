import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Users, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Nominee {
  id: string;
  address: string;
  role: string;
  percentage: string;
}

interface NomineesProps {
  onSave: (nominees: Nominee[]) => void;
  initialNominees?: Nominee[];
  locked?: boolean;
}

export default function Nominees({ onSave, initialNominees, locked = false }: NomineesProps) {
  const [nominees, setNominees] = useState<Nominee[]>(initialNominees || []);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Sync internal editor when chain config loads.
  useEffect(() => {
    setNominees(initialNominees || []);
    setError(null);
    setSuccessMessage(null);
  }, [initialNominees]);

  const roles = [
    { id: 'executor', label: 'Executor', description: 'Manages asset distribution' },
    { id: 'beneficiary', label: 'Beneficiary', description: 'Receives assets' },
    { id: 'trustee', label: 'Trustee', description: 'Custodian of assets' },
    { id: 'advisor', label: 'Advisor', description: 'Provides guidance' },
  ];

  const handleAddNominee = () => {
    if (locked) return;
    if (getTotalPercentage() >= 100) {
      setError('Total distribution is already 100%. Reduce an existing nominee percentage before adding another nominee.');
      return;
    }
    const newNominee: Nominee = {
      id: Date.now().toString(),
      address: '',
      role: 'beneficiary',
      percentage: '',
    };
    setNominees([...nominees, newNominee]);
  };

  const handleUpdateNominee = (id: string, field: keyof Nominee, value: string) => {
    setNominees(nominees.map(n => 
      n.id === id ? { ...n, [field]: value } : n
    ));
  };

  const handleRemoveNominee = (id: string) => {
    if (locked) return;
    setNominees(nominees.filter(n => n.id !== id));
  };

  const isValidAddress = (addr: string): boolean => {
    // Stellar addresses start with G and are 56 characters
    return /^G[A-Z0-9]{55}$/.test(addr);
  };

  const getTotalPercentage = (): number => {
    return nominees.reduce((sum, n) => {
      const pct = parseFloat(n.percentage) || 0;
      return sum + pct;
    }, 0);
  };

  const handleSave = () => {
    // When locked, "Save" becomes an update of existing config only.
    setError(null);

    if (nominees.length === 0) {
      setError('Add at least one nominee');
      return;
    }

    for (const nominee of nominees) {
      if (!nominee.address) {
        setError('All nominees must have a Stellar address');
        return;
      }
      if (!isValidAddress(nominee.address)) {
        setError(`Invalid Stellar address: ${nominee.address.slice(0, 10)}...`);
        return;
      }
      if (!nominee.percentage || isNaN(parseFloat(nominee.percentage))) {
        setError('All nominees must have a valid percentage');
        return;
      }
      const pct = parseFloat(nominee.percentage);
      if (pct <= 0 || pct > 100) {
        setError('Percentages must be between 0 and 100');
        return;
      }
    }

    const total = getTotalPercentage();
    if (Math.abs(total - 100) > 0.01) {
      setError(`Total percentage must equal 100% (currently ${total.toFixed(2)}%)`);
      return;
    }

    // Check for duplicate addresses
    const addresses = nominees.map(n => n.address);
    if (new Set(addresses).size !== addresses.length) {
      setError('Duplicate addresses not allowed');
      return;
    }

    onSave(nominees);
    setSuccessMessage('Nominees saved!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const totalPct = getTotalPercentage();
  const isValidTotal = Math.abs(totalPct - 100) < 0.01;

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center">
          <Users className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Nominees & Distribution</h3>
          <p className="text-xs text-zinc-500">Define beneficiaries and their roles</p>
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

      {nominees.length > 0 && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          isValidTotal 
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' 
            : 'bg-orange-500/10 border border-orange-500/20 text-orange-400'
        }`}>
          Total Distribution: <span className="font-semibold">{totalPct.toFixed(2)}%</span>
        </div>
      )}

      <div className="space-y-3 mb-6">
        {nominees.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="text-sm">No nominees added yet</p>
          </div>
        ) : (
          nominees.map((nominee, idx) => {
            const roleInfo = roles.find(r => r.id === nominee.role);
            return (
              <div key={nominee.id} className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="flex items-start justify-between mb-3">
                  <div className="text-sm font-semibold text-zinc-300">Nominee {idx + 1}</div>
                  <button
                    onClick={() => handleRemoveNominee(nominee.id)}
                    className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                    style={{ display: locked ? 'none' : undefined }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Stellar Address</label>
                    <input
                      type="text"
                      value={nominee.address}
                      onChange={(e) => handleUpdateNominee(nominee.id, 'address', e.target.value)}
                      placeholder="G..."
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/50 font-mono"
                    />
                    {nominee.address && !isValidAddress(nominee.address) && (
                      <p className="text-xs text-red-400 mt-1">Invalid Stellar address format</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Role</label>
                      <select
                        value={nominee.role}
                        onChange={(e) => handleUpdateNominee(nominee.id, 'role', e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500/50"
                      >
                        {roles.map(r => (
                          <option key={r.id} value={r.id} className="bg-zinc-900">
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Distribution %</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={nominee.percentage}
                        onChange={(e) => handleUpdateNominee(nominee.id, 'percentage', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500/50"
                      />
                    </div>
                  </div>

                  {roleInfo && (
                    <p className="text-xs text-zinc-400">{roleInfo.description}</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAddNominee}
          className="flex-1 px-4 py-2 bg-blue-500/15 border border-blue-500/30 hover:bg-blue-500/25 rounded-lg text-blue-400 transition-colors flex items-center justify-center gap-2"
          style={{ display: locked ? 'none' : undefined }}
        >
          <Plus className="w-4 h-4" />
          Add Nominee
        </button>
        <button
          onClick={handleSave}
          disabled={nominees.length === 0}
          className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          {locked ? 'Update Nominees' : 'Save Nominees'}
        </button>
      </div>
    </div>
  );
}
