import freighter from "@stellar/freighter-api";
const { isConnected, getAddress, signTransaction, requestAccess } = freighter;
import { Horizon, Networks, TransactionBuilder, Asset, Operation, xdr, Address } from "stellar-sdk";

export enum WalletType {
  FREIGHTER = "freighter",
  METAMASK = "metamask",
}

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON_URL);

export const stellarService = {
  async checkFreighter() {
    try {
      
      const hasFreighterGlobal = !!(window as any).freighter;
      const hasStargazerGlobal = !!(window as any).stargazer;
      const result = await isConnected();
      
      console.log("[StellarService] Detection - Global Freighter:", hasFreighterGlobal, "Global Stargazer:", hasStargazerGlobal, "isConnected:", result);
      
      if (hasFreighterGlobal || hasStargazerGlobal) return true;
      
      if (typeof result === 'boolean') return result;
      if (typeof result === 'object' && result !== null) {
        return (result as any).isConnected === true;
      }
      return !!result;
    } catch (e) {
      console.error("[StellarService] checkFreighter error:", e);
      return false;
    }
  },

  async checkMetaMask() {
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) return false;
      
      
      return !!ethereum.isMetaMask;
    } catch (e) {
      return false;
    }
  },

  async connectWallet(type: WalletType = WalletType.FREIGHTER) {
    if (type === WalletType.METAMASK) {
      return this.connectMetaMask();
    }
    return this.connectFreighter();
  },

  async connectFreighter() {
    try {
      const isSecure = window.isSecureContext;
      console.log(`[StellarService] Environment Check - Origin: ${window.location.origin}, Secure Context: ${isSecure}`);
      
      if (!isSecure && window.location.hostname !== 'localhost') {
        console.warn("[StellarService] Warning: Running on an insecure origin. Wallet extensions may block signatures.");
      }

      console.log("[StellarService] Requesting access from Freighter...");
      // requestAccess() is the primary way to trigger the popup
      const response = await requestAccess();
      console.log("[StellarService] Freighter response:", response);
      
      // Handle both string and object responses
      const publicKey = typeof response === 'string' ? response : (response as any)?.address;
      
      if (!publicKey) {

        console.log("[StellarService] No key in response, trying getAddress()...");
        const fallbackResponse = await getAddress();
        console.log("[StellarService] getAddress() result:", fallbackResponse);
        
        if (!fallbackResponse || !fallbackResponse.address) {
          throw new Error("Freighter connection rejected or no address returned.");
        }
        return fallbackResponse.address;
      }
      
      return publicKey;
    } catch (e: any) {
      console.error("[StellarService] Freighter connection failed", e);
      throw new Error(e.message || "Freighter connection failed. Please ensure the extension is unlocked.");
    }
  },

  async connectMetaMask() {
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        throw new Error("MetaMask not found. Please install MetaMask extension.");
      }

      console.log("[StellarService] Requesting Stellar Snap from MetaMask...");
      // Request Snap
      try {
        await ethereum.request({
          method: 'wallet_requestSnaps',
          params: {
            'npm:stellar-snap': {},
          },
        });
      } catch (snapError: any) {
        console.error("[StellarService] Snap request failed:", snapError);
        if (snapError.code === 4001) {
          throw new Error("Connection rejected. Please accept the Snap installation request.");
        }
        throw new Error(snapError.message || "Failed to install or connect Stellar Snap.");
      }

      console.log("[StellarService] Invoking getAddress on Stellar Snap...");
      // Get address from Snap
      const response = await ethereum.request({
        method: 'wallet_invokeSnap',
        params: {
          snapId: 'npm:stellar-snap',
          request: {
            method: 'getAddress',
          },
        },
      });

      console.log("[StellarService] MetaMask Snap response:", response);
      
      let address: string | null = null;
      if (typeof response === 'string') {
        address = response;
      } else if (response && typeof response === 'object') {
        address = (response as any).address || (response as any).publicKey || (response as any).account;
      }

      if (!address) {
        throw new Error("Could not retrieve address from MetaMask Snap. Please ensure the Snap is correctly configured.");
      }

      return address;
    } catch (e: any) {
      console.error("[StellarService] MetaMask connection failed", e);
      if (e.message) throw e;
      throw new Error("MetaMask connection failed. Please try again.");
    }
  },

  async getAccountBalance(publicKey: string) {
    try {
      const account = await server.loadAccount(publicKey);
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    } catch (e) {
      console.error("Failed to fetch balance", e);
      return 0;
    }
  },

  async getAccountInfo(publicKey: string) {
    try {
      return await server.loadAccount(publicKey);
    } catch (e) {
      console.error("Failed to fetch account info", e);
      return null;
    }
  },

  async fundAccount(publicKey: string) {
    try {
      console.log("[StellarService] Funding account via Friendbot:", publicKey);
      const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
      const result = await response.json();
      return { success: true, result };
    } catch (e: any) {
      console.error("[StellarService] Friendbot funding failed:", e);
      return { success: false, error: e.message };
    }
  },

  async sendXLM(from: string, to: string, amount: string, walletType: WalletType = WalletType.FREIGHTER) {
    try {
      console.log(`[StellarService] Preparing transfer: ${amount} XLM from ${from} to ${to} using ${walletType}`);
      
      const account = await server.loadAccount(from);
      
      // Check if destination exists
      let destinationExists = true;
      try {
        await server.loadAccount(to);
      } catch (e) {
        destinationExists = false;
        console.log("[StellarService] Destination account does not exist. Using createAccount operation.");
      }

      const txBuilder = new TransactionBuilder(account, {
        fee: "1000",
        networkPassphrase: Networks.TESTNET,
      });

      if (destinationExists) {
        txBuilder.addOperation(
          Operation.payment({
            destination: to,
            asset: Asset.native(),
            amount: amount,
          })
        );
      } else {
        
        txBuilder.addOperation(
          Operation.createAccount({
            destination: to,
            startingBalance: amount,
          })
        );
      }

      const transaction = txBuilder.setTimeout(60).build();
      const xdrBase64 = transaction.toXDR();
      console.log("[StellarService] Requesting signature for XDR:", xdrBase64);
      
      let signedXdr: any;
      if (walletType === WalletType.METAMASK) {
        const ethereum = (window as any).ethereum;
        signedXdr = await ethereum.request({
          method: 'wallet_invokeSnap',
          params: {
            snapId: 'npm:stellar-snap',
            request: {
              method: 'signTransaction',
              params: {
                transactionPayload: xdrBase64,
                network: 'testnet',
              },
            },
          },
        });
      } else {
        signedXdr = await signTransaction(xdrBase64, {
          networkPassphrase: Networks.TESTNET,
          address: from,
        });
      }

      if (!signedXdr) {
        return { success: false, error: "Transaction signing was cancelled or failed." };
      }

      console.log("[StellarService] Transaction signed, raw response type:", typeof signedXdr);
      
      // Robust XDR extraction
      let xdrString: string | undefined;
      if (typeof signedXdr === 'string') {
        xdrString = signedXdr;
      } else if (signedXdr && typeof signedXdr === 'object') {
        
        xdrString = (signedXdr as any).signedTransaction || 
                    (signedXdr as any).xdr || 
                    (signedXdr as any).signedXdr ||
                    (signedXdr as any).result;
        
        
        if (!xdrString) {
          for (const key in signedXdr) {
            const val = (signedXdr as any)[key];
            if (typeof val === 'string' && val.length > 32 && /^[A-Za-z0-9+/=]+$/.test(val)) {
              console.log(`[StellarService] Found potential XDR in property: ${key}`);
              xdrString = val;
              break;
            }
          }
        }
      }

      if (!xdrString) {
        console.error("[StellarService] Failed to extract XDR from response:", signedXdr);
        return { success: false, error: "Invalid response from wallet: Could not extract signed XDR." };
      }

      console.log("[StellarService] Submitting signed XDR...");
      let signedTx;
      try {
        signedTx = TransactionBuilder.fromXDR(xdrString, Networks.TESTNET);
      } catch (e: any) {
        console.error("[StellarService] Failed to parse XDR from wallet:", e);
        return { success: false, error: "The wallet returned an invalid transaction format." };
      }
      
      const result = await server.submitTransaction(signedTx);
      
      return { success: true, hash: (result as any).hash };
    } catch (e: any) {
      console.error("[StellarService] Transaction failed:", e);
      let errorMsg = "Transaction failed";
      if (e.response?.data?.extras?.result_codes?.operations?.[0]) {
        errorMsg = `Stellar Error: ${e.response.data.extras.result_codes.operations[0]}`;
      } else if (e.message) {
        errorMsg = e.message;
      }
      return { success: false, error: errorMsg };
    }
  },

  
  async checkIn(publicKey: string, walletType: WalletType = WalletType.FREIGHTER) {
    try {
      console.log("[Soroban] Initializing 'check_in' contract call for:", publicKey, "using", walletType);
      
      const account = await server.loadAccount(publicKey);
      
      
      const CONTRACT_ID = "CBY2L5ADWFW2RPABNLCWDWSM7IHKKJ2XM6H4GT2E5H5KSFXHDBOLY6OP";

   
      const transaction = new TransactionBuilder(account, {
        fee: "2000",
        networkPassphrase: Networks.TESTNET,
      })
      .addOperation(
        
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: new Address(CONTRACT_ID).toScAddress(),
              functionName: "check_in",
              args: [] 
            })
          ),
          auth: []
        })
      )
      .setTimeout(60)
      .build();

      const xdrBase64 = transaction.toXDR();
      let signedXdr: any;
      
      if (walletType === WalletType.METAMASK) {
        const ethereum = (window as any).ethereum;
        signedXdr = await ethereum.request({
          method: 'wallet_invokeSnap',
          params: {
            snapId: 'npm:stellar-snap',
            request: {
              method: 'signTransaction',
              params: {
                transactionPayload: xdrBase64,
                network: 'testnet',
              },
            },
          },
        });
      } else {
        signedXdr = await signTransaction(xdrBase64, {
          networkPassphrase: Networks.TESTNET,
          address: publicKey,
        });
      }

      if (!signedXdr) {
        return { success: false, error: "Contract call signing was cancelled or failed." };
      }

      console.log("[Soroban] Contract call signed, raw response type:", typeof signedXdr);
      
      
      let xdrString: string | undefined;
      if (typeof signedXdr === 'string') {
        xdrString = signedXdr;
      } else if (signedXdr && typeof signedXdr === 'object') {
        xdrString = (signedXdr as any).signedTransaction || 
                    (signedXdr as any).xdr || 
                    (signedXdr as any).signedXdr ||
                    (signedXdr as any).result;
        
        
        if (!xdrString) {
          for (const key in signedXdr) {
            const val = (signedXdr as any)[key];
            if (typeof val === 'string' && val.length > 32 && /^[A-Za-z0-9+/=]+$/.test(val)) {
              console.log(`[Soroban] Found potential XDR in property: ${key}`);
              xdrString = val;
              break;
            }
          }
        }
      }

      if (!xdrString) {
        console.error("[Soroban] Failed to extract XDR from response:", signedXdr);
        return { success: false, error: "Invalid response from wallet: Could not extract signed XDR." };
      }

      console.log("[Soroban] Submitting signed XDR...");
      let signedTx;
      try {
        signedTx = TransactionBuilder.fromXDR(xdrString, Networks.TESTNET);
      } catch (e: any) {
        console.error("[Soroban] Failed to parse XDR from wallet:", e);
        return { success: false, error: "The wallet returned an invalid transaction format." };
      }
      
      const result = await server.submitTransaction(signedTx);
      
      return { success: true, hash: (result as any).hash };
    } catch (e: any) {
      console.error("[Soroban] Contract invocation failed:", e);
      return { success: false, error: e?.message || "Contract invocation failed" };
    }
  },

  async signXDR(xdrBase64: string, publicKey: string, walletType: WalletType = WalletType.FREIGHTER): Promise<string> {
    try {
      let signedXdr: any;
      
      if (walletType === WalletType.METAMASK) {
        const ethereum = (window as any).ethereum;
        signedXdr = await ethereum.request({
          method: 'wallet_invokeSnap',
          params: {
            snapId: 'npm:stellar-snap',
            request: {
              method: 'signTransaction',
              params: {
                transactionPayload: xdrBase64,
                network: 'testnet',
              },
            },
          },
        });
      } else {
        signedXdr = await signTransaction(xdrBase64, {
          networkPassphrase: Networks.TESTNET,
          address: publicKey,
        });
      }

      if (!signedXdr) {
        throw new Error("Transaction signing was cancelled or failed.");
      }

      
      let xdrString: string | undefined;
      if (typeof signedXdr === 'string') {
        xdrString = signedXdr;
      } else if (signedXdr && typeof signedXdr === 'object') {
        xdrString = (signedXdr as any).signedTransaction || 
                    (signedXdr as any).xdr || 
                    (signedXdr as any).signedXdr ||
                    (signedXdr as any).result;
        
        
        if (!xdrString) {
          for (const key in signedXdr) {
            const val = (signedXdr as any)[key];
            if (typeof val === 'string' && val.length > 32 && /^[A-Za-z0-9+/=]+$/.test(val)) {
              console.log(`[StellarService] Found potential XDR in property: ${key}`);
              xdrString = val;
              break;
            }
          }
        }
      }

      if (!xdrString) {
        throw new Error("Invalid response from wallet: Could not extract signed XDR.");
      }

      return xdrString;
    } catch (e: any) {
      console.error("[StellarService] XDR signing failed:", e);
      throw e;
    }
  },

  async getBalance(publicKey: string): Promise<number | null> {
    try {
      const account = await server.loadAccount(publicKey);
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return nativeBalance ? parseFloat(nativeBalance.balance) : 0;
    } catch (e: any) {
      console.error("[StellarService] Failed to get balance:", e);
      return null;
    }
  }
};
