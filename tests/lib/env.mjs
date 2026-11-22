import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

export const PROJECT_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const TSX_CLI = join(PROJECT_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
export const ARTIFACTS = join(PROJECT_ROOT, "tests", "artifacts");
export const REPORTS = join(PROJECT_ROOT, "tests", "reports");

export async function freePort() {
  const srv = net.createServer();
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const port = srv.address().port;
  await new Promise((ok) => srv.close(ok));
  return port;
}

async function waitHealth(baseUrl, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastErr = new Error(`health ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`服务启动超时: ${lastErr?.message}`);
}

export function createWorkDir() {
  const dir = mkdtempSync(join(tmpdir(), "sigwall-qa-"));
  cpSync(join(PROJECT_ROOT, "server"), join(dir, "server"), { recursive: true });
  cpSync(join(PROJECT_ROOT, "package.json"), join(dir, "package.json"));
  const dist = join(PROJECT_ROOT, "dist");
  if (existsSync(dist)) {
    try { symlinkSync(dist,join(dir,"dist"),"junction"); }
    catch { cpSync(dist,join(dir,"dist"),{recursive:true}); }
  }
  mkdirSync(join(dir, "data"), { recursive: true });
  try {
    symlinkSync(join(PROJECT_ROOT, "node_modules"), join(dir, "node_modules"), "junction");
  } catch {
    cpSync(join(PROJECT_ROOT, "node_modules"), join(dir, "node_modules"), { recursive: true });
  }
  return dir;
}

export function startServer(dir, port, secret) {
  const child = spawn(process.execPath, ["--import", "tsx", join(dir, "server", "index.ts")], {
    cwd: dir,
    env: { ...process.env, HOST: "127.0.0.1", SIGNATURE_DATA_DIR: join(dir,"data"), PORT: String(port), ADMIN_SECRET: secret, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));
  const baseUrl = `http://127.0.0.1:${port}`;
  const ready = waitHealth(baseUrl).then(() => true);
  return {
    child,
    port,
    baseUrl,
    secret,
    ready,
    logs: () => log.join(""),
  };
}

export function stopServer(server) {
  if (!server) return;
  const { child } = server;
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

export async function createEnv(opts = {}) {
  const dir = opts.dir || createWorkDir();
  const port = await freePort();
  const secret = opts.secret || `qa-secret-${Math.random().toString(36).slice(2)}`;
  const server = startServer(dir, port, secret);
  try {
    await server.ready;
  } catch (e) {
    stopServer(server);
    throw new Error(`${e.message}\n--- 服务日志 ---\n${server.logs()}`);
  }
  return {
    dir,
    port,
    secret,
    server,
    baseUrl: server.baseUrl,
    async restart() {
      stopServer(server);
      await new Promise((r) => setTimeout(r, 700));
      const p = await freePort();
      const next = startServer(dir, p, secret);
      await next.ready;
      this.server = next;
      this.port = p;
      this.baseUrl = next.baseUrl;
      return this;
    },
    async dispose() {
      stopServer(this.server);
      await new Promise((r) => setTimeout(r, 300));
      if (!opts.keepDir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {}
      }
    },
  };
}

export async function api(env, path, opts = {}) {
  const headers = { "content-type": "application/json", ...(opts.headers || {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${env.baseUrl}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

export function metricsFor(name, size = 64) {
  const chars = [...name].length;
  return { width: Math.ceil(chars * size * 0.95), height: Math.ceil(size * 1.22) };
}

let reqSeq = 0;
export function uniqueRequestId(prefix = "qa") {
  reqSeq += 1;
  return `${prefix}-${Date.now()}-${reqSeq}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function createSignature(env, name, opts = {}) {
  return api(env, "/api/signatures", {
    method: "POST",
    body: {
      name,
      fontId: opts.fontId || "lxgw-wenkai",
      requestId: opts.requestId || uniqueRequestId("sig"),
      metrics: opts.metrics || metricsFor(name, opts.size || 64),
    },
  });
}

export function overlaps(a, b, padding = 0) {
  return (
    a.x < b.x + b.width + padding &&
    a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding &&
    a.y + a.height + padding > b.y
  );
}

export const RESERVED_ZONES = [
  { x: 30, y: 20, width: 570, height: 140 },
  { x: 1540, y: 20, width: 350, height: 140 },
  { x: 1590, y: 730, width: 300, height: 320 },
];

export async function waitFor(fn, timeoutMs = 10000, intervalMs = 120) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw last || new Error("等待条件超时");
}

export function pngSize(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
