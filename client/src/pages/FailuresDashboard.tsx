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
  Zap,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { FailuresData, VeeamConfig, JobFailureSummary } from "@/types/veeam";

interface FailuresDashboardProps {
  failuresData: FailuresData;
  config: VeeamConfig;
  onReset: () => void;
  isLoading?: boolean;
}

const WORKLOAD_ICONS: Record<string, React.ReactNode> = {
  vm: <Server className="h-3.5 w-3.5" />,
  agent: <Monitor className="h-3.5 w-3.5" />,
  fileshare: <Folder className="h-3.5 w-3.5" />,
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
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [activeGapFilter, setActiveGapFilter] = useState<string>("all");

  const totalRate = failuresData.totalSessions > 0
    ? ((failuresData.successSessions / failuresData.totalSessions) * 100).toFixed(1)
    : "100.0";

  const toggleJob = (jobName: string) => {
    setExpandedJobs(prev => {
      const next = new Set(prev);
      if (next.has(jobName)) {
        next.delete(jobName);
      } else {
        next.add(jobName);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedJobs(new Set(failuresData.jobSummary.map(j => j.jobName)));
  };

  const collapseAll = () => {
    setExpandedJobs(new Set());
  };

  // Dados para gráfico de pizza — status dos JOBS
  const jobStatusPieData = [
    { name: "Sucesso", value: failuresData.jobSummary.filter(j => j.jobStatus.toLowerCase() === "success").length },
    { name: "Aviso", value: failuresData.jobSummary.filter(j => j.jobStatus.toLowerCase() === "warning").length },
    { name: "Falha", value: failuresData.jobSummary.filter(j => ["failed", "error"].includes(j.jobStatus.toLowerCase())).length },
    { name: "Outros", value: failuresData.jobSummary.filter(j => !["success", "warning", "failed", "error"].includes(j.jobStatus.toLowerCase())).length },
  ].filter(d => d.value > 0);

  const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#94a3b8"];

  // Top 10 jobs com mais falhas
  const topFailures = failuresData.jobSummary
    .filter(j => j.failedCount > 0)
    .slice(0, 10)
    .map(j => ({
      name: j.jobName.length > 20 ? j.jobName.substring(0, 20) + "…" : j.jobName,
      fullName: j.jobName,
      falhas: j.failedCount,
      avisos: j.warningCount,
      workloads: j.totalWorkloads,
    }));

  // Top 10 jobs com maiores lacunas
  const topGaps = failuresData.jobSummary
    .filter(j => j.maxGapDays > 0)
    .sort((a, b) => b.maxGapDays - a.maxGapDays)
    .slice(0, 10)
    .map(j => ({
      name: j.jobName.length > 20 ? j.jobName.substring(0, 20) + "…" : j.jobName,
      fullName: j.jobName,
      diasSemBackup: j.maxGapDays,
      workloads: j.totalWorkloads,
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
    csv += `Total de Jobs,${failuresData.totalJobs}\n`;
    csv += `Total de Workloads,${failuresData.totalWorkloads}\n`;
    csv += `Total de Sessões,${failuresData.totalSessions}\n`;
    csv += `Sessões com Falha,${failuresData.failedSessions}\n`;
    csv += `Sessões com Aviso,${failuresData.warningSessions}\n`;
    csv += `Taxa de Sucesso,${totalRate}%\n`;
    csv += `Jobs com Falha,${failuresData.jobsWithFailures}\n`;
    csv += `Jobs com Lacunas,${failuresData.jobsWithGaps}\n\n`;

    csv += "Falhas por Job\n";
    csv += "Job,Status,Workloads,Total Sessões,Falhas,Avisos,Sucessos,Taxa de Falha (%),Maior Lacuna (dias),Erros\n";
    for (const j of failuresData.jobSummary) {
      csv += `"${j.jobName}",${j.jobStatus},${j.totalWorkloads},${j.totalSessions},${j.failedCount},${j.warningCount},${j.successCount},${j.failureRate.toFixed(1)},${j.maxGapDays},"${j.errors.join('; ')}"\n`;

      for (const w of j.workloads) {
        csv += `"  → ${w.workloadName}",${w.workloadType},,${w.totalSessions},${w.failedCount},${w.warningCount},${w.successCount},${w.failureRate.toFixed(1)},${w.maxGapDays},"${w.errors.join('; ')}"\n`;
      }
    }

    csv += "\nLacunas de Backup\n";
    csv += "Job,Workload,Tipo,Início da Lacuna,Fim da Lacuna,Dias sem Backup\n";
    for (const g of failuresData.gaps) {
      csv += `"${g.jobName}","${g.workloadName}",${g.workloadType},${g.gapStart},${g.gapEnd},${g.gapDays}\n`;
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
                Jobs Analisados
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold">{failuresData.totalJobs}</div>
                <Zap className="h-8 w-8 text-primary/60" />
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
                Jobs com Falha
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-red-600">{failuresData.jobsWithFailures}</div>
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
                Jobs com Lacunas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="text-3xl font-bold text-violet-600">{failuresData.jobsWithGaps}</div>
                <ShieldAlert className="h-8 w-8 text-violet-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="jobs">Falhas por Job</TabsTrigger>
            <TabsTrigger value="gaps">Lacunas de Backup</TabsTrigger>
            <TabsTrigger value="sessions">Todas as Sessões</TabsTrigger>
          </TabsList>

          {/* ── Overview Tab ── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Status Pie — Jobs */}
              <Card>
                <CardHeader>
                  <CardTitle>Status dos Jobs</CardTitle>
                  <CardDescription>
                    Distribuição de status do último run de cada job
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {jobStatusPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={jobStatusPieData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {jobStatusPieData.map((_entry, index) => (
                            <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">Nenhum job encontrado.</p>
                  )}
                </CardContent>
              </Card>

              {/* Top Failures Bar — Jobs */}
              <Card>
                <CardHeader>
                  <CardTitle>Top 10 Jobs com Mais Falhas</CardTitle>
                  <CardDescription>
                    Jobs com maior número de sessões falhadas
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {topFailures.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={topFailures} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 12 }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-background border rounded-lg p-2 shadow-lg text-sm">
                                  <p className="font-semibold">{data.fullName}</p>
                                  <p className="text-muted-foreground">{data.workloads} workloads</p>
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

            {/* Top Gaps Bar — Jobs */}
            <Card>
              <CardHeader>
                <CardTitle>Top 10 Jobs com Maiores Lacunas</CardTitle>
                <CardDescription>
                  Jobs com mais dias consecutivos sem backup em algum workload
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
                                <p className="text-muted-foreground">{data.workloads} workloads</p>
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
                  <p className="text-center text-muted-foreground py-8">Nenhuma lacuna detectada. 🎉</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Falhas por Job Tab ── */}
          <TabsContent value="jobs">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Falhas por Job (Cliente)</CardTitle>
                    <CardDescription>
                      {failuresData.jobSummary.length} jobs analisados — clique em um job para expandir seus workloads
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={expandAll}>
                      Expandir Todos
                    </Button>
                    <Button variant="outline" size="sm" onClick={collapseAll}>
                      Recolher Todos
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        <th className="text-left py-2 px-2">Job / Workload</th>
                        <th className="text-left py-2 px-2">Status</th>
                        <th className="text-right py-2 px-2">Workloads</th>
                        <th className="text-right py-2 px-2">Sessões</th>
                        <th className="text-right py-2 px-2">Falhas</th>
                        <th className="text-right py-2 px-2">Avisos</th>
                        <th className="text-right py-2 px-2">Taxa Falha</th>
                        <th className="text-right py-2 px-2">Maior Lacuna</th>
                        <th className="text-left py-2 px-2">Erros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failuresData.jobSummary.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-muted-foreground">
                            Nenhum job encontrado.
                          </td>
                        </tr>
                      ) : (
                        failuresData.jobSummary.map((job, jIdx) => {
                          const isExpanded = expandedJobs.has(job.jobName);
                          return (
                            <>
                              {/* Job Row (pai) */}
                              <tr
                                key={`job-${jIdx}`}
                                className={`
                                  border-b font-semibold cursor-pointer transition-colors
                                  ${job.failedCount > 0 ? "bg-red-50/40 hover:bg-red-50/60" : "bg-muted/40 hover:bg-muted/60"}
                                `}
                                onClick={() => toggleJob(job.jobName)}
                              >
                                <td className="py-2 px-2">
                                  <span className="inline-flex items-center gap-1.5">
                                    {isExpanded
                                      ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                      : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                    }
                                    <Zap className="h-4 w-4 text-primary/70" />
                                    {job.jobName}
                                  </span>
                                </td>
                                <td className="py-2 px-2">{getStatusBadge(job.jobStatus)}</td>
                                <td className="py-2 px-2 text-right">{job.totalWorkloads}</td>
                                <td className="py-2 px-2 text-right">{job.totalSessions}</td>
                                <td className="py-2 px-2 text-right">
                                  {job.failedCount > 0 ? (
                                    <span className="text-red-600 font-bold">{job.failedCount}</span>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {job.warningCount > 0 ? (
                                    <span className="text-amber-600 font-bold">{job.warningCount}</span>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-right">
                                  <span className={`font-bold ${job.failureRate > 50 ? "text-red-600" : job.failureRate > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                                    {job.failureRate.toFixed(1)}%
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-right">
                                  {job.maxGapDays > 0 ? (
                                    <span className="text-violet-600 font-bold">{job.maxGapDays}d</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-xs max-w-[180px] truncate" title={job.errors.join("; ")}>
                                  {job.errors.length > 0 ? (
                                    <span className="text-red-600">{job.errors.length} erro(s)</span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              </tr>

                              {/* Workload Rows (filhos) */}
                              {isExpanded && job.workloads.map((wl, wIdx) => (
                                <tr key={`job-${jIdx}-wl-${wIdx}`} className={`border-b hover:bg-muted/20 text-muted-foreground ${wl.failedCount > 0 ? "bg-red-50/20" : ""}`}>
                                  <td className="py-1.5 px-2 pl-10">
                                    <span className="inline-flex items-center gap-1.5">
                                      {WORKLOAD_ICONS[wl.workloadType]}
                                      {wl.workloadName}
                                      <Badge variant="outline" className="text-[10px] ml-1">
                                        {WORKLOAD_LABELS[wl.workloadType]}
                                      </Badge>
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2">—</td>
                                  <td className="py-1.5 px-2 text-right">—</td>
                                  <td className="py-1.5 px-2 text-right">{wl.totalSessions}</td>
                                  <td className="py-1.5 px-2 text-right">
                                    {wl.failedCount > 0 ? (
                                      <span className="text-red-600">{wl.failedCount}</span>
                                    ) : "0"}
                                  </td>
                                  <td className="py-1.5 px-2 text-right">
                                    {wl.warningCount > 0 ? (
                                      <span className="text-amber-600">{wl.warningCount}</span>
                                    ) : "0"}
                                  </td>
                                  <td className="py-1.5 px-2 text-right">
                                    <span className={wl.failureRate > 50 ? "text-red-600" : wl.failureRate > 0 ? "text-amber-600" : ""}>
                                      {wl.failureRate.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2 text-right">
                                    {wl.maxGapDays > 0 ? (
                                      <span className="text-violet-600">{wl.maxGapDays}d</span>
                                    ) : "—"}
                                  </td>
                                  <td className="py-1.5 px-2 text-xs max-w-[180px] truncate" title={wl.errors.join("; ")}>
                                    {wl.errors.length > 0 ? (
                                      <span className="text-red-600">{wl.errors[0]}</span>
                                    ) : "—"}
                                  </td>
                                </tr>
                              ))}
                            </>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Lacunas de Backup Tab ── */}
          <TabsContent value="gaps" className="space-y-4">
            {biggestGap && (
              <Card className="border-violet-200 bg-violet-50/50">
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    <div className="rounded-full p-2 bg-violet-100">
                      <ShieldAlert className="h-6 w-6 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-bold text-violet-900">
                        Maior lacuna detectada: {biggestGap.gapDays} dias
                      </p>
                      <p className="text-sm text-violet-700">
                        Job: {biggestGap.jobName} → {biggestGap.workloadName} ({WORKLOAD_LABELS[biggestGap.workloadType]})
                        — de {biggestGap.gapStart} a {biggestGap.gapEnd}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Lacunas de Backup (Períodos sem Proteção)</CardTitle>
                <CardDescription>
                  {failuresData.gaps.length} lacunas detectadas em {failuresData.jobsWithGaps} jobs
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
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-left py-2 px-2">Workload</th>
                        <th className="text-left py-2 px-2">Tipo</th>
                        <th className="text-left py-2 px-2">Início</th>
                        <th className="text-left py-2 px-2">Fim</th>
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
                              <td className="py-2 px-2 font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <Zap className="h-3.5 w-3.5 text-primary/70" />
                                  {gap.jobName}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <span className="inline-flex items-center gap-1">
                                  {WORKLOAD_ICONS[gap.workloadType]}
                                  {gap.workloadName}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {WORKLOAD_LABELS[gap.workloadType] || gap.workloadType}
                                </Badge>
                              </td>
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
                        <th className="text-left py-2 px-2">Job</th>
                        <th className="text-left py-2 px-2">Workload</th>
                        <th className="text-left py-2 px-2">Tipo</th>
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
                              <td className="py-2 px-2 font-medium">
                                <span className="inline-flex items-center gap-1">
                                  <Zap className="h-3.5 w-3.5 text-primary/70" />
                                  {session.jobName}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <span className="inline-flex items-center gap-1">
                                  {WORKLOAD_ICONS[session.workloadType]}
                                  {session.workloadName}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                <Badge variant="outline" className="text-xs">
                                  {WORKLOAD_LABELS[session.workloadType] || session.workloadType}
                                </Badge>
                              </td>
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
