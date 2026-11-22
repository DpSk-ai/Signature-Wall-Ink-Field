import { saveBlob } from "./download";
import QRCode from "qrcode";
import { drawGrid, drawSculpture, mark } from "./art";
import { loadFace } from "./fonts";
import { drawName } from "./ink";
import type { State } from "./live";
const mono = "monospace",
  sans = 'Arial, "Noto Sans SC", sans-serif',
  serif = 'Georgia, "Times New Roman", serif';
const brandText =
  "四川大学实时签到已署名墨场扫码签到书写暂停连接中签到已结束江安校区综合楼尚待第一位署名";
export const prepareBoard = () => loadFace("source-han-sans", brandText);
export function drawBoard(
  c: CanvasRenderingContext2D,
  s: State,
  online: boolean,
  signURL: string,
) {
  drawGrid(c, 1920, 1080);
  const count = s.signatures.length;
  c.save();
  c.globalAlpha = 0.16 + 0.84 * Math.exp(-count / 24);
  drawSculpture(c, 1150, 553, 374, count);
  c.restore();
  c.strokeStyle = "#60566a";
  c.lineWidth = 1;
  const rule = (x: number, y: number, x2: number, y2: number) => {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x2, y2);
    c.stroke();
  };
  const txt = (
    str: string,
    x: number,
    y: number,
    font: string,
    color = "#f3ede6",
  ) => {
    c.font = font;
    c.fillStyle = color;
    c.fillText(str, x, y);
  };
  rule(60, 84, 1860, 84);
  rule(60, 977, 1701, 977);
  c.strokeStyle = "#b0a3c4";
  for (const [x, y] of [
    [60, 84],
    [1860, 84],
    [60, 977],
    [1701, 977],
  ])
    mark(c, x, y, 5);
  c.save();
  c.translate(79, 46);
  c.strokeStyle = "#ff9d74";
  c.lineWidth = 1.4;
  for (let i = 0; i < 7; i++) {
    c.beginPath();
    c.ellipse(0, 0, 18, 6, ((i * 17 - 45) * Math.PI) / 180, 0, Math.PI * 2);
    c.stroke();
  }
  c.restore();
  txt("TRAE on Campus", 114, 55, "bold 26px " + sans);
  txt("@四川大学", 349, 54, "21px " + sans, "#d5c9da");
  txt("11.28  /  13:00–18:20", 1462, 52, "18px " + mono, "#d9cedf");
  txt("C103", 1804, 52, "18px " + mono, "#ffa57e");
  const legacyHeader = s.signatures.some(
    (n) => n.x < 580 && n.y < 266 && n.y + n.height > 125,
  );
  if (legacyHeader) {
    txt("Ink Field.  墨场", 62, 138, "48px " + serif, "#d1bef5");
    txt("AI Coding Hackathon", 650, 131, "32px " + sans);
  } else {
    txt("墨 场   /   SIGNATURE WALL", 65, 127, "17px " + mono, "#c8badd");
    txt("Ink", 58, 228, "110px " + serif);
    txt("Field.", 240, 228, "italic 110px " + serif, "#d1bef5");
    txt("AI Coding Hackathon", 65, 264, "32px " + sans);
  }
  txt(String(count).padStart(3, "0"), 1637, 204, "72px " + serif);
  txt("已署名  /  SIGNED", 1643, 235, "16px " + sans, "#c8badd");
  if (!count) txt("尚待第一位署名", 69, 566, "23px " + sans, "#b6a9bc");
  c.fillStyle = online ? "#ffa27d" : "#9991a1";
  c.beginPath();
  c.arc(70, 1020, 5, 0, Math.PI * 2);
  c.fill();
  txt(
    !online
      ? "连接中"
      : s.animationPaused
        ? "书写暂停"
        : s.eventStatus === "open"
          ? "实时签到  /  LIVE"
          : s.eventStatus === "ended"
            ? "签到已结束"
            : "签到暂停",
    88,
    1027,
    "19px " + sans,
  );
  txt("江安校区 · 综合楼 C103", 520, 1027, "18px " + sans, "#c8badd");
  txt("扫码签到", 1510, 1011, "25px " + sans);
  txt("SCAN TO SIGN  ↗", 1510, 1040, "16px " + mono, "#eebaab");
  const qr = QRCode.create(signURL, { errorCorrectionLevel: "M" }).modules;
  const module = Math.min(5, Math.floor(155 / (qr.size + 8))),
    size = (qr.size + 8) * module,
    x = 1860 - size,
    y = 1042 - size;
  c.fillStyle = "#faf6f0";
  c.fillRect(x, y, size, size);
  c.fillStyle = "#171521";
  for (let r = 0; r < qr.size; r++)
    for (let k = 0; k < qr.size; k++)
      if (qr.get(r, k))
        c.fillRect(x + (k + 4) * module, y + (r + 4) * module, module, module);
}
export async function exportBoard(s: State, url: string) {
  await Promise.all([
    prepareBoard(),
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
