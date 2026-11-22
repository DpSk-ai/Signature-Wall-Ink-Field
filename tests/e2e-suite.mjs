import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  ARTIFACTS,
  REPORTS,
  api,
  createEnv,
  createSignature,
  metricsFor,
  pngSize,
  waitFor,
} from "./lib/env.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const startedAt = new Date().toISOString();
const results = [];
const defects = [];
const evidence = {};
const consoleNoise =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|favicon\.ico|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED|status of 40[01] \(/i;

mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

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

function monitor(page) {
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const source = m.location?.()?.url || "";
    if (consoleNoise.test(source)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`);
  });
  return {
    errors,
    failedRequests,
    seriousErrors() {
      return errors.filter((e) => !consoleNoise.test(e));
    },
    fontFailures() {
      return failedRequests.filter((u) => /\/fonts\//.test(u));
    },
  };
}

const shot = async (page, name) => {
  const file = join(ARTIFACTS, name);
  await page.screenshot({ path: file, fullPage: false });
  return file;
};

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
const env = await createEnv();
let animEnv = null;
let renderEnv = null;
let wallContext = null;
let adminContext = null;
let mobileContext = null;

try {
  const seededNames = [];
  for (const [name, fontId] of [
    ["林小满", "lxgw-wenkai"],
    ["周砚", "ma-shan-zheng"],
    ["苏禾", "zcool-xiaowei"],
    ["陈一澜", "source-han-serif"],
  ]) {
    const r = await createSignature(env, name, { fontId });
    if (r.status === 201) seededNames.push(name);
  }
  evidence.seeded = seededNames;

  mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mobile = await mobileContext.newPage();
  const mobileMon = monitor(mobile);
  await mobile.goto(env.baseUrl + "/", { waitUntil: "domcontentloaded" });
  await mobile.getByRole("link", {name:"留下你的名字"}).click();
  await mobile.waitForSelector("input#name");

  await test("E2E-01", "手机签到页正常加载，无横向溢出与控制台异常", async () => {
    const h1 = (await mobile.locator("h1").first().innerText()).replace(/\s+/g, "");
    assert(h1 === "留下你的名字" && await mobile.getByRole("link", {name:"返回活动入口"}).isVisible(), `标题异常: ${h1}`);
    assert(await mobile.locator("input#name").isVisible(), "姓名输入框不可见");
    assert((await mobile.locator(".font-card").count()) >= 1, "字体卡片未渲染");
    const overflow = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    assert(overflow.scrollWidth <= overflow.innerWidth + 1, `横向溢出 ${overflow.scrollWidth}>${overflow.innerWidth}`);
    const errors = mobileMon.seriousErrors();
    assert(errors.length === 0, `控制台/页面错误: ${errors.join(" | ")}`);
    const file = await shot(mobile, "01-mobile-sign.png");
    return `视口 390×844，字体错误请求 ${mobileMon.fontFailures().length} 个；截图 ${file}`;
  });

  await test("E2E-02", "字体分类选择与字体一致性（预览字体与所选字体映射一致）", async () => {
    await mobile.locator(".tabs button", { hasText: "手写" }).click();
    const card = mobile.locator(".font-card", { hasText: "霞鹜文楷" });
    assert((await card.count()) === 1, "手写分类下未找到霞鹜文楷");
    await card.click();
    await mobile.locator("input#name").fill("林小满");
    await mobile.waitForFunction(()=>!document.querySelector("button.primary").disabled);
    const styles = await mobile.evaluate(() => {
      const preview = document.querySelector(".preview");
      const selected = document.querySelector(".font-card.selected");
      return {
        previewFamily: preview ? getComputedStyle(preview).fontFamily : "",
        selectedText: selected?.textContent || "",
        loaded: document.fonts ? document.fonts.check('64px "LXGW WenKai"', "林小满") : null,
      };
    });
    assert(/LXGW WenKai/i.test(styles.previewFamily), `预览字体未应用: ${styles.previewFamily}`);
    assert(styles.selectedText.includes("霞鹜文楷"), "字体卡片未显示选中态");
    evidence.font = styles;
    return `preview=${styles.previewFamily}，document.fonts.check=${styles.loaded}，字体网络失败 ${mobileMon.fontFailures().length}`;
  });

  await test("E2E-03", "手机端提交签到成功并写入后端", async () => {
    const name = "林小满";
    const before = (await api(env, "/api/state")).data.signatures.length;
    await mobile.locator("button.primary", { hasText: "确认签名" }).click();
    await mobile.waitForSelector("main.success", { timeout: 15000 });
    const h1 = await mobile.locator("main.success h1").innerText();
    assert(h1.trim() === name, `成功页姓名 ${h1}`);
    await waitFor(async () => (await api(env, "/api/state")).data.signatures.length === before + 1, 5000);
    const st = await api(env, "/api/state");
    const row = st.data.signatures.filter((s) => s.name === name).at(-1);
    assert(row, "后端未找到签到记录");
    assert(row.font_id === "lxgw-wenkai", `字体未持久化 ${row.font_id}`);
    const file = await shot(mobile, "02-sign-success.png");
    return `记录 id=${row.id}，截图 ${file}`;
  });

  await test("E2E-04", "大屏实时同步：Connect 后收到历史记录，新签到立即出现", async () => {
    wallContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const wall = await wallContext.newPage();
    const mon = monitor(wall);
    await wall.goto(env.baseUrl + "/wall", { waitUntil: "domcontentloaded" });
    await wall.waitForSelector(".signature", { state: "attached" });
    const state = (await api(env, "/api/state")).data;
    const domCount = await wall.locator(".signature").count();
    assert(domCount === state.signatures.length, `大屏 DOM ${domCount} 与后端 ${state.signatures.length} 不一致`);
    const countText = (await wall.locator(".wall-count strong").innerText()).trim();
    assert(Number(countText) === state.signatures.length, `大屏计数 ${countText} 与后端不一致`);
    const name = "实时乙";
    const created = await createSignature(env, name);
    assert(created.status === 201, `实时签到失败 ${created.status}`);
    await wall.waitForFunction(
      (n) => [...document.querySelectorAll(".signature")].some((el) => el.textContent?.includes(n)),
      name,
      { timeout: 6000 },
    );
    const newCount = await wall.locator(".signature").count();
    assert(newCount === state.signatures.length + 1, `实时同步后数量 ${newCount}`);
    const errors = mon.seriousErrors();
    assert(errors.length === 0, `大屏页面错误: ${errors.join(" | ")}`);
    evidence.wallSync = { before: state.signatures.length, after: newCount };
    const file = await shot(wall, "03-wall-realtime.png");
    return `DOM ${state.signatures.length}→${newCount}，截图 ${file}`;
  });

  const wall = wallContext.pages()[0];

  await test("E2E-05", "大屏刷新恢复：F5 后记录与坐标保持", async () => {
    const before = await wall.locator(".signature").count();
    await wall.reload({ waitUntil: "domcontentloaded" });
    await wall.waitForSelector(".signature", { state: "attached" });
    await wall.waitForFunction(
      (n) => document.querySelectorAll(".signature").length === n,
      before,
      { timeout: 6000 },
    );
    const after = await wall.locator(".signature").count();
    assert(after === before, `刷新前后 ${before}→${after}`);
    return `${after} 条记录刷新后保持`;
  });

  await test("E2E-06", "网络断开重连后大屏恢复实时同步", async () => {
    const before = await wall.locator(".signature").count();
    await wallContext.setOffline(true);
    await wall.waitForTimeout(1800);
    await wallContext.setOffline(false);
    await wall.waitForTimeout(3000);
    const name = "重连丙";
    const created = await createSignature(env, name);
    assert(created.status === 201, `重连后创建失败 ${created.status}`);
    await wall.waitForFunction(
      (n) => document.querySelectorAll(".signature").length === n,
      before + 1,
      { timeout: 10000 },
    );
    const after = await wall.locator(".signature").count();
    assert(after === before + 1, `重连后未同步 ${before}→${after}`);
    return `离线/恢复后新增记录已同步（${before}→${after}）`;
  });

  adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  const adminMon = monitor(admin);
  await admin.goto(env.baseUrl + "/admin", { waitUntil: "domcontentloaded" });
  await admin.waitForSelector(".admin-login");

  await test("E2E-07", "管理员登录：错误密码提示，正确密码进入控制台", async () => {
    await admin.locator(".admin-login input").fill("wrong-password");
    await admin.locator("button.primary", { hasText: "登录后台" }).click();
    await admin.waitForSelector(".admin-login .error");
    const err = await admin.locator(".admin-login .error").innerText();
    assert(err.includes("密码错误"), `错误提示异常: ${err}`);
    await admin.locator(".admin-login input").fill(env.secret);
    await admin.locator("button.primary", { hasText: "登录后台" }).click();
    await admin.waitForSelector("main.admin");
    assert((await admin.locator("h1").innerText()).includes("现场控制台"), "未进入控制台");
    const staleToasts = await admin.locator(".toast").allInnerTexts();
    if (staleToasts.some((t) => t.includes("密码错误"))) {
      defects.push({
        id: "DEF-STALE-LOGIN-TOAST",
        severity: "P3",
        title: "登录失败后再登录成功，控制台仍悬浮“密码错误”提示",
        expected: "成功进入后台后清除登录错误提示",
        actual: `进入控制台后仍显示 toast: ${staleToasts.join(" | ")}`,
        steps: "先输错密码触发提示，再输入正确密码登录",
        owner: "Frontend",
        evidence: "tests/reports/e2e-report.json E2E-07",
      });
    }
    const errors = adminMon.seriousErrors();
    assert(errors.length === 0, `管理页错误: ${errors.join(" | ")}`);
    const file = await shot(admin, "04-admin.png");
    return `登录成功，残留提示 ${staleToasts.length}；截图 ${file}`;
  });

  await test("E2E-08", "管理员暂停签到：手机端按钮禁用，接口拒绝写入", async () => {
    await admin.locator(".controls button", { hasText: "暂停署名" }).click();
    await admin.waitForFunction(
      () => document.querySelector(".toast")?.textContent?.includes("操作已保存"),
      null,
      { timeout: 6000 },
    );
    await mobile.goto(env.baseUrl + "/", { waitUntil: "domcontentloaded" });
    await mobile.getByRole("link", {name:"留下你的名字"}).click();
    await mobile.waitForSelector("button.primary");
    await waitFor(async () => (await mobile.locator("button.primary").innerText()).includes("署名暂未开放"), 6000);
    const disabled = await mobile.locator("button.primary").isDisabled();
    assert(disabled, "暂停后签到按钮仍可点击");
    const blocked = await createSignature(env, "暂停测试");
    assert(blocked.status === 409, `暂停时接口返回 ${blocked.status}`);
    await admin.locator(".controls button", { hasText: "开启署名" }).click();
    await waitFor(async () => {
      const r = await api(env, "/api/state");
      return r.data.eventStatus === "open";
    }, 5000);
    return "暂停/恢复门禁在 UI 与 API 均生效";
  });

  await test("E2E-09", "管理员隐藏记录：大屏与后台列表同步移除，且可恢复显示", async () => {
    const wallBefore = Number((await wall.locator(".wall-count strong").innerText()).trim());
    const adminBefore = await admin.locator(".records article").count();
    const hideResponse = admin.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/api/admin/signatures/"),
      { timeout: 10000 },
    );
    await admin.locator(".records article button", { hasText: "隐藏" }).first().click();
    const response = await hideResponse;
    assert(response.ok(), `隐藏请求失败 ${response.status()}`);
    await admin.waitForFunction(
      (n) => document.querySelectorAll(".records article").length === n,
      adminBefore - 1,
      { timeout: 6000 },
    );
    await wall.waitForFunction(
      (n) => Number(document.querySelector(".wall-count strong")?.textContent) === n,
      wallBefore - 1,
      { timeout: 6000 },
    );
    const adminAfter = await admin.locator(".records article").count();
    assert(adminAfter === adminBefore - 1, `后台记录 ${adminBefore}→${adminAfter}`);

    await admin.locator(".section-head button", { hasText: "显示已隐藏" }).click();
    await admin.waitForFunction(
      (n) => document.querySelectorAll(".records article").length >= n,
      adminBefore,
      { timeout: 6000 },
    );
    const canUnhide = await admin.locator(".records article button", { hasText: "恢复" }).count();
    evidence.hide = { wallBefore, wallAfter: wallBefore - 1, adminBefore, adminAfter, canUnhide };
    if (canUnhide === 0) {
      defects.push({
        id: "DEF-HIDE-NO-UNDO",
        severity: "P3",
        title: "隐藏记录后后台不再展示该记录，界面无法恢复显示",
        expected: "误隐藏后可在管理端找回并恢复显示",
        actual: "显示已隐藏后仍无“恢复”入口",
        steps: "管理端点击任一记录“隐藏”，再点击“显示已隐藏”",
        owner: "Frontend / Backend",
        evidence: "tests/reports/e2e-report.json E2E-09",
      });
    }
    assert(canUnhide >= 1, "显示已隐藏后应出现“恢复”按钮");

    const restoreResponse = admin.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().includes("/api/admin/signatures/"),
      { timeout: 10000 },
    );
    await admin.locator(".records article button", { hasText: "恢复" }).first().click();
    await restoreResponse;
    await wall.waitForFunction(
      (n) => Number(document.querySelector(".wall-count strong")?.textContent) === n,
      wallBefore,
      { timeout: 6000 },
    );
    return `大屏 ${wallBefore}→${wallBefore - 1}→${wallBefore}，后台 ${adminBefore}→${adminAfter}，恢复入口 ${canUnhide}`;
  });

  await test("E2E-10", "管理员“重播最近姓名”按钮可用", async () => {
    const before = (await api(env, "/api/state")).data.signatures;
    const responsePromise = admin.waitForResponse((r) => r.url().includes("/api/admin/replay"), { timeout: 10000 });
    await admin.locator(".controls button", { hasText: "重播最近姓名" }).click();
    const response = await responsePromise;
    await admin.waitForTimeout(400);
    const toast = (await admin.locator(".toast").innerText()).trim();
    evidence.replay = { status: response.status(), toast, beforeCount: before.length };
    if (!toast.includes("操作已保存")) {
      defects.push({
        id: "DEF-REPLAY-UI",
        severity: "P2",
        title: "管理端“重播最近姓名”点击后报错，重播无效",
        expected: "提示“操作已保存”，最新姓名重新书写",
        actual: `提示内容：${toast}`,
        steps: "管理端登录后点击“重播最近姓名”",
        owner: "Frontend / Backend",
        evidence: "tests/reports/e2e-report.json E2E-10 + api-report.json API-10",
      });
    }
    assert(toast.includes("操作已保存"), `重播失败提示: ${toast}`);
    return "重播操作成功";
  });

  await test("E2E-11", "4K 纪念图导出：下载成功且分辨率为 3840×2160", async () => {
    const [download] = await Promise.all([
      admin.waitForEvent("download", { timeout: 30000 }),
      admin.locator(".header-actions button", { hasText: "导出 4K 纪念图" }).click(),
    ]);
    const file = join(ARTIFACTS, "signature-wall-4k.png");
    await download.saveAs(file);
    const buf = readFileSync(file);
    const size = pngSize(buf);
    assert(size, "下载文件不是 PNG");
    assert(size.width === 3840 && size.height === 2160, `分辨率 ${size.width}×${size.height}`);
    evidence.export4k = { file, ...size, bytes: buf.length };
    return `3840×2160，${(buf.length / 1024 / 1024).toFixed(2)}MB`;
  });

  await test("E2E-12", "管理端页面无控制台错误与资源加载异常", async () => {
    const errors = adminMon.seriousErrors();
    assert(errors.length === 0, `管理页错误: ${errors.join(" | ")}`);
    return `控制台错误 0，字体网络失败 ${adminMon.fontFailures().length}`;
  });

  animEnv = await createEnv();
  const animNames = ["动画甲", "动画乙", "动画丙"];
  for (const n of animNames) {
    const r = await createSignature(animEnv, n);
    assert(r.status === 201, `动画环境签到失败 ${n} ${r.status}`);
  }
  await test("E2E-13", "大屏队列动画：多人依次书写并完成", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await page.goto(animEnv.baseUrl + "/wall", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".signature", { state: "attached" });
    await page.waitForTimeout(9000);
    const state = (await api(animEnv, "/api/state")).data;
    const statuses = state.signatures.map((s) => `${s.name}:${s.status}`);
    const classes = await page.locator(".signature").evaluateAll((els) =>
      els.map((el) => `${el.textContent}:${el.className}`),
    );
    const done = state.signatures.filter((s) => s.status === "complete").length;
    const file = await shot(page, "05-animation-queue.png");
    await ctx.close();
    if (done !== state.signatures.length) {
      defects.push({
        id: "DEF-ANIM-STUCK",
        severity: "P0",
        title: "大屏仅首个姓名进入书写，状态永久停留在 writing，后续签到不再出现",
        expected: "3 位签到者按顺序依次进入 writing 并最终 complete，全部姓名在大屏可见",
        actual: `等待 9 秒后状态：${statuses.join("，")}；已完成 ${done}/${state.signatures.length}`,
        steps: "向空库连续提交 3 条签到，打开 /wall 等待 9 秒，查询 /api/state",
        owner: "Frontend",
        evidence: `tests/reports/e2e-report.json E2E-13；截图 ${file}`,
        rootCauseHint:
          "src/main.tsx Wall 动画 useEffect：PATCH writing 触发 WS signature.updated 后 state.signatures 变化，effect cleanup 清除了完成计时器，但 active.current 仍为 true，导致后续 effect 直接 return，永不发送 complete。",
      });
      throw new Error(`动画队列未推进：${statuses.join("，")}`);
    }
    return `3/3 完成，DOM: ${classes.join(" | ")}`;
  });

  renderEnv = await createEnv();
  await test("E2E-14", "120 条姓名大屏渲染与布局（数据注入，仅验证渲染能力）", async () => {
    const db = new Database(join(renderEnv.dir, "data", "signature-wall.db"));
    const insert = db.prepare(
      "INSERT INTO signatures(id,request_id,name,font_id,x,y,width,height,size,rotation,status,hidden,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    const fonts = ["lxgw-wenkai", "ma-shan-zheng", "zcool-xiaowei", "source-han-serif", "zcool-kuaile"];
    const base = Date.now() - 240000;
    const tx = db.transaction(() => {
      for (let i = 0; i < 120; i++) {
        const col = i % 12;
        const row = Math.floor(i / 12);
        insert.run(
          randomUUID(),
          `render-${i}`,
          `名${i}`,
          fonts[i % fonts.length],
          70 + col * 115,
          150 + row * 78,
          108,
          48,
          40,
          0,
          "complete",
          0,
          new Date(base + i * 1000).toISOString(),
        );
      }
    });
    tx();
    db.close();
    const st = await api(renderEnv, "/api/state");
    assert(st.data.signatures.length === 120, `注入后状态 ${st.data.signatures.length}`);
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const mon = monitor(page);
    const t0 = Date.now();
    await page.goto(renderEnv.baseUrl + "/wall", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".signature").length === 120, null, { timeout: 15000 });
    const elapsed = Date.now() - t0;
    const count = Number((await page.locator(".wall-count strong").innerText()).trim());
    assert(count === 120, `大屏计数 ${count}`);
    const layout = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".signature")];
      let outside = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2) outside++;
      }
      return { outside, scrollWidth: document.documentElement.scrollWidth, innerWidth };
    });
    assert(layout.outside === 0, `${layout.outside} 条姓名超出视口`);
    assert(layout.scrollWidth <= layout.innerWidth + 1, "页面横向溢出");
    const errors = mon.seriousErrors();
    assert(errors.length === 0, `120 人页面错误: ${errors.join(" | ")}`);
    const file = await shot(page, "06-wall-120.png");
    await ctx.close();
    evidence.render120 = { elapsedMs: elapsed, ...layout, file };
    return `120 条渲染 ${elapsed}ms，溢出 ${layout.outside} 条，截图 ${file}`;
  });
} catch (e) {
  console.error("E2E 套件异常:", e);
  record("E2E-FATAL", "套件执行异常", "failed", 0, undefined, e);
} finally {
  for (const ctx of [wallContext, adminContext, mobileContext]) {
    try {
      await ctx?.close();
    } catch {}
  }
  await browser.close();
  if (animEnv) await animEnv.dispose();
  if (renderEnv) await renderEnv.dispose();
  await env.dispose();
}

const passed = results.filter((r) => r.status === "passed").length;
const failed = results.filter((r) => r.status === "failed").length;
const skipped = results.filter((r) => r.status === "skipped").length;
const report = {
  suite: "Signature Wall 浏览器端到端",
  startedAt,
  finishedAt: new Date().toISOString(),
  environment: { browser: "chromium headless", playwright: "1.65.1", isolatedDb: true },
  results,
  evidence,
  defects,
  summary: { total: results.length, passed, failed, skipped },
};
writeFileSync(join(REPORTS, "e2e-report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`\nE2E 套件完成: 通过 ${passed} / 失败 ${failed} / 跳过 ${skipped}`);
if (failed) {
  console.log("失败用例:");
  for (const r of results.filter((x) => x.status === "failed")) console.log(` - ${r.id} ${r.title}: ${r.error?.split("\n")[0]}`);
}
