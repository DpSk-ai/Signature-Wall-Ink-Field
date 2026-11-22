import { place, occupiedBounds, type Box } from "./layout.js";
import fontIds from "./font-ids.json" with { type: "json" };
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import Database from "better-sqlite3";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, ".."),
  dir = process.env.SIGNATURE_DATA_DIR || join(root, "data");
mkdirSync(dir, { recursive: true });
const db = new Database(join(dir, "signature-wall.db"));
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.exec(
  `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS signatures(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL,font_id TEXT NOT NULL,x REAL NOT NULL,y REAL NOT NULL,width REAL NOT NULL,height REAL NOT NULL,size REAL NOT NULL,rotation REAL NOT NULL,status TEXT NOT NULL DEFAULT 'queued',hidden INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS idx_signatures_request_id ON signatures(request_id);CREATE INDEX IF NOT EXISTS idx_signatures_status ON signatures(status);CREATE INDEX IF NOT EXISTS idx_signatures_hidden ON signatures(hidden);CREATE INDEX IF NOT EXISTS idx_signatures_visibility_status ON signatures(hidden,status,created_at);INSERT OR IGNORE INTO settings(key,value)VALUES('event_name','四川大学 AI 黑客松'),('event_status','open'),('animation_paused','false');`,
);
if (
  !(db.pragma("table_info(signatures)") as { name: string }[]).some(
    (col) => col.name === "split_at",
  )
) {
  db.exec(
    "ALTER TABLE signatures ADD COLUMN split_at INTEGER NOT NULL DEFAULT 0",
  );
}
const app = Fastify({ logger: true });
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body: string, done) => {
    try {
      const json = body.length > 0 ? JSON.parse(body) : {};
      done(null, json);
    } catch (err: any) {
      done(err, undefined);
    }
  },
);
await app.register(cors, { origin: true });
await app.register(websocket);
type Client = { socket: any; alive: boolean };
const clients = new Set<Client>();
const dropClient = (client: Client) => {
  clients.delete(client);
  try {
    client.socket.terminate();
  } catch {}
};
const get = (k: string) =>
  (db.prepare("SELECT value FROM settings WHERE key=?").get(k) as any)?.value;
const put = (k: string, v: string) =>
  db
    .prepare(
      "INSERT INTO settings(key,value)VALUES(?,?)ON CONFLICT(key)DO UPDATE SET value=excluded.value",
    )
    .run(k, v);
const list = () =>
  db
    .prepare(
      "SELECT * FROM signatures WHERE hidden=0 ORDER BY created_at, rowid",
    )
    .all();
const state = () => ({
  eventName: get("event_name"),
  eventStatus: get("event_status"),
  animationPaused: get("animation_paused") === "true",
  connections: clients.size,
  signatures: list(),
});
const send = (m: any) => {
  const b = JSON.stringify(m);
  for (const client of clients) {
    if (client.socket.readyState !== 1) {
      clients.delete(client);
      continue;
    }
    try {
      client.socket.send(b);
    } catch {
      dropClient(client);
    }
  }
};
const heartbeat = setInterval(() => {
  for (const client of clients) {
    if (!client.alive) {
      dropClient(client);
      continue;
    }
    client.alive = false;
    try {
      client.socket.ping();
    } catch {
      dropClient(client);
    }
  }
}, 30000);
heartbeat.unref();
app.addHook("onClose", async () => {
  clearInterval(heartbeat);
  for (const client of clients) dropClient(client);
});
app.get("/api/health", () => ({ ok: true, connections: clients.size }));
app.get("/api/state", state);
app.get("/ws", { websocket: true }, (socket) => {
  const client: Client = { socket, alive: true };
  clients.add(client);
  send({ type: "connections", data: clients.size });
  socket.on("pong", () => {
    client.alive = true;
  });
  socket.on("close", () => {
    clients.delete(client);
    send({ type: "connections", data: clients.size });
  });
  socket.on("error", () => clients.delete(client));
  try {
    socket.send(JSON.stringify({ type: "snapshot", data: state() }));
  } catch {
    dropClient(client);
  }
});
const allowed = new Set(fontIds);
app.post("/api/signatures", (req, reply) => {
  const b = (req.body ?? {}) as any,
    requestId = String(b.requestId || randomUUID());
  if (requestId.length > 200)
    return reply.code(400).send({ error: "请求标识过长" });
  const old = db
    .prepare("SELECT * FROM signatures WHERE request_id=?")
    .get(requestId);
  if (old) return reply.code(200).send(old);
  const name = String(b.name || "").trim();
  if (!name || [...name].length > 12)
    return reply.code(400).send({ error: "姓名需要 1–12 个字符" });
  if (get("event_status") !== "open")
    return reply.code(409).send({ error: "签到当前未开放" });
  const width = Number(b.metrics?.width),
    height = Number(b.metrics?.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 8 ||
    width > 1100 ||
    height < 20 ||
    height > 180
  )
    return reply.code(400).send({ error: "无法取得有效字形尺寸" });
  const id = randomUUID(),
    splitAt =
      [...name].length > 6 && /[^\u0000-\u00ff]/u.test(name)
        ? Math.ceil([...name].length / 2)
        : 0,
    prior = (
      db
        .prepare("SELECT x,y,width,height,rotation FROM signatures")
        .all() as (Box & { rotation: number })[]
    ).map(occupiedBounds),
    p = place(
      splitAt ? (width * splitAt) / [...name].length + 16 : width,
      splitAt ? Math.max(128, height * 2) : height,
      prior,
      id,
      splitAt,
    ),
    font = allowed.has(b.fontId) ? b.fontId : "source-han-sans",
    created = new Date().toISOString();
  try {
    db.prepare(
      "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at,split_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      requestId,
      name,
      font,
      p.x,
      p.y,
      p.width,
      p.height,
      p.size,
      p.rotation,
      "queued",
      created,
      p.split_at,
    );
  } catch (err: any) {
    if (String(err?.code || "").startsWith("SQLITE_CONSTRAINT")) {
      const existing = db
        .prepare("SELECT * FROM signatures WHERE request_id=?")
        .get(requestId);
      if (existing) return reply.code(200).send(existing);
    }
    throw err;
  }
  const row = db.prepare("SELECT * FROM signatures WHERE id=?").get(id);
  send({ type: "signature.created", data: row });
  return reply.code(201).send(row);
});
app.patch("/api/signatures/:id/status", (req, reply) => {
  const id = (req.params as any).id,
    status = (req.body as any)?.status;
  if (!["writing", "complete"].includes(status))
    return reply.code(400).send({ error: "状态无效" });
  const expected = (req.body as any)?.expectedStatus;
  const changed = expected
    ? db
        .prepare("UPDATE signatures SET status=? WHERE id=? AND status=?")
        .run(status, id, expected)
    : db.prepare("UPDATE signatures SET status=? WHERE id=?").run(status, id);
  if (
    expected &&
    !changed.changes &&
    db.prepare("SELECT 1 FROM signatures WHERE id=?").get(id)
  )
    return { id, skipped: true };
  if (changed.changes === 0)
    return reply.code(404).send({ error: "签名不存在" });
  const data = { id, status };
  send({ type: "signature.updated", data });
  return data;
});
const secret = process.env.ADMIN_SECRET || "change-this-before-production",
  sign = () => createHmac("sha256", secret).update("admin").digest("hex"),
  auth = (r: any) => {
    const t = String(r.headers.authorization || "").replace(/^Bearer /, ""),
      e = sign();
    return (
      t.length === e.length && timingSafeEqual(Buffer.from(t), Buffer.from(e))
    );
  };
if (!process.env.ADMIN_SECRET) {
  console.warn(
    "\n⚠️  警告: 使用默认 ADMIN_SECRET,生产环境请设置环境变量 ADMIN_SECRET\n",
  );
}
app.post("/api/admin/login", (req, reply) =>
  String((req.body as any)?.password) === secret
    ? { token: sign() }
    : reply.code(401).send({ error: "密码错误" }),
);
app.put("/api/admin/settings", (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  const b = req.body as any,
    d: any = {};
  if (typeof b.eventName === "string" && b.eventName.trim()) {
    d.eventName = b.eventName.trim();
    put("event_name", d.eventName);
  }
  if (["open", "paused", "ended"].includes(b.eventStatus)) {
    d.eventStatus = b.eventStatus;
    put("event_status", d.eventStatus);
  }
  if (typeof b.animationPaused === "boolean") {
    d.animationPaused = b.animationPaused;
    put("animation_paused", String(d.animationPaused));
  }
  send({ type: "settings.updated", data: d });
  return { ok: true };
});
app.patch("/api/admin/signatures/:id", (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  const id = (req.params as any).id,
    hidden = !!(req.body as any)?.hidden;
  const changed = db
    .prepare("UPDATE signatures SET hidden=? WHERE id=?")
    .run(hidden ? 1 : 0, id);
  if (changed.changes === 0)
    return reply.code(404).send({ error: "签名不存在" });
  send({ type: "signature.visibility", data: { id, hidden } });
  send({ type: "snapshot", data: state() });
  return { ok: true };
});
app.post("/api/admin/replay", async (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  const row = db
    .prepare(
      "SELECT id FROM signatures WHERE hidden=0 ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get() as any;
  if (row) {
    db.prepare("UPDATE signatures SET status='queued' WHERE id=?").run(row.id);
    send({ type: "signature.updated", data: { id: row.id, status: "queued" } });
  }
  return { ok: true };
});
app.get("/api/admin/signatures", (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  return db
    .prepare("SELECT * FROM signatures ORDER BY created_at, rowid")
    .all();
});
app.delete("/api/admin/signatures/:id", (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  const id = (req.params as any).id;
  const changed = db.prepare("DELETE FROM signatures WHERE id=?").run(id);
  if (changed.changes === 0)
    return reply.code(404).send({ error: "签名不存在" });
  send({ type: "signature.deleted", data: { id } });
  return { ok: true };
});
app.delete("/api/admin/signatures", (req, reply) => {
  if (!auth(req)) return reply.code(401).send({ error: "未授权" });
  db.prepare("DELETE FROM signatures").run();
  send({ type: "signatures.cleared", data: {} });
  return { ok: true };
});
if (existsSync(join(root, "dist"))) {
  await app.register(staticPlugin, {
    root: join(root, "dist"),
    wildcard: true,
  });
  app.setNotFoundHandler((req, reply) =>
    !["/", "/admin", "/admin/", "/wall", "/wall/"].includes(
      req.url.split("?")[0],
    )
      ? reply.code(404).send({ error: "Not found" })
      : reply.sendFile("index.html"),
  );
}
await app.listen({
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "0.0.0.0",
});
