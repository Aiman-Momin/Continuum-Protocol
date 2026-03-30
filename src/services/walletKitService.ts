import { isConnected, getAddress, signTransaction } from "@stellar/freighter-api";
import { Networks } from "stellar-sdk";

export enum WalletType {
  Freighter = "Freighter",
  xBull = "xBull",
  Albedo = "Albedo",
  Mock = "Mock",
}

export interface WalletOption {
  id: WalletType;
  name: string;
  icon: string;
  isInstalled: boolean;
}

export const walletKitService = {
  async getAvailableWallets(): Promise<WalletOption[]> {
    let freighterInstalled = false;
    try {
      const freighterStatus = await isConnected();
      freighterInstalled = freighterStatus && typeof freighterStatus === 'object' 
        ? (freighterStatus as any).isConnected 
        : !!freighterStatus;
      
      
      if (!freighterInstalled) {
        freighterInstalled = !!(window as any).freighter || !!(window as any).stargazer;
      }
    } catch (e) {
      console.warn("[WalletKit] Freighter detection error", e);
      freighterInstalled = !!(window as any).freighter || !!(window as any).stargazer;
    }
    
    return [
      {
        id: WalletType.Freighter,
        name: "Freighter",
        icon: "https://www.freighter.app/favicon.ico",
        isInstalled: freighterInstalled,
      },
      {
        id: WalletType.xBull,
        name: "xBull",
        icon: "https://xbull.app/favicon.ico",
        isInstalled: false, // Mocked for demo
      },
      {
        id: WalletType.Albedo,
        name: "Albedo",
        icon: "https://albedo.link/favicon.ico",
        isInstalled: false, // Mocked for demo
      },
      {
        id: WalletType.Mock,
        name: "Mock Wallet (Testing)",
        icon: "https://raw.githubusercontent.com/lucide-react/lucide/main/icons/terminal.svg",
        isInstalled: true,
      },
    ];
  },

  async connect(walletType: WalletType): Promise<string | null> {
    if (walletType === WalletType.Mock) {
      return "GCONTNUUM7PROTOCOLEXAMPLEID1234567890ABCDEF";
    }
    if (walletType === WalletType.Freighter) {
      try {
       
        const { requestAccess, getAddress } = await import("@stellar/freighter-api");
        
        console.log("[WalletKit] Requesting access from Freighter...");
        const response = await requestAccess();
        
        let publicKey = typeof response === 'string' ? response : (response as any)?.address;
        
        if (!publicKey) {
          console.log("[WalletKit] No key in response, trying getAddress()...");
          const addrResponse = await getAddress();
          publicKey = typeof addrResponse === 'string' ? addrResponse : (addrResponse as any)?.address;
        }
        
        return publicKey || null;
      } catch (e) {
        console.error("[WalletKit] Freighter connection failed", e);
        return null;
      }
    }
    return null;
  },

  async sign(xdr: string, walletType: WalletType): Promise<string | null> {
    if (walletType === WalletType.Mock) {
      return xdr; 
    }
    if (walletType === WalletType.Freighter) {
      try {
        const signed = await signTransaction(xdr, { networkPassphrase: Networks.TESTNET });
        if (signed && typeof signed === 'object' && 'signedTxXdr' in signed) {
          return signed.signedTxXdr;
        }
        return signed as any;
      } catch (e) {
        console.error("[WalletKit] Freighter signing failed", e);
        return null;
      }
    }
    return null;
  }
};
