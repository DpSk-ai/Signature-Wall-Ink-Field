import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import {
  createEnv,
  createSignature,
  api,
  ARTIFACTS,
  REPORTS,
} from "./lib/env.mjs";

// All school payloads are generated fixtures. Chromium serves the external page in memory.
const school =
  "https://school.example.invalid/activity?campus=A%2FB&entry=demo+value#sign";
const env = await createEnv();
let browser;
const checks = [];
try {
  mkdirSync(ARTIFACTS, { recursive: true });
  mkdirSync(REPORTS, { recursive: true });
  const created = await createSignature(env, "旧署名");
  assert.equal(created.status, 201);
  const records = async () => (await api(env, "/api/state")).data.signatures;
  const before = await records();
  const path = "/api/admin/check-in";
  const token = (
    await api(env, "/api/admin/login", {
      method: "POST",
      body: { password: env.secret },
    })
  ).data.token;
  let cfg = (await api(env, path, { token })).data;
  const save = (body) =>
    api(env, path, {
      token,
      method: "PUT",
      body: { revision: cfg.revision, ...body },
    });
  const publish = async (body) => {
    const r = await save(body);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    cfg = r.data;
  };
  const readGuide = async () => (await api(env, "/api/check-in")).data;
  assert.equal((await readGuide()).mode, "off");
  assert.equal((await api(env, path)).status, 401);
  assert.equal(
    (await api(env, path, { method: "PUT", body: { source: "off" } })).status,
    401,
  );
  assert.equal(
    (await save({ source: "link", url: "http://school.example.invalid/" }))
      .status,
    400,
  );
  checks.push("管理员权限、初始状态及地址校验");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 MicroMessenger/8.0",
  });
  const admin = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  for (const page of [phone, admin])
    page.on("pageerror", (err) => errors.push(err.message));
  await phone.goto(env.baseUrl);
  await phone.getByText("主办方暂未发布", { exact: false }).waitFor();
  await phone.getByRole("link", { name: "留下你的名字" }).click();
  await phone.locator("#name").waitFor();
  await phone.getByRole("link", { name: "返回活动入口" }).click();
  checks.push("无二课配置也可进入签名页并返回");
  await admin.goto(env.baseUrl + "/admin");
  await admin.locator("input[type=password]").fill(env.secret);
  await admin.getByRole("button", { name: "登录后台" }).click();
  const panel = admin.locator(".configuration");
  await panel.getByRole("combobox").selectOption("auto");
  const png = await QRCode.toBuffer(school, { width: 400, margin: 4 });
  const jpeg = await admin.evaluate(async (encoded) => {
    const img = new Image();
    img.src = "data:image/png;base64," + encoded;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, png.toString("base64"));
  await panel.locator("input[type=file]").setInputFiles({
    name: "official-sample.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpeg, "base64"),
  });
  await panel.getByRole("combobox").selectOption("qr");
  await panel.getByRole("combobox").selectOption("auto");
  await panel.getByRole("button", { name: "保存二课入口" }).click();
  await panel
    .getByRole("status")
    .filter({ hasText: "已保存 · 打开学校网页" })
    .waitFor();
  await admin.screenshot({ path: join(ARTIFACTS, "folio-admin.png") });
  cfg = (await api(env, path, { token })).data;
  assert.equal(cfg.url, school);
  assert.equal(cfg.hasQr, true);
  assert.equal(
    (await save({ source: "off", revision: "previous-revision" })).status,
    409,
  );
  const guide = await readGuide();
  assert.equal(guide.hasQr, true);
  assert(!Object.hasOwn(guide, "url"));
  assert(
    !JSON.stringify((await api(env, "/api/state")).data).includes(
      "example.invalid",
    ),
  );
  await env.restart();
  assert.equal((await readGuide()).revision, cfg.revision);
  assert.deepEqual(await records(), before);
  const response = await fetch(env.baseUrl + "/api/check-in/open", {
    redirect: "manual",
  });
  assert.equal(response.headers.get("location"), school);
  assert.equal(response.headers.get("cache-control"), "no-store");
  checks.push("后台上传、HTTPS 解码、原有签名不变、冲突检测、重启持久化");
  const cdp = await phone.context().newCDPSession(phone);
  const visited = [];
  cdp.on("Fetch.requestPaused", async (e) => {
    visited.push(e.request.url);
    await cdp.send("Fetch.fulfillRequest", {
      requestId: e.requestId,
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "text/html; charset=utf-8" },
      ],
      body: Buffer.from(
        "<title>测试学校活动页</title><p>学校活动页（测试夹具）</p>",
      ).toString("base64"),
    });
  });
  await cdp.send("Fetch.enable", {
    patterns: [{ urlPattern: "https://school.example.invalid/*" }],
  });
  await phone.goto(env.baseUrl);
  const link = phone.getByRole("link", { name: "前往二课签到" });
  await link.waitFor();
  await phone.evaluate(() => document.fonts.ready);
  await phone.screenshot({ path: join(ARTIFACTS, "folio-welcome.png") });
  await phone.getByRole("button", { name: /查看官方二维码/ }).click();
  await phone.locator(".official-code img").waitFor();
  await link.click();
  assert.equal(phone.url(), school);
  assert.equal(visited.length, 1);
  await phone.goBack();
  await phone.getByText(/已打开过学校入口/).waitFor();
  assert(
    !/签到已成功|签到已确认/.test(await phone.locator("body").innerText()),
  );
  await phone.getByRole("link", { name: "留下你的名字" }).click();
  await phone.locator("#name").fill("墨池");
  await phone.getByRole("button", { name: "确认签名" }).click();
  await phone.getByText("数字签名已提交").waitFor();
  const signed = await records();
  assert.equal(signed.length, before.length + 1);
  assert.equal(signed.at(-1).name, "墨池");
  checks.push("微信 UA 同页跳转、保留参数和片段、浏览器返回、数字签名回执");
  const wall = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await wall.goto(env.baseUrl + "/wall");
  await wall.locator(".signature").nth(1).waitFor({ state: "attached" });
  let decoded = "";
  for (let i = 0; i < 50 && !decoded; i++) {
    const bitmap = await wall.locator(".board > canvas").screenshot();
    const im = PNG.sync.read(bitmap);
    decoded =
      jsQR(new Uint8ClampedArray(im.data), im.width, im.height)?.data ?? "";
    if (!decoded) await wall.waitForTimeout(150);
  }
  assert.equal(decoded, env.baseUrl + "/");
  checks.push("解码实际大屏画布，统一码仅指向墨场欢迎页");
  const protocolPng = (
    await QRCode.toBuffer("campus-demo:activity/42")
  ).toString("base64");
  await publish({ source: "auto", png: protocolPng });
  assert.equal(cfg.mode, "qr");
  assert.equal(cfg.url, "");
  await phone.goto(env.baseUrl);
  await phone.locator(".official-code img").waitFor();
  assert.equal(
    await phone.getByRole("link", { name: "前往二课签到" }).count(),
    0,
  );
  const qrResponse = await fetch(env.baseUrl + "/api/check-in/qr");
  assert.equal(qrResponse.headers.get("content-type"), "image/png");
  const im = PNG.sync.read(Buffer.from(await qrResponse.arrayBuffer()));
  assert.equal(
    jsQR(new Uint8ClampedArray(im.data), im.width, im.height)?.data,
    "campus-demo:activity/42",
  );
  await phone.screenshot({
    path: join(ARTIFACTS, "folio-qr.png"),
    fullPage: true,
  });
  await phone.setViewportSize({ width: 320, height: 720 });
  assert(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await publish({ source: "qr", png: png.toString("base64") });
  assert.equal(cfg.mode, "qr");
  await publish({ source: "auto" });
  assert.equal(cfg.url, school);
  const empty = new PNG({ width: 64, height: 64 });
  empty.data.fill(255);
  await publish({
    source: "auto",
    png: PNG.sync.write(empty).toString("base64"),
  });
  assert.equal(cfg.mode, "qr");
  const intact = cfg.revision;
  assert.equal((await save({ source: "qr", png: "AAAA" })).status, 400);
  assert.equal((await readGuide()).revision, intact);
  await publish({ source: "link", url: school });
  assert.equal(cfg.hasQr, false);
  await publish({ source: "off" });
  assert.equal((await readGuide()).mode, "off");
  assert.equal((await fetch(env.baseUrl + "/api/check-in/qr")).status, 404);
  assert.deepEqual(errors, []);
  checks.push(
    "专用协议、无法解码、强制原码、刷新配置、手动链接、撤下及窄屏排版",
  );
  writeFileSync(
    join(REPORTS, "check-in.json"),
    JSON.stringify({ pass: true, checks }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser?.close();
  await env.dispose();
}
