import React, { useState } from 'react';
import { motion } from 'motion/react';
import { GitBranch, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface InheritanceRule {
  id: string;
  name: string;
  trigger: string; // e.g., "inactivity", "age", "date", "custom"
  primaryBeneficiary: string;
  fallbackBeneficiary: string;
  assetDistribution: string; // percentage or amount
  conditions: string;
  priority: string; // 1, 2, 3, etc.
  notes: string;
}

interface InheritanceRulesProps {
  onSave: (rules: InheritanceRule[]) => void;
}

export default function InheritanceRules({ onSave }: InheritanceRulesProps) {
  const [rules, setRules] = useState<InheritanceRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const triggerTypes = [
    { id: 'inactivity', label: 'Inactivity', description: 'Trigger after X days without activity' },
    { id: 'age', label: 'Age-based', description: 'Trigger when heir reaches certain age' },
    { id: 'date', label: 'Specific Date', description: 'Trigger on a predetermined date' },
    { id: 'event', label: 'Event-based', description: 'Trigger on specific event (marriage, graduation, etc)' },
    { id: 'custom', label: 'Custom Logic', description: 'Define your own inheritance trigger' },
  ];

  const handleAddRule = () => {
    const newRule: InheritanceRule = {
      id: Date.now().toString(),
      name: '',
      trigger: 'inactivity',
      primaryBeneficiary: '',
      fallbackBeneficiary: '',
      assetDistribution: '',
      conditions: '',
      priority: String(rules.length + 1),
      notes: '',
    };
    setRules([...rules, newRule]);
  };

  const handleUpdateRule = (id: string, field: keyof InheritanceRule, value: string) => {
    setRules(rules.map(r => 
      r.id === id ? { ...r, [field]: value } : r
    ));
  };

  const handleRemoveRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const isValidAddress = (addr: string): boolean => {
    return /^G[A-Z0-9]{55}$/.test(addr);
  };

  const handleSave = () => {
    setError(null);

    if (rules.length === 0) {
      setError('Add at least one inheritance rule');
      return;
    }

    for (const rule of rules) {
      if (!rule.name.trim()) {
        setError('All rules must have a name');
        return;
      }
      if (!rule.primaryBeneficiary.trim()) {
        setError(`Rule "${rule.name}": Primary beneficiary address required`);
        return;
      }
      if (!isValidAddress(rule.primaryBeneficiary)) {
        setError(`Rule "${rule.name}": Invalid primary beneficiary address`);
        return;
      }
      if (rule.fallbackBeneficiary && !isValidAddress(rule.fallbackBeneficiary)) {
        setError(`Rule "${rule.name}": Invalid fallback beneficiary address`);
        return;
      }
      if (!rule.assetDistribution.trim()) {
        setError(`Rule "${rule.name}": Asset distribution required`);
        return;
      }
      if (!rule.conditions.trim()) {
        setError(`Rule "${rule.name}": Inheritance conditions required`);
        return;
      }
    }

    // Check priority uniqueness
    const priorities = rules.map(r => r.priority);
    if (new Set(priorities).size !== priorities.length) {
      setError('Each rule must have a unique priority');
      return;
    }

    onSave(rules);
    setSuccessMessage('Inheritance rules saved!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-pink-500/10 flex items-center justify-center">
          <GitBranch className="w-5 h-5 text-pink-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Inheritance Rules</h3>
          <p className="text-xs text-zinc-500">Define your legacy and succession logic</p>
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

      <div className="mb-6 p-4 bg-white/5 border border-white/10 rounded-lg">
        <p className="text-xs text-zinc-400 leading-relaxed">
          Create inheritance rules that define who receives your assets and under what conditions. Each rule has a priority level that determines execution order.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        {rules.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="text-sm">No inheritance rules defined yet</p>
          </div>
        ) : (
          rules.sort((a, b) => parseInt(a.priority) - parseInt(b.priority)).map((rule, idx) => {
            const triggerType = triggerTypes.find(t => t.id === rule.trigger);
            return (
              <motion.div
                key={rule.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-white/5 border border-white/10 rounded-lg"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-1 bg-pink-500/20 text-pink-400 rounded text-xs font-semibold">
                        Priority {rule.priority}
                      </span>
                      <input
                        type="text"
                        value={rule.name}
                        onChange={(e) => handleUpdateRule(rule.id, 'name', e.target.value)}
                        placeholder="Rule name (e.g., Primary Heir, Contingency)"
                        className="flex-1 px-3 py-1 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveRule(rule.id)}
                    className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors ml-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Trigger Type</label>
                    <select
                      value={rule.trigger}
                      onChange={(e) => handleUpdateRule(rule.id, 'trigger', e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-pink-500/50"
                    >
                      {triggerTypes.map(t => (
                        <option key={t.id} value={t.id} className="bg-zinc-900">
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {triggerType && (
                      <p className="text-xs text-zinc-500 mt-1">{triggerType.description}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Priority Level</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={rule.priority}
                      onChange={(e) => handleUpdateRule(rule.id, 'priority', e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-pink-500/50"
                    />
                    <p className="text-xs text-zinc-500 mt-1">Lower number = higher priority</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Primary Beneficiary Address</label>
                    <input
                      type="text"
                      value={rule.primaryBeneficiary}
                      onChange={(e) => handleUpdateRule(rule.id, 'primaryBeneficiary', e.target.value)}
                      placeholder="G..."
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50 font-mono text-xs"
                    />
                    {rule.primaryBeneficiary && !isValidAddress(rule.primaryBeneficiary) && (
                      <p className="text-xs text-red-400 mt-1">Invalid address</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Fallback Beneficiary (optional)</label>
                    <input
                      type="text"
                      value={rule.fallbackBeneficiary}
                      onChange={(e) => handleUpdateRule(rule.id, 'fallbackBeneficiary', e.target.value)}
                      placeholder="G... (if primary unavailable)"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50 font-mono text-xs"
                    />
                    {rule.fallbackBeneficiary && !isValidAddress(rule.fallbackBeneficiary) && (
                      <p className="text-xs text-red-400 mt-1">Invalid address</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Asset Distribution</label>
                    <input
                      type="text"
                      value={rule.assetDistribution}
                      onChange={(e) => handleUpdateRule(rule.id, 'assetDistribution', e.target.value)}
                      placeholder="e.g., 100%, 50 XLM, All assets"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Inheritance Conditions</label>
                    <input
                      type="text"
                      value={rule.conditions}
                      onChange={(e) => handleUpdateRule(rule.id, 'conditions', e.target.value)}
                      placeholder="e.g., 30 days inactive, reaches age 25"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Additional Notes (optional)</label>
                  <textarea
                    value={rule.notes}
                    onChange={(e) => handleUpdateRule(rule.id, 'notes', e.target.value)}
                    placeholder="Any additional context or instructions..."
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-pink-500/50 resize-none"
                    rows={2}
                  />
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAddRule}
          className="flex-1 px-4 py-2 bg-pink-500/10 border border-pink-500/20 hover:bg-pink-500/20 rounded-lg text-pink-400 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
        <button
          onClick={handleSave}
          disabled={rules.length === 0}
          className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          Save Rules
        </button>
      </div>
    </div>
  );
}
