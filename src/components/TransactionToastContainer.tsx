import React from 'react';
import { AnimatePresence } from 'motion/react';
import { TransactionToast, TransactionToastProps } from './TransactionToast';

export interface Toast extends TransactionToastProps {
  autoHideDelay?: number;
}

interface TransactionToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export const TransactionToastContainer: React.FC<TransactionToastContainerProps> = ({
  toasts,
  onDismiss,
}) => {
  return (
    <div className="fixed bottom-8 right-8 z-50 flex flex-col gap-3 max-w-sm pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <TransactionToast {...toast} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
};
