import React, { useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Plus, Trash2, CheckCircle2 } from 'lucide-react';

interface Condition {
  id: string;
  type: 'proof_of_life' | 'time_elapsed' | 'custom';
  parameter: string;
  operator: 'equals' | 'greater_than' | 'less_than';
  value: string;
}

interface ConditionalRemittanceProps {
  onSave: (conditions: Condition[]) => void;
}

export default function ConditionalRemittance({ onSave }: ConditionalRemittanceProps) {
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const conditionTypes = [
    { id: 'proof_of_life', label: 'Proof of Life', description: 'User must check in within X days' },
    { id: 'time_elapsed', label: 'Time Elapsed', description: 'Release after X days/hours' },
    { id: 'custom', label: 'Custom Condition', description: 'Define any custom condition' },
  ];

  const handleAddCondition = () => {
    const newCondition: Condition = {
      id: Date.now().toString(),
      type: 'proof_of_life',
      parameter: '',
      operator: 'greater_than',
      value: '',
    };
    setConditions([...conditions, newCondition]);
  };

  const handleUpdateCondition = (id: string, field: keyof Condition, value: string) => {
    setConditions(conditions.map(c => 
      c.id === id ? { ...c, [field]: value } : c
    ));
  };

  const handleRemoveCondition = (id: string) => {
    setConditions(conditions.filter(c => c.id !== id));
  };

  const handleSave = () => {
    setError(null);

    if (conditions.length === 0) {
      setError('Add at least one condition');
      return;
    }

    for (const condition of conditions) {
      if (!condition.parameter) {
        setError('All conditions must have a parameter');
        return;
      }
      if (!condition.value) {
        setError('All conditions must have a value');
        return;
      }
    }

    onSave(conditions);
    setSuccessMessage('Conditions saved!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-orange-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Conditional Remittance</h3>
          <p className="text-xs text-zinc-500">Define release conditions</p>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-start gap-3"
        >
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
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

      <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Set conditions that must be met before funds are released. For example: "Release only if user checks in every 7 days" or "Release after 30 days"
        </p>
      </div>

      <div className="space-y-3 mb-6">
        {conditions.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="text-sm">No conditions added yet</p>
          </div>
        ) : (
          conditions.map((condition, idx) => {
            const condType = conditionTypes.find(ct => ct.id === condition.type);
            return (
              <div key={condition.id} className="p-4 bg-white/5 border border-white/10 rounded-lg">
                <div className="flex items-start justify-between mb-3">
                  <div className="text-sm font-semibold text-zinc-300">Condition {idx + 1}</div>
                  <button
                    onClick={() => handleRemoveCondition(condition.id)}
                    className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Type</label>
                    <select
                      value={condition.type}
                      onChange={(e) => handleUpdateCondition(condition.id, 'type', e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-orange-500/50"
                    >
                      {conditionTypes.map(ct => (
                        <option key={ct.id} value={ct.id} className="bg-zinc-900">
                          {ct.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Operator</label>
                    <select
                      value={condition.operator}
                      onChange={(e) => handleUpdateCondition(condition.id, 'operator', e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-orange-500/50"
                    >
                      <option value="equals" className="bg-zinc-900">Equals</option>
                      <option value="greater_than" className="bg-zinc-900">Greater than</option>
                      <option value="less_than" className="bg-zinc-900">Less than</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Parameter</label>
                    <input
                      type="text"
                      value={condition.parameter}
                      onChange={(e) => handleUpdateCondition(condition.id, 'parameter', e.target.value)}
                      placeholder={condition.type === 'proof_of_life' ? 'days' : 'value'}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Value</label>
                    <input
                      type="text"
                      value={condition.value}
                      onChange={(e) => handleUpdateCondition(condition.id, 'value', e.target.value)}
                      placeholder={condition.type === 'proof_of_life' ? '7' : '30'}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-orange-500/50"
                    />
                  </div>
                </div>
                
                <p className="text-xs text-zinc-500 mt-2">{condType?.description}</p>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAddCondition}
          className="flex-1 px-4 py-2 bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 rounded-lg text-orange-400 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Condition
        </button>
        <button
          onClick={handleSave}
          disabled={conditions.length === 0}
          className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          Save Conditions
        </button>
      </div>
    </div>
  );
}
