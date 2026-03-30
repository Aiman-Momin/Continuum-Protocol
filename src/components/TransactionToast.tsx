import React from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Clock, X } from 'lucide-react';

export interface TransactionToastProps {
  id: string;
  status: 'pending' | 'success' | 'failed';
  message: string;
  detail?: string;
  hash?: string;
  onDismiss: (id: string) => void;
}

export const TransactionToast: React.FC<TransactionToastProps> = ({
  id,
  status,
  message,
  detail,
  hash,
  onDismiss,
}) => {
  const bgColor = {
    pending: 'bg-blue-500/10 border-blue-500/20',
    success: 'bg-emerald-500/10 border-emerald-500/20',
    failed: 'bg-red-500/10 border-red-500/20',
  }[status];

  const textColor = {
    pending: 'text-blue-400',
    success: 'text-emerald-400',
    failed: 'text-red-400',
  }[status];

  const Icon =
    status === 'pending' ? Clock : status === 'success' ? CheckCircle2 : AlertCircle;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, x: 100 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, y: 20, x: 100 }}
      className={`glass-card p-4 flex items-start gap-4 border ${bgColor} shadow-lg`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${textColor}`} />
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm ${textColor}`}>{message}</div>
        {detail && <div className="text-xs text-zinc-400 mt-1">{detail}</div>}
        {hash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-500 hover:text-blue-400 transition-colors mt-2 inline-block"
          >
            View on Explorer →
          </a>
        )}
      </div>
      <button
        onClick={() => onDismiss(id)}
        className="p-1 hover:bg-white/10 rounded transition-colors flex-shrink-0"
      >
        <X className="w-4 h-4 text-zinc-500" />
      </button>
    </motion.div>
  );
};
