// Tipos para a API do Veeam ONE

// Modo de operação da aplicação
export type AppMode = "billing" | "failures";

export interface VeeamConfig {
  apiUrl: string;
  username: string;
  password: string;
  startDate: string;
  endDate: string;
  mode: AppMode;
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
  backupCount?: number;
}

export interface VeeamFileShare {
  fileShareUid?: string;
  name: string;
  platform?: string;
  usedSourceSizeBytes: number;
  lastProtectedDate?: string;
  jobName?: string;
  jobUid?: string;
  backupCount?: number;
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

// ─── Tipos para Relatório de Falhas e Lacunas ───

export type WorkloadType = "vm" | "agent" | "fileshare";

// Sessão de backup com detalhes de falha
export interface BackupSession {
  sessionId: string;
  jobName: string;
  jobUid: string;
  workloadName: string;
  workloadType: WorkloadType;
  status: string;
  startTime: string;
  endTime?: string;
  durationSec: number;
  errorMessage?: string;
  transferredBytes?: number;
  lastProtectedDate?: string;
}

// Lacuna (gap) de backup por workload
export interface BackupGap {
  workloadName: string;
  workloadType: WorkloadType;
  gapStart: string;
  gapEnd: string;
  gapDays: number;
  jobName: string;
  lastBackupDate?: string;
}

// Resumo de falhas de um workload DENTRO de um job
export interface WorkloadFailureDetail {
  workloadName: string;
  workloadType: WorkloadType;
  totalSessions: number;
  failedCount: number;
  warningCount: number;
  successCount: number;
  failureRate: number;
  lastBackupDate?: string;
  lastProtectedDate?: string;
  gaps: BackupGap[];
  maxGapDays: number;
  errors: string[];
}

// Resumo de falhas de um JOB (= cliente)
export interface JobFailureSummary {
  jobName: string;
  jobUid: string;
  jobStatus: string;
  totalWorkloads: number;
  totalSessions: number;
  failedCount: number;
  warningCount: number;
  successCount: number;
  failureRate: number;
  lastRunDate?: string;
  inconsistentWorkloads: number;
  workloadsWithFailures: number;
  workloads: WorkloadFailureDetail[];
  gaps: BackupGap[];
  maxGapDays: number;
  errors: string[];
}

// Dados consolidados de falhas
export interface FailuresData {
  sessions: BackupSession[];
  gaps: BackupGap[];
  totalJobs: number;
  totalWorkloads: number;
  totalSessions: number;
  failedSessions: number;
  warningSessions: number;
  successSessions: number;
  jobsWithFailures: number;
  jobsInconsistent: number;
  jobsWithGaps: number;
  periodStart: string;
  periodEnd: string;
  jobSummary: JobFailureSummary[];
}
