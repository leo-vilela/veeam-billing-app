# Veeam Billing Dashboard

Um painel web responsivo e moderno projetado para consolidar e calcular o faturamento de ambientes de proteção de dados (BaaS) consumindo diretamente a **REST API v2.2** do **Veeam ONE**.

## 🎯 Objetivo

O principal objetivo desta aplicação é fornecer a provedores de serviço e administradores de TI uma ferramenta unificada para gerar relatórios de cobrança. O dashboard consome dados diretamente do Veeam ONE para extrair volumes trafegados, dados protegidos e retenção agrupada, permitindo cruzar o consumo real em Gigabytes (GB) com o preço de venda estipulado.

## ✨ Funcionalidades

- **Dashboard Unificado**: Visão consolidada de todas as instâncias protegidas pelo ambiente Veeam.
- **Cobrança Dinâmica**: Cálculo de faturamento em tempo real estimando o custo Total Volume (GB) × Valor Base.
- **Suporte Multi-Workload**:
  - Máquinas Virtuais (VMs) On-Premises ou Cloud
  - Agentes Físicos (Veeam Agents/Computers)
  - Compartilhamentos de Arquivo (File Shares NAS/SMB)
- **Consolidação por Job**: A aba *Backups Consolidado* unifica todas as VMs e backups pertencentes a um mesmo Job para facilitar a fatura de locatários e departamentos.
- **Exportação CSV**: Exportação completa e organizada dos dados renderizados (incluindo abas de VMs, Servidores Físicos e File Shares separados) ideal para importar no Excel ou em outro sistema de faturamento.
- **Auditoria de Licenciamento**: Recupera do endpoint de "Usage" informações sobre licenças disponíveis e consumidas da VUL (Veeam Universal License) para fácil controle de consumo no topo do painel.
- **Bypass de CORS Embutido**: Inclui um proxy de desenvolvimento rápido configurado via Vite que contorna problemas comuns de CORS e de Certificados SSL Auto-Assinados em ambientes locais do Veeam ONE.

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
   git clone https://github.com/seu-usuario/veeam-billing-app.git
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

### Realizando a Conexão
Para se conectar ao seu ambiente, preencha os dados no formulário principal de login da aplicação:
- **URL da API**: O IP ou HostName do seu servidor Veeam ONE (ex: `https://10.X.X.X:1239`)
- **Usuário e Senha**: Credenciais com permissão de Admin/Read-Only na API.

## 📝 Pontos de Atenção (Contribuição e Desenvolvimento)
Certifique-se de que a API Server (Veeam) possua endpoints compatíveis se atualizada para a v12.1+ ou outras versões. As rotas chaves mapeadas neste projeto estão construídas na arquitetura `/api/v2.2/`. Seus arquivos centrais de consumo localizam-se em `client/src/lib/veeamApi.ts`.
