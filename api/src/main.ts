import "reflect-metadata";
import { createServer } from "node:http";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import { AppModule } from "./app.module";
import { createRequestConcurrencyMiddleware } from "./load/requestConcurrency";

const compressionMiddleware =
  (compression as unknown as { default?: typeof compression }).default ?? compression;

function desktopCorsPatterns(): RegExp[] {
  return [
    /^https?:\/\/localhost(:\d+)?$/,
    /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
    /^tauri:\/\/.+/,
    /^https?:\/\/tauri\.localhost(:\d+)?$/,
  ];
}

function parseCorsOrigins(): boolean | (string | RegExp)[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) {
    const isProd = process.env.NODE_ENV === "production";
    if (!isProd) return true;
    return desktopCorsPatterns();
  }
  if (raw === "*") return true;
  const explicit = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  // Installed Tauri apps use https://tauri.localhost — always allow desktop origins
  // even when CORS_ORIGINS is set on Railway (avoids blocking release .exe builds).
  return [...explicit, ...desktopCorsPatterns()];
}

function listenFallbackHealth(host: string, port: number): void {
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "";
    if (path === "/health" || path.startsWith("/health/")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "fallback", ts: new Date().toISOString() }));
      return;
    }
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "starting" }));
  });
  server.listen(port, host, () => {
    console.error(`[api] Fallback /health listening on http://${host}:${port} after Nest bootstrap failure`);
  });
}

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  console.log(`[api] Bootstrapping on ${host}:${port} (NODE_ENV=${process.env.NODE_ENV ?? "development"})`);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.use(compressionMiddleware());
  app.use(createRequestConcurrencyMiddleware());
  app.enableCors({
    origin: parseCorsOrigins(),
    credentials: true,
  });
  app.useStaticAssets(join(process.cwd(), "data", "uploads"), { prefix: "/uploads/" });
  await app.listen(port, host);
  console.log(`[api] Listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";
  listenFallbackHealth(host, port);
});
