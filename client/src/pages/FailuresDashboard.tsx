import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  ShieldAlert,
  Server,
  Monitor,
  Folder,
  Download,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { FailuresData, VeeamConfig, WorkloadFailureSummary } from "@/types/veeam";

interface FailuresDashboardProps {
  failuresData: FailuresData;
  config: VeeamConfig;
  onReset: () => void;
  isLoading?: boolean;
}

const WORKLOAD_ICONS: Record<string, React.ReactNode> = {
  vm: <Server className="h-4 w-4" />,
  agent: <Monitor className="h-4 w-4" />,
  fileshare: <Folder className="h-4 w-4" />,
};

const WORKLOAD_LABELS: Record<string, string> = {
  vm: "VM",
  agent: "Agent",
  fileshare: "File Share",
};

function getStatusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "success") {
    return <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200 hover:bg-emerald-500/20">{status}</Badge>;
  }
  if (s === "warning") {
    return <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 hover:bg-amber-500/20">{status}</Badge>;
  }
  if (s === "failed" || s === "error") {
    return <Badge className="bg-red-500/10 text-red-600 border-red-200 hover:bg-red-500/20">{status}</Badge>;
  }
  return <Badge variant="secondary">{status}</Badge>;
}

export default function FailuresDashboard({
  failuresData,
  config,
  onReset,
  isLoading = false,
}: FailuresDashboardProps) {
  const [activeGapFilter, setActiveGapFilter] = useState<string>("all");

  const totalRate = failuresData.totalSessions > 0
    ? ((failuresData.successSessions / failuresData.totalSessions) * 100).toFixed(1)
    : "100.0";

  // Dados para gráfico de pizza de status
  const statusPieData = [
    { name: "Sucesso", value: failuresData.successSessions },
    { name: "Aviso", value: failuresData.warningSessions },
    { name: "Falha", value: failuresData.failedSessions },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444"];

  // Top 10 workloads com mais falhas
  const topFailures = failuresData.workloadSummary
    .filter(w => w.failedCount > 0)
    .slice(0, 10)
    .map(w => ({
      name: w.workloadName.length > 18 ? w.workloadName.substring(0, 18) + "…" : w.workloadName,
      fullName: w.workloadName,
      falhas: w.failedCount,
      avisos: w.warningCount,
      tipo: WORKLOAD_LABELS[w.workloadType] || w.workloadType,
    }));

  // Top 10 workloads com maiores lacunas
  const topGaps = failuresData.workloadSummary
    .filter(w => w.maxGapDays > 0)
    .sort((a, b) => b.maxGapDays - a.maxGapDays)
    .slice(0, 10)
    .map(w => ({
      name: w.workloadName.length > 18 ? w.workloadName.substring(0, 18) + "…" : w.workloadName,
      fullName: w.workloadName,
      diasSemBackup: w.maxGapDays,
      tipo: WORKLOAD_LABELS[w.workloadType] || w.workloadType,
    }));

  // Filtragem de gaps
  const filteredGaps = activeGapFilter === "all"
    ? failuresData.gaps
    : failuresData.gaps.filter(g => g.workloadType === activeGapFilter);

  // Maior lacuna
  const biggestGap = failuresData.gaps.length > 0
    ? failuresData.gaps.reduce((max, g) => g.gapDays > max.gapDays ? g : max, failuresData.gaps[0])
    : null;

  // ── Exportar CSV ──
  const handleExportCSV = () => {
    let csv = "Relatório de Falhas e Lacunas de Backup Veeam\n";
    csv += `Período: ${config.startDate} a ${config.endDate}\n\n`;
    csv += `Total de Workloads,${failuresData.totalWorkloads}\n`;
    csv += `Total de Sessões,${failuresData.totalSessions}\n`;
    csv += `Sessões com Falha,${failuresData.failedSessions}\n`;
    csv += `Sessões com Aviso,${failuresData.warningSessions}\n`;
    csv += `Sessões com Sucesso,${failuresData.successSessions}\n`;
    csv += `Taxa de Sucesso,${totalRate}%\n`;
    csv += `Workloads com Lacunas,${failuresData.workloadsWithGaps}\n\n`;

    csv += "Falhas por Workload\n";
    csv += "Workload,Tipo,Job,Total Sessões,Falhas,Avisos,Sucessos,Taxa de Falha (%),Maior Lacuna (dias),Último Backup,Erros\n";
    for (const w of failuresData.workloadSummary) {
      csv += `"${w.workloadName}",${w.workloadType},"${w.jobName}",${w.totalSessions},${w.failedCount},${w.warningCount},${w.successCount},${w.failureRate.toFixed(1)},${w.maxGapDays},${w.lastBackupDate || "N/A"},"${w.errors.join('; ')}"\n`;
    }

    csv += "\nLacunas de Backup\n";
    csv += "Workload,Tipo,Job,Início da Lacuna,Fim da Lacuna,Dias sem Backup\n";
    for (const g of failuresData.gaps) {
      csv += `"${g.workloadName}",${g.workloadType},"${g.jobName}",${g.gapStart},${g.gapEnd},${g.gapDays}\n`;
    }

    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/csv;charset=utf-8," + encodeURIComponent(csv)
    );
    element.setAttribute("download", "veeam-failures-report.csv");
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
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <ShieldAlert className="h-8 w-8 text-destructive" />
              Relatório de Falhas de Backup
            </h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Workloads Analisados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{failuresData.totalWorkloads}</div>
                <Server className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total de Sessões
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{failuresData.totalSessions}</div>
                <Clock className="h-8 w-8 text-primary/60" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-red-600">
                Sessões com Falha
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-red-600">{failuresData.failedSessions}</div>
                <XCircle className="h-8 w-8 text-red-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-amber-600">
                Sessões com Aviso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-amber-600">{failuresData.warningSessions}</div>
                <AlertTriangle className="h-8 w-8 text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-emerald-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-emerald-600">
                Taxa de Sucesso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-emerald-600">{totalRate}%</div>
                <TrendingUp className="h-8 w-8 text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-violet-200 bg-violet-50/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-violet-600">
                Com Lacunas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-violet-600">{failuresData.workloadsWithGaps}</div>
                <ShieldAlert className="h-8 w-8 text-violet-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="workloads">Falhas por Workload</TabsTrigger>
            <TabsTrigger value="gaps">Lacunas de Backup</TabsTrigger>
            <TabsTrigger value="sessions">Todas as Sessões</TabsTrigger>
          </TabsList>

          {/* ── Overview Tab ── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Status Pie */}
              <Card>
                <CardHeader>
                  <CardTitle>Distribuição de Status</CardTitle>
                  <CardDescription>
                    Status de todas as sessões de backup no período
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statusPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={statusPieData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {statusPieData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">Nenhuma sessão encontrada.</p>
                  )}
                </CardContent>
              </Card>

              {/* Top Failures Bar */}
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Workloads com Mais Falhas</CardTitle>
                  <CardDescription>
                    Workloads com maior número de sessões falhadas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {topFailures.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={topFailures} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-background border rounded-lg p-2 shadow-lg text-sm">
                                  <p className="font-semibold">{data.fullName}</p>
                                  <p className="text-muted-foreground">{data.tipo}</p>
                                  <p className="text-red-600">Falhas: {data.falhas}</p>
                                  <p className="text-amber-600">Avisos: {data.avisos}</p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Bar dataKey="falhas" fill="#ef4444" name="Falhas" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">Nenhuma falha encontrada no período. 🎉</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Top Gaps Bar */}
            <Card>
              <CardHeader>
                <CardTitle>Top 10 Workloads com Maiores Lacunas</CardTitle>
                <CardDescription>
                  Workloads com mais dias consecutivos sem backup
                </CardDescription>
              </CardHeader>
              <CardContent>
                {topGaps.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topGaps}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis label={{ value: "Dias", angle: -90, position: "insideLeft", style: { fontSize: 12 } }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            return (
                              <div className="bg-background border rounded-lg p-2 shadow-lg text-sm">
                                <p className="font-semibold">{data.fullName}</p>
                                <p className="text-muted-foreground">{data.tipo}</p>
                                <p className="text-violet-600">Maior lacuna: {data.diasSemBackup} dias</p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="diasSemBackup" fill="#8b5cf6" name="Dias sem Backup" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Nenhuma lacuna detectada. Todos os workloads possuem backup diário. 🎉</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Falhas por Workload Tab ── */}
          <TabsContent value="workloads">
            <Card>
              <CardHeader>
                <CardTitle>Falhas por Workload</CardTitle>
                <CardDescription>
                  Detalhamento de falhas, avisos e lacunas agrupado por workload —
                  {" "}{failuresData.workloadSummary.length} workloads analisados
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Workload</th>
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-right py-2 px-2">Sessões</th>
                        <th className="text-right py-2 px-2">Falhas</th>
                        <th className="text-right py-2 px-2">Avisos</th>
                        <th className="text-right py-2 px-2">Taxa Falha</th>
                        <th className="text-right py-2 px-2">Maior Lacuna</th>
                        <th className="text-left py-2 px-2">Último Backup</th>
                        <th className="text-left py-2 px-2">Erros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failuresData.workloadSummary.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-8 text-center text-muted-foreground">
                            Nenhum workload encontrado.
                          </td>
                        </tr>
                      ) : (
                        failuresData.workloadSummary.map((w, idx) => (
                          <tr key={`wl-${idx}`} className={`border-b hover:bg-muted/50 ${w.failedCount > 0 ? "bg-red-50/30" : ""}`}>
                            <td className="py-2 px-2 font-medium flex items-center gap-1.5">
                              {WORKLOAD_ICONS[w.workloadType]}
                              {w.workloadName}
                            </td>
                            <td className="py-2 px-2">
                              <Badge variant="outline" className="text-xs">
                                {WORKLOAD_LABELS[w.workloadType] || w.workloadType}
                              </Badge>
                            </td>
                            <td className="py-2 px-2 text-muted-foreground text-xs">{w.jobName}</td>
                            <td className="py-2 px-2 text-right">{w.totalSessions}</td>
                            <td className="py-2 px-2 text-right">
                              {w.failedCount > 0 ? (
                                <span className="text-red-600 font-semibold">{w.failedCount}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right">
                              {w.warningCount > 0 ? (
                                <span className="text-amber-600 font-semibold">{w.warningCount}</span>
                              ) : (
                                <span className="text-muted-foreground">0</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right">
                              <span className={`font-semibold ${w.failureRate > 50 ? "text-red-600" : w.failureRate > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                {w.failureRate.toFixed(1)}%
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right">
                              {w.maxGapDays > 0 ? (
                                <span className="text-violet-600 font-semibold">{w.maxGapDays}d</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-xs text-muted-foreground">
                              {w.lastBackupDate
                                ? new Date(w.lastBackupDate).toLocaleDateString()
                                : "N/A"}
                            </td>
                            <td className="py-2 px-2 text-xs max-w-[200px] truncate" title={w.errors.join("; ")}>
                              {w.errors.length > 0 ? (
                                <span className="text-red-600">{w.errors[0]}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Lacunas de Backup Tab ── */}
          <TabsContent value="gaps" className="space-y-4">
            {/* Destaque da maior lacuna */}
            {biggestGap && (
              <Card className="border-violet-200 bg-violet-50/50">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-full p-2 bg-violet-100">
                        <ShieldAlert className="h-6 w-6 text-violet-600" />
                      </div>
                      <div>
                        <p className="font-bold text-violet-900">
                          Maior lacuna detectada: {biggestGap.gapDays} dias
                        </p>
                        <p className="text-sm text-violet-700">
                          {biggestGap.workloadName} ({WORKLOAD_LABELS[biggestGap.workloadType]})
                          — de {biggestGap.gapStart} a {biggestGap.gapEnd}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Lacunas de Backup (Períodos sem Proteção)</CardTitle>
                <CardDescription>
                  {failuresData.gaps.length} lacunas detectadas em {failuresData.workloadsWithGaps} workloads
                </CardDescription>
                <div className="flex gap-2 pt-2">
                  {["all", "vm", "agent", "fileshare"].map(filter => (
                    <Button
                      key={filter}
                      variant={activeGapFilter === filter ? "default" : "outline"}
                      size="sm"
                      onClick={() => setActiveGapFilter(filter)}
                    >
                      {filter === "all" ? "Todos" : WORKLOAD_LABELS[filter]}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Workload</th>
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-left py-2 px-2">Início da Lacuna</th>
                        <th className="text-left py-2 px-2">Fim da Lacuna</th>
                        <th className="text-right py-2 px-2">Dias sem Backup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGaps.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-muted-foreground">
                            Nenhuma lacuna encontrada{activeGapFilter !== "all" ? ` para ${WORKLOAD_LABELS[activeGapFilter]}` : ""}. 🎉
                          </td>
                        </tr>
                      ) : (
                        filteredGaps
                          .sort((a, b) => b.gapDays - a.gapDays)
                          .map((gap, idx) => (
                            <tr key={`gap-${idx}`} className={`border-b hover:bg-muted/50 ${gap.gapDays >= 7 ? "bg-red-50/30" : gap.gapDays >= 3 ? "bg-amber-50/30" : ""}`}>
                              <td className="py-2 px-2 font-medium flex items-center gap-1.5">
                                {WORKLOAD_ICONS[gap.workloadType]}
                                {gap.workloadName}
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {WORKLOAD_LABELS[gap.workloadType] || gap.workloadType}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-muted-foreground text-xs">{gap.jobName}</td>
                              <td className="py-2 px-2">{gap.gapStart}</td>
                              <td className="py-2 px-2">{gap.gapEnd}</td>
                              <td className="py-2 px-2 text-right">
                                <span className={`font-bold ${gap.gapDays >= 7 ? "text-red-600" : gap.gapDays >= 3 ? "text-amber-600" : "text-violet-600"}`}>
                                  {gap.gapDays}
                                </span>
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Todas as Sessões Tab ── */}
          <TabsContent value="sessions">
            <Card>
              <CardHeader>
                <CardTitle>Todas as Sessões de Backup</CardTitle>
                <CardDescription>
                  {failuresData.totalSessions} sessões no período — mostrando as 200 mais recentes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Workload</th>
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-left py-2 px-2">Data</th>
                        <th className="text-left py-2 px-2">Erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failuresData.sessions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-8 text-center text-muted-foreground">
                            Nenhuma sessão encontrada.
                          </td>
                        </tr>
                      ) : (
                        failuresData.sessions
                          .sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""))
                          .slice(0, 200)
                          .map((session, idx) => (
                            <tr key={`session-${idx}`} className={`border-b hover:bg-muted/50 ${session.status.toLowerCase() === "failed" ? "bg-red-50/30" : ""}`}>
                              <td className="py-2 px-2 font-medium flex items-center gap-1.5">
                                {WORKLOAD_ICONS[session.workloadType]}
                                {session.workloadName}
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {WORKLOAD_LABELS[session.workloadType] || session.workloadType}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-muted-foreground text-xs">{session.jobName}</td>
                              <td className="py-2 px-2">{getStatusBadge(session.status)}</td>
                              <td className="py-2 px-2 text-xs text-muted-foreground">
                                {session.startTime
                                  ? new Date(session.startTime).toLocaleString()
                                  : "N/A"}
                              </td>
                              <td className="py-2 px-2 text-xs max-w-[250px] truncate" title={session.errorMessage || ""}>
                                {session.errorMessage ? (
                                  <span className="text-red-600">{session.errorMessage}</span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>
    </div>
  );
}
