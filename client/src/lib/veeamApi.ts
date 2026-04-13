import {
  VeeamConfig,
  BillingData,
  VeeamJob,
  VeeamVM,
  VeeamComputer,
  VeeamFileShare,
  VeeamBackup,
  FailuresData,
  BackupSession,
  BackupGap,
  JobFailureSummary,
  WorkloadFailureDetail,
  WorkloadType,
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
 * Filtra um array de backups (qualquer formato) pelo período informado.
 * Usa os campos creationTime ou backupDate do objeto.
 */
function filterBackupsByDate(
  backups: any[],
  startDate?: string,
  endDate?: string
): any[] {
  if (!startDate && !endDate) return backups;

  const start = startDate ? toStartOfDay(startDate) : null;
  const end = endDate ? toEndOfDay(endDate) : null;

  return backups.filter((backup: any) => {
    const dateStr = backup.creationTime || backup.backupDate;
    if (!dateStr) return false;

    const backupDate = new Date(dateStr);
    if (Number.isNaN(backupDate.getTime())) return false;

    if (start && backupDate < start) return false;
    if (end && backupDate > end) return false;

    return true;
  });
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

  // Buscar backups de todas as VMs (em lotes paralelos)
  const allBackups: VeeamBackup[] = [];

  const vmBackupResults = await processBatch(vms, async (vm) => {
    const vmBackups = await getVeeamVMBackups(
      apiUrl,
      token,
      vm.vmUidInVbr,
      startDate,
      endDate
    );
    return vmBackups.map((backup: any) => ({
      backupUid: backup.uid,
      vmName: vm.name,
      backupDate: backup.creationTime || backup.backupDate,
      sizeBytes: backup.sizeBytes || 0,
      status: backup.status || "Unknown",
    }));
  }, 5);
  for (const batch of vmBackupResults) {
    allBackups.push(...batch);
  }

  // Buscar backups de todos os Agents (em lotes paralelos)
  const agentBackupResults = await processBatch(
    computers.filter(comp => (comp as any).computerUid || (comp as any).computerUidInVbr),
    async (comp) => {
      const uid = (comp as any).computerUid || (comp as any).computerUidInVbr;
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
      if (!resp.ok) return [];
      const data = await readJsonSafely<any>(resp);
      return filterBackupsByDate(data.items || [], startDate, endDate).map((backup: any) => ({
        backupUid: backup.uid,
        vmName: comp.name,
        backupDate: backup.creationTime || backup.backupDate,
        sizeBytes: backup.sizeBytes || 0,
        status: backup.status || "Unknown",
      }));
    }, 5
  );
  for (const batch of agentBackupResults) {
    allBackups.push(...batch);
  }

  // Buscar backups de todos os File Shares (em lotes paralelos)
  const fsBackupResults = await processBatch(
    fileShares.filter(fs => (fs as any).fileShareUid || (fs as any).fileShareUidInVbr),
    async (fs) => {
      const uid = (fs as any).fileShareUid || (fs as any).fileShareUidInVbr;
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
      if (!resp.ok) return [];
      const data = await readJsonSafely<any>(resp);
      return filterBackupsByDate(data.items || [], startDate, endDate).map((backup: any) => ({
        backupUid: backup.uid,
        vmName: fs.name,
        backupDate: backup.creationTime || backup.backupDate,
        sizeBytes: backup.sizeBytes || 0,
        status: backup.status || "Unknown",
      }));
    }, 5
  );
  for (const batch of fsBackupResults) {
    allBackups.push(...batch);
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

// ─── Helper: Processamento em Lotes Paralelos ───

/**
 * Processa um array de itens em lotes paralelos com concorrência controlada.
 * Evita sobrecarregar a API do Veeam enquanto mantém boa performance.
 */
async function processBatch<T, R>(
  items: T[],
  handler: (item: T) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(handler));
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      }
    }
  }
  return results;
}

// ─── Funções para Relatório de Falhas e Lacunas ───

/**
 * Calcula lacunas (gaps) de backup para um workload no período selecionado.
 * Um gap é definido como um período de 1+ dias consecutivos sem nenhum backup.
 */
export function calculateBackupGaps(
  backupDates: string[],
  periodStart: string,
  periodEnd: string,
  workloadName: string,
  workloadType: WorkloadType,
  jobName: string
): BackupGap[] {
  const start = toStartOfDay(periodStart);
  const end = toEndOfDay(periodEnd);

  // Criar set de dias com backup (formato YYYY-MM-DD)
  const daysWithBackup = new Set<string>();
  for (const dateStr of backupDates) {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      daysWithBackup.add(d.toISOString().split("T")[0]);
    }
  }

  const gaps: BackupGap[] = [];
  let gapStart: Date | null = null;

  const current = new Date(start);
  while (current <= end) {
    const dayKey = current.toISOString().split("T")[0];

    if (!daysWithBackup.has(dayKey)) {
      if (!gapStart) {
        gapStart = new Date(current);
      }
    } else {
      if (gapStart) {
        const gapEndDate = new Date(current);
        gapEndDate.setDate(gapEndDate.getDate() - 1);
        const gapDays = Math.ceil(
          (gapEndDate.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)
        ) + 1;

        if (gapDays >= 1) {
          gaps.push({
            workloadName,
            workloadType,
            gapStart: gapStart.toISOString().split("T")[0],
            gapEnd: gapEndDate.toISOString().split("T")[0],
            gapDays,
            jobName,
          });
        }
        gapStart = null;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  // Fechar gap que vai até o final do período
  if (gapStart) {
    const gapDays = Math.ceil(
      (end.getTime() - gapStart.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    if (gapDays >= 1) {
      gaps.push({
        workloadName,
        workloadType,
        gapStart: gapStart.toISOString().split("T")[0],
        gapEnd: end.toISOString().split("T")[0],
        gapDays,
        jobName,
      });
    }
  }

  return gaps;
}

/**
 * Constrói resumo de falhas agrupado por JOB (= cliente).
 * Cada Job contém workloads internos com seus detalhes.
 */
export function buildJobSummary(
  sessions: BackupSession[],
  gaps: BackupGap[],
  jobs: VeeamJob[]
): JobFailureSummary[] {
  // Mapa de jobs com seus dados da API
  const jobStatusMap = new Map<string, VeeamJob>();
  for (const job of jobs) {
    jobStatusMap.set(job.name, job);
  }

  // Mapa de Jobs → WorkloadDetails
  const jobMap = new Map<string, {
    jobName: string;
    jobUid: string;
    jobStatus: string;
    lastRunDate?: string;
    workloadMap: Map<string, WorkloadFailureDetail>;
  }>();

  // Percorrer sessions e agrupar por Job → Workload
  for (const session of sessions) {
    const jobKey = session.jobName || "Sem Job";

    if (!jobMap.has(jobKey)) {
      const apiJob = jobStatusMap.get(jobKey);
      jobMap.set(jobKey, {
        jobName: jobKey,
        jobUid: session.jobUid || apiJob?.vmBackupJobUid || "",
        jobStatus: apiJob?.status || "Unknown",
        lastRunDate: apiJob?.lastRun,
        workloadMap: new Map(),
      });
    }

    const jobEntry = jobMap.get(jobKey)!;
    const wlKey = `${session.workloadType}::${session.workloadName}`;

    if (!jobEntry.workloadMap.has(wlKey)) {
      jobEntry.workloadMap.set(wlKey, {
        workloadName: session.workloadName,
        workloadType: session.workloadType,
        totalSessions: 0,
        failedCount: 0,
        warningCount: 0,
        successCount: 0,
        failureRate: 0,
        lastBackupDate: undefined,
        gaps: [],
        maxGapDays: 0,
        errors: [],
      });
    }

    const wl = jobEntry.workloadMap.get(wlKey)!;
    wl.totalSessions++;

    const statusLower = session.status.toLowerCase();
    if (statusLower === "failed" || statusLower === "error") {
      wl.failedCount++;
      if (session.errorMessage && !wl.errors.includes(session.errorMessage)) {
        wl.errors.push(session.errorMessage);
      }
    } else if (statusLower === "warning") {
      wl.warningCount++;
    } else {
      wl.successCount++;
    }

    if (session.startTime) {
      if (!wl.lastBackupDate || session.startTime > wl.lastBackupDate) {
        wl.lastBackupDate = session.startTime;
      }
    }
  }

  // Associar gaps aos workloads dentro dos jobs
  for (const gap of gaps) {
    const jobKey = gap.jobName || "Sem Job";

    if (!jobMap.has(jobKey)) {
      jobMap.set(jobKey, {
        jobName: jobKey,
        jobUid: "",
        jobStatus: "Unknown",
        workloadMap: new Map(),
      });
    }

    const jobEntry = jobMap.get(jobKey)!;
    const wlKey = `${gap.workloadType}::${gap.workloadName}`;

    if (!jobEntry.workloadMap.has(wlKey)) {
      jobEntry.workloadMap.set(wlKey, {
        workloadName: gap.workloadName,
        workloadType: gap.workloadType,
        totalSessions: 0,
        failedCount: 0,
        warningCount: 0,
        successCount: 0,
        failureRate: 0,
        gaps: [],
        maxGapDays: 0,
        errors: [],
      });
    }

    const wl = jobEntry.workloadMap.get(wlKey)!;
    wl.gaps.push(gap);
    if (gap.gapDays > wl.maxGapDays) {
      wl.maxGapDays = gap.gapDays;
    }
  }

  // Montar JobFailureSummary[]
  const result: JobFailureSummary[] = [];

  for (const [, entry] of Array.from(jobMap.entries())) {
    const workloads = Array.from(entry.workloadMap.values());

    // Calcular taxa de falha por workload
    for (const wl of workloads) {
      if (wl.totalSessions > 0) {
        wl.failureRate = (wl.failedCount / wl.totalSessions) * 100;
      }
    }

    // Agregar contadores a nível de Job
    const totalSessions = workloads.reduce((s, w) => s + w.totalSessions, 0);
    const failedCount = workloads.reduce((s, w) => s + w.failedCount, 0);
    const warningCount = workloads.reduce((s, w) => s + w.warningCount, 0);
    const successCount = workloads.reduce((s, w) => s + w.successCount, 0);
    const allGapsJob = workloads.flatMap(w => w.gaps);
    const maxGapDays = workloads.reduce((m, w) => Math.max(m, w.maxGapDays), 0);
    const allErrors = Array.from(new Set(workloads.flatMap(w => w.errors)));

    result.push({
      jobName: entry.jobName,
      jobUid: entry.jobUid,
      jobStatus: entry.jobStatus,
      totalWorkloads: workloads.length,
      totalSessions,
      failedCount,
      warningCount,
      successCount,
      failureRate: totalSessions > 0 ? (failedCount / totalSessions) * 100 : 0,
      lastRunDate: entry.lastRunDate,
      workloads: workloads.sort((a, b) => b.failureRate - a.failureRate),
      gaps: allGapsJob,
      maxGapDays,
      errors: allErrors,
    });
  }

  return result.sort((a, b) => b.failureRate - a.failureRate);
}

/**
 * Função consolidada para buscar todos os dados de falhas e lacunas.
 * Agrupado por JOB (= cliente). Reutiliza autenticação e endpoints existentes.
 */
export async function fetchFailuresData(
  config: VeeamConfig
): Promise<FailuresData> {
  const { apiUrl, username, password, startDate, endDate } = config;

  // Autenticar
  const token = await getVeeamToken(apiUrl, username, password);

  // Buscar jobs e workloads em paralelo
  let jobs: VeeamJob[] = [];

  const [jobsResult, vms, computers, fileShares] = await Promise.all([
    getVeeamJobs(apiUrl, token, startDate, endDate).catch(() => {
      console.warn("Não foi possível buscar jobs. Continuando sem dados de job.");
      return [] as VeeamJob[];
    }),
    getVeeamVMs(apiUrl, token),
    getVeeamComputers(apiUrl, token),
    getVeeamFileShares(apiUrl, token),
  ]);
  jobs = jobsResult;

  const allSessions: BackupSession[] = [];
  const allGaps: BackupGap[] = [];

  // ── Processar VMs (em lotes paralelos) ──
  const vmResults = await processBatch(vms, async (vm) => {
    const vmBackups = await getVeeamVMBackups(
      apiUrl,
      token,
      vm.vmUidInVbr,
      startDate,
      endDate
    );

    const sessions: BackupSession[] = [];
    const backupDates: string[] = [];

    for (const backup of vmBackups) {
      const backupDate = (backup as any).creationTime || (backup as any).backupDate;

      sessions.push({
        sessionId: (backup as any).uid || `vm-${vm.vmUidInVbr}-${backupDate}`,
        jobName: vm.jobName || "N/A",
        jobUid: vm.jobUid || "",
        workloadName: vm.name,
        workloadType: "vm",
        status: (backup as any).status || "Unknown",
        startTime: backupDate || "",
        endTime: (backup as any).endTime,
        durationSec: Number((backup as any).durationSec || 0),
        errorMessage: (backup as any).failureMessage || (backup as any).errorMessage || undefined,
        transferredBytes: Number((backup as any).sizeBytes || 0),
      });

      if (backupDate) {
        backupDates.push(backupDate);
      }
    }

    const vmGaps = calculateBackupGaps(
      backupDates,
      startDate,
      endDate,
      vm.name,
      "vm",
      vm.jobName || "N/A"
    );

    return { sessions, gaps: vmGaps };
  }, 5);

  for (const result of vmResults) {
    allSessions.push(...result.sessions);
    allGaps.push(...result.gaps);
  }

  // ── Processar Agents (em lotes paralelos) ──
  const agentResults = await processBatch(
    computers.filter(comp => (comp as any).computerUid || (comp as any).computerUidInVbr),
    async (comp) => {
      const uid = (comp as any).computerUid || (comp as any).computerUidInVbr;
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

      if (!resp.ok) return { sessions: [] as BackupSession[], gaps: [] as BackupGap[] };

      const data = await readJsonSafely<any>(resp);
      const backups: any[] = filterBackupsByDate(data.items || [], startDate, endDate);
      const sessions: BackupSession[] = [];
      const backupDates: string[] = [];

      for (const backup of backups) {
        const backupDate = backup.creationTime || backup.backupDate;

        sessions.push({
          sessionId: backup.uid || `agent-${uid}-${backupDate}`,
          jobName: comp.jobName || "N/A",
          jobUid: comp.jobUid || "",
          workloadName: comp.name,
          workloadType: "agent",
          status: backup.status || "Unknown",
          startTime: backupDate || "",
          endTime: backup.endTime,
          durationSec: Number(backup.durationSec || 0),
          errorMessage: backup.failureMessage || backup.errorMessage || undefined,
          transferredBytes: Number(backup.sizeBytes || 0),
        });

        if (backupDate) {
          backupDates.push(backupDate);
        }
      }

      const agentGaps = calculateBackupGaps(
        backupDates,
        startDate,
        endDate,
        comp.name,
        "agent",
        comp.jobName || "N/A"
      );

      return { sessions, gaps: agentGaps };
    }, 5
  );

  for (const result of agentResults) {
    allSessions.push(...result.sessions);
    allGaps.push(...result.gaps);
  }

  // ── Processar File Shares (em lotes paralelos) ──
  const fsResults = await processBatch(
    fileShares.filter(fs => (fs as any).fileShareUid || (fs as any).fileShareUidInVbr),
    async (fs) => {
      const uid = (fs as any).fileShareUid || (fs as any).fileShareUidInVbr;
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

      if (!resp.ok) return { sessions: [] as BackupSession[], gaps: [] as BackupGap[] };

      const data = await readJsonSafely<any>(resp);
      const backups: any[] = filterBackupsByDate(data.items || [], startDate, endDate);
      const sessions: BackupSession[] = [];
      const backupDates: string[] = [];

      for (const backup of backups) {
        const backupDate = backup.creationTime || backup.backupDate;

        sessions.push({
          sessionId: backup.uid || `fs-${uid}-${backupDate}`,
          jobName: fs.jobName || "N/A",
          jobUid: fs.jobUid || "",
          workloadName: fs.name,
          workloadType: "fileshare",
          status: backup.status || "Unknown",
          startTime: backupDate || "",
          endTime: backup.endTime,
          durationSec: Number(backup.durationSec || 0),
          errorMessage: backup.failureMessage || backup.errorMessage || undefined,
          transferredBytes: Number(backup.sizeBytes || 0),
        });

        if (backupDate) {
          backupDates.push(backupDate);
        }
      }

      const fsGaps = calculateBackupGaps(
        backupDates,
        startDate,
        endDate,
        fs.name,
        "fileshare",
        fs.jobName || "N/A"
      );

      return { sessions, gaps: fsGaps };
    }, 5
  );

  for (const result of fsResults) {
    allSessions.push(...result.sessions);
    allGaps.push(...result.gaps);
  }

  // Construir resumo por JOB
  const jobSummary = buildJobSummary(allSessions, allGaps, jobs);

  // Contadores (passagem única)
  let failedSessions = 0;
  let warningSessions = 0;
  let successSessions = 0;
  for (const s of allSessions) {
    const st = s.status.toLowerCase();
    if (st === "failed" || st === "error") failedSessions++;
    else if (st === "warning") warningSessions++;
    else if (st === "success") successSessions++;
  }

  const jobsWithFailures = jobSummary.filter(j => j.failedCount > 0).length;
  const jobsWithGaps = jobSummary.filter(j => j.gaps.length > 0).length;

  return {
    sessions: allSessions,
    gaps: allGaps,
    totalJobs: jobSummary.length,
    totalWorkloads: vms.length + computers.length + fileShares.length,
    totalSessions: allSessions.length,
    failedSessions,
    warningSessions,
    successSessions,
    jobsWithFailures,
    jobsWithGaps,
    periodStart: startDate,
    periodEnd: endDate,
    jobSummary,
  };
}


