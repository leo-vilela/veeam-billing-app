import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, CheckCircle2, DollarSign, ShieldAlert } from "lucide-react";
import { VeeamConfig, AppMode } from "@/types/veeam";

interface ConfigurationPageProps {
  onConfigSubmit: (config: VeeamConfig) => void;
  isLoading?: boolean;
  error?: string;
}

export default function ConfigurationPage({
  onConfigSubmit,
  isLoading = false,
  error,
}: ConfigurationPageProps) {
  const [selectedMode, setSelectedMode] = useState<AppMode>("billing");
  const [formData, setFormData] = useState<Omit<VeeamConfig, "mode">>({
    apiUrl: "https://0.0.0.0:1239",
    username: "",
    password: "",
    startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0],
    endDate: new Date().toISOString().split("T")[0],
    jobFilter: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfigSubmit({ ...formData, mode: selectedMode });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl">Veeam Dashboard</CardTitle>
          <CardDescription>
            Selecione o modo de operação e configure a conexão com a API do Veeam ONE
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* ── Seletor de Modo ── */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Modo de Operação</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setSelectedMode("billing")}
                  className={`
                    relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center
                    transition-all duration-200 cursor-pointer
                    ${selectedMode === "billing"
                      ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                      : "border-muted hover:border-muted-foreground/30 hover:bg-muted/30"
                    }
                    ${isLoading ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                >
                  <div className={`
                    rounded-full p-2.5
                    ${selectedMode === "billing"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                    }
                  `}>
                    <DollarSign className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${selectedMode === "billing" ? "text-primary" : ""}`}>
                      Billing
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Faturamento e volumetria
                    </p>
                  </div>
                  {selectedMode === "billing" && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => setSelectedMode("failures")}
                  className={`
                    relative flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center
                    transition-all duration-200 cursor-pointer
                    ${selectedMode === "failures"
                      ? "border-destructive bg-destructive/5 shadow-md ring-2 ring-destructive/20"
                      : "border-muted hover:border-muted-foreground/30 hover:bg-muted/30"
                    }
                    ${isLoading ? "opacity-50 cursor-not-allowed" : ""}
                  `}
                >
                  <div className={`
                    rounded-full p-2.5
                    ${selectedMode === "failures"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                    }
                  `}>
                    <ShieldAlert className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-sm ${selectedMode === "failures" ? "text-destructive" : ""}`}>
                      Falhas de Backup
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Erros e lacunas por workload
                    </p>
                  </div>
                  {selectedMode === "failures" && (
                    <div className="absolute top-2 right-2">
                      <CheckCircle2 className="h-4 w-4 text-destructive" />
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* ── Campos de Conexão ── */}
            <div className="space-y-2">
              <Label htmlFor="apiUrl">URL da API Veeam</Label>
              <Input
                id="apiUrl"
                name="apiUrl"
                type="url"
                placeholder="https://0.0.0.0:1239"
                value={formData.apiUrl}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Exemplo: https://192.168.1.1:1239
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                name="username"
                type="text"
                placeholder="seu-usuario"
                value={formData.username}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="sua-senha"
                value={formData.password}
                onChange={handleChange}
                required
                disabled={isLoading}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Data Inicial</Label>
                <Input
                  id="startDate"
                  name="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={handleChange}
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">Data Final</Label>
                <Input
                  id="endDate"
                  name="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={handleChange}
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            {/* ── Filtro de Job (apenas billing) ── */}
            {selectedMode === "billing" && (
              <div className="space-y-2">
                <Label htmlFor="jobFilter">Filtro de Job (opcional)</Label>
                <Input
                  id="jobFilter"
                  name="jobFilter"
                  type="text"
                  placeholder="Ex: PGE ou CORP"
                  value={formData.jobFilter || ""}
                  onChange={handleChange}
                  disabled={isLoading}
                  minLength={3}
                />
                <p className="text-xs text-muted-foreground">
                  Mínimo 3 caracteres. Filtra jobs cujo nome contenha o texto informado (case-insensitive). Deixe vazio para trazer todos.
                </p>
              </div>
            )}

            <Button
              type="submit"
              className={`w-full ${selectedMode === "failures" ? "bg-destructive hover:bg-destructive/90" : ""}`}
              disabled={isLoading}
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {selectedMode === "billing" ? "Conectando..." : "Analisando Falhas..."}
                </>
              ) : (
                <>
                  {selectedMode === "billing" ? (
                    <DollarSign className="mr-2 h-4 w-4" />
                  ) : (
                    <ShieldAlert className="mr-2 h-4 w-4" />
                  )}
                  {selectedMode === "billing"
                    ? "Conectar e Buscar Dados de Billing"
                    : "Conectar e Analisar Falhas de Backup"
                  }
                </>
              )}
            </Button>

            <div className="pt-4 border-t space-y-2 text-sm text-muted-foreground">
              <p>
                <strong>Dica:</strong> Certifique-se de que a URL da API está
                acessível e que suas credenciais têm permissão de leitura.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
