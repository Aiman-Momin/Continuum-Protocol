import * as StellarSdk from "stellar-sdk";
const { Horizon, rpc: SorobanRpc, TransactionBuilder, Networks, Contract, Address, scValToNative, nativeToScVal } = StellarSdk;

const server = new Horizon.Server("https://horizon-testnet.stellar.org");
const sorobanServer = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

export const CONTRACT_ID = "CCDQDKGOQJ3EONDHU7EZEB5CWZI6SMOUCIY7KGCTBA5WPO63XVD4735J";


export async function getData(userAddress: string): Promise<number | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_data"))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
      const result = scValToNative(simulation.result!.retval);
      return Number(result);
    }
    return null;
  } catch (e) {
    console.error("[contractService] getData failed:", e);
    return null;
  }
}


export async function setData(
  userAddress: string,
  value: number,
  signTransaction: (xdr: string) => Promise<string>
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    if (!Number.isInteger(value) || value < 0) {
      return { success: false, error: "Value must be a non-negative integer" };
    }

    const contract = new Contract(CONTRACT_ID);
    
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("set_data", nativeToScVal(BigInt(value))))
      .setTimeout(60)
      .build();

    // Prepare for Soroban
    const preparedTx = await sorobanServer.prepareTransaction(tx);
    const xdrString = preparedTx.toXDR();

   
    const signedXdr = await signTransaction(xdrString);
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

    
    const result = await server.submitTransaction(signedTx);
    
    return { 
      success: true, 
      hash: (result as any).hash 
    };
  } catch (e: any) {
    console.error("[contractService] setData failed:", e);
    return { 
      success: false, 
      error: e.message || "Contract call failed" 
    };
  }
}

export async function getLastActive(userAddress: string): Promise<number | null> {
  try {
    const contract = new Contract(CONTRACT_ID);
    
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_last_active"))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationSuccess(simulation)) {
      const result = scValToNative(simulation.result!.retval);
      return Number(result);
    }
    return null;
  } catch (e) {
    console.error("[contractService] getLastActive failed:", e);
    return null;
  }
}

export async function checkIn(
  userAddress: string,
  signTransaction: (xdr: string) => Promise<string>
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    const contract = new Contract(CONTRACT_ID);
    
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("check_in"))
      .setTimeout(60)
      .build();

    const preparedTx = await sorobanServer.prepareTransaction(tx);
    const xdrString = preparedTx.toXDR();

    const signedXdr = await signTransaction(xdrString);
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);

    const result = await server.submitTransaction(signedTx);
    
    return { 
      success: true, 
      hash: (result as any).hash 
    };
  } catch (e: any) {
    console.error("[contractService] checkIn failed:", e);
    return { 
      success: false, 
      error: e.message || "Check-in failed" 
    };
  }
}

export const contractService = {
  getData,
  setData,
  getLastActive,
  checkIn
};
