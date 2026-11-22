import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  createEnv,
  api,
  ARTIFACTS,
  REPORTS,
  PROJECT_ROOT,
  pngSize,
} from "./lib/env.mjs";
const catalog = JSON.parse(
  readFileSync(join(PROJECT_ROOT, "src/catalog.json"), "utf8"),
);
const report = {
  fonts: [],
  layouts: [],
  errors: [],
  external: [],
  animation: {},
  browser: "",
};
mkdirSync(ARTIFACTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });
const env = await createEnv();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
report.browser = browser.version();
const observe = (page) => {
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400)
      report.errors.push(r.status() + " " + new URL(r.url()).pathname);
  });
  page.on("request", (r) => {
    if (r.url().startsWith("http") && !r.url().startsWith(env.baseUrl))
      report.external.push(r.url());
  });
};
const shot = (page, name) => page.screenshot({ path: join(ARTIFACTS, name) });
try {
  const phone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const wall = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  observe(phone);
  observe(wall);
  await wall.goto(env.baseUrl + "/wall");
  await phone.goto(env.baseUrl);
  await phone.locator("#name").fill("林知秋");
  await phone.waitForFunction(
    () => !document.querySelector(".primary").disabled,
  );
  await phone.waitForTimeout(2000);
  await shot(phone, "mobile-studio.png");
  await shot(wall, "wall-000.png");
  const devtools = await phone.context().newCDPSession(phone);
  await devtools.send("DOM.enable");
  await devtools.send("CSS.enable");
  for (const group of new Set(catalog.map((f) => f.group))) {
    await phone.getByRole("button", { name: group, exact: true }).click();
    await phone.waitForFunction(
      () =>
        getComputedStyle(document.querySelector(".font-card strong"))
          .visibility === "visible",
    );
    const { root } = await devtools.send("DOM.getDocument");
    const { nodeIds } = await devtools.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: ".font-card strong",
    });
    const faces = catalog.filter((f) => f.group === group);
    for (const [i, nodeId] of nodeIds.entries()) {
      const { fonts } = await devtools.send("CSS.getPlatformFontsForNode", {
        nodeId,
      });
      assert(
        fonts.length && fonts.every((f) => f.isCustomFont),
        "Local font missing: " + faces[i].id,
      );
      const hash = await phone
        .locator(".font-card strong")
        .nth(i)
        .evaluate((el) => {
          const c = document.createElement("canvas");
          c.width = 128;
          c.height = 64;
          const g = c.getContext("2d");
          g.font = "48px " + getComputedStyle(el).fontFamily;
          g.fillText("山川", 0, 52);
          return c.toDataURL();
        });
      const { createHash } = await import("node:crypto");
      report.fonts.push({
        id: faces[i].id,
        platform: fonts.map((f) => ({
          name: f.postScriptName,
          glyphs: f.glyphCount,
        })),
        raster: createHash("sha256").update(hash).digest("hex"),
      });
    }
  }
  assert.equal(report.fonts.length, 24);
  assert.equal(
    new Set(report.fonts.map((f) => f.raster)).size,
    24,
    "Duplicate specimen outline",
  );
  await phone.getByRole("button", { name: "笔墨", exact: true }).click();
  await phone.getByRole("button", { name: "确认签到" }).click();
  await phone.waitForSelector("main.success");
  await shot(phone, "mobile-signed.png");
  await wall.waitForSelector(".signature.writing", { timeout: 15000 });
  const sample = await wall.evaluate(async () => {
    const el = document.querySelector(".signature.writing"),
      c = el.querySelector("canvas"),
      ctx = c.getContext("2d"),
      series = [];
    const start = performance.now();
    while (performance.now() - start < 2300) {
      const a = ctx.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 3; i < a.length; i += 4) if (a[i] > 12) ink++;
      const b = el.getBoundingClientRect();
      series.push({ ink, x: b.x, y: b.y });
      await new Promise((r) => setTimeout(r, 65));
    }
    return series;
  });
  assert(new Set(sample.map((v) => v.ink)).size > 4, "Missing progressive ink");
  assert(
    new Set(sample.map((v) => v.x + "," + v.y)).size === 1,
    "Animated name moved",
  );
  report.animation = {
    samples: sample.length,
    inkLevels: new Set(sample.map((v) => v.ink)).size,
    positions: new Set(sample.map((v) => v.x + "," + v.y)).size,
  };
  await wall.waitForSelector(".signature.complete");
  await shot(wall, "wall-001.png");
  await wall.emulateMedia({ reducedMotion: "reduce" });
  const lastNames = [
    ..."赵钱孙李周吴郑王冯陈沈韩杨朱许何吕张孔曹严华陶姜谢乔苏潘葛范彭陆沈邱顾宋白孟程夏温唐杜",
  ];
  const given = [
    "一禾",
    "川",
    "知远",
    "星野",
    "宁",
    "嘉树",
    "子衿",
    "怀瑾",
    "景行",
    "文溪",
    "晚晴",
    "明澈",
    "彦",
    "嘉言",
    "望舒",
    "初阳",
    "之恒",
    "清和",
    "南山",
  ];
  const first = (await api(env, "/api/state")).data.signatures[0];
  const pinned = new Map([
    [first.id, [first.x, first.y, first.width, first.height]],
  ]);
  let count = 1;
  for (const goal of [5, 10, 50, 100, 120]) {
    while (count < goal) {
      const name =
        count === 9
          ? "江安校区十二字符签名压力"
          : count % 19 === 0
            ? "Ada " + count
            : lastNames[count % lastNames.length] + given[count % given.length];
      const f = catalog[count % catalog.length];
      await phone.getByRole("button", { name: "继续签到" }).click();
      await phone.locator("#name").fill(name);
      await phone.getByRole("button", { name: f.group, exact: true }).click();
      await phone.locator(".font-card").filter({ hasText: f.label }).click();
      await phone.getByRole("button", { name: "确认签到" }).click();
      await phone.waitForSelector("main.success");
      assert.equal(await phone.locator("main.success h1").innerText(), name);
      count++;
    }
    await wall.waitForFunction(
      (n) => document.querySelectorAll(".signature.complete").length === n,
      goal,
      { timeout: 180000 },
    );
    await wall.waitForTimeout(350);
    const layouts = await wall.locator(".signature").evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect(),
          c = el.querySelector("canvas"),
          a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        return {
          id: el.dataset.id,
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          ink: a.some((v, i) => i % 4 === 3 && v > 100),
        };
      }),
    );
    let overlaps = 0,
      clipped = 0,
      moved = 0;
    for (const [i, b] of layouts.entries()) {
      assert(b.ink, "Blank canvas at " + goal);
      if (b.x < 0 || b.y < 0 || b.x + b.w > 1920.01 || b.y + b.h > 1080.01)
        clipped++;
      for (const a of layouts.slice(0, i))
        if (
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y
        )
          overlaps++;
      const prev = pinned.get(b.id),
        next = [b.x, b.y, b.w, b.h];
      if (prev?.some((v, i) => Math.abs(v - next[i]) > 0.03)) moved++;
      pinned.set(b.id, next);
    }
    assert.equal(overlaps + clipped + moved, 0);
    const sizes = (await api(env, "/api/state")).data.signatures
      .map((s) => s.size)
      .sort((a, b) => a - b);
    report.layouts.push({
      count: goal,
      overlaps,
      clipped,
      moved,
      visibleInk: layouts.length,
      minSize: sizes[0],
      medianSize: sizes[Math.floor(goal / 2)],
      maxSize: sizes.at(-1),
    });
    await shot(wall, "wall-" + String(goal).padStart(3, "0") + ".png");
    console.log("wall", goal, "ok");
  }
  const admin = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  observe(admin);
  await admin.goto(env.baseUrl + "/admin");
  await admin.locator("input[type=password]").fill(env.secret);
  await admin.getByText("登录后台").click();
  await admin.waitForSelector(".admin");
  await shot(admin, "admin-console.png");
  const download = admin.waitForEvent("download", { timeout: 60000 });
  await admin.getByRole("button", { name: "导出 4K 纪念图" }).click();
  const file = join(ARTIFACTS, "ink-field-4k.png");
  await (await download).saveAs(file);
  report.export = pngSize(readFileSync(file));
  assert.deepEqual(report.export, { width: 3840, height: 2160 });
  await phone.goto(env.baseUrl);
  await phone.setViewportSize({ width: 320, height: 720 });
  assert(
    await phone.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  report.mobileWidths = [320, 390];
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.external, []);
  const perf = await wall.context().newCDPSession(wall);
  await perf.send("Performance.enable");
  const measure = async () =>
    Object.fromEntries(
      (await perf.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const before = await measure();
  await wall.waitForTimeout(30000);
  const after = await measure();
  report.idle = {
    seconds: 30,
    taskSeconds: after.TaskDuration - before.TaskDuration,
    layouts: after.LayoutCount - before.LayoutCount,
    heapMiB: after.JSHeapUsedSize / 2 ** 20,
  };
  report.pass = true;
} finally {
  writeFileSync(join(REPORTS, "exhibit.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await env.dispose();
}
