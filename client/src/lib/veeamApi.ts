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
  DailyBackupStatus,
  WeeklyJobRow,
  WeekBlock,
  WeeklyBackupData,
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
 * Busca jobs de um tipo específico da API do Veeam ONE.
 * Fallback silencioso: retorna [] se o endpoint não existir (404/400).
 */
async function fetchJobsByType(
  apiUrl: string,
  token: string,
  jobType: string,
  startDate?: string,
  endDate?: string
): Promise<VeeamJob[]> {
  const params = new URLSearchParams({ skip: "0", limit: "1000" });

  const response = await veeamRequest(
    apiUrl,
    `/api/v2.2/vbrJobs/${jobType}?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    // Endpoint pode não existir para este tipo de job — fallback silencioso
    if (response.status === 404 || response.status === 400) {
      console.warn(`Endpoint /vbrJobs/${jobType} não disponível (${response.status}). Ignorando.`);
      return [];
    }
    const errorMessage = await getApiErrorMessage(response);
    throw new Error(`Erro ao buscar jobs (${jobType}): ${errorMessage}`);
  }

  const data = await readJsonSafely<any>(response);
  const jobs: VeeamJob[] = data.items || [];

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
 * Função para obter todos os jobs de backup (VMs, Agents e File Shares).
 * Busca os 3 tipos de jobs e unifica os resultados.
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

  const [vmJobs, agentJobs, fsJobs] = await Promise.all([
    fetchJobsByType(apiUrl, token, "vmBackupJobs", startDate, endDate),
    fetchJobsByType(apiUrl, token, "agentBackupJobs", startDate, endDate).catch(() => {
      console.warn("Endpoint agentBackupJobs não disponível. Ignorando.");
      return [] as VeeamJob[];
    }),
    fetchJobsByType(apiUrl, token, "fileShareBackupJobs", startDate, endDate).catch(() => {
      console.warn("Endpoint fileShareBackupJobs não disponível. Ignorando.");
      return [] as VeeamJob[];
    }),
  ]);

  return [...vmJobs, ...agentJobs, ...fsJobs];
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
 * O gap é a diferença em dias entre o lastProtectedDate e o periodEnd.
 */
export function calculateBackupGaps(
  lastProtectedDate: string | undefined,
  periodStart: string,
  periodEnd: string,
  workloadName: string,
  workloadType: WorkloadType,
  jobName: string
): BackupGap[] {
  const gaps: BackupGap[] = [];
  const end = new Date(periodEnd + "T23:59:59Z");
  const start = new Date(periodStart + "T00:00:00Z");

  if (!lastProtectedDate) {
    // Sem backup registrado
    const gapDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (gapDays >= 1) {
      gaps.push({
        workloadName,
        workloadType,
        gapStart: periodStart,
        gapEnd: periodEnd,
        gapDays,
        jobName,
      });
    }
    return gaps;
  }

  const lastBackup = new Date(lastProtectedDate);
  if (Number.isNaN(lastBackup.getTime())) return gaps;

  // O início do gap é o dia seguinte ao último backup
  const gapStartDate = new Date(lastBackup);
  gapStartDate.setDate(gapStartDate.getDate() + 1);
  const startOfGap = new Date(gapStartDate.toISOString().split("T")[0] + "T00:00:00Z");

  if (startOfGap <= end) {
    const gapDays = Math.ceil((end.getTime() - startOfGap.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (gapDays >= 1) {
      gaps.push({
        workloadName,
        workloadType,
        gapStart: startOfGap.toISOString().split("T")[0],
        gapEnd: periodEnd,
        gapDays,
        jobName,
        lastBackupDate: lastBackup.toISOString(),
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
        lastProtectedDate: undefined,
        gaps: [],
        maxGapDays: 0,
        errors: [],
      });
    }

    const wl = jobEntry.workloadMap.get(wlKey)!;
    wl.totalSessions++;

    if (session.lastProtectedDate && !wl.lastProtectedDate) {
      wl.lastProtectedDate = session.lastProtectedDate;
    }

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
        lastBackupDate: gap.lastBackupDate,
        lastProtectedDate: undefined,
        gaps: [],
        maxGapDays: 0,
        errors: [],
      });
    }

    const wl = jobEntry.workloadMap.get(wlKey)!;
    wl.gaps.push(gap);
    if (gap.lastBackupDate && !wl.lastBackupDate) {
      wl.lastBackupDate = gap.lastBackupDate;
    }
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

    // Inconsistente = job cujo status geral é Success mas tem workloads com falha real
    // OU job com status Failed/Error
    const workloadsWithFailures = workloads.filter(w => w.failedCount > 0).length;
    const jobIsFailed = entry.jobStatus.toLowerCase() === 'failed' || entry.jobStatus.toLowerCase() === 'error';
    const inconsistentWorkloads = jobIsFailed ? 1 : workloadsWithFailures;

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
      inconsistentWorkloads,
      workloadsWithFailures,
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
 * Agrupado por JOB (= cliente). Usa status real dos Jobs.
 * Filtra workloads apenas pelos jobNames do período selecionado.
 */
export async function fetchFailuresData(
  config: VeeamConfig
): Promise<FailuresData> {
  const { apiUrl, username, password, startDate, endDate } = config;

  // Autenticar
  const token = await getVeeamToken(apiUrl, username, password);

  // Buscar jobs e workloads em paralelo
  const [allJobs, allVMs, allComputers, allFileShares] = await Promise.all([
    getVeeamJobs(apiUrl, token, startDate, endDate).catch(() => {
      console.warn("Não foi possível buscar jobs. Continuando sem dados de job.");
      return [] as VeeamJob[];
    }),
    getVeeamVMs(apiUrl, token),
    getVeeamComputers(apiUrl, token),
    getVeeamFileShares(apiUrl, token),
  ]);

  // ── Usar todos os jobs retornados (já filtrados por período em getVeeamJobs) ──
  const jobs = allJobs;

  // Helper: extrair UID do job independente do tipo (VM ou Agent)
  const getJobUid = (job: VeeamJob): string =>
    job.vmBackupJobUid || job.agentBackupJobUid || (job as any).fileShareBackupJobUid || "";

  // ── Filtrar workloads apenas pelos Jobs ativos do período ──
  const jobNameSet = new Set(jobs.map(j => j.name));
  const vms = allVMs.filter(vm => jobNameSet.has(vm.jobName));
  const computers = allComputers.filter(c => jobNameSet.has(c.jobName || ""));
  const fileShares = allFileShares.filter(f => jobNameSet.has(f.jobName || ""));

  // ── Mapa de jobName -> lastRun para gaps (BUG 7: Running = data de hoje) ──
  const jobLastRunMap = new Map<string, string>();
  for (const job of jobs) {
    if (job.lastRun) {
      const isRunning = job.status?.toLowerCase() === "running";
      jobLastRunMap.set(job.name, isRunning ? new Date().toISOString() : job.lastRun);
    }
  }

  // ── Construir Sessões e Gaps consolidados ──
  const allSessions: BackupSession[] = [];
  const allGaps: BackupGap[] = [];

  for (const job of jobs) {
    const jobUid = getJobUid(job);
    const isAgent = !!job.agentBackupJobUid && !job.vmBackupJobUid;
    const isFileShare = !!(job as any).fileShareBackupJobUid;
    const defaultWType: WorkloadType = isAgent ? "agent" : isFileShare ? "fileshare" : "vm";
    
    // Workloads deste job
    const jobVms = vms.filter(v => v.jobName === job.name);
    const jobComps = computers.filter(c => c.jobName === job.name);
    const jobFs = fileShares.filter(f => f.jobName === job.name);
    
    const workloadsForJob = [
      ...jobVms.map(v => ({ name: v.name, type: "vm" as WorkloadType, uid: v.vmUidInVbr, lastProt: v.lastProtectedDate })),
      ...jobComps.map(c => ({ name: c.name, type: "agent" as WorkloadType, uid: c.computerUid || c.name, lastProt: c.lastProtectedDate })),
      ...jobFs.map(f => ({ name: f.name, type: "fileshare" as WorkloadType, uid: (f as any).fileShareUid || f.name, lastProt: (f as any).lastProtectedDate }))
    ];

    const jobSt = (job.status || "Unknown").toLowerCase();
    const isFailed = jobSt === "failed" || jobSt === "error";
    // BUG 6: Erro real vindo da API
    const errorMessage = isFailed
      ? (job.details && job.details.length > 0 ? job.details[0] : `Job "${job.name}" falhou`)
      : undefined;

    if (workloadsForJob.length === 0) {
      // 🔴 BUG 1 FIX: Workload sintético para Job Órfão
      allSessions.push({
        sessionId: jobUid,
        jobName: job.name,
        jobUid: jobUid,
        workloadName: job.name, 
        workloadType: defaultWType,
        status: job.status || "Unknown",
        startTime: job.lastRun || "",
        endTime: "",
        durationSec: job.lastRunDurationSec || 0,
        errorMessage,
      });

      // Gerar gap sintético
      const gapLastRun = jobLastRunMap.get(job.name) || job.lastRun;
      allGaps.push(...calculateBackupGaps(gapLastRun, startDate, endDate, job.name, defaultWType, job.name));
    } else {
      // 🔴 BUG 2 FIX: Uma sessão por workload, mas com o status unificado do Job
      for (const w of workloadsForJob) {
        allSessions.push({
          sessionId: `${jobUid}-${w.uid}`,
          jobName: job.name,
          jobUid: jobUid,
          workloadName: w.name,
          workloadType: w.type,
          status: job.status || "Unknown",
          startTime: job.lastRun || "",
          endTime: "",
          durationSec: job.lastRunDurationSec || 0,
          errorMessage,
        });

        // ── Calcular Gap deste workload ──
        const workloadLastRun = jobLastRunMap.get(job.name) || w.lastProt;
        allGaps.push(...calculateBackupGaps(workloadLastRun, startDate, endDate, w.name, w.type, job.name));
      }
    }
  }

  // Construir resumo por JOB
  const jobSummary = buildJobSummary(allSessions, allGaps, jobs);

  // Contadores diretos das sessões
  let failedSessions = 0;
  let warningSessions = 0;
  let successSessions = 0;
  for (const s of allSessions) {
    const st = s.status.toLowerCase();
    // 🟡 BUG 3 FIX: Ignorar 'running' para não inflar as contagens nem taxas
    if (st === "running") continue; 
    
    if (st === "failed" || st === "error") failedSessions++;
    else if (st === "warning") warningSessions++;
    else if (st === "success") successSessions++;
  }

  const jobsWithFailures = jobSummary.filter(j => j.failedCount > 0).length;
  const jobsInconsistent = jobSummary.filter(j => j.inconsistentWorkloads > 0).length;
  const jobsWithGaps = jobSummary.filter(j => j.gaps.length > 0).length;

  return {
    sessions: allSessions,
    gaps: allGaps,
    totalJobs: jobs.length,
    totalWorkloads: vms.length + computers.length + fileShares.length,
    totalSessions: allSessions.length,
    failedSessions,
    warningSessions,
    successSessions,
    jobsWithFailures,
    jobsInconsistent,
    jobsWithGaps,
    periodStart: startDate,
    periodEnd: endDate,
    jobSummary,
  };
}

/**
 * Gera dados do Backup Semanal (14 dias) usando inferência de restore points.
 * Para cada VM, infere quais dias tiveram backup usando restorePoints + lastProtectedDate.
 */
export async function fetchWeeklyBackupData(
  config: VeeamConfig
): Promise<WeeklyBackupData> {
  const { apiUrl, username, password } = config;
  const token = await getVeeamToken(apiUrl, username, password);

  // Período fixo: últimos 14 dias a partir de hoje
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
  fourteenDaysAgo.setHours(0, 0, 0, 0);

  const periodStart = fourteenDaysAgo.toISOString().split("T")[0];
  const periodEnd = today.toISOString().split("T")[0];

  // Gerar array de 14 dias
  const allDates: string[] = [];
  for (let d = new Date(fourteenDaysAgo); d <= today; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split("T")[0]);
  }

  // Buscar jobs e workloads
  const [jobs, allVMs] = await Promise.all([
    getVeeamJobs(apiUrl, token).catch(() => [] as VeeamJob[]),
    getVeeamVMs(apiUrl, token),
  ]);

  // Mapa jobName -> VMs
  const jobVMsMap = new Map<string, VeeamVM[]>();
  for (const vm of allVMs) {
    if (!vm.jobName) continue;
    if (!jobVMsMap.has(vm.jobName)) jobVMsMap.set(vm.jobName, []);
    jobVMsMap.get(vm.jobName)!.push(vm);
  }

  // Para cada job, buscar restore points das VMs e inferir datas
  const weeklyRows: WeeklyJobRow[] = [];

  // Processar em lotes de 5 jobs
  const BATCH_SIZE = 5;
  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const batch = jobs.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (job) => {
        const jobUid = job.vmBackupJobUid || job.agentBackupJobUid || "";
        const vmsForJob = jobVMsMap.get(job.name) || [];

        // Coletar datas com backup (union de todos os RPs de todas VMs do job)
        const backupDatesSet = new Set<string>();

        for (const vm of vmsForJob) {
          try {
            const bkResp = await veeamRequest(
              apiUrl,
              `/api/v2.2/protectedData/virtualMachines/${vm.vmUidInVbr}/backups?skip=0&limit=10`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              }
            );
            if (bkResp.ok) {
              const bkData = await readJsonSafely<any>(bkResp);
              for (const bk of bkData.items || []) {
                const rpCount = Number(bk.restorePoints) || 0;
                const lastProt = bk.lastProtectedDate;
                if (lastProt && rpCount > 0) {
                  // Inferir datas retroativas a partir de lastProtectedDate
                  const lpDate = new Date(lastProt);
                  for (let d = 0; d < rpCount; d++) {
                    const rpDate = new Date(lpDate);
                    rpDate.setDate(rpDate.getDate() - d);
                    backupDatesSet.add(rpDate.toISOString().split("T")[0]);
                  }
                }
              }
            }
          } catch {
            // Ignorar VMs com erro
          }
        }

        // Se não temos VMs, usar lastRun do job como fallback
        if (vmsForJob.length === 0 && job.lastRun) {
          const lastRunDate = new Date(job.lastRun).toISOString().split("T")[0];
          backupDatesSet.add(lastRunDate);
        }

        // Construir array de dias para este job
        const days: DailyBackupStatus[] = allDates.map(date => {
          const d = new Date(date + "T12:00:00Z");
          return {
            date,
            dayOfWeek: d.getDay(),
            hasBackup: backupDatesSet.has(date),
            inPeriod: true,
          };
        });

        const successDays = days.filter(d => d.hasBackup).length;
        const missingDays = days.filter(d => !d.hasBackup).length;

        return {
          jobName: job.name,
          jobStatus: job.status || "Unknown",
          totalWorkloads: vmsForJob.length,
          days,
          successDays,
          missingDays,
        } as WeeklyJobRow;
      })
    );
    weeklyRows.push(...batchResults);
  }

  // Agrupar por semana (seg-dom)
  const weeks: WeekBlock[] = [];
  let weekStart = new Date(fourteenDaysAgo);
  // Ajustar para segunda-feira
  const dayOfWeek = weekStart.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  weekStart.setDate(weekStart.getDate() + mondayOffset);

  while (weekStart <= today) {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const wsStr = weekStart.toISOString().split("T")[0];
    const weStr = weekEnd.toISOString().split("T")[0];

    const formatBR = (d: Date) => {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      return `${dd}/${mm}`;
    };

    const weekLabel = `Semana (${formatBR(weekStart)} - ${formatBR(weekEnd)})`;

    // Filtrar dias de cada job para esta semana
    const weekJobs: WeeklyJobRow[] = weeklyRows.map(row => {
      const weekDays = row.days.filter(d => d.date >= wsStr && d.date <= weStr);
      return {
        ...row,
        days: weekDays,
        successDays: weekDays.filter(d => d.hasBackup).length,
        missingDays: weekDays.filter(d => !d.hasBackup).length,
      };
    });

    // Só incluir semana se tem pelo menos 1 dia no período
    if (weekJobs.some(j => j.days.length > 0)) {
      weeks.push({
        weekLabel,
        startDate: wsStr,
        endDate: weStr,
        jobs: weekJobs,
      });
    }

    weekStart.setDate(weekStart.getDate() + 7);
  }

  // Totais
  const totalDays = weeklyRows.reduce((s, r) => s + r.days.length, 0);
  const totalSuccessDays = weeklyRows.reduce((s, r) => s + r.successDays, 0);
  const totalMissingDays = weeklyRows.reduce((s, r) => s + r.missingDays, 0);

  return {
    weeks,
    totalJobs: jobs.length,
    totalDays,
    totalSuccessDays,
    totalMissingDays,
    coverageRate: totalDays > 0 ? (totalSuccessDays / totalDays) * 100 : 0,
    periodStart,
    periodEnd,
  };
}
