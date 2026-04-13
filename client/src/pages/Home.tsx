import { useState } from "react";
import { toast } from "sonner";
import ConfigurationPage from "./ConfigurationPage";
import BillingDashboard from "./BillingDashboard";
import FailuresDashboard from "./FailuresDashboard";
import { VeeamConfig, BillingData, FailuresData } from "@/types/veeam";
import { fetchBillingData, fetchFailuresData } from "@/lib/veeamApi";

export default function Home() {
  const [currentPage, setCurrentPage] = useState<"config" | "billing" | "failures">("config");
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [failuresData, setFailuresData] = useState<FailuresData | null>(null);
  const [config, setConfig] = useState<VeeamConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfigSubmit = async (formConfig: VeeamConfig) => {
    setIsLoading(true);
    setError(null);

    try {
      if (formConfig.mode === "billing") {
        toast.loading("Conectando à API do Veeam...");
        const data = await fetchBillingData(formConfig);
        setBillingData(data);
        setConfig(formConfig);
        setCurrentPage("billing");
        toast.dismiss();
        toast.success("Dados de billing carregados com sucesso!");
      } else {
        toast.loading("Conectando e analisando falhas de backup...");
        const data = await fetchFailuresData(formConfig);
        setFailuresData(data);
        setConfig(formConfig);
        setCurrentPage("failures");
        toast.dismiss();
        toast.success("Análise de falhas concluída!");
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Erro desconhecido";
      setError(errorMessage);
      toast.dismiss();
      toast.error(`Erro: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setCurrentPage("config");
    setBillingData(null);
    setFailuresData(null);
    setConfig(null);
    setError(null);
  };

  return (
    <div className="min-h-screen">
      {currentPage === "config" ? (
        <ConfigurationPage
          onConfigSubmit={handleConfigSubmit}
          isLoading={isLoading}
          error={error || undefined}
        />
      ) : currentPage === "billing" && billingData && config ? (
        <BillingDashboard
          billingData={billingData}
          config={config}
          onReset={handleReset}
          isLoading={isLoading}
        />
      ) : currentPage === "failures" && failuresData && config ? (
        <FailuresDashboard
          failuresData={failuresData}
          config={config}
          onReset={handleReset}
          isLoading={isLoading}
        />
      ) : null}
    </div>
  );
}
