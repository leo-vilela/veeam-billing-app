import axios from "axios";
import express from "express";
import { createServer } from "http";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const insecureHttpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "2mb" }));

  app.post("/__veeam__/proxy", async (req, res) => {
    try {
      const { url, method = "GET", headers = {}, body } = req.body ?? {};

      if (typeof url !== "string") {
        res.status(400).json({ error: "URL inválida" });
        return;
      }

      const target = new URL(url);
      if (target.protocol !== "http:" && target.protocol !== "https:") {
        res.status(400).json({ error: "Protocolo não suportado" });
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

      Object.entries(upstreamResponse.headers).forEach(([key, value]) => {
        if (!ignoredHeaders.has(key.toLowerCase())) {
          res.setHeader(key, Array.isArray(value) ? value.join(", ") : String(value));
        }
      });

      const responseBuffer = Buffer.from(upstreamResponse.data);
      res.status(upstreamResponse.status).send(responseBuffer);
    } catch (error) {
      res.status(502).json({
        error: "Falha ao encaminhar requisição para a API Veeam",
        details: String(error),
      });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
