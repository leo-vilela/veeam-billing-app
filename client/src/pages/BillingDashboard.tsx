import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Server,
  HardDrive,
  Zap,
  DollarSign,
  Download,
  RotateCcw,
  Monitor,
  Folder,
} from "lucide-react";
import { BillingData, VeeamConfig } from "@/types/veeam";
import { formatBytes, calculateBilling } from "@/lib/veeamApi";

interface BillingDashboardProps {
  billingData: BillingData;
  config: VeeamConfig;
  onReset: () => void;
  isLoading?: boolean;
}

export default function BillingDashboard({
  billingData,
  config,
  onReset,
  isLoading = false,
}: BillingDashboardProps) {
  const [unitPrice, setUnitPrice] = useState(0.05);
  const isLegacyLicenseMode = billingData.billingMode === "legacy-license";
  const licenseInstances = billingData.legacySummary?.instances ?? 0;

  const totalCost = isLegacyLicenseMode
    ? licenseInstances * unitPrice
    : calculateBilling(billingData.totalVolumeBytes, unitPrice);
  const totalGB = billingData.totalVolumeBytes / (1024 * 1024 * 1024);

  // Dados para gráfico de jobs
  const jobsData = billingData.jobs.map((job) => ({
    name: job.name.substring(0, 20),
    duration: job.avgDurationSec / 60, // em minutos
    size: job.lastTransferredDataBytes / (1024 * 1024 * 1024), // em GB
  }));

  // Dados para gráfico de VMs
  const vmsData = billingData.vms.slice(0, 10).map((vm) => ({
    name: vm.name.substring(0, 15),
    size: vm.usedSourceSizeBytes / (1024 * 1024 * 1024), // em GB
  }));

  // Dados para gráfico de status
  const statusData = [
    {
      name: "Sucesso",
      value: billingData.jobs.filter((j) => j.status === "Success").length,
    },
    {
      name: "Aviso",
      value: billingData.jobs.filter((j) => j.status === "Warning").length,
    },
    {
      name: "Falha",
      value: billingData.jobs.filter((j) => j.status === "Failed").length,
    },
  ];

  const COLORS = ["#10b981", "#f59e0b", "#ef4444"];

  // Consolidação de backups de VMs agrupado por Job
  // Usa o volume real dos backups retidos (sizeBytes) e não o tamanho de origem
  const jobGroups = (() => {
    const map = new Map<string, {
      jobName: string;
      vms: { name: string; retainedBytes: number; backupCount: number }[];
      totalBytes: number;
      totalBackups: number;
    }>();
    for (const vm of billingData.vms) {
      const jobKey = vm.jobName || "Sem Job";
      const existing = map.get(jobKey);
      const vmBackups = billingData.backups.filter(b => b.vmName === vm.name);
      const retainedBytes = vmBackups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
      const vmEntry = {
        name: vm.name,
        retainedBytes,
        backupCount: vmBackups.length,
      };
      if (existing) {
        existing.vms.push(vmEntry);
        existing.totalBytes += vmEntry.retainedBytes;
        existing.totalBackups += vmEntry.backupCount;
      } else {
        map.set(jobKey, {
          jobName: jobKey,
          vms: [vmEntry],
          totalBytes: vmEntry.retainedBytes,
          totalBackups: vmEntry.backupCount,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  })();

  const grandTotalBytes = jobGroups.reduce((sum, g) => sum + g.totalBytes, 0);
  const grandTotalBackups = jobGroups.reduce((sum, g) => sum + g.totalBackups, 0);
  const grandTotalVMs = jobGroups.reduce((sum, g) => sum + g.vms.length, 0);

  // Consolidação de Agents (computadores) agrupado por Job
  // Usa o volume real dos backups retidos
  type WorkloadEntry = { name: string; retainedBytes: number; backupCount: number };
  type JobGroup = { jobName: string; items: WorkloadEntry[]; totalBytes: number; totalBackups: number };

  const agentGroups: JobGroup[] = (() => {
    const map = new Map<string, JobGroup>();
    for (const comp of (billingData.computers || [])) {
      const jobKey = comp.jobName || "Sem Job";
      const compBackups = billingData.backups.filter(b => b.vmName === comp.name);
      const retainedBytes = compBackups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
      const entry: WorkloadEntry = {
        name: comp.name,
        retainedBytes,
        backupCount: compBackups.length || comp.backupCount || 0,
      };
      const existing = map.get(jobKey);
      if (existing) {
        existing.items.push(entry);
        existing.totalBytes += entry.retainedBytes;
        existing.totalBackups += entry.backupCount;
      } else {
        map.set(jobKey, { jobName: jobKey, items: [entry], totalBytes: entry.retainedBytes, totalBackups: entry.backupCount });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  })();

  const grandTotalAgentBytes = agentGroups.reduce((sum, g) => sum + g.totalBytes, 0);
  const grandTotalAgentBackups = agentGroups.reduce((sum, g) => sum + g.totalBackups, 0);
  const grandTotalAgents = agentGroups.reduce((sum, g) => sum + g.items.length, 0);

  // Consolidação de File Shares agrupado por Job
  // Usa o volume real dos backups retidos
  const fileShareGroups: JobGroup[] = (() => {
    const map = new Map<string, JobGroup>();
    for (const fs of (billingData.fileShares || [])) {
      const jobKey = fs.jobName || "Sem Job";
      const fsBackups = billingData.backups.filter(b => b.vmName === fs.name);
      const retainedBytes = fsBackups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
      const entry: WorkloadEntry = {
        name: fs.name,
        retainedBytes,
        backupCount: fsBackups.length || fs.backupCount || 0,
      };
      const existing = map.get(jobKey);
      if (existing) {
        existing.items.push(entry);
        existing.totalBytes += entry.retainedBytes;
        existing.totalBackups += entry.backupCount;
      } else {
        map.set(jobKey, { jobName: jobKey, items: [entry], totalBytes: entry.retainedBytes, totalBackups: entry.backupCount });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  })();

  const grandTotalFileShareBytes = fileShareGroups.reduce((sum, g) => sum + g.totalBytes, 0);
  const grandTotalFileShareBackups = fileShareGroups.reduce((sum, g) => sum + g.totalBackups, 0);
  const grandTotalFileShares = fileShareGroups.reduce((sum, g) => sum + g.items.length, 0);

  const grandTotalAllBytes = grandTotalBytes + grandTotalAgentBytes + grandTotalFileShareBytes;

  // Mapas de retainedBytes por workload para as abas individuais
  const retainedByWorkload = new Map<string, number>();
  const backupCountByWorkload = new Map<string, number>();
  for (const backup of billingData.backups) {
    const key = backup.vmName;
    retainedByWorkload.set(key, (retainedByWorkload.get(key) || 0) + (backup.sizeBytes || 0));
    backupCountByWorkload.set(key, (backupCountByWorkload.get(key) || 0) + 1);
  }

  const handleExportCSV = () => {
    let csv = "Relatório de Cobrança Veeam\n";
    csv += `Período: ${config.startDate} a ${config.endDate}\n\n`;
    csv += `Total de Jobs,${billingData.jobCount}\n`;
    csv += `Total de VMs,${billingData.vmCount}\n`;
    csv += `Total de Agentes,${billingData.computerCount || 0}\n`;
    csv += `Total de File Shares,${billingData.fileShareCount || 0}\n`;
    csv += `Total de Backups,${billingData.backupCount}\n`;
    csv += isLegacyLicenseMode
      ? `Instâncias Licenciadas,${licenseInstances}\n`
      : `Volume Total,${formatBytes(billingData.totalVolumeBytes)}\n`;
    csv += isLegacyLicenseMode
      ? `Preço por Instância (R$),${unitPrice.toFixed(2)}\n`
      : `Preço por GB (R$),${unitPrice.toFixed(2)}\n`;
    csv += `Custo Estimado (R$),${totalCost.toFixed(2)}\n\n`;

    csv += "Jobs\n";
    csv += "Nome,Status,Última Execução,Duração (s),Dados Transferidos\n";
    billingData.jobs.forEach((job) => {
      csv += `"${job.name}",${job.status},${job.lastRun},${job.lastRunDurationSec},${formatBytes(job.lastTransferredDataBytes)}\n`;
    });

    csv += "\nVMs\n";
    csv += "Nome,Plataforma,Tamanho Usado,Data Última Proteção\n";
    billingData.vms.forEach((vm) => {
      csv += `"${vm.name}",${vm.platform},${formatBytes(vm.usedSourceSizeBytes)},${vm.lastProtectedDate}\n`;
    });

    csv += "\nAgentes\n";
    csv += "Nome,Sistema,Tamanho Usado,Data Última Proteção\n";
    (billingData.computers || []).forEach((c) => {
      csv += `"${c.name}",${c.platform || "N/A"},${formatBytes(c.usedSourceSizeBytes)},${c.lastProtectedDate || "N/A"}\n`;
    });

    csv += "\nFile Shares\n";
    csv += "Nome,Tipo,Tamanho Usado,Data Última Proteção\n";
    (billingData.fileShares || []).forEach((fs) => {
      csv += `"${fs.name}",${fs.platform || "N/A"},${formatBytes(fs.usedSourceSizeBytes)},${fs.lastProtectedDate || "N/A"}\n`;
    });

    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/csv;charset=utf-8," + encodeURIComponent(csv)
    );
    element.setAttribute("download", "veeam-billing-report.csv");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleExportConsolidadoCSV = () => {
    const toGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(2);
    const toCost = (bytes: number) => (bytes / (1024 * 1024 * 1024) * unitPrice).toFixed(2);
    const SEP = ";";
    const HEADER = ["Tipo", "Job / Workload", "Qtd", "Backups Retidos", "Tamanho Total", "Volume (GB)", "Valor a Cobrar (R$)"].join(SEP);

    let csv = `Relatório Consolidado de Backups Retidos\n`;
    csv += `Período de Referência${SEP}${config.startDate} a ${config.endDate}\n`;
    if (config.jobFilter && config.jobFilter.trim().length >= 3) {
      csv += `Filtro de Job${SEP}${config.jobFilter.trim()}\n`;
    }
    csv += `Preço por GB (R$)${SEP}${unitPrice.toFixed(2)}\n`;
    csv += `\n`;

    // ── Seção VMs ──
    csv += `=== JOB / VMs ===\n`;
    csv += `${HEADER}\n`;
    for (const group of jobGroups) {
      csv += `VM${SEP}"${group.jobName}"${SEP}${group.vms.length}${SEP}${group.totalBackups}${SEP}${formatBytes(group.totalBytes)}${SEP}${toGB(group.totalBytes)}${SEP}${toCost(group.totalBytes)}\n`;
      for (const vm of group.vms) {
        csv += `${SEP}  "${vm.name}"${SEP}—${SEP}${vm.backupCount}${SEP}${formatBytes(vm.retainedBytes)}${SEP}${toGB(vm.retainedBytes)}${SEP}${toCost(vm.retainedBytes)}\n`;
      }
    }
    csv += `Subtotal VMs${SEP}${SEP}${grandTotalVMs}${SEP}${grandTotalBackups}${SEP}${formatBytes(grandTotalBytes)}${SEP}${toGB(grandTotalBytes)}${SEP}${toCost(grandTotalBytes)}\n`;
    csv += `\n`;

    // ── Seção Agents ──
    csv += `=== JOB / AGENTS ===\n`;
    csv += `${HEADER}\n`;
    if (agentGroups.length === 0) {
      csv += `${SEP}Nenhum Agent encontrado.\n`;
    } else {
      for (const group of agentGroups) {
        csv += `Agent${SEP}"${group.jobName}"${SEP}${group.items.length}${SEP}${group.totalBackups}${SEP}${formatBytes(group.totalBytes)}${SEP}${toGB(group.totalBytes)}${SEP}${toCost(group.totalBytes)}\n`;
        for (const item of group.items) {
          csv += `${SEP}  "${item.name}"${SEP}—${SEP}${item.backupCount}${SEP}${formatBytes(item.retainedBytes)}${SEP}${toGB(item.retainedBytes)}${SEP}${toCost(item.retainedBytes)}\n`;
        }
      }
    }
    csv += `Subtotal Agents${SEP}${SEP}${grandTotalAgents}${SEP}${grandTotalAgentBackups}${SEP}${formatBytes(grandTotalAgentBytes)}${SEP}${toGB(grandTotalAgentBytes)}${SEP}${toCost(grandTotalAgentBytes)}\n`;
    csv += `\n`;

    // ── Seção File Shares ──
    csv += `=== JOB / FILE SHARES ===\n`;
    csv += `${HEADER}\n`;
    if (fileShareGroups.length === 0) {
      csv += `${SEP}Nenhum File Share encontrado.\n`;
    } else {
      for (const group of fileShareGroups) {
        csv += `FileShare${SEP}"${group.jobName}"${SEP}${group.items.length}${SEP}${group.totalBackups}${SEP}${formatBytes(group.totalBytes)}${SEP}${toGB(group.totalBytes)}${SEP}${toCost(group.totalBytes)}\n`;
        for (const item of group.items) {
          csv += `${SEP}  "${item.name}"${SEP}—${SEP}${item.backupCount}${SEP}${formatBytes(item.retainedBytes)}${SEP}${toGB(item.retainedBytes)}${SEP}${toCost(item.retainedBytes)}\n`;
        }
      }
    }
    csv += `Subtotal File Shares${SEP}${SEP}${grandTotalFileShares}${SEP}${grandTotalFileShareBackups}${SEP}${formatBytes(grandTotalFileShareBytes)}${SEP}${toGB(grandTotalFileShareBytes)}${SEP}${toCost(grandTotalFileShareBytes)}\n`;
    csv += `\n`;

    // ── TOTAL GERAL ──
    csv += `TOTAL GERAL (VMs + Agents + File Shares)${SEP}${SEP}${grandTotalVMs + grandTotalAgents + grandTotalFileShares}${SEP}${grandTotalBackups + grandTotalAgentBackups + grandTotalFileShareBackups}${SEP}${formatBytes(grandTotalAllBytes)}${SEP}${toGB(grandTotalAllBytes)}${SEP}${toCost(grandTotalAllBytes)}\n`;

    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv)
    );
    element.setAttribute("download", "veeam-backup-consolidado.csv");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-40">
        <div className="container py-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Veeam Billing Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Período: {config.startDate} a {config.endDate}
              {config.jobFilter && config.jobFilter.trim().length >= 3 && (
                <span className="ml-2 text-primary font-medium">
                  · Filtro: &quot;{config.jobFilter.trim()}&quot;
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={isLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportConsolidadoCSV}
              disabled={isLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar Consolidado
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onReset}
              disabled={isLoading}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Voltar
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container py-8">
        {isLegacyLicenseMode && (
          <Alert className="mb-4">
            <AlertDescription>
              Billing calculado por licenciamento legado (instâncias). Jobs/VMs/backups detalhados não estão disponíveis nesta API. Instâncias: {licenseInstances}
              {billingData.legacySummary?.licenseType
                ? ` | Tipo: ${billingData.legacySummary.licenseType}`
                : ""}
              {billingData.legacySummary?.product && billingData.legacySummary?.version
                ? ` | Produto: ${billingData.legacySummary.product} ${billingData.legacySummary.version}`
                : ""}
            </AlertDescription>
          </Alert>
        )}

        {billingData.licensingUsage && (
          <Alert className="mb-4 bg-primary/10 border-primary/20">
            <AlertDescription>
              <span className="font-semibold block mb-1">Dados de Licenciamento (API v2.2):</span>
              <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(billingData.licensingUsage, null, 2)}</pre>
            </AlertDescription>
          </Alert>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isLegacyLicenseMode ? "Jobs (indisponível)" : "Total de Jobs"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {isLegacyLicenseMode ? "-" : billingData.jobCount}
                </div>
                <Zap className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isLegacyLicenseMode ? "Instâncias Licenciadas" : "Total de VMs"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {isLegacyLicenseMode ? licenseInstances : billingData.vmCount}
                </div>
                <Server className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Agentes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {billingData.computerCount || 0}
                </div>
                <Monitor className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de File Shares
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {billingData.fileShareCount || 0}
                </div>
                <Folder className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {isLegacyLicenseMode ? "Unidades Faturáveis" : "Volume Total"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {isLegacyLicenseMode ? `${totalGB.toFixed(0)} instâncias` : `${totalGB.toFixed(2)} GB`}
                </div>
                <HardDrive className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Custo Estimado
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  R$ {totalCost.toFixed(2)}
                </div>
                <DollarSign className="h-8 w-8 text-primary/60" />
              </div>
              <div className="mt-3 space-y-2">
                <Label htmlFor="unitPrice" className="text-xs text-muted-foreground">
                  {isLegacyLicenseMode ? "Preço por instância (R$)" : "Preço por GB (R$)"}
                </Label>
                <Input
                  id="unitPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={Number.isFinite(unitPrice) ? unitPrice : 0}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    setUnitPrice(Number.isFinite(parsed) ? parsed : 0);
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {isLegacyLicenseMode
                  ? `Base: R$ ${unitPrice.toFixed(2)} por instância`
                  : `Base: R$ ${unitPrice.toFixed(2)} por GB`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="vms">VMs</TabsTrigger>
            <TabsTrigger value="computers">Agent</TabsTrigger>
            <TabsTrigger value="fileshares">File Shares</TabsTrigger>
            <TabsTrigger value="backups">Backups Consolidado</TabsTrigger>
            <TabsTrigger value="execucoes">Cadeia de Backup</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Jobs Duration Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Duração Média dos Jobs</CardTitle>
                  <CardDescription>
                    Tempo médio de execução em minutos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={jobsData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="duration" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>Distribuição de Status</CardTitle>
                  <CardDescription>
                    Status dos jobs de backup
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={statusData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* VMs Size Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Top 10 VMs por Tamanho</CardTitle>
                <CardDescription>
                  Máquinas virtuais com maior volume de dados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={vmsData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="size" fill="#06b6d4" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Jobs Tab */}
          <TabsContent value="jobs">
            <Card>
              <CardHeader>
                <CardTitle>Lista de Jobs</CardTitle>
                <CardDescription>
                  Total de {billingData.jobCount} jobs de backup
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Nome</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Plataforma</th>
                        <th className="text-left py-2 px-2">Última Execução</th>
                        <th className="text-right py-2 px-2">Dados Transferidos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingData.jobs.map((job) => (
                        <tr key={job.vmBackupJobUid} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{job.name}</td>
                          <td className="py-2 px-2">
                            <Badge
                              variant={
                                job.status === "Success"
                                  ? "default"
                                  : job.status === "Warning"
                                    ? "secondary"
                                    : "destructive"
                              }
                            >
                              {job.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-2">{job.platform}</td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">
                            {new Date(job.lastRun).toLocaleDateString()}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatBytes(job.lastTransferredDataBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* VMs Tab */}
          <TabsContent value="vms">
            <Card>
              <CardHeader>
                <CardTitle>Lista de VMs Protegidas</CardTitle>
                <CardDescription>
                  Total de {billingData.vmCount} máquinas virtuais
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Nome</th>
                        <th className="text-left py-2 px-2">Plataforma</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-right py-2 px-2">Volume Retido</th>
                        <th className="text-right py-2 px-2">Backups</th>
                        <th className="text-left py-2 px-2">Última Proteção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingData.vms.map((vm) => (
                        <tr key={vm.vmUidInVbr} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{vm.name}</td>
                          <td className="py-2 px-2">{vm.platform}</td>
                          <td className="py-2 px-2 text-sm text-muted-foreground">
                            {vm.jobName}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatBytes(retainedByWorkload.get(vm.name) || 0)}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {backupCountByWorkload.get(vm.name) || 0}
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">
                            {new Date(vm.lastProtectedDate).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Computers Tab */}
          <TabsContent value="computers">
            <Card>
              <CardHeader>
                <CardTitle>Lista de Computadores Protegidos</CardTitle>
                <CardDescription>
                  Total de {billingData.computerCount || 0} Veeam Agents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Nome</th>
                        <th className="text-left py-2 px-2">Sistema</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-right py-2 px-2">Volume Retido</th>
                        <th className="text-right py-2 px-2">Backups</th>
                        <th className="text-left py-2 px-2">Última Proteção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(billingData.computers || []).map((comp, idx) => (
                        <tr key={comp.computerUid || idx} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{comp.name}</td>
                          <td className="py-2 px-2">{comp.platform || "N/A"}</td>
                          <td className="py-2 px-2 text-sm text-muted-foreground">
                            {comp.jobName || "N/A"}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatBytes(retainedByWorkload.get(comp.name) || 0)}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {backupCountByWorkload.get(comp.name) || 0}
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">
                            {comp.lastProtectedDate ? new Date(comp.lastProtectedDate).toLocaleDateString() : "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* File Shares Tab */}
          <TabsContent value="fileshares">
            <Card>
              <CardHeader>
                <CardTitle>Lista de File Shares Protegidos</CardTitle>
                <CardDescription>
                  Total de {billingData.fileShareCount || 0} Compartilhamentos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Nome</th>
                        <th className="text-left py-2 px-2">Plataforma</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-right py-2 px-2">Volume Retido</th>
                        <th className="text-right py-2 px-2">Backups</th>
                        <th className="text-left py-2 px-2">Última Proteção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(billingData.fileShares || []).map((fs, idx) => (
                        <tr key={fs.fileShareUid || idx} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">{fs.name}</td>
                          <td className="py-2 px-2">{fs.platform || "N/A"}</td>
                          <td className="py-2 px-2 text-sm text-muted-foreground">
                            {fs.jobName || "N/A"}
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatBytes(retainedByWorkload.get(fs.name) || 0)}
                          </td>
                          <td className="py-2 px-2 text-right text-muted-foreground">
                            {backupCountByWorkload.get(fs.name) || 0}
                          </td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">
                            {fs.lastProtectedDate ? new Date(fs.lastProtectedDate).toLocaleDateString() : "N/A"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Backups Consolidado Tab */}
          <TabsContent value="backups">
            <Card>
              <CardHeader>
                <CardTitle>Backups Consolidado</CardTitle>
                <CardDescription>
                  {jobGroups.length} jobs-VMs | {grandTotalVMs} VMs &nbsp;·&nbsp;
                  {agentGroups.length} jobs-Agents | {grandTotalAgents} Agents &nbsp;·&nbsp;
                  {fileShareGroups.length} jobs-FS | {grandTotalFileShares} File Shares &nbsp;·&nbsp;
                  Base: R$ {unitPrice.toFixed(2)}/GB
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-8">

                {/* ── Seção VMs ── */}
                <div>
                  <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary/70" /> Job / VMs
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Job / VM</th>
                          <th className="text-right py-2 px-2">VMs</th>
                          <th className="text-right py-2 px-2">Backups Retidos</th>
                          <th className="text-right py-2 px-2">Tamanho Total</th>
                          <th className="text-right py-2 px-2">Volume (GB)</th>
                          <th className="text-right py-2 px-2">Valor a Cobrar (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {jobGroups.map((group, gIdx) => {
                          const jobGb = group.totalBytes / (1024 * 1024 * 1024);
                          const jobCost = jobGb * unitPrice;
                          return (
                            <>
                              <tr key={`job-${gIdx}`} className="bg-muted/40 border-b font-semibold">
                                <td className="py-2 px-2">
                                  <Zap className="inline h-4 w-4 mr-1 text-primary/70" />
                                  {group.jobName}
                                </td>
                                <td className="py-2 px-2 text-right">{group.vms.length}</td>
                                <td className="py-2 px-2 text-right">{group.totalBackups}</td>
                                <td className="py-2 px-2 text-right">{formatBytes(group.totalBytes)}</td>
                                <td className="py-2 px-2 text-right">{jobGb.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-primary">R$ {jobCost.toFixed(2)}</td>
                              </tr>
                              {group.vms.map((vm, vIdx) => {
                                const vmGb = vm.retainedBytes / (1024 * 1024 * 1024);
                                const vmCost = vmGb * unitPrice;
                                return (
                                  <tr key={`vm-${gIdx}-${vIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{vm.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{vm.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(vm.retainedBytes)}</td>
                                    <td className="py-1.5 px-2 text-right">{vmGb.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right">R$ {vmCost.toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 font-semibold bg-muted/20">
                        <tr>
                          <td className="py-2 px-2">Subtotal VMs</td>
                          <td className="py-2 px-2 text-right">{grandTotalVMs}</td>
                          <td className="py-2 px-2 text-right">{grandTotalBackups}</td>
                          <td className="py-2 px-2 text-right">{formatBytes(grandTotalBytes)}</td>
                          <td className="py-2 px-2 text-right">{(grandTotalBytes / (1024 * 1024 * 1024)).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-primary">R$ {(grandTotalBytes / (1024 * 1024 * 1024) * unitPrice).toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* ── Seção Agents ── */}
                <div>
                  <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-primary/70" /> Job / Agents
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Job / Agente</th>
                          <th className="text-right py-2 px-2">Agentes</th>
                          <th className="text-right py-2 px-2">Backups Retidos</th>
                          <th className="text-right py-2 px-2">Tamanho Total</th>
                          <th className="text-right py-2 px-2">Volume (GB)</th>
                          <th className="text-right py-2 px-2">Valor a Cobrar (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agentGroups.length === 0 ? (
                          <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Nenhum Agent encontrado.</td></tr>
                        ) : agentGroups.map((group, gIdx) => {
                          const jobGb = group.totalBytes / (1024 * 1024 * 1024);
                          const jobCost = jobGb * unitPrice;
                          return (
                            <>
                              <tr key={`agent-job-${gIdx}`} className="bg-muted/40 border-b font-semibold">
                                <td className="py-2 px-2">
                                  <Zap className="inline h-4 w-4 mr-1 text-primary/70" />
                                  {group.jobName}
                                </td>
                                <td className="py-2 px-2 text-right">{group.items.length}</td>
                                <td className="py-2 px-2 text-right">{group.totalBackups}</td>
                                <td className="py-2 px-2 text-right">{formatBytes(group.totalBytes)}</td>
                                <td className="py-2 px-2 text-right">{jobGb.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-primary">R$ {jobCost.toFixed(2)}</td>
                              </tr>
                              {group.items.map((item, iIdx) => {
                                const itemGb = item.retainedBytes / (1024 * 1024 * 1024);
                                const itemCost = itemGb * unitPrice;
                                return (
                                  <tr key={`agent-item-${gIdx}-${iIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{item.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{item.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(item.retainedBytes)}</td>
                                    <td className="py-1.5 px-2 text-right">{itemGb.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right">R$ {itemCost.toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 font-semibold bg-muted/20">
                        <tr>
                          <td className="py-2 px-2">Subtotal Agents</td>
                          <td className="py-2 px-2 text-right">{grandTotalAgents}</td>
                          <td className="py-2 px-2 text-right">{grandTotalAgentBackups}</td>
                          <td className="py-2 px-2 text-right">{formatBytes(grandTotalAgentBytes)}</td>
                          <td className="py-2 px-2 text-right">{(grandTotalAgentBytes / (1024 * 1024 * 1024)).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-primary">R$ {(grandTotalAgentBytes / (1024 * 1024 * 1024) * unitPrice).toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* ── Seção File Shares ── */}
                <div>
                  <h3 className="text-base font-semibold mb-2 flex items-center gap-2">
                    <Folder className="h-4 w-4 text-primary/70" /> Job / File Shares
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr>
                          <th className="text-left py-2 px-2">Job / File Share</th>
                          <th className="text-right py-2 px-2">File Shares</th>
                          <th className="text-right py-2 px-2">Backups Retidos</th>
                          <th className="text-right py-2 px-2">Tamanho Total</th>
                          <th className="text-right py-2 px-2">Volume (GB)</th>
                          <th className="text-right py-2 px-2">Valor a Cobrar (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fileShareGroups.length === 0 ? (
                          <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Nenhum File Share encontrado.</td></tr>
                        ) : fileShareGroups.map((group, gIdx) => {
                          const jobGb = group.totalBytes / (1024 * 1024 * 1024);
                          const jobCost = jobGb * unitPrice;
                          return (
                            <>
                              <tr key={`fs-job-${gIdx}`} className="bg-muted/40 border-b font-semibold">
                                <td className="py-2 px-2">
                                  <Zap className="inline h-4 w-4 mr-1 text-primary/70" />
                                  {group.jobName}
                                </td>
                                <td className="py-2 px-2 text-right">{group.items.length}</td>
                                <td className="py-2 px-2 text-right">{group.totalBackups}</td>
                                <td className="py-2 px-2 text-right">{formatBytes(group.totalBytes)}</td>
                                <td className="py-2 px-2 text-right">{jobGb.toFixed(2)}</td>
                                <td className="py-2 px-2 text-right text-primary">R$ {jobCost.toFixed(2)}</td>
                              </tr>
                              {group.items.map((item, iIdx) => {
                                const itemGb = item.retainedBytes / (1024 * 1024 * 1024);
                                const itemCost = itemGb * unitPrice;
                                return (
                                  <tr key={`fs-item-${gIdx}-${iIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{item.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{item.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(item.retainedBytes)}</td>
                                    <td className="py-1.5 px-2 text-right">{itemGb.toFixed(2)}</td>
                                    <td className="py-1.5 px-2 text-right">R$ {itemCost.toFixed(2)}</td>
                                  </tr>
                                );
                              })}
                            </>
                          );
                        })}
                      </tbody>
                      <tfoot className="border-t-2 font-semibold bg-muted/20">
                        <tr>
                          <td className="py-2 px-2">Subtotal File Shares</td>
                          <td className="py-2 px-2 text-right">{grandTotalFileShares}</td>
                          <td className="py-2 px-2 text-right">{grandTotalFileShareBackups}</td>
                          <td className="py-2 px-2 text-right">{formatBytes(grandTotalFileShareBytes)}</td>
                          <td className="py-2 px-2 text-right">{(grandTotalFileShareBytes / (1024 * 1024 * 1024)).toFixed(2)}</td>
                          <td className="py-2 px-2 text-right text-primary">R$ {(grandTotalFileShareBytes / (1024 * 1024 * 1024) * unitPrice).toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* ── TOTAL GERAL ── */}
                <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-base">TOTAL GERAL (VMs + Agents + File Shares)</p>
                      <p className="text-sm text-muted-foreground">
                        {grandTotalVMs} VMs · {grandTotalAgents} Agents · {grandTotalFileShares} File Shares
                        &nbsp;·&nbsp; {(grandTotalAllBytes / (1024 * 1024 * 1024)).toFixed(2)} GB
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-primary">
                        R$ {(grandTotalAllBytes / (1024 * 1024 * 1024) * unitPrice).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatBytes(grandTotalAllBytes)}</p>
                    </div>
                  </div>
                </div>

              </CardContent>
            </Card>
          </TabsContent>

          {/* Execuções do Período Tab */}
          <TabsContent value="execucoes">
            <Card>
              <CardHeader>
                <CardTitle>Backups Ativos no Período</CardTitle>
                <CardDescription>
                  Cadeias de backup com atividade entre {config.startDate} e {config.endDate}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {(() => {
                  // Filtrar backups cuja lastProtectedDate está no período
                  const pStart = config.startDate;
                  const pEnd = config.endDate;

                  const periodBackups = billingData.backups.filter((b) => {
                    if (!b.backupDate) return false;
                    const dateStr = typeof b.backupDate === "string"
                      ? b.backupDate.substring(0, 10)
                      : "";
                    return dateStr >= pStart && dateStr <= pEnd;
                  });

                  // Mapear workload → jobName
                  const workloadJobMap = new Map<string, string>();
                  for (const vm of billingData.vms) workloadJobMap.set(vm.name, vm.jobName || "Sem Job");
                  for (const c of (billingData.computers || [])) workloadJobMap.set(c.name, c.jobName || "Sem Job");
                  for (const f of (billingData.fileShares || [])) workloadJobMap.set(f.name, f.jobName || "Sem Job");

                  // Agrupar: Job → Servidor → Backups[]
                  type BackupEntry = {
                    date: string;
                    sizeBytes: number;
                    latestSizeBytes: number;
                    restorePoints: number;
                    status: string;
                    jobName: string;
                  };
                  const jobMap = new Map<string, Map<string, BackupEntry[]>>();

                  for (const b of periodBackups) {
                    const jobName = b.jobName || workloadJobMap.get(b.vmName) || "Sem Job";
                    const serverName = b.vmName;
                    if (!jobMap.has(jobName)) jobMap.set(jobName, new Map());
                    const serverMap = jobMap.get(jobName)!;
                    if (!serverMap.has(serverName)) serverMap.set(serverName, []);
                    serverMap.get(serverName)!.push({
                      date: b.backupDate,
                      sizeBytes: b.sizeBytes || 0,
                      latestSizeBytes: b.latestSizeBytes || 0,
                      restorePoints: b.restorePoints || 0,
                      status: b.status || "Success",
                      jobName,
                    });
                  }

                  // Ordenar por data mais recente
                  for (const [, serverMap] of Array.from(jobMap.entries())) {
                    for (const [, backups] of Array.from(serverMap.entries())) {
                      backups.sort((x: BackupEntry, y: BackupEntry) => new Date(y.date).getTime() - new Date(x.date).getTime());
                    }
                  }

                  const jobEntries = Array.from(jobMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

                  if (periodBackups.length === 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <p>Nenhum backup com atividade no período selecionado.</p>
                        <p className="text-xs mt-2">
                          Total de cadeias disponíveis: {billingData.backups.length}
                          {billingData.backups.length > 0 && billingData.backups[0].backupDate &&
                            ` · Exemplo de data: ${billingData.backups[0].backupDate}`
                          }
                        </p>
                      </div>
                    );
                  }

                  const totalRestorePoints = periodBackups.reduce((s, b) => s + (b.restorePoints || 0), 0);

                  return (
                    <>
                      <div className="text-sm text-muted-foreground mb-4">
                        {periodBackups.length} cadeias de backup em {jobEntries.length} jobs · {totalRestorePoints} restore points · Volume total retido: {formatBytes(periodBackups.reduce((s, b) => s + (b.sizeBytes || 0), 0))}
                      </div>
                      {jobEntries.map(([jobName, serverMap]) => {
                        const servers = Array.from(serverMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                        const jobTotalBytes = servers.reduce((s, [, bks]) => s + bks.reduce((ss, b) => ss + b.sizeBytes, 0), 0);
                        const jobTotalRP = servers.reduce((s, [, bks]) => s + bks.reduce((ss, b) => ss + b.restorePoints, 0), 0);
                        return (
                          <div key={jobName} className="border rounded-lg">
                            <div className="bg-muted/50 px-4 py-3 flex items-center justify-between rounded-t-lg">
                              <div>
                                <p className="font-semibold text-sm">{jobName}</p>
                                <p className="text-xs text-muted-foreground">
                                  {servers.length} servidores · {jobTotalRP} restore points · {formatBytes(jobTotalBytes)}
                                </p>
                              </div>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b bg-muted/20">
                                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Servidor</th>
                                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Último Backup</th>
                                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Restore Points</th>
                                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Volume Total</th>
                                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Último Ponto</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {servers.map(([serverName, backups]) => {
                                    // Se o servidor tem múltiplas cadeias, somar
                                    const totalSize = backups.reduce((s, b) => s + b.sizeBytes, 0);
                                    const totalRP = backups.reduce((s, b) => s + b.restorePoints, 0);
                                    const latestDate = backups[0]?.date;
                                    const latestSize = backups.reduce((s, b) => s + b.latestSizeBytes, 0);
                                    return (
                                      <tr key={serverName} className="border-b hover:bg-muted/30">
                                        <td className="py-2 px-3 font-medium">{serverName}</td>
                                        <td className="py-2 px-3">
                                          {latestDate ? new Date(latestDate).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "N/A"}
                                        </td>
                                        <td className="py-2 px-3 text-right">{totalRP}</td>
                                        <td className="py-2 px-3 text-right">{formatBytes(totalSize)}</td>
                                        <td className="py-2 px-3 text-right text-muted-foreground">{formatBytes(latestSize)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                                <tfoot>
                                  <tr className="border-t font-medium">
                                    <td className="py-2 px-3">{servers.length} servidores</td>
                                    <td></td>
                                    <td className="py-2 px-3 text-right">{jobTotalRP}</td>
                                    <td className="py-2 px-3 text-right">{formatBytes(jobTotalBytes)}</td>
                                    <td></td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
