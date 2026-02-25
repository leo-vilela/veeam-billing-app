// Tipos para a API do Veeam ONE

export interface VeeamConfig {
  apiUrl: string;
  username: string;
  password: string;
  startDate: string;
  endDate: string;
}

export interface VeeamJob {
  vmBackupJobUid: string;
  name: string;
  status: string;
  lastRun: string;
  lastRunDurationSec: number;
  avgDurationSec: number;
  lastTransferredDataBytes: number;
  platform: string;
  description?: string;
}

export interface VeeamVM {
  vmUidInVbr: string;
  name: string;
  platform: string;
  usedSourceSizeBytes: number;
  provisionedSourceSizeBytes: number;
  lastProtectedDate: string;
  jobName: string;
  jobUid: string;
}

export interface VeeamComputer {
  computerUid?: string;
  name: string;
  platform?: string;
  usedSourceSizeBytes: number;
  lastProtectedDate?: string;
  jobName?: string;
  jobUid?: string;
}

export interface VeeamFileShare {
  fileShareUid?: string;
  name: string;
  platform?: string;
  usedSourceSizeBytes: number;
  lastProtectedDate?: string;
  jobName?: string;
  jobUid?: string;
}

export interface VeeamBackup {
  backupUid?: string;
  vmName: string;
  backupDate: string;
  sizeBytes: number;
  status: string;
}

export interface VeeamLicensingUsage {
  instances?: number;
  sockets?: number;
  capacityBytes?: number;
  [key: string]: any;
}

export interface BillingData {
  jobs: VeeamJob[];
  vms: VeeamVM[];
  computers: VeeamComputer[];
  fileShares: VeeamFileShare[];
  backups: VeeamBackup[];
  totalVolumeBytes: number;
  jobCount: number;
  vmCount: number;
  computerCount: number;
  fileShareCount: number;
  backupCount: number;
  periodStart: string;
  periodEnd: string;
  billingMode?: "v22" | "legacy-license";
  licensingUsage?: VeeamLicensingUsage;
  legacySummary?: {
    instances: number;
    sockets: number;
    licenseType?: string;
    expirationDate?: string;
    supportExpirationDate?: string;
    product?: string;
    version?: string;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
