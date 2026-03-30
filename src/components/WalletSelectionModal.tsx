import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Wallet, CheckCircle2, AlertCircle } from "lucide-react";
import { walletKitService, WalletOption, WalletType } from "../services/walletKitService";

interface WalletSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (wallet: WalletType) => void;
}

export const WalletSelectionModal: React.FC<WalletSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelect,
}) => {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      walletKitService.getAvailableWallets().then((res) => {
        setWallets(res);
        setLoading(false);
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-md overflow-hidden bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl"
        >
          <div className="flex items-center justify-between p-6 border-bottom border-white/5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-xl">
                <Wallet className="w-5 h-5 text-blue-400" />
              </div>
              <h2 className="text-xl font-semibold text-white">Connect Wallet</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/5 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-zinc-500" />
            </button>
          </div>

          <div className="p-6 space-y-3">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-zinc-500">Scanning for wallets...</p>
              </div>
            ) : (
              wallets.map((wallet) => (
                <button
                  key={wallet.id}
                  onClick={() => wallet.isInstalled && onSelect(wallet.id)}
                  disabled={!wallet.isInstalled}
                  className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all group ${
                    wallet.isInstalled
                      ? "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20"
                      : "bg-white/2 border-white/5 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 overflow-hidden rounded-xl bg-zinc-800 p-2">
                      <img src={wallet.icon} alt={wallet.name} className="w-full h-full object-contain" />
                    </div>
                    <div className="text-left">
                      <p className="font-medium text-white">{wallet.name}</p>
                      <p className="text-xs text-zinc-500">
                        {wallet.isInstalled ? "Available" : "Not Detected"}
                      </p>
                    </div>
                  </div>
                  {wallet.isInstalled ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-zinc-600" />
                  )}
                </button>
              ))
            )}
          </div>

          <div className="p-6 bg-white/2 border-top border-white/5">
            <p className="text-xs text-center text-zinc-500">
              New to Stellar? <a href="https://www.freighter.app/" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Download Freighter</a>
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
