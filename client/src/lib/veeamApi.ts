import {
  VeeamConfig,
  BillingData,
  VeeamJob,
  VeeamVM,
  VeeamComputer,
  VeeamFileShare,
  VeeamBackup,
} from "@/types/veeam";

const capabilityCache = new Map<string, boolean>();

interface VeeamOneLegacyLicenseInfo {
  type?: string;
  expirationDate?: string;
  supportExpirationDate?: string;
  instances?: number;
  sockets?: number;
}

interface VeeamOneServiceInfo {
  product?: string;
  version?: string;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  const normalized = new Headers(headers);
  return Object.fromEntries(normalized.entries());
}

function serializeProxyBody(body: RequestInit["body"]): unknown {
  if (body == null) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  return body;
}

async function readJsonSafely<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Resposta JSON inválida da API: ${reason}`);
  }
}

async function getApiErrorMessage(response: Response): Promise<string> {
  let errorMessage = `${response.status} ${response.statusText}`.trim();

  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const errorBody = await readJsonSafely<any>(response);
      if (typeof errorBody?.message === "string") {
        return errorBody.message;
      }
      if (typeof errorBody?.detail === "string") {
        return errorBody.detail;
      }
      if (typeof errorBody?.title === "string") {
        return errorBody.title;
      }
      if (typeof errorBody?.error_description === "string") {
        return errorBody.error_description;
      }
      if (typeof errorBody?.error === "string") {
        return errorBody.error;
      }
    }
  } catch {
    // Ignora parsing inválido
  }

  return errorMessage || "Erro desconhecido";
}

async function veeamRequest(
  apiUrl: string,
  endpoint: string,
  init: RequestInit = {}
): Promise<Response> {
  const normalizedApiUrl = apiUrl.trim().replace(/\/$/, "");
  const targetUrl = `${normalizedApiUrl}${endpoint}`;

  return fetch("/__veeam__/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: targetUrl,
      method: init.method ?? "GET",
      headers: normalizeHeaders(init.headers),
      body: serializeProxyBody(init.body),
    }),
  });
}

async function hasV22BillingEndpoints(
  apiUrl: string,
  options?: { forceRefresh?: boolean; strict?: boolean }
): Promise<boolean> {
  const cacheKey = apiUrl.trim().toLowerCase() + "_v22";
  const forceRefresh = options?.forceRefresh ?? false;
  const strict = options?.strict ?? false;

  if (!forceRefresh && capabilityCache.has(cacheKey)) {
    return capabilityCache.get(cacheKey)!;
  }

  try {
    const response = await veeamRequest(apiUrl, "/swagger/v2.2/swagger.json");
    if (!response.ok) {
      if (strict) {
        capabilityCache.set(cacheKey, false);
        return false;
      }
      return true;
    }

    const data = await readJsonSafely<any>(response);
    const paths = data?.paths ?? {};
    const hasExpectedPath =
      typeof paths === "object" &&
      paths !== null &&
      Boolean(paths["/api/v2.2/vbrJobs/vmBackupJobs"]);

    capabilityCache.set(cacheKey, hasExpectedPath);
    return hasExpectedPath;
  } catch {
    if (strict) {
      capabilityCache.set(cacheKey, false);
      return false;
    }
    return true;
  }
}

function unsupportedApiMessage(): string {
  return "O servidor Veeam ONE não suporta a API v2.2 requerida para billing. Verifique sua instalação do Veeam ONE.";
}

async function getLegacyLicenseInfo(
  apiUrl: string,
  token: string
): Promise<VeeamOneLegacyLicenseInfo> {
  const response = await veeamRequest(apiUrl, "/api/v1/license", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(`Erro ao buscar licença: ${errorMessage}`);
  }

  return readJsonSafely<VeeamOneLegacyLicenseInfo>(response);
}

async function getLegacyServiceInfo(
  apiUrl: string,
  token: string
): Promise<VeeamOneServiceInfo | null> {
  const response = await veeamRequest(
    apiUrl,
    "/api/v1/about/installationInfo",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  return readJsonSafely<VeeamOneServiceInfo>(response);
}

async function fetchLegacyLicenseBillingData(
  apiUrl: string,
  token: string,
  startDate: string,
  endDate: string
): Promise<BillingData> {
  const licenseInfo = await getLegacyLicenseInfo(apiUrl, token);
  const serviceInfo = await getLegacyServiceInfo(apiUrl, token);

  const instances = Number(licenseInfo.instances ?? 0);
  const sockets = Number(licenseInfo.sockets ?? 0);

  const billableUnits = instances > 0 ? instances : sockets;
  const totalVolumeBytes = billableUnits * 1024 * 1024 * 1024;

  return {
    jobs: [],
    vms: [],
    computers: [],
    fileShares: [],
    backups: [],
    totalVolumeBytes,
    jobCount: 0,
    vmCount: instances,
    computerCount: 0,
    fileShareCount: 0,
    backupCount: 0,
    periodStart: startDate,
    periodEnd: endDate,
    billingMode: "legacy-license",
    legacySummary: {
      instances,
      sockets,
      licenseType: licenseInfo.type,
      expirationDate: licenseInfo.expirationDate,
      supportExpirationDate: licenseInfo.supportExpirationDate,
      product: serviceInfo?.product,
      version: serviceInfo?.version,
    },
  };
}

function toStartOfDay(dateString: string): Date {
  const date = new Date(dateString);
  date.setHours(0, 0, 0, 0);
  return date;
}

function toEndOfDay(dateString: string): Date {
  const date = new Date(dateString);
  date.setHours(23, 59, 59, 999);
  return date;
}

/**
 * Função para obter token de autenticação da API do Veeam ONE
 */
export async function getVeeamToken(
  apiUrl: string,
  username: string,
  password: string
): Promise<string> {
  const normalizedUsername = username.trim();

  const usernameCandidates = [normalizedUsername];
  if (normalizedUsername.includes("\\")) {
    const [domain, user] = normalizedUsername.split("\\", 2);
    if (domain && user) {
      usernameCandidates.push(`${user}@${domain}`);
    }
  }

  let lastError = "Falha na autenticação";

  const authStrategies = [
    {
      label: "v2.2/token",
      endpoint: "/api/token",
      buildRequest: (usernameCandidate: string): RequestInit => ({
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "password",
          username: usernameCandidate,
          password,
        }),
      }),
    },
  ] as const;

  for (const usernameCandidate of usernameCandidates) {
    for (const strategy of authStrategies) {
      const response = await veeamRequest(
        apiUrl,
        strategy.endpoint,
        strategy.buildRequest(usernameCandidate)
      );

      if (response.ok) {
        const data = await readJsonSafely<any>(response);
        const token = data.token || data.access_token;
        if (token) {
          return token;
        }
      }

      const errorMessage = await getApiErrorMessage(response);
      lastError = `Falha na autenticação (${usernameCandidate} - ${strategy.label}): ${errorMessage}`;
    }
  }

  throw new Error(lastError);
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
  const supported = await hasV22BillingEndpoints(apiUrl, {
    forceRefresh: true,
    strict: true,
  });
  if (!supported) {
    throw new Error(unsupportedApiMessage());
  }

  const params = new URLSearchParams({
    skip: "0",
    limit: "1000",
  });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/vbrJobs/vmBackupJobs?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      const stillSupported = await hasV22BillingEndpoints(apiUrl, {
        forceRefresh: true,
        strict: true,
      });
      if (!stillSupported) {
        throw new Error(unsupportedApiMessage());
      }
    }
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(`Erro ao buscar jobs: ${errorMessage}`);
  }

  const data = await readJsonSafely<any>(response);
  const jobs = data.items || [];

  if (!startDate && !endDate) {
    return jobs;
  }

  const start = startDate ? toStartOfDay(startDate) : null;
  const end = endDate ? toEndOfDay(endDate) : null;

  return jobs.filter((job: VeeamJob) => {
    const lastRunValue = (job as any).lastRun;
    if (!lastRunValue) {
      return false;
    }

    const lastRun = new Date(lastRunValue);
    if (Number.isNaN(lastRun.getTime())) {
      return false;
    }

    if (start && lastRun < start) {
      return false;
    }

    if (end && lastRun > end) {
      return false;
    }

    return true;
  });
}

/**
 * Função para obter todas as VMs protegidas
 */
export async function getVeeamVMs(
  apiUrl: string,
  token: string
): Promise<VeeamVM[]> {
  const params = new URLSearchParams({
    skip: "0",
    limit: "1000",
  });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/protectedData/virtualMachines?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(`Erro ao buscar VMs: ${errorMessage}`);
  }

  const data = await readJsonSafely<any>(response);
  return data.items || [];
}

/**
 * Função para obter todos os computadores protegidos (Veeam Agents)
 * Enriquece com dados de backup (jobName e usedSourceSizeBytes) via sub-endpoint
 */
export async function getVeeamComputers(
  apiUrl: string,
  token: string
): Promise<VeeamComputer[]> {
  const params = new URLSearchParams({
    skip: "0",
    limit: "1000",
  });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/protectedData/computers?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    console.warn(
      "Endpoints de computadores podem não estar licenciados ou falharam."
    );
    return [];
  }

  const data = await readJsonSafely<any>(response);
  const computers: any[] = data.items || [];

  // Enriquecer com dados de backup (jobName, usedSourceSizeBytes)
  const enriched: VeeamComputer[] = await Promise.all(
    computers.map(async comp => {
      const uid = comp.computerUidInVbr || comp.computerId;
      let jobName = comp.jobName || "";
      let usedSourceSizeBytes = Number(
        comp.usedSourceSizeBytes ||
        comp.sourceSizeBytes ||
        comp.sizeBytes ||
        comp.totalSize ||
        0
      );
      let backupCount = Number(comp.backupCount || comp.restorePointCount || comp.restorePointsCount || 0);

      if (uid) {
        try {
          const backupsResp = await veeamRequest(
            apiUrl,
            `/api/v2.2/protectedData/computers/${uid}/backups?skip=0&limit=10`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
          if (backupsResp.ok) {
            const backupsData = await readJsonSafely<any>(backupsResp);
            const backups: any[] = backupsData.items || [];
            const totalFromApi = Number(backupsData.totalCount || backupsData.total || backupsData.count || 0);
            if (totalFromApi > 0) {
              backupCount = totalFromApi;
            } else if (backups.length > 0) {
              backupCount = backups.length;
            }
            if (backups.length > 0) {
              jobName = jobName || backups[0].jobName || "";
              const latestBackup = backups[0];
              const latestSize = Number(
                latestBackup.usedSourceSizeBytes ||
                latestBackup.sourceSizeBytes ||
                latestBackup.totalRestorePointSizeBytes ||
                latestBackup.sizeBytes ||
                latestBackup.backupSize ||
                latestBackup.dataSizeBytes ||
                0
              );
              if (latestSize > 0 && usedSourceSizeBytes === 0) {
                usedSourceSizeBytes = latestSize;
              }
            }
          }
        } catch (e) {
          console.warn(`Erro ao buscar backups do computador ${comp.name}:`, e);
        }
      }

      return {
        computerUid: uid,
        name: comp.name || "N/A",
        platform: comp.platform || comp.operationMode || "",
        usedSourceSizeBytes,
        lastProtectedDate: comp.lastProtectedDate,
        jobName,
        jobUid: "",
        backupCount,
      };
    })
  );

  return enriched;
}

/**
 * Função para obter todos os file shares protegidos
 * Enriquece com dados de backup (jobName e usedSourceSizeBytes) via sub-endpoint
 */
export async function getVeeamFileShares(
  apiUrl: string,
  token: string
): Promise<VeeamFileShare[]> {
  const params = new URLSearchParams({
    skip: "0",
    limit: "1000",
  });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/protectedData/unstructuredData/fileShares?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    console.warn(
      "Endpoints de file shares podem não estar licenciados ou falharam."
    );
    return [];
  }

  const data = await readJsonSafely<any>(response);
  const shares: any[] = data.items || [];

  // Enriquecer com dados de backup (jobName, usedSourceSizeBytes)
  const enriched: VeeamFileShare[] = await Promise.all(
    shares.map(async fs => {
      const uid = fs.fileShareUidInVbr || fs.fileShareId;
      let jobName = fs.jobName || "";
      let usedSourceSizeBytes = Number(
        fs.usedSourceSizeBytes ||
        fs.sourceSizeBytes ||
        fs.sizeBytes ||
        fs.totalSize ||
        fs.capacityBytes ||
        0
      );
      let backupCount = Number(fs.backupCount || fs.restorePointCount || fs.restorePointsCount || 0);

      if (uid) {
        try {
          const backupsResp = await veeamRequest(
            apiUrl,
            `/api/v2.2/protectedData/unstructuredData/fileShares/${uid}/backups?skip=0&limit=10`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          );
          if (backupsResp.ok) {
            const backupsData = await readJsonSafely<any>(backupsResp);
            const backups: any[] = backupsData.items || [];
            const totalFromApi = Number(backupsData.totalCount || backupsData.total || backupsData.count || 0);
            if (totalFromApi > 0) {
              backupCount = totalFromApi;
            } else if (backups.length > 0) {
              backupCount = backups.length;
            }
            if (backups.length > 0) {
              jobName = jobName || backups[0].jobName || "";
              const latestBackup = backups[0];
              const latestSize = Number(
                latestBackup.usedSourceSizeBytes ||
                latestBackup.sourceSizeBytes ||
                latestBackup.totalRestorePointSizeBytes ||
                latestBackup.sizeBytes ||
                latestBackup.backupSize ||
                latestBackup.dataSizeBytes ||
                0
              );
              if (latestSize > 0 && usedSourceSizeBytes === 0) {
                usedSourceSizeBytes = latestSize;
              }
            }
          }
        } catch (e) {
          console.warn(`Erro ao buscar backups do file share ${fs.name}:`, e);
        }
      }

      return {
        fileShareUid: uid,
        name: fs.name || "N/A",
        platform: fs.platform || "",
        usedSourceSizeBytes,
        lastProtectedDate: fs.lastProtectedDate,
        jobName,
        jobUid: "",
        backupCount,
      };
    })
  );

  return enriched;
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
    skip: "0",
    limit: "1000",
  });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/protectedData/virtualMachines/${vmUid}/backups?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(`Erro ao buscar backups da VM: ${errorMessage}`);
  }

  const data = await readJsonSafely<any>(response);
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
    const response = await veeamRequest(apiUrl, `/api/v1/sessions?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-api-version": "1.3-rev1",
      },
    });

    if (response.ok) {
      const data = await readJsonSafely<any>(response);
      return data.data || [];
    }
  } catch (error) {
    console.warn("Erro ao buscar sessões via VBR API:", error);
  }

  // Fallback para API do Veeam ONE v2.2
  try {
    const response = await veeamRequest(
      apiUrl,
      `/api/v2.2/taskSessions?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      const data = await readJsonSafely<any>(response);
      return data.items || [];
    }
  } catch (error) {
    console.warn("Erro ao buscar sessões via Veeam ONE API:", error);
  }

  return [];
}

/**
 * Função para obter uso de licenciamento da API v2.2
 */
export async function getVeeamLicensingUsage(
  apiUrl: string,
  token: string
): Promise<any> {
  try {
    const response = await veeamRequest(
      apiUrl,
      `/api/v2.2/license/currentUsage`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (response.ok) {
      return readJsonSafely<any>(response);
    }
  } catch (error) {
    console.warn("Erro ao buscar dados de licenciamento:", error);
  }
  return null;
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

  const supportsV22Billing = await hasV22BillingEndpoints(apiUrl, {
    forceRefresh: true,
    strict: true,
  });

  if (!supportsV22Billing) {
    return fetchLegacyLicenseBillingData(apiUrl, token, startDate, endDate);
  }

  // Buscar licensing usage
  const licensingUsage = await getVeeamLicensingUsage(apiUrl, token);

  // Buscar jobs e workloads
  const [jobs, vms, computers, fileShares] = await Promise.all([
    getVeeamJobs(apiUrl, token, startDate, endDate),
    getVeeamVMs(apiUrl, token),
    getVeeamComputers(apiUrl, token),
    getVeeamFileShares(apiUrl, token),
  ]);

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

  // Buscar backups de todos os Agents (computadores)
  for (const comp of computers) {
    const uid = (comp as any).computerUid || (comp as any).computerUidInVbr;
    if (!uid) continue;
    try {
      const resp = await veeamRequest(
        apiUrl,
        `/api/v2.2/protectedData/computers/${uid}/backups?skip=0&limit=1000`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (resp.ok) {
        const data = await readJsonSafely<any>(resp);
        const backups: any[] = data.items || [];
        allBackups.push(
          ...backups.map((backup: any) => ({
            backupUid: backup.uid,
            vmName: comp.name,
            backupDate: backup.creationTime || backup.backupDate,
            sizeBytes: backup.sizeBytes || 0,
            status: backup.status || "Unknown",
          }))
        );
      }
    } catch (error) {
      console.warn(`Erro ao buscar backups do Agent ${comp.name}:`, error);
    }
  }

  // Buscar backups de todos os File Shares
  for (const fs of fileShares) {
    const uid = (fs as any).fileShareUid || (fs as any).fileShareUidInVbr;
    if (!uid) continue;
    try {
      const resp = await veeamRequest(
        apiUrl,
        `/api/v2.2/protectedData/unstructuredData/fileShares/${uid}/backups?skip=0&limit=1000`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );
      if (resp.ok) {
        const data = await readJsonSafely<any>(resp);
        const backups: any[] = data.items || [];
        allBackups.push(
          ...backups.map((backup: any) => ({
            backupUid: backup.uid,
            vmName: fs.name,
            backupDate: backup.creationTime || backup.backupDate,
            sizeBytes: backup.sizeBytes || 0,
            status: backup.status || "Unknown",
          }))
        );
      }
    } catch (error) {
      console.warn(`Erro ao buscar backups do File Share ${fs.name}:`, error);
    }
  }

  // Calcular totais
  const vmsVolume = vms.reduce(
    (sum, vm) => sum + (vm.usedSourceSizeBytes || 0),
    0
  );
  const computersVolume = computers.reduce(
    (sum, comp) => sum + (comp.usedSourceSizeBytes || 0),
    0
  );
  const fileSharesVolume = fileShares.reduce(
    (sum, fs) => sum + (fs.usedSourceSizeBytes || 0),
    0
  );

  const totalVolumeBytes = vmsVolume + computersVolume + fileSharesVolume;

  return {
    jobs,
    vms,
    computers,
    fileShares,
    backups: allBackups,
    totalVolumeBytes,
    jobCount: jobs.length,
    vmCount: vms.length,
    computerCount: computers.length,
    fileShareCount: fileShares.length,
    backupCount: allBackups.length,
    periodStart: startDate,
    periodEnd: endDate,
    billingMode: "v22",
    licensingUsage: licensingUsage || undefined,
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
