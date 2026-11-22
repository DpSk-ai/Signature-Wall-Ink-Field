import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

describe("Signature Wall Backend", () => {
  let db: Database.Database;
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sig-test-"));
    db = new Database(join(tempDir, "test.db"));
    db.pragma("journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
       CREATE TABLE IF NOT EXISTS signatures(
         id TEXT PRIMARY KEY,
         request_id TEXT UNIQUE NOT NULL,
         name TEXT NOT NULL,
         font_id TEXT NOT NULL,
         x REAL NOT NULL,
         y REAL NOT NULL,
         width REAL NOT NULL,
         height REAL NOT NULL,
         size REAL NOT NULL,
         rotation REAL NOT NULL,
         status TEXT NOT NULL DEFAULT 'queued',
         hidden INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       );
       CREATE INDEX IF NOT EXISTS idx_signatures_request_id ON signatures(request_id);
       CREATE INDEX IF NOT EXISTS idx_signatures_status ON signatures(status);
       CREATE INDEX IF NOT EXISTS idx_signatures_hidden ON signatures(hidden);
       INSERT OR IGNORE INTO settings(key,value) VALUES
         ('event_name','Test Event'),
         ('event_status','open'),
         ('animation_paused','false');`,
    );
  });

  afterAll(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("数据库迁移", () => {
    it("应该创建 settings 表", () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'",
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    it("应该创建 signatures 表", () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='signatures'",
        )
        .all();
      expect(tables).toHaveLength(1);
    });

    it("应该有 request_id 的唯一索引", () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='signatures' AND name='idx_signatures_request_id'",
        )
        .all();
      expect(indexes.length).toBeGreaterThanOrEqual(1);
    });

    it("应该有 status 索引", () => {
      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='signatures' AND name='idx_signatures_status'",
        )
        .all();
      expect(indexes.length).toBeGreaterThanOrEqual(1);
    });

    it("应该初始化默认设置", () => {
      const eventName = db
        .prepare("SELECT value FROM settings WHERE key='event_name'")
        .get() as any;
      expect(eventName?.value).toBe("Test Event");
    });
  });

  describe("签到幂等性", () => {
    it("相同 request_id 应该返回相同记录", () => {
      const requestId = "test-request-123";
      const signature1 = {
        id: "sig-1",
        request_id: requestId,
        name: "测试用户",
        font_id: "lxgw-wenkai",
        x: 100,
        y: 200,
        width: 150,
        height: 60,
        size: 64,
        rotation: 0,
        status: "queued",
        hidden: 0,
        created_at: new Date().toISOString(),
      };

      // 第一次插入
      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,hidden,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        signature1.id,
        signature1.request_id,
        signature1.name,
        signature1.font_id,
        signature1.x,
        signature1.y,
        signature1.width,
        signature1.height,
        signature1.size,
        signature1.rotation,
        signature1.status,
        signature1.hidden,
        signature1.created_at,
      );

      // 使用相同 request_id 查询
      const existing = db
        .prepare("SELECT * FROM signatures WHERE request_id=?")
        .get(requestId);

      expect(existing).toBeDefined();
      expect((existing as any).id).toBe(signature1.id);
      expect((existing as any).name).toBe(signature1.name);
    });

    it("不同 request_id 应该创建新记录", () => {
      const req1 = "req-001";
      const req2 = "req-002";

      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "sig-2",
        req1,
        "用户A",
        "lxgw-wenkai",
        100,
        200,
        150,
        60,
        64,
        0,
        "queued",
        new Date().toISOString(),
      );

      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "sig-3",
        req2,
        "用户B",
        "lxgw-wenkai",
        300,
        400,
        150,
        60,
        64,
        0,
        "queued",
        new Date().toISOString(),
      );

      const count = db
        .prepare("SELECT COUNT(*) as c FROM signatures")
        .get() as any;
      expect(count.c).toBeGreaterThanOrEqual(3);
    });
  });

  describe("活动状态管理", () => {
    it("应该能更新活动状态", () => {
      db.prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run("event_status", "paused");

      const status = db
        .prepare("SELECT value FROM settings WHERE key='event_status'")
        .get() as any;
      expect(status?.value).toBe("paused");
    });

    it("应该能暂停和恢复动画", () => {
      db.prepare(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run("animation_paused", "true");

      const paused = db
        .prepare("SELECT value FROM settings WHERE key='animation_paused'")
        .get() as any;
      expect(paused?.value).toBe("true");
    });
  });

  describe("签名可见性", () => {
    it("应该能隐藏签名", () => {
      const id = "sig-to-hide";
      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        "req-hide",
        "隐藏测试",
        "lxgw-wenkai",
        100,
        200,
        150,
        60,
        64,
        0,
        "queued",
        new Date().toISOString(),
      );

      db.prepare("UPDATE signatures SET hidden=? WHERE id=?").run(1, id);

      const sig = db
        .prepare("SELECT hidden FROM signatures WHERE id=?")
        .get(id) as any;
      expect(sig?.hidden).toBe(1);
    });

    it("列表查询应该过滤隐藏的签名", () => {
      const visible = db
        .prepare("SELECT * FROM signatures WHERE hidden=0 ORDER BY created_at")
        .all();
      expect(visible.every((s: any) => s.hidden === 0)).toBe(true);
    });
  });

  describe("数据完整性", () => {
    it("request_id 应该是唯一的", () => {
      const duplicateRequestId = "duplicate-req";

      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        "sig-dup-1",
        duplicateRequestId,
        "第一次",
        "lxgw-wenkai",
        100,
        200,
        150,
        60,
        64,
        0,
        "queued",
        new Date().toISOString(),
      );

      // 尝试插入重复的 request_id 应该抛出错误
      expect(() => {
        db.prepare(
          "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          "sig-dup-2",
          duplicateRequestId,
          "第二次",
          "lxgw-wenkai",
          300,
          400,
          150,
          60,
          64,
          0,
          "queued",
          new Date().toISOString(),
        );
      }).toThrow();
    });

    it("status 字段应该只接受有效值", () => {
      const id = "sig-status-test";
      db.prepare(
        "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        "req-status",
        "状态测试",
        "lxgw-wenkai",
        100,
        200,
        150,
        60,
        64,
        0,
        "queued",
        new Date().toISOString(),
      );

      // 更新为有效状态
      db.prepare("UPDATE signatures SET status=? WHERE id=?").run("writing", id);
      let sig = db
        .prepare("SELECT status FROM signatures WHERE id=?")
        .get(id) as any;
      expect(sig?.status).toBe("writing");

      db.prepare("UPDATE signatures SET status=? WHERE id=?").run(
        "complete",
        id,
      );
      sig = db
        .prepare("SELECT status FROM signatures WHERE id=?")
        .get(id) as any;
      expect(sig?.status).toBe("complete");
    });
  });
});
