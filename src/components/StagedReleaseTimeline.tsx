import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Clock, Plus, Trash2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ReleaseStage {
  id: string;
  date: string;
  amount: string;
  description: string;
}

interface StagedReleaseTimelineProps {
  onSave: (stages: ReleaseStage[]) => void;
}

export default function StagedReleaseTimeline({ onSave }: StagedReleaseTimelineProps) {
  const [stages, setStages] = useState<ReleaseStage[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleAddStage = () => {
    const newStage: ReleaseStage = {
      id: Date.now().toString(),
      date: '',
      amount: '',
      description: '',
    };
    setStages([...stages, newStage]);
    setShowForm(true);
  };

  const handleUpdateStage = (id: string, field: keyof ReleaseStage, value: string) => {
    setStages(stages.map(s => 
      s.id === id ? { ...s, [field]: value } : s
    ));
  };

  const handleRemoveStage = (id: string) => {
    setStages(stages.filter(s => s.id !== id));
  };

  const handleSave = () => {
    setError(null);
    
    // Validation
    if (stages.length === 0) {
      setError('Add at least one release stage');
      return;
    }

    for (const stage of stages) {
      if (!stage.date) {
        setError('All stages must have a date');
        return;
      }
      if (!stage.amount || isNaN(parseFloat(stage.amount))) {
        setError('All stages must have a valid amount');
        return;
      }
      if (parseFloat(stage.amount) <= 0) {
        setError('Amounts must be greater than 0');
        return;
      }
    }

    // Check chronological order
    const sortedDates = stages.map(s => new Date(s.date).getTime()).sort((a, b) => a - b);
    for (let i = 0; i < sortedDates.length - 1; i++) {
      if (sortedDates[i] >= sortedDates[i + 1]) {
        setError('Dates must be in chronological order');
        return;
      }
    }

    onSave(stages);
    setSuccessMessage('Staged release timeline saved!');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  return (
    <div className="glass-card p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <Clock className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h3 className="text-lg font-bold">Staged Release Timeline</h3>
          <p className="text-xs text-zinc-500">Define when and how much to release</p>
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

      <div className="space-y-3 mb-6">
        {stages.length === 0 ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="text-sm">No stages added yet</p>
          </div>
        ) : (
          stages.map((stage, idx) => (
            <div key={stage.id} className="p-4 bg-white/5 border border-white/10 rounded-lg">
              <div className="flex items-start justify-between mb-3">
                <div className="text-sm font-semibold text-zinc-300">Stage {idx + 1}</div>
                <button
                  onClick={() => handleRemoveStage(stage.id)}
                  className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Release Date</label>
                  <input
                    type="datetime-local"
                    value={stage.date}
                    onChange={(e) => handleUpdateStage(stage.id, 'date', e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-purple-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Amount (XLM)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={stage.amount}
                    onChange={(e) => handleUpdateStage(stage.id, 'amount', e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white focus:outline-none focus:border-purple-500/50"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Description (optional)</label>
                <input
                  type="text"
                  value={stage.description}
                  onChange={(e) => handleUpdateStage(stage.id, 'description', e.target.value)}
                  placeholder="e.g., First milestone, Half release, Final payment"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleAddStage}
          className="flex-1 px-4 py-2 bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 rounded-lg text-purple-400 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Stage
        </button>
        <button
          onClick={handleSave}
          disabled={stages.length === 0}
          className="flex-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
        >
          Save Timeline
        </button>
      </div>
    </div>
  );
}
