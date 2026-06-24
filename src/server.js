import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { authMiddleware } from "./middleware/auth.js";
import messagesRouter from "./routes/messages.js";
import proxyRouter from "./routes/proxy.js";
import { loadConfig } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// View engine
app.set("view engine", "pug");
app.set("views", `${__dirname}/views`);

// Load service routes from config.js, then register routes
const routes = loadConfig();

routes.forEach((route) => {
  // Inject service config into each request for this route
  const serviceMiddleware = (req, _res, next) => {
    req._serviceConfig = route;
    next();
  };

  const prefix = `/${route.name}/v1`;

  // Anthropic-compatible messages endpoint
  app.use(`${prefix}/messages`, serviceMiddleware, authMiddleware, messagesRouter);

  // Forward all other /<name>/v1/* requests to the remote API
  app.use(prefix, serviceMiddleware, authMiddleware, proxyRouter);
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Home page — show routes and example Claude config
app.get("/", (_req, res) => {
  const host = process.env.HOST || "0.0.0.0";
  const port = parseInt(process.env.PORT, 10) || 8088;
  // Use localhost for display if bound to 0.0.0.0
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  const baseUrl = `http://${displayHost}:${port}`;

  res.render("index", { routes, baseUrl });
});

// Start server if run directly (not imported for testing)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const HOST = process.env.HOST || "0.0.0.0";
  const PORT = parseInt(process.env.PORT, 10) || 8088;
  app.listen(PORT, HOST, () => {
    const serviceNames = routes.map((r) => r.name).join(", ");
    console.log(`AI proxy listening on ${HOST}:${PORT} (services: ${serviceNames})`);
  });
}

export default app;
