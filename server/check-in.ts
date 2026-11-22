import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import jsQR from "jsqr";
import { PNG } from "pngjs";

type Settings = {
  mode: "off" | "link" | "qr";
  url: string;
  revision: string;
  hasQr: number;
};
const blank: Settings = { mode: "off", url: "", revision: "", hasQr: 0 };
const maxImageBytes = 2 * 1024 * 1024;

function httpsTarget(input: unknown): string {
  if (typeof input !== "string" || input.length > 8192) return "";
  const value = input.trim();
  if ([...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    return "";
  if (!/^https:\/\/[^/?#]/i.test(value) || /[\s\\]/u.test(value)) return "";
  try {
    const url = new URL(value);
    return url.username || url.password ? "" : url.href;
  } catch {
    return "";
  }
}

function readQr(encoded: unknown) {
  if (
    typeof encoded !== "string" ||
    encoded.length > Math.ceil(maxImageBytes / 3) * 4
  )
    throw Error("二维码图片超过 2 MiB，请裁切后重试");
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length < 33 ||
    bytes.length > maxImageBytes ||
    !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    throw Error("请选择有效的二维码图片");
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 1200 || height > 1200)
    throw Error("二维码边长需在 1–1200 像素内");
  const png = PNG.sync.read(bytes);
  return { png, bytes: PNG.sync.write(png) };
}

export function registerCheckIn(
  app: FastifyInstance,
  db: Database.Database,
  authorized: (req: FastifyRequest) => boolean,
  eventName: () => string,
) {
  db.exec(`CREATE TABLE IF NOT EXISTS official_check_in (
    id INTEGER PRIMARY KEY CHECK (id = 1), mode TEXT NOT NULL, url TEXT NOT NULL,
    qr BLOB, revision TEXT NOT NULL)`);
  const meta = db.prepare(
    "SELECT mode,url,revision,qr IS NOT NULL AS hasQr FROM official_check_in WHERE id=1",
  );
  const image = db.prepare("SELECT qr FROM official_check_in WHERE id=1");
  const write =
    db.prepare(`INSERT INTO official_check_in(id,mode,url,qr,revision) VALUES(1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,url=excluded.url,qr=excluded.qr,revision=excluded.revision WHERE official_check_in.revision=?`);
  const settings = () => (meta.get() as Settings | undefined) ?? blank;
  function privateResponse(reply: FastifyReply) {
    return reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer");
  }
  app.get("/api/check-in", (_req, reply) => {
    const { mode, revision, hasQr } = settings();
    return privateResponse(reply).send({
      mode,
      revision,
      hasQr: !!hasQr,
      eventName: eventName(),
    });
  });
  app.get("/api/check-in/open", (_req, reply) => {
    const { mode, url } = settings();
    return privateResponse(reply).redirect(
      mode === "link" && url ? url : "/#official",
    );
  });
  app.get("/api/check-in/qr", (_req, reply) => {
    const row = image.get() as { qr: Buffer | null } | undefined;
    privateResponse(reply).header("X-Content-Type-Options", "nosniff");
    return row?.qr
      ? reply.type("image/png").send(row.qr)
      : reply.code(404).send({ error: "未配置二维码" });
  });
  app.get("/api/admin/check-in", (req, reply) => {
    privateResponse(reply);
    if (!authorized(req)) return reply.code(401).send({ error: "未授权" });
    const { mode, url, revision, hasQr } = settings();
    return { mode, url, revision, hasQr: !!hasQr };
  });
  app.put(
    "/api/admin/check-in",
    { bodyLimit: 3 * 1024 * 1024 },
    (req, reply) => {
      privateResponse(reply);
      if (!authorized(req)) return reply.code(401).send({ error: "未授权" });
      const b = (req.body ?? {}) as {
        source?: string;
        url?: unknown;
        png?: unknown;
        revision?: string;
      };
      if (b.revision !== settings().revision)
        return reply.code(409).send({ error: "配置已更新，请重新载入后编辑" });
      let mode: Settings["mode"] = "off",
        url = "",
        qr: Buffer | null = null;
      if (b.source === "link") {
        url = httpsTarget(b.url);
        if (!url)
          return reply.code(400).send({ error: "请输入完整的官方 HTTPS 地址" });
        mode = "link";
      } else if (b.source === "auto" || b.source === "qr") {
        try {
          const stored =
            b.png === undefined
              ? (image.get() as { qr: Buffer | null } | undefined)
              : undefined;
          const { png, bytes } = readQr(
            b.png ?? stored?.qr?.toString("base64"),
          );
          qr = bytes;
          if (b.source === "auto") {
            const code = jsQR.default(
              new Uint8ClampedArray(png.data),
              png.width,
              png.height,
            );
            url = httpsTarget(code?.data);
          }
          mode = url ? "link" : "qr";
        } catch {
          return reply
            .code(400)
            .send({ error: "图片无法读取，请提供清晰的 PNG 或 JPEG 二维码" });
        }
      } else if (b.source !== "off") {
        return reply.code(400).send({ error: "请选择入口类型" });
      }
      const revision = randomUUID();
      if (!write.run(mode, url, qr, revision, b.revision).changes)
        return reply.code(409).send({ error: "配置已更新，请重新载入后编辑" });
      return { mode, url, hasQr: !!qr, revision };
    },
  );
}
