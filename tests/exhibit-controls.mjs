import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  createEnv,
  createSignature,
  api,
  overlaps,
  REPORTS,
} from "./lib/env.mjs";
const env = await createEnv();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const report = {};
try {
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  const wall = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  await wall.goto(env.baseUrl + "/wall");
  await phone.goto(env.baseUrl);
  await phone.locator("#name").fill("林龘");
  await phone.waitForSelector(".coverage");
  report.rareGlyph = await phone.locator(".coverage").innerText();
  await phone.locator("#name").fill("江安校区十二字符签名压力");
  await phone.getByRole("button", { name: "确认签到" }).click();
  await phone.waitForSelector("main.success");
  const sig = (await api(env, "/api/state")).data.signatures[0];
  assert.equal(sig.split_at, 6);
  const token = (
    await api(env, "/api/admin/login", {
      method: "POST",
      body: { password: env.secret },
    })
  ).data.token;
  await wall.waitForSelector(".writing");
  await wall.waitForTimeout(400);
  await api(env, "/api/admin/settings", {
    token,
    method: "PUT",
    body: { animationPaused: true },
  });
  await wall.waitForTimeout(200);
  const pixels = () =>
    wall.locator(".writing canvas").evaluate((c) => c.toDataURL());
  const start = await pixels();
  await wall.waitForTimeout(1100);
  assert.equal(await pixels(), start);
  await api(env, "/api/admin/settings", {
    token,
    method: "PUT",
    body: { animationPaused: false },
  });
  await wall.waitForSelector(".complete", { timeout: 20000 });
  report.pauseResume = "frozen pixels and resumed completion";
  const admin = await browser.newPage({ acceptDownloads: true });
  await admin.goto(env.baseUrl + "/admin");
  await admin.locator("input[type=password]").fill(env.secret);
  await admin.getByText("登录后台").click();
  await admin.waitForSelector(".records article");
  await admin.getByPlaceholder("搜索姓名").fill("江安");
  assert.equal(await admin.locator(".records article").count(), 1);
  const d = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "导出签到记录" }).click();
  const savedFile = join(env.dir, "records.csv");
  await (await d).saveAs(savedFile);
  const csv = readFileSync(savedFile, "utf8");
  assert(csv.includes(sig.name) && csv.includes(sig.font_id));
  report.csv = "name, font ID and UTF-8 BOM verified";
  assert.equal(csv.charCodeAt(0), 0xfeff);
  admin.on("dialog", (dlg) => dlg.accept());
  await admin.locator(".records").getByRole("button", { name: "删除" }).click();
  await wall.waitForFunction(
    () => document.querySelectorAll(".signature").length === 0,
  );
  const created = await Promise.all(
    Array.from({ length: 120 }, (_, i) =>
      createSignature(env, "并发" + String(i).padStart(3, "0")),
    ),
  );
  assert(created.every((r) => r.status === 201));
  assert.equal(new Set(created.map((r) => r.data.id)).size, 120);
  assert(
    !created.some((r, i) =>
      created.slice(0, i).some((a) => overlaps(a.data, r.data)),
    ),
  );
  report.concurrentPosts = created.length;
  await admin.getByRole("button", { name: "清空全部签到" }).click();
  await wall.waitForFunction(
    () => document.querySelectorAll(".signature").length === 0,
  );
  assert.equal((await api(env, "/api/state")).data.signatures.length, 0);
  report.deleteClear = true;
  report.pass = true;
} finally {
  writeFileSync(
    join(REPORTS, "exhibit-controls.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await env.dispose();
}
