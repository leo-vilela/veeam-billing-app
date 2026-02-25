import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
  const [pricePerGB, setPricePerGB] = useState(0.05);

  const totalCost = calculateBilling(billingData.totalVolumeBytes, pricePerGB);
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

  const handleExportCSV = () => {
    let csv = "Relatório de Cobrança Veeam\n";
    csv += `Período: ${config.startDate} a ${config.endDate}\n\n`;
    csv += `Total de Jobs,${billingData.jobCount}\n`;
    csv += `Total de VMs,${billingData.vmCount}\n`;
    csv += `Total de Backups,${billingData.backupCount}\n`;
    csv += `Volume Total,${formatBytes(billingData.totalVolumeBytes)}\n`;
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
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {billingData.jobCount}
                </div>
                <Zap className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de VMs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">
                  {billingData.vmCount}
                </div>
                <Server className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Volume Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-2xl font-bold">
                  {totalGB.toFixed(2)} GB
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
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="vms">VMs</TabsTrigger>
            <TabsTrigger value="backups">Backups</TabsTrigger>
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

          {/* Backups Tab */}
          <TabsContent value="backups">
            <Card>
              <CardHeader>
                <CardTitle>Histórico de Backups</CardTitle>
                <CardDescription>
                  Total de {billingData.backupCount} backups realizados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">VM</th>
                        <th className="text-left py-2 px-2">Data do Backup</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-right py-2 px-2">Tamanho</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingData.backups.slice(0, 50).map((backup, idx) => (
                        <tr key={idx} className="border-b hover:bg-muted/50">
                          <td className="py-2 px-2 font-medium">
                            {backup.vmName}
                          </td>
                          <td className="py-2 px-2 text-sm text-muted-foreground">
                            {new Date(backup.backupDate).toLocaleString()}
                          </td>
                          <td className="py-2 px-2">
                            <Badge
                              variant={
                                backup.status === "Success"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {backup.status}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-right">
                            {formatBytes(backup.sizeBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {billingData.backups.length > 50 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Mostrando 50 de {billingData.backups.length} backups
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
