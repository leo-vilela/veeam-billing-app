import { useState } from "react";
import { toast } from "sonner";
import ConfigurationPage from "./ConfigurationPage";
import BillingDashboard from "./BillingDashboard";
import { VeeamConfig, BillingData } from "@/types/veeam";
import { fetchBillingData } from "@/lib/veeamApi";

export default function Home() {
  const [currentPage, setCurrentPage] = useState<"config" | "dashboard">("config");
  const [billingData, setBillingData] = useState<BillingData | null>(null);
  const [config, setConfig] = useState<VeeamConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfigSubmit = async (formConfig: VeeamConfig) => {
    setIsLoading(true);
    setError(null);

    try {
      toast.loading("Conectando à API do Veeam...");
      const data = await fetchBillingData(formConfig);
      setBillingData(data);
      setConfig(formConfig);
      setCurrentPage("dashboard");
      toast.dismiss();
      toast.success("Dados carregados com sucesso!");
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
      ) : billingData && config ? (
        <BillingDashboard
          billingData={billingData}
          config={config}
          onReset={handleReset}
          isLoading={isLoading}
        />
      ) : null}
    </div>
  );
}
