import axios from "axios";
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

function veeamProxyPlugin(): Plugin {
  return {
    name: "veeam-proxy-plugin",

    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__veeam__/proxy", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handleProxy = async (payload: any) => {
          try {
            const { url, method = "GET", headers = {}, body } = payload ?? {};

            if (typeof url !== "string") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "URL inválida" }));
              return;
            }

            const target = new URL(url);
            if (target.protocol !== "http:" && target.protocol !== "https:") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Protocolo não suportado" }));
              return;
            }

            const upstreamResponse = await axios.request<ArrayBuffer>({
              url: target.toString(),
              method,
              headers,
              data:
                body == null
                  ? undefined
                  : typeof body === "string"
                    ? body
                    : JSON.stringify(body),
              responseType: "arraybuffer",
              validateStatus: () => true,
              httpsAgent:
                target.protocol === "https:" ? insecureHttpsAgent : undefined,
            });

            const ignoredHeaders = new Set([
              "content-encoding",
              "transfer-encoding",
              "connection",
              "content-length",
            ]);

            const responseHeaders: Record<string, string> = {};
            Object.entries(upstreamResponse.headers).forEach(([key, value]) => {
              if (!ignoredHeaders.has(key.toLowerCase())) {
                responseHeaders[key] = Array.isArray(value)
                  ? value.join(", ")
                  : String(value);
              }
            });

            const responseBuffer = Buffer.from(upstreamResponse.data);

            res.writeHead(upstreamResponse.status, responseHeaders);
            res.end(responseBuffer);
          } catch (error) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: "Falha ao encaminhar requisição para a API Veeam",
                details: String(error),
              })
            );
          }
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          void handleProxy(reqBody);
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            void handleProxy(payload);
          } catch (error) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Payload inválido", details: String(error) }));
          }
        });
      });
    },
  };
}
const plugins = [react(), tailwindcss(), jsxLocPlugin(), veeamProxyPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: false, // Will find next available port if 3000 is busy
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
