import { saveBlob } from "./download";
import QRCode from "qrcode";
import { family, loadFace } from "./fonts";
import { drawName } from "./ink";
import type { State } from "./live";

const ink = "#322f26",
  red = "#983d2b",
  muted = "#665e50";
export const prepareBoard = (eventName: string) =>
  Promise.all([
    loadFace("zhuque", "现场题名录墨等候第一位署名" + eventName),
    loadFace(
      "source-han-sans",
      "墨场活动署名已开放暂停结束连接中微信扫码二课签到数字签名人",
    ),
  ]);
export function drawBoard(
  c: CanvasRenderingContext2D,
  s: State,
  online: boolean,
  signURL: string,
) {
  const count = s.signatures.length;
  const serif = family("zhuque"),
    body = family("source-han-sans");
  function text(
    str: string,
    x: number,
    y: number,
    font: string,
    color = ink,
    maxWidth?: number,
  ) {
    c.font = font;
    c.fillStyle = color;
    c.fillText(str, x, y, maxWidth);
  }
  function line(x: number, y: number, x2: number, y2: number, color: string) {
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x2, y2);
    c.stroke();
  }
  c.fillStyle = "#f6f0df";
  c.fillRect(0, 0, 1920, 1080);
  c.fillStyle = ink;
  c.fillRect(58, 35, 1804, 4);
  c.fillStyle = red;
  c.fillRect(60, 55, 37, 37);
  text("墨", 65, 83, "27px " + serif, "#fff7e7");
  text("墨场   /   INK FIELD", 112, 83, "22px " + body);
  text(s.eventName, 540, 82, "22px " + serif, muted, 865);
  const compact = s.signatures.some(
    (n) => n.x < 600 && n.y < 266 && n.y + n.height > 125,
  );
  if (compact) {
    text("现场题名录", 61, 136, "39px " + serif);
  } else {
    text("现场题名录", 58, 205, "91px " + serif);
    text("SIGNATURE REGISTER", 65, 245, "18px monospace", muted);
  }
  text(
    String(count).padStart(3, "0"),
    1635,
    139,
    "76px Georgia, serif",
    red,
    165,
  );
  text("人署名", 1800, 134, "21px " + body, muted);
  line(58, 263, 1862, 263, "#9e927c");
  line(58, 274, 58, 958, "#b9ac91");
  for (let row = 1; row <= 12; row++)
    line(59, 266 + row * 58, row > 8 ? 1590 : 1862, 266 + row * 58, "#ddd4bf");
  if (!count) {
    text("等候第一位署名", 710, 595, "54px " + serif, muted);
  }
  line(58, 976, 1688, 976, "#9e927c");
  c.fillStyle = online ? red : muted;
  c.beginPath();
  c.arc(68, 1021, 5, 0, Math.PI * 2);
  c.fill();
  const status = !online
    ? "连接中"
    : s.animationPaused
      ? "书写暂停"
      : s.eventStatus === "open"
        ? "署名开放"
        : s.eventStatus === "ended"
          ? "署名已结束"
          : "署名暂停";
  text(status, 85, 1028, "22px " + body);
  text("微信扫码", 1450, 1009, "27px " + serif);
  text("二课签到 · 数字签名", 1450, 1040, "18px " + body, muted);
  const qr = QRCode.create(signURL, { errorCorrectionLevel: "M" }).modules;
  const module = Math.min(5, Math.floor(155 / (qr.size + 8))),
    size = (qr.size + 8) * module,
    x = 1860 - size,
    y = 1042 - size;
  c.fillStyle = "#ffffff";
  c.fillRect(x, y, size, size);
  c.fillStyle = "#27251f";
  for (let r = 0; r < qr.size; r++)
    for (let k = 0; k < qr.size; k++)
      if (qr.get(r, k))
        c.fillRect(x + (k + 4) * module, y + (r + 4) * module, module, module);
}
export async function exportBoard(s: State, url: string) {
  await Promise.all([
    prepareBoard(s.eventName),
    ...s.signatures.map((n) => loadFace(n.font_id, n.name)),
  ]);
  const c = document.createElement("canvas");
  c.width = 3840;
  c.height = 2160;
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  drawBoard(ctx, s, true, url);
  s.signatures.forEach((n) => drawName(ctx, n));
  const blob = await new Promise<Blob>((ok, fail) =>
    c.toBlob((b) => (b ? ok(b) : fail(Error("图片编码失败"))), "image/png"),
  );
  saveBlob(blob, "signature-wall-4k.png");
}
