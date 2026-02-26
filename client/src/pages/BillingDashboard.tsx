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
  const jobGroups = (() => {
    const map = new Map<string, {
      jobName: string;
      vms: { name: string; usedSourceSizeBytes: number; backupCount: number }[];
      totalBytes: number;
      totalBackups: number;
    }>();
    for (const vm of billingData.vms) {
      const jobKey = vm.jobName || "Sem Job";
      const existing = map.get(jobKey);
      const vmBackups = billingData.backups.filter(b => b.vmName === vm.name);
      const vmEntry = {
        name: vm.name,
        usedSourceSizeBytes: vm.usedSourceSizeBytes || 0,
        backupCount: vmBackups.length,
      };
      if (existing) {
        existing.vms.push(vmEntry);
        existing.totalBytes += vmEntry.usedSourceSizeBytes;
        existing.totalBackups += vmEntry.backupCount;
      } else {
        map.set(jobKey, {
          jobName: jobKey,
          vms: [vmEntry],
          totalBytes: vmEntry.usedSourceSizeBytes,
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
  type WorkloadEntry = { name: string; usedSourceSizeBytes: number; backupCount: number };
  type JobGroup = { jobName: string; items: WorkloadEntry[]; totalBytes: number; totalBackups: number };

  const agentGroups: JobGroup[] = (() => {
    const map = new Map<string, JobGroup>();
    for (const comp of (billingData.computers || [])) {
      const jobKey = comp.jobName || "Sem Job";
      const entry: WorkloadEntry = {
        name: comp.name,
        usedSourceSizeBytes: comp.usedSourceSizeBytes || 0,
        backupCount: comp.backupCount || 0,
      };
      const existing = map.get(jobKey);
      if (existing) {
        existing.items.push(entry);
        existing.totalBytes += entry.usedSourceSizeBytes;
        existing.totalBackups += entry.backupCount;
      } else {
        map.set(jobKey, { jobName: jobKey, items: [entry], totalBytes: entry.usedSourceSizeBytes, totalBackups: entry.backupCount });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  })();

  const grandTotalAgentBytes = agentGroups.reduce((sum, g) => sum + g.totalBytes, 0);
  const grandTotalAgentBackups = agentGroups.reduce((sum, g) => sum + g.totalBackups, 0);
  const grandTotalAgents = agentGroups.reduce((sum, g) => sum + g.items.length, 0);

  // Consolidação de File Shares agrupado por Job
  const fileShareGroups: JobGroup[] = (() => {
    const map = new Map<string, JobGroup>();
    for (const fs of (billingData.fileShares || [])) {
      const jobKey = fs.jobName || "Sem Job";
      const entry: WorkloadEntry = {
        name: fs.name,
        usedSourceSizeBytes: fs.usedSourceSizeBytes || 0,
        backupCount: fs.backupCount || 0,
      };
      const existing = map.get(jobKey);
      if (existing) {
        existing.items.push(entry);
        existing.totalBytes += entry.usedSourceSizeBytes;
        existing.totalBackups += entry.backupCount;
      } else {
        map.set(jobKey, { jobName: jobKey, items: [entry], totalBytes: entry.usedSourceSizeBytes, totalBackups: entry.backupCount });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalBytes - a.totalBytes);
  })();

  const grandTotalFileShareBytes = fileShareGroups.reduce((sum, g) => sum + g.totalBytes, 0);
  const grandTotalFileShareBackups = fileShareGroups.reduce((sum, g) => sum + g.totalBackups, 0);
  const grandTotalFileShares = fileShareGroups.reduce((sum, g) => sum + g.items.length, 0);

  const grandTotalAllBytes = grandTotalBytes + grandTotalAgentBytes + grandTotalFileShareBytes;

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

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-40">
        <div className="container py-4 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Veeam Billing Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Período: {config.startDate} a {config.endDate}
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
                        <th className="text-right py-2 px-2">Tamanho Usado</th>
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
                            {formatBytes(vm.usedSourceSizeBytes)}
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
                        <th className="text-right py-2 px-2">Tamanho Usado</th>
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
                            {formatBytes(comp.usedSourceSizeBytes)}
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
                        <th className="text-right py-2 px-2">Tamanho Usado</th>
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
                            {formatBytes(fs.usedSourceSizeBytes)}
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
                                const vmGb = vm.usedSourceSizeBytes / (1024 * 1024 * 1024);
                                const vmCost = vmGb * unitPrice;
                                return (
                                  <tr key={`vm-${gIdx}-${vIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{vm.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{vm.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(vm.usedSourceSizeBytes)}</td>
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
                                const itemGb = item.usedSourceSizeBytes / (1024 * 1024 * 1024);
                                const itemCost = itemGb * unitPrice;
                                return (
                                  <tr key={`agent-item-${gIdx}-${iIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{item.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{item.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(item.usedSourceSizeBytes)}</td>
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
                                const itemGb = item.usedSourceSizeBytes / (1024 * 1024 * 1024);
                                const itemCost = itemGb * unitPrice;
                                return (
                                  <tr key={`fs-item-${gIdx}-${iIdx}`} className="border-b hover:bg-muted/20 text-muted-foreground">
                                    <td className="py-1.5 px-2 pl-8">{item.name}</td>
                                    <td className="py-1.5 px-2 text-right">—</td>
                                    <td className="py-1.5 px-2 text-right">{item.backupCount}</td>
                                    <td className="py-1.5 px-2 text-right">{formatBytes(item.usedSourceSizeBytes)}</td>
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
        </Tabs>
      </div>
    </div>
  );
}
