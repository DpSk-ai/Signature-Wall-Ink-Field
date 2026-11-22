import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPORTS,
  api,
  createEnv,
  createSignature,
  metricsFor,
  overlaps,
  uniqueRequestId,
  waitFor,
} from "./lib/env.mjs";

const results = [];
const startedAt = new Date().toISOString();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(id, title, fn) {
  const t0 = Date.now();
  try {
    const details = await fn();
    results.push({
      id,
      title,
      status: "passed",
      durationMs: Date.now() - t0,
      details: details ?? null,
    });
    console.log(`[PASS] ${id} ${title} (${Date.now() - t0}ms)${details ? ` :: ${details}` : ""}`);
  } catch (error) {
    results.push({
      id,
      title,
      status: "failed",
      durationMs: Date.now() - t0,
      error: String(error.stack || error.message || error),
    });
    console.log(`[FAIL] ${id} ${title} (${Date.now() - t0}ms) :: ${error.message}`);
  }
}

const env = await createEnv();
let token = "";

try {
  const login = await api(env, "/api/admin/login", {
    method: "POST",
    body: { password: env.secret },
  });
  assert(login.status === 200 && login.data.token, "管理员登录失败");
  token = login.data.token;

  await test("REG-01", "暂停签到后重复 requestId 仍返回原记录", async () => {
    const requestId = uniqueRequestId("paused-idem");
    const before = await createSignature(env, "暂停幂等甲", { requestId });
    assert(before.status === 201, `首次签到 ${before.status}`);
    await api(env, "/api/admin/settings", {
      method: "PUT",
      body: { eventStatus: "paused" },
      token,
    });
    const replay = await api(env, "/api/signatures", {
      method: "POST",
      body: {
        name: "暂停幂等乙",
        fontId: "lxgw-wenkai",
        requestId,
        metrics: metricsFor("暂停幂等乙"),
      },
    });
    assert(replay.status === 200, `重复提交应 200，实际 ${replay.status}`);
    assert(replay.data.id === before.data.id, "重复提交返回了不同记录");
    assert(replay.data.name === "暂停幂等甲", "重复提交覆盖了姓名");
    await api(env, "/api/admin/settings", {
      method: "PUT",
      body: { eventStatus: "open" },
      token,
    });
    return `id=${replay.data.id}`;
  });

  await test("REG-02", "并发相同 requestId 只创建一条记录", async () => {
    const requestId = uniqueRequestId("concurrent");
    const body = {
      name: "并发甲",
      fontId: "lxgw-wenkai",
      requestId,
      metrics: metricsFor("并发甲"),
    };
    const [a, b] = await Promise.all([
      api(env, "/api/signatures", { method: "POST", body }),
      api(env, "/api/signatures", { method: "POST", body }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert(statuses[0] === 200 && statuses[1] === 201, `状态异常 ${statuses.join(",")}`);
    assert(a.data.id === b.data.id, "并发请求生成了不同记录");
    const state = await api(env, "/api/state");
    const rows = state.data.signatures.filter((row) => row.request_id === requestId);
    assert(rows.length === 1, `库中记录数为 ${rows.length}`);
    return `id=${a.data.id}`;
  });

  await test("REG-03", "状态更新对不存在记录返回 404", async () => {
    const response = await api(env, "/api/signatures/not-exists/status", {
      method: "PATCH",
      body: { status: "writing" },
    });
    assert(response.status === 404, `期望 404，实际 ${response.status}`);
    return "404";
  });

  await test("REG-04", "隐藏不存在的记录返回 404", async () => {
    const response = await api(env, "/api/admin/signatures/not-exists", {
      method: "PATCH",
      body: { hidden: true },
      token,
    });
    assert(response.status === 404, `期望 404，实际 ${response.status}`);
    return "404";
  });

  await test("REG-05", "隐藏记录仍占用布局，恢复显示后不重叠", async () => {
    const hidden = await createSignature(env, "先隐藏");
    assert(hidden.status === 201, `创建失败 ${hidden.status}`);
    const hide = await api(env, `/api/admin/signatures/${hidden.data.id}`, {
      method: "PATCH",
      body: { hidden: true },
      token,
    });
    assert(hide.status === 200, `隐藏失败 ${hide.status}`);
    const visible = await createSignature(env, "后显示");
    assert(visible.status === 201, `创建失败 ${visible.status}`);
    const show = await api(env, `/api/admin/signatures/${hidden.data.id}`, {
      method: "PATCH",
      body: { hidden: false },
      token,
    });
    assert(show.status === 200, `恢复失败 ${show.status}`);
    assert(!overlaps(hidden.data, visible.data, 17), "恢复显示后与后续签名重叠");
    return "无重叠";
  });

  await test("REG-06", "断线后连接计数清理并可用新连接获取完整快照", async () => {
    const before = await api(env, "/api/health");
    const WebSocket = (await import("ws")).default;
    const ws = new WebSocket(env.baseUrl.replace(/^http/, "ws") + "/ws");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const snapshot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("未收到快照")), 5000);
      ws.on("message", (buf) => {
        const message = JSON.parse(String(buf));
        if (message.type === "snapshot") {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
    ws.terminate();
    await waitFor(
      async () => (await api(env, "/api/health")).data.connections === before.data.connections,
      8000,
    );
    assert(snapshot.data.signatures.length > 0, "快照记录为空");
    return `快照 ${snapshot.data.signatures.length} 条`;
  });
} finally {
  await env.dispose();
}

const passed = results.filter((result) => result.status === "passed").length;
const failed = results.filter((result) => result.status === "failed").length;
mkdirSync(REPORTS, { recursive: true });
writeFileSync(
  join(REPORTS, "backend-regression.json"),
  JSON.stringify(
    {
      suite: "Signature Wall 后端回归",
      startedAt,
      finishedAt: new Date().toISOString(),
      results,
      summary: { total: results.length, passed, failed },
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`\n后端回归完成: 通过 ${passed} / 失败 ${failed}`);
if (failed) process.exitCode = 1;
