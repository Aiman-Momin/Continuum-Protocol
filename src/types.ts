
export enum VaultStatus {
  Active = "Active",
  InactivityDetected = "InactivityDetected",
  GracePeriod = "GracePeriod",
  Distributing = "Distributing",
  Closed = "Closed",
}

export interface Beneficiary {
  address: string;
  percentage: number;
  name: string;
}

export interface VaultState {
  owner: string;
  lastActive: number;
  threshold: number;
  status: VaultStatus;
  beneficiaries: Beneficiary[];
  balance: number;
}
