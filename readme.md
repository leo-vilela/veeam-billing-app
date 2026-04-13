# Veeam Billing & Backup Analysis Dashboard

Um painel web responsivo e moderno projetado para consolidar, analisar e reportar faturamento e falhas de backups de ambientes de proteção de dados (BaaS), consumindo diretamente a **REST API v2.2** do **Veeam ONE**.

## 🎯 Objetivo

O principal objetivo desta aplicação é fornecer a provedores de serviço e administradores de TI uma ferramenta unificada para duas finalidades:

1. **Billing (Faturamento)**: Gerar relatórios de cobrança baseados em volumetria e licenciamento consumido a partir do Veeam ONE.
2. **Análise de Falhas de Backup**: Identificar falhas, avisos e lacunas de backup por workload, gerando um relatório detalhado de períodos sem proteção.

## ✨ Funcionalidades

### Modo Billing
- **Dashboard Unificado**: Visão consolidada de todas as instâncias protegidas pelo ambiente Veeam.
- **Cobrança Dinâmica**: Cálculo de faturamento em tempo real estimando o custo Total Volume (GB) × Valor Base.
- **Suporte Multi-Workload**:
  - Máquinas Virtuais (VMs) On-Premises ou Cloud
  - Agentes Físicos (Veeam Agents/Computers)
  - Compartilhamentos de Arquivo (File Shares NAS/SMB)
- **Consolidação por Job**: A aba *Backups Consolidado* unifica todas as VMs e backups pertencentes a um mesmo Job para facilitar a fatura de locatários e departamentos.
- **Exportação CSV**: Exportação completa e organizada dos dados renderizados.
- **Auditoria de Licenciamento**: Recupera informações sobre licenças VUL disponíveis e consumidas.

### Modo Falhas de Backup (NOVO)
- **Análise de Falhas por Workload**: Lista todas as sessões de backup com status Failed, Warning ou Success, agrupadas por workload (VM, Agent, File Share).
- **Detecção de Lacunas (Gaps)**: Identifica automaticamente períodos sem backup por workload, calculando dias consecutivos sem proteção.
- **KPIs de Saúde**: Cards com total de workloads, sessões, falhas, avisos, taxa de sucesso e workloads com lacunas.
- **Gráficos Interativos**: Pizza de distribuição de status, barras com Top 10 workloads com mais falhas e maiores lacunas.
- **Filtros por Tipo**: Filtro por tipo de workload (VM, Agent, File Share) na visualização de lacunas.
- **Exportação CSV**: Relatório completo de falhas e lacunas para análise externa.

### Geral
- **Bypass de CORS Embutido**: Proxy de desenvolvimento que contorna problemas de CORS e certificados SSL auto-assinados.
- **Seletor de Modo na Entrada**: Tela inicial permite escolher entre "Billing" ou "Falhas de Backup" antes de conectar.

## 🛠️ Tecnologias Utilizadas

- **Frontend:**
  - [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
  - Construído com [Vite](https://vitejs.dev/)
  - [Tailwind CSS](https://tailwindcss.com/) & [Shadcn UI](https://ui.shadcn.com/) para estilização limpa e Dark/Light mode
  - [Recharts](https://recharts.org/) para a visualização através de gráficos intuitivos
- **Integração:**
  - `fetch` nativo com `ProxyServer` acoplado via middleware do Vite.

## 🚀 Como Executar Localmente

### Pré-requisitos
- Ter o **Node.js** instalado (versão 18+)
- Possuir o **pnpm** como gerenciador de dependências (`npm i -g pnpm`)
- Um servidor **Veeam ONE** rodando no seu ambiente interno emitindo logs pela `REST API v2.2` (Padrão porta `:1239` no IP do servidor).

### Passos para Instalação

1. Clone o repositório em sua máquina:
   ```bash
   git clone https://github.com/leo-vilela/veeam-billing-app.git
   cd veeam-billing-app
   ```

2. Instale as dependências com `pnpm`:
   ```bash
   pnpm install
   ```

3. Gire o servidor de Desenvolvimento local (isso iniciará o frontend e o Proxy API simultaneamente na porta 3000):
   ```bash
   pnpm run dev
   ```

4. Acesse em seu navegador a página `http://localhost:3000`.

### Fluxo de Uso

1. Na tela inicial, selecione o **modo de operação**:
   - **Billing** — para gerar relatórios de cobrança
   - **Falhas de Backup** — para analisar falhas e lacunas
2. Preencha URL da API, credenciais e período desejado.
3. Clique em "Conectar" para carregar os dados.
4. Navegue pelas abas do dashboard correspondente.
5. Exporte o relatório em CSV se necessário.

## 📝 Pontos de Atenção (Contribuição e Desenvolvimento)
Certifique-se de que a API Server (Veeam) possua endpoints compatíveis se atualizada para a v12.1+ ou outras versões. As rotas chaves mapeadas neste projeto estão construídas na arquitetura `/api/v2.2/`. Seus arquivos centrais de consumo localizam-se em `client/src/lib/veeamApi.ts`.
