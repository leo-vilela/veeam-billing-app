import { VeeamConfig, BillingData, VeeamJob, VeeamVM, VeeamBackup } from "@/types/veeam";

/**
 * Função para obter token de autenticação da API do Veeam ONE
 */
export async function getVeeamToken(
  apiUrl: string,
  username: string,
  password: string
): Promise<string> {
  const credentials = btoa(`${username}:${password}`);

  const response = await fetch(`${apiUrl}/api/v2.3/authentication/logon`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Falha na autenticação: ${response.statusText}`);
  }

  const data = await response.json();
  return data.token || data.access_token;
}

/**
 * Função para obter todos os jobs de backup de VMs
 */
export async function getVeeamJobs(
  apiUrl: string,
  token: string,
  startDate?: string,
  endDate?: string
): Promise<VeeamJob[]> {
  const params = new URLSearchParams({
    Offset: "0",
    Limit: "1000",
  });

  if (startDate) {
    params.append("Filter", `lastRun ge '${startDate}'`);
  }

  const response = await fetch(
    `${apiUrl}/api/v2.3/vbrJobs/vmBackupJobs?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Erro ao buscar jobs: ${response.statusText}`);
  }

  const data = await response.json();
  return data.items || [];
}

/**
 * Função para obter todas as VMs protegidas
 */
export async function getVeeamVMs(
  apiUrl: string,
  token: string
): Promise<VeeamVM[]> {
  const params = new URLSearchParams({
    Offset: "0",
    Limit: "1000",
  });

  const response = await fetch(
    `${apiUrl}/api/v2.3/protectedData/virtualMachines?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Erro ao buscar VMs: ${response.statusText}`);
  }

  const data = await response.json();
  return data.items || [];
}

/**
 * Função para obter backups de uma VM específica
 */
export async function getVeeamVMBackups(
  apiUrl: string,
  token: string,
  vmUid: string,
  startDate?: string,
  endDate?: string
): Promise<VeeamBackup[]> {
  const params = new URLSearchParams({
    Offset: "0",
    Limit: "1000",
  });

  const response = await fetch(
    `${apiUrl}/api/v2.3/protectedData/virtualMachines/${vmUid}/backups?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Erro ao buscar backups da VM: ${response.statusText}`);
  }

  const data = await response.json();
  const backups = data.items || [];

  // Filtrar por período se fornecido
  if (startDate || endDate) {
    return backups.filter((backup: any) => {
      const backupDate = new Date(backup.creationTime || backup.backupDate);
      if (startDate && backupDate < new Date(startDate)) return false;
      if (endDate && backupDate > new Date(endDate)) return false;
      return true;
    });
  }

  return backups;
}

/**
 * Função para obter todas as sessões de backup (alternativa via VBR API)
 */
export async function getVeeamSessions(
  apiUrl: string,
  token: string,
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const params = new URLSearchParams({
    skip: "0",
    limit: "1000",
  });

  if (startDate) {
    params.append("createdAfterFilter", startDate);
  }

  if (endDate) {
    params.append("createdBeforeFilter", endDate);
  }

  // Tentar primeiro com a API do VBR
  try {
    const response = await fetch(`${apiUrl}/api/v1/sessions?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-api-version": "1.3-rev1",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.data || [];
    }
  } catch (error) {
    console.warn("Erro ao buscar sessões via VBR API:", error);
  }

  // Fallback para API do Veeam ONE
  try {
    const response = await fetch(`${apiUrl}/api/v2.3/sessions?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.items || [];
    }
  } catch (error) {
    console.warn("Erro ao buscar sessões via Veeam ONE API:", error);
  }

  return [];
}

/**
 * Função consolidada para buscar todos os dados de cobrança
 */
export async function fetchBillingData(
  config: VeeamConfig
): Promise<BillingData> {
  const { apiUrl, username, password, startDate, endDate } = config;

  // Obter token
  const token = await getVeeamToken(apiUrl, username, password);

  // Buscar jobs
  const jobs = await getVeeamJobs(apiUrl, token, startDate, endDate);

  // Buscar VMs
  const vms = await getVeeamVMs(apiUrl, token);

  // Buscar backups de todas as VMs
  const allBackups: VeeamBackup[] = [];
  for (const vm of vms) {
    try {
      const vmBackups = await getVeeamVMBackups(
        apiUrl,
        token,
        vm.vmUidInVbr,
        startDate,
        endDate
      );
      allBackups.push(
        ...vmBackups.map((backup: any) => ({
          backupUid: backup.uid,
          vmName: vm.name,
          backupDate: backup.creationTime || backup.backupDate,
          sizeBytes: backup.sizeBytes || 0,
          status: backup.status || "Unknown",
        }))
      );
    } catch (error) {
      console.warn(`Erro ao buscar backups da VM ${vm.name}:`, error);
    }
  }

  // Calcular totais
  const totalVolumeBytes = vms.reduce(
    (sum, vm) => sum + (vm.usedSourceSizeBytes || 0),
    0
  );

  return {
    jobs,
    vms,
    backups: allBackups,
    totalVolumeBytes,
    jobCount: jobs.length,
    vmCount: vms.length,
    backupCount: allBackups.length,
    periodStart: startDate,
    periodEnd: endDate,
  };
}

/**
 * Função para formatar bytes em unidades legíveis
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Função para calcular cobrança baseada em volumetria
 */
export function calculateBilling(
  totalVolumeBytes: number,
  pricePerGB: number = 0.05
): number {
  const totalGB = totalVolumeBytes / (1024 * 1024 * 1024);
  return totalGB * pricePerGB;
}
