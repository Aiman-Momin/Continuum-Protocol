import * as StellarSdk from "stellar-sdk";
const {
  Horizon,
  rpc: SorobanRpc,
  TransactionBuilder,
  Networks,
  Contract,
  Address,
  scValToNative,
  nativeToScVal,
} = StellarSdk;

const server = new Horizon.Server("https://horizon-testnet.stellar.org");
const sorobanServer = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

export const CONTRACT_ID = "CBY2L5ADWFW2RPABNLCWDWSM7IHKKJ2XM6H4GT2E5H5KSFXHDBOLY6OP";

export type NomineeOnChain = {
  address: string; // Stellar address (G...)
  role: string; // Symbol on-chain (we keep string in UI)
  bps: number; // basis points, 10000 = 100%
};

export type TimelineStageOnChain = {
  when: number; // unix seconds
  amount: string; // i128 as string to be safe in JS
  memo: string; // Symbol string
};

export type DistributionPhaseOnChain = {
  inactivity_days: number;
  entries: Array<{ address: string; bps: number }>;
};

function requireOwner(userAddress: string) {
  if (!userAddress) throw new Error("Missing user address");
  return new Address(userAddress);
}


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
      .addOperation(contract.call("get_last_active", requireOwner(userAddress).toScVal()))
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
      .addOperation(contract.call("check_in", requireOwner(userAddress).toScVal()))
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

export async function getNominees(userAddress: string): Promise<NomineeOnChain[]> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_nominees", requireOwner(userAddress).toScVal()))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) return [];
    const native = scValToNative(simulation.result!.retval) as any[];

    // expected: [{address: <Address>, role: <Symbol>, bps: <u32>}, ...]
    return (native || []).map((n: any) => ({
      address: String(n.address),
      role: String(n.role),
      bps: Number(n.bps),
    }));
  } catch (e) {
    console.error("[contractService] getNominees failed:", e);
    return [];
  }
}

export async function setNominees(
  userAddress: string,
  nominees: NomineeOnChain[],
  signTransaction: (xdr: string) => Promise<string>,
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);

    const nomineesScVal = nativeToScVal(
      nominees.map((n) => ({
        address: new Address(n.address),
        role: n.role,
        bps: n.bps,
      })),
      { type: "vec" },
    );

    const tx = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call("set_nominees", requireOwner(userAddress).toScVal(), nomineesScVal),
      )
      .setTimeout(60)
      .build();

    const preparedTx = await sorobanServer.prepareTransaction(tx);
    const signedXdr = await signTransaction(preparedTx.toXDR());
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(signedTx);
    return { success: true, hash: (result as any).hash };
  } catch (e: any) {
    console.error("[contractService] setNominees failed:", e);
    return { success: false, error: e.message || "set_nominees failed" };
  }
}

export async function getTimeline(userAddress: string): Promise<TimelineStageOnChain[]> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_timeline", requireOwner(userAddress).toScVal()))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) return [];
    const native = scValToNative(simulation.result!.retval) as any[];

    return (native || []).map((s: any) => ({
      when: Number(s.when),
      amount: String(s.amount),
      memo: String(s.memo),
    }));
  } catch (e) {
    console.error("[contractService] getTimeline failed:", e);
    return [];
  }
}

export async function setTimeline(
  userAddress: string,
  stages: TimelineStageOnChain[],
  signTransaction: (xdr: string) => Promise<string>,
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);

    const stagesScVal = nativeToScVal(
      stages.map((s) => ({
        when: BigInt(s.when),
        amount: BigInt(s.amount),
        memo: s.memo,
      })),
      { type: "vec" },
    );

    const tx = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("set_timeline", requireOwner(userAddress).toScVal(), stagesScVal))
      .setTimeout(60)
      .build();

    const preparedTx = await sorobanServer.prepareTransaction(tx);
    const signedXdr = await signTransaction(preparedTx.toXDR());
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(signedTx);
    return { success: true, hash: (result as any).hash };
  } catch (e: any) {
    console.error("[contractService] setTimeline failed:", e);
    return { success: false, error: e.message || "set_timeline failed" };
  }
}

export async function getDistributions(userAddress: string): Promise<DistributionPhaseOnChain[]> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(contract.call("get_distributions", requireOwner(userAddress).toScVal()))
      .setTimeout(30)
      .build();

    const simulation = await sorobanServer.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) return [];
    const native = scValToNative(simulation.result!.retval) as any[];

    return (native || []).map((p: any) => ({
      inactivity_days: Number(p.inactivity_days),
      entries: (p.entries || []).map((e: any) => ({
        address: String(e.address),
        bps: Number(e.bps),
      })),
    }));
  } catch (e) {
    console.error("[contractService] getDistributions failed:", e);
    return [];
  }
}

export async function setDistributions(
  userAddress: string,
  phases: DistributionPhaseOnChain[],
  signTransaction: (xdr: string) => Promise<string>,
): Promise<{ success: boolean; hash?: string; error?: string }> {
  try {
    const contract = new Contract(CONTRACT_ID);
    const account = await server.loadAccount(userAddress);

    const phasesScVal = nativeToScVal(
      phases.map((p) => ({
        inactivity_days: p.inactivity_days,
        entries: p.entries.map((e) => ({
          address: new Address(e.address),
          bps: e.bps,
        })),
      })),
      { type: "vec" },
    );

    const tx = new TransactionBuilder(account, {
      fee: "1000",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        contract.call("set_distributions", requireOwner(userAddress).toScVal(), phasesScVal),
      )
      .setTimeout(60)
      .build();

    const preparedTx = await sorobanServer.prepareTransaction(tx);
    const signedXdr = await signTransaction(preparedTx.toXDR());
    const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const result = await server.submitTransaction(signedTx);
    return { success: true, hash: (result as any).hash };
  } catch (e: any) {
    console.error("[contractService] setDistributions failed:", e);
    return { success: false, error: e.message || "set_distributions failed" };
  }
}

export const contractService = {
  getData,
  setData,
  getLastActive,
  checkIn,
  getNominees,
  setNominees,
  getTimeline,
  setTimeline,
  getDistributions,
  setDistributions,
};
