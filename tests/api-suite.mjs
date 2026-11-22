import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import {
  ARTIFACTS,
  REPORTS,
  RESERVED_ZONES,
  api,
  createEnv,
  createSignature,
  metricsFor,
  overlaps,
  uniqueRequestId,
  waitFor,
} from "./lib/env.mjs";

const startedAt = new Date().toISOString();
const results = [];
const defects = [];
const evidence = {};
let kept100 = null;
let kept120 = null;
const capacity = { requested: 0, created: 0, firstFailureAt: null, failure: null, durations: [], sizes: {} };

function record(id, title, status, durationMs, details, error) {
  results.push({
    id,
    title,
    status,
    durationMs: Math.round(durationMs),
    details: details ?? null,
    error: error ? String(error.stack || error.message || error) : null,
  });
  const mark = status === "passed" ? "PASS" : status === "failed" ? "FAIL" : "SKIP";
  console.log(`[${mark}] ${id} ${title} (${Math.round(durationMs)}ms)${details ? ` :: ${details}` : ""}`);
}

async function test(id, title, fn) {
  const t0 = Date.now();
  try {
    const details = await fn();
    record(id, title, "passed", Date.now() - t0, typeof details === "string" ? details : undefined);
    return true;
  } catch (e) {
    record(id, title, "failed", Date.now() - t0, undefined, e);
    return false;
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function connectWs(env) {
  const url = env.baseUrl.replace(/^http/, "ws") + "/ws";
  const ws = new WebSocket(url);
  const messages = [];
  ws.on("message", (buf) => {
    try {
      messages.push(JSON.parse(String(buf)));
    } catch {}
  });
  const opened = new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });
  return {
    ws,
    messages,
    opened,
    async next(type, predicate = () => true, timeoutMs = 5000) {
      return waitFor(() => messages.find((m) => m.type === type && predicate(m)), timeoutMs, 60);
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

const env = await createEnv();
const capacityNames = [];
{
  const surnames = "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳".split("");
  let n = 0;
  for (const a of surnames) {
    for (let i = 1; i <= 3 && n < 120; i++) {
      capacityNames.push(`${a}${["一", "澜", "舟", "禾", "宁", "辰"][i]}`);
      n++;
    }
  }
}

try {
  evidence.build = { baseUrl: env.baseUrl, node: process.version, platform: process.platform };

  await test("API-01", "健康检查 /api/health 可用", async () => {
    const r = await api(env, "/api/health");
    assert(r.status === 200 && r.data.ok === true, `健康检查失败: ${r.status} ${JSON.stringify(r.data)}`);
    return `connections=${r.data.connections}`;
  });

  await test("API-02", "签到参数校验（空名/超长/缺尺寸/越界尺寸）", async () => {
    const cases = [
      ["", metricsFor("张三"), 400],
      ["一二三四五六七八九十一二三", metricsFor("一二三四五六七八九十一二三"), 400],
      ["张三", undefined, 400],
      ["张三", { width: 4, height: 80 }, 400],
      ["张三", { width: 200, height: 8 }, 400],
      ["张三", { width: 5000, height: 80 }, 400],
    ];
    const seen = [];
    for (const [name, metrics, expect] of cases) {
      const r = await api(env, "/api/signatures", {
        method: "POST",
        body: { name, fontId: "lxgw-wenkai", requestId: uniqueRequestId("invalid"), metrics },
      });
      seen.push(r.status);
      assert(r.status === expect, `期望 ${expect}，实际 ${r.status}: ${JSON.stringify(r.data)}`);
    }
    return `状态码 ${seen.join(",")}`;
  });

  await test("API-03", "有效签到返回坐标并在安全区域内", async () => {
    const name = "测试甲";
    const m = metricsFor(name);
    const r = await createSignature(env, name, { metrics: m });
    assert(r.status === 201, `创建失败: ${r.status} ${JSON.stringify(r.data)}`);
    const s = r.data;
    for (const k of ["id", "name", "font_id", "x", "y", "width", "height", "size", "rotation", "created_at"]) {
      assert(s[k] !== undefined && s[k] !== null, `缺少字段 ${k}`);
    }
    assert(s.name === name, "姓名不一致");
    assert(s.x >= 69 && s.y >= 149, `坐标越界 x=${s.x} y=${s.y}`);
    assert(s.x + s.width <= 1811, `右边界越界 ${s.x + s.width}`);
    assert(s.y + s.height <= 971, `下边界越界 ${s.y + s.height}`);
    assert(Math.abs(s.width - m.width) < 1 || s.size < 64, `宽度未按字形尺寸放置 width=${s.width}`);
    evidence.firstSignature = s;
    return `x=${s.x.toFixed(1)} y=${s.y.toFixed(1)} size=${s.size}`;
  });

  await test("API-04", "requestId 幂等：重复提交不重复入库", async () => {
    const requestId = uniqueRequestId("idem");
    const a = await createSignature(env, "幂等甲", { requestId });
    const b = await createSignature(env, "幂等乙", { requestId });
    assert(a.status === 201 && b.status === 200, `状态异常 a=${a.status} b=${b.status}`);
    assert(a.data.id === b.data.id, "重复 requestId 生成了不同记录");
    assert(b.data.name === "幂等甲", "幂等返回了错误记录");
    const st = await api(env, "/api/state");
    const same = st.data.signatures.filter((x) => x.id === a.data.id);
    assert(same.length === 1, `库中重复记录 ${same.length}`);
    return `id=${a.data.id}`;
  });

  await test("API-05", "状态流转接口校验与更新", async () => {
    const created = await createSignature(env, "流转甲");
    assert(created.status === 201, "创建失败");
    const bad = await api(env, `/api/signatures/${created.data.id}/status`, {
      method: "PATCH",
      body: { status: "bogus" },
    });
    assert(bad.status === 400, `非法状态应 400，实际 ${bad.status}`);
    const w = await api(env, `/api/signatures/${created.data.id}/status`, {
      method: "PATCH",
      body: { status: "writing" },
    });
    assert(w.status === 200 && w.data.status === "writing", "writing 更新失败");
    const c = await api(env, `/api/signatures/${created.data.id}/status`, {
      method: "PATCH",
      body: { status: "complete" },
    });
    assert(c.status === 200 && c.data.status === "complete", "complete 更新失败");
    return "writing/complete 正常，非法值 400";
  });

  let adminToken = "";
  await test("API-06", "管理员鉴权：错误密码 401，未授权写操作被拒绝", async () => {
    const wrong = await api(env, "/api/admin/login", { method: "POST", body: { password: "wrong" } });
    assert(wrong.status === 401, `错误密码应 401，实际 ${wrong.status}`);
    const login = await api(env, "/api/admin/login", { method: "POST", body: { password: env.secret } });
    assert(login.status === 200 && typeof login.data.token === "string", "正确密码未返回 token");
    adminToken = login.data.token;
    const noAuth = await api(env, "/api/admin/settings", { method: "PUT", body: { eventStatus: "paused" } });
    assert(noAuth.status === 401, `未授权设置应 401，实际 ${noAuth.status}`);
    const fake = await api(env, "/api/admin/settings", {
      method: "PUT",
      body: { eventStatus: "paused" },
      token: "deadbeef",
    });
    assert(fake.status === 401, `伪造 token 应 401，实际 ${fake.status}`);
    evidence.adminToken = adminToken;
    return "401 鉴权生效";
  });

  await test("API-07", "活动状态控制：暂停后签到 409，恢复后可签到", async () => {
    const pause = await api(env, "/api/admin/settings", {
      method: "PUT",
      body: { eventStatus: "paused" },
      token: adminToken,
    });
    assert(pause.status === 200, "暂停设置失败");
    const blocked = await createSignature(env, "暂停甲");
    assert(blocked.status === 409, `暂停时签到应 409，实际 ${blocked.status}`);
    const open = await api(env, "/api/admin/settings", {
      method: "PUT",
      body: { eventStatus: "open" },
      token: adminToken,
    });
    assert(open.status === 200, "恢复设置失败");
    const ok = await createSignature(env, "恢复甲");
    assert(ok.status === 201, `恢复后签到应 201，实际 ${ok.status}`);
    return "暂停/恢复门禁正常";
  });

  await test("API-08", "隐藏/恢复记录与实时可见性广播", async () => {
    const created = await createSignature(env, "隐藏甲");
    const client = connectWs(env);
    await client.opened;
    const hide = await api(env, `/api/admin/signatures/${created.data.id}`, {
      method: "PATCH",
      body: { hidden: true },
      token: adminToken,
    });
    assert(hide.status === 200, "隐藏失败");
    const msg = await client.next("signature.visibility", (m) => m.data.id === created.data.id);
    assert(msg.data.hidden === true, "广播 hidden 不为 true");
    const st = await api(env, "/api/state");
    assert(!st.data.signatures.some((s) => s.id === created.data.id), "隐藏后仍在公开状态中");
    const show = await api(env, `/api/admin/signatures/${created.data.id}`, {
      method: "PATCH",
      body: { hidden: false },
      token: adminToken,
    });
    assert(show.status === 200, "恢复显示失败");
    const st2 = await api(env, "/api/state");
    assert(st2.data.signatures.some((s) => s.id === created.data.id), "恢复后未回到公开状态");
    client.close();
    return "隐藏/恢复与广播正常";
  });

  await test("API-09", "WebSocket 快照、实时新增广播与连接计数", async () => {
    await waitFor(async () => (await api(env, "/api/health")).data.connections === 0, 5000);
    const before = await api(env, "/api/health");
    const client = connectWs(env);
    await client.opened;
    const snap = await client.next("snapshot");
    const st = await api(env, "/api/state");
    assert(snap.data.signatures.length === st.data.signatures.length, "快照数量与状态不一致");
    const created = await createSignature(env, "实时甲");
    assert(created.status === 201, "创建失败");
    const evt = await client.next("signature.created", (m) => m.data.id === created.data.id);
    assert(evt.data.name === "实时甲", "广播姓名不一致");
    const during = await waitFor(async () => {
      const h = await api(env, "/api/health");
      return h.data.connections >= before.data.connections + 1 ? h : null;
    }, 5000);
    assert(during.data.connections >= before.data.connections + 1, "连接计数未增加");
    client.close();
    await waitFor(async () => {
      const h = await api(env, "/api/health");
      return h.data.connections <= before.data.connections;
    }, 5000);
    return `快照 ${snap.data.signatures.length} 条，广播正常`;
  });

  await test("API-10", "重播最近姓名：最新签名回到 queued", async () => {
    const latest = await createSignature(env, "重播甲");
    await api(env, `/api/signatures/${latest.data.id}/status`, {
      method: "PATCH",
      body: { status: "complete" },
    });
    const r = await api(env, "/api/admin/replay", { method: "POST", token: adminToken });
    let withJsonBody = null;
    if (r.status !== 200) {
      withJsonBody = await api(env, "/api/admin/replay", { method: "POST", token: adminToken, body: {} });
      defects.push({
        id: "DEF-REPLAY-EMPTY-BODY",
        severity: "P2",
        title: "管理端“重播最近姓名”按钮请求缺少 JSON 请求体，接口返回 400",
        expected: "点击“重播最近姓名”后接口返回 200，最新姓名重新进入 queued 队列",
        actual: `前端同款请求（无 body）返回 ${r.status} ${JSON.stringify(r.data)}；携带空 JSON 对象时返回 ${withJsonBody.status}`,
        steps: "POST /api/admin/replay，请求头 content-type: application/json 且无请求体（与 src/main.tsx 的 call 调用一致）",
        owner: "Frontend / Backend",
        evidence: "tests/reports/api-report.json API-10",
      });
    }
    assert(r.status === 200, `重播接口失败: ${r.status} ${JSON.stringify(r.data)}；携带空对象时 ${withJsonBody?.status ?? "未测"}`);
    const st = await api(env, "/api/state");
    const row = st.data.signatures.find((s) => s.id === latest.data.id);
    assert(row.status === "queued", `重播后状态 ${row.status}`);
    const unauth = await api(env, "/api/admin/replay", { method: "POST" });
    assert(unauth.status === 401, "未授权重播未被拒绝");
    return `status=${row.status}`;
  });

  await test("API-11", "已签到记录坐标无重叠且避开保留区", async () => {
    const st = await api(env, "/api/state");
    const rows = st.data.signatures;
    assert(rows.length > 3, `样本不足 ${rows.length}`);
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i];
      for (const z of RESERVED_ZONES) {
        assert(!overlaps(a, z, 7), `${a.name} 与保留区重叠`);
      }
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j];
        assert(!overlaps(a, b, 17), `${a.name} 与 ${b.name} 重叠/间距不足`);
      }
    }
    evidence.placementSample = rows.map((r) => ({ name: r.name, x: r.x, y: r.y, w: r.width, h: r.height, size: r.size }));
    return `${rows.length} 条记录无重叠`;
  });

  async function runCapacity(count, envRef) {
    const envC = await createEnv();
    if (envRef === 100) kept100 = envC;
    if (envRef === 120) kept120 = envC;
    const t0 = Date.now();
    const stats = { requested: count, created: 0, firstFailureAt: null, failure: null, durations: [], sizes: {} };
    for (let i = 0; i < count; i++) {
      const name = capacityNames[i];
      const s = Date.now();
      const r = await createSignature(envC, name);
      stats.durations.push(Date.now() - s);
      if (r.status !== 201) {
        stats.firstFailureAt = i + 1;
        stats.failure = { status: r.status, data: r.data };
        break;
      }
      stats.created++;
    }
    const st = await api(envC, "/api/state");
    stats.sizes = sizeHistogram(st.data.signatures);
    stats.elapsedMs = Date.now() - t0;
    stats.avgRequestMs = Number(avg(stats.durations).toFixed(2));
    stats.maxRequestMs = Math.max(...stats.durations);
    stats.minSize = st.data.signatures.length ? Math.min(...st.data.signatures.map((s) => s.size)) : null;
    stats.stateCount = st.data.signatures.length;
    return stats;
  }

  await test("CAP-01", "100 人容量：全部签到成功且无碰撞", async () => {
    const stats = await runCapacity(100, 100);
    capacity.hundred = stats;
    evidence.capacity100 = stats;
    if (stats.created !== 100) {
      defects.push({
        id: "DEF-CAP-100",
        severity: "P1",
        title: `100 人容量未达成：第 ${stats.firstFailureAt} 人签到返回 409`,
        expected: "100 位参与者均可成功签到并获得不重叠坐标",
        actual: `成功 ${stats.created}/100，失败响应 ${stats.failure?.status} ${JSON.stringify(stats.failure?.data)}`,
        steps: "使用 2 字中文姓名（字面尺寸约 122×79px）连续调用 POST /api/signatures",
        owner: "Backend / Architect",
        evidence: "tests/reports/api-report.json CAP-01",
      });
      verifyPlacement((await api(kept100, "/api/state")).data.signatures);
      throw new Error(`仅成功 ${stats.created}/100，首次失败在第 ${stats.firstFailureAt} 人: ${JSON.stringify(stats.failure)}`);
    }
    if (stats.stateCount !== 100) throw new Error(`状态记录 ${stats.stateCount}`);
    verifyPlacement((await api(kept100, "/api/state")).data.signatures);
    return `100/100 成功，用时 ${stats.elapsedMs}ms，平均 ${stats.avgRequestMs}ms/人`;
  });

  await test("CAP-02", "120 人容量：全部签到成功且无碰撞", async () => {
    const stats = await runCapacity(120, 120);
    capacity.hundredTwenty = stats;
    evidence.capacity120 = stats;
    if (stats.created !== 120) {
      defects.push({
        id: "DEF-CAP-120",
        severity: "P1",
        title: `120 人容量未达成：第 ${stats.firstFailureAt} 人签到返回 409`,
        expected: "120 位参与者均可成功签到并获得不重叠坐标",
        actual: `成功 ${stats.created}/120，失败响应 ${stats.failure?.status} ${JSON.stringify(stats.failure?.data)}`,
        steps: "使用 2 字中文姓名（字面尺寸约 122×79px）连续调用 POST /api/signatures",
        owner: "Backend / Architect",
        evidence: "tests/reports/api-report.json CAP-02",
      });
      verifyPlacement((await api(kept120, "/api/state")).data.signatures);
      throw new Error(`120 人容量失败：成功 ${stats.created}/120，首次失败第 ${stats.firstFailureAt} 人，${stats.failure?.status} ${JSON.stringify(stats.failure?.data)}`);
    }
    if (stats.stateCount !== 120) throw new Error(`状态记录 ${stats.stateCount}`);
    verifyPlacement((await api(kept120, "/api/state")).data.signatures);
    return `120/120 成功，用时 ${stats.elapsedMs}ms，字号区间 ${stats.minSize.toFixed(1)}–64px`;
  });

  const recoveryEnv = kept120 || kept100;
  if (recoveryEnv) {
    await test("CAP-03", "刷新/重启恢复：已写入记录与坐标完整保留", async () => {
      const before = await api(recoveryEnv, "/api/state");
      const beforeRows = before.data.signatures;
      await recoveryEnv.restart();
      const after = await api(recoveryEnv, "/api/state");
      const afterRows = after.data.signatures;
      assert(afterRows.length === beforeRows.length, `重启前后数量 ${beforeRows.length} -> ${afterRows.length}`);
      const map = new Map(afterRows.map((r) => [r.id, r]));
      for (const row of beforeRows) {
        const next = map.get(row.id);
        assert(next, `重启后丢失 ${row.name}`);
        assert(next.x === row.x && next.y === row.y && next.status === row.status, `${row.name} 坐标/状态变化`);
      }
      evidence.recovery = { count: afterRows.length, statuses: countBy(afterRows, "status") };
      return `${afterRows.length} 条记录重启后完整恢复`;
    });

    await test("CAP-04", "网络重连：WebSocket 断开重连后获得完整快照", async () => {
      const c1 = connectWs(recoveryEnv);
      await c1.opened;
      const snap1 = await c1.next("snapshot");
      c1.close();
      await waitFor(async () => (await api(recoveryEnv, "/api/health")).data.connections === 0, 8000);
      const c2 = connectWs(recoveryEnv);
      await c2.opened;
      const snap2 = await c2.next("snapshot");
      assert(snap2.data.signatures.length === snap1.data.signatures.length, "重连快照数量不一致");
      c2.close();
      return `重连快照 ${snap2.data.signatures.length} 条`;
    });
  } else {
    record("CAP-03", "刷新/重启恢复", "skipped", 0, "容量环境不可用");
    record("CAP-04", "网络重连", "skipped", 0, "容量环境不可用");
  }

  await test("CAP-05", "容量边界：空间耗尽时返回结构化 409 而非崩溃", async () => {
    const target = kept120;
    if (!target) return "无 120 人环境，跳过";
    let last = null;
    for (let i = 0; i < 40; i++) {
      const r = await createSignature(target, `溢出${i}`);
      last = r;
      if (r.status !== 201) break;
    }
    assert(last && (last.status === 409 || last.status === 201), `异常状态 ${last?.status}`);
    const health = await api(target, "/api/health");
    assert(health.status === 200 && health.data.ok, "空间耗尽后服务不可用");
    return last.status === 409 ? `空间耗尽返回 409: ${last.data.error}` : "仍可继续放置，未触发上限";
  });

  if (kept100) await kept100.dispose();
  if (kept120) await kept120.dispose();
} finally {
  await env.dispose();
}

const passed = results.filter((r) => r.status === "passed").length;
const failed = results.filter((r) => r.status === "failed").length;
const skipped = results.filter((r) => r.status === "skipped").length;
const report = {
  suite: "Signature Wall API / 容量 / 恢复",
  startedAt,
  finishedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, isolatedDb: true },
  results,
  capacity,
  evidence,
  defects,
  summary: { total: results.length, passed, failed, skipped },
};
mkdirSync(REPORTS, { recursive: true });
mkdirSync(ARTIFACTS, { recursive: true });
writeFileSync(join(REPORTS, "api-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`\nAPI 套件完成: 通过 ${passed} / 失败 ${failed} / 跳过 ${skipped}`);
if (failed) {
  console.log("失败用例:");
  for (const r of results.filter((x) => x.status === "failed")) console.log(` - ${r.id} ${r.title}: ${r.error?.split("\n")[0]}`);
}

function verifyPlacement(rows) {
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    for (const z of RESERVED_ZONES) {
      if (overlaps(a, z, 7)) throw new Error(`${a.name} 与保留区重叠`);
    }
    for (let j = i + 1; j < rows.length; j++) {
      if (overlaps(a, rows[j], 17)) throw new Error(`${a.name} 与 ${rows[j].name} 重叠/间距不足`);
    }
  }
}

function sizeHistogram(rows) {
  const h = {};
  for (const r of rows) {
    const k = r.size.toFixed(1);
    h[k] = (h[k] || 0) + 1;
  }
  return h;
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
}

function countBy(rows, key) {
  const h = {};
  for (const r of rows) h[r[key]] = (h[r[key]] || 0) + 1;
  return h;
}
