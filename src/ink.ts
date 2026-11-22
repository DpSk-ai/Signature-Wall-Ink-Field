import { family, loadFace } from "./fonts";
import type { Sig } from "./live";
type Stroke = [number, number][];
type Glyphs = Record<string, Stroke[]>;
let index: Promise<number[]> | undefined;
const blocks = new Map<number, Promise<Glyphs>>();
async function pathsFor(text: string) {
  const keys = await (index ??= fetch("/strokes/index.json")
    .then((r) => r.json())
    .catch((e) => {
      index = undefined;
      throw e;
    }));
  const ids = new Set(
    [...text]
      .map((c) => Math.floor(c.codePointAt(0)! / 128))
      .filter((k) => keys.includes(k)),
  );
  const data = await Promise.all(
    [...ids].map((id) => {
      if (!blocks.has(id))
        blocks.set(
          id,
          fetch(`/strokes/${id}.json`)
            .then((r) => r.json())
            .then((d) => d.glyphs)
            .catch((e) => {
              blocks.delete(id);
              throw e;
            }),
        );
      return blocks.get(id)!;
    }),
  );
  return Object.assign({}, ...data) as Glyphs;
}
export async function writingData(s: Sig) {
  const [, paths] = await Promise.all([
    loadFace(s.font_id, s.name),
    pathsFor(s.name),
  ]);
  return paths;
}
export const duration = (name: string) => Math.max(900, [...name].length * 550);
function reveal(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[] | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
) {
  ctx.beginPath();
  if (!strokes?.length) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w * (t * 1.3), y);
    ctx.lineTo(x + w * (t * 1.3 - 0.3), y + h);
    ctx.lineTo(x, y + h);
    ctx.clip();
    return;
  }
  const pts = strokes.flat();
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ymin = Math.min(...ys),
    ymax = Math.max(...ys);
  const progress = t * strokes.length;
  // Lay down overlapping brush dabs along the actual stroke medians. The last wash
  // picks up flourishes outside the reference skeleton of the selected typeface.
  const radius =
    Math.max(w, h) * (0.115 + 0.8 * Math.max(0, (t - 0.85) / 0.15));
  const map = (p: [number, number]) => [
    x + w * (0.08 + (0.84 * (p[0] - xmin)) / Math.max(1, xmax - xmin)),
    y + h * (0.08 + (0.84 * (ymax - p[1])) / Math.max(1, ymax - ymin)),
  ];
  for (let k = 0; k < Math.min(Math.ceil(progress), strokes.length); k++) {
    const stroke = strokes[k],
      end = Math.min(1, progress - k) * (stroke.length - 1);
    for (let j = 0; j <= Math.floor(end); j++) {
      const a = map(stroke[j]),
        b = map(stroke[Math.min(j + 1, stroke.length - 1)]),
        frac = Math.min(1, end - j);
      const steps = Math.ceil(
        (Math.hypot(b[0] - a[0], b[1] - a[1]) * frac) /
          Math.max(1, radius * 0.65),
      );
      for (let m = 0; m <= steps; m++) {
        const f = (frac * m) / Math.max(1, steps),
          px = a[0] + (b[0] - a[0]) * f,
          py = a[1] + (b[1] - a[1]) * f;
        ctx.moveTo(px + radius, py);
        ctx.arc(px, py, radius, 0, Math.PI * 2);
      }
    }
  }
  ctx.clip();
}
export function drawName(
  ctx: CanvasRenderingContext2D,
  s: Sig,
  progress = 1,
  paths: Glyphs = {},
) {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.font = `${s.size}px ${family(s.font_id)}`;
  ctx.textBaseline = "alphabetic";
  const chars = [...s.name],
    lines = s.split_at
      ? [chars.slice(0, s.split_at), chars.slice(s.split_at)]
      : [chars];
  const progressInChars = progress * chars.length;
  let offset = 0;
  const palette = ["#f4eee7", "#f2c4ba", "#d8c9ff", "#e6e2f0", "#edc9a9"];
  ctx.fillStyle =
    palette[
      [...s.id].reduce((v, c) => v + c.charCodeAt(0), 0) % palette.length
    ];
  lines.forEach((line, row) => {
    const glyphs = line.map((c) => ctx.measureText(c)),
      advance = glyphs.reduce((v, m) => v + m.width, 0);
    const ascent = Math.max(1, ...glyphs.map((m) => m.actualBoundingBoxAscent)),
      descent = Math.max(1, ...glyphs.map((m) => m.actualBoundingBoxDescent));
    const left = Math.max(0, glyphs[0]?.actualBoundingBoxLeft || 0);
    const last = glyphs[glyphs.length - 1],
      right = Math.max(0, last.actualBoundingBoxRight - last.width);
    const rowH = s.height / lines.length,
      scale = Math.min(
        1,
        (s.width - 1) / (advance + left + right),
        (rowH - 1) / (ascent + descent),
      );
    ctx.save();
    ctx.translate(
      (s.width - (advance + left + right) * scale) / 2,
      (row + 0.5) * rowH,
    );
    ctx.scale(scale, scale);
    let x = left,
      baseline = (ascent - descent) / 2;
    line.forEach((c, i) => {
      const t = progressInChars - offset - i,
        m = glyphs[i];
      if (t > 0) {
        ctx.save();
        if (t < 1)
          reveal(
            ctx,
            paths[c],
            x - m.actualBoundingBoxLeft,
            baseline - m.actualBoundingBoxAscent,
            m.actualBoundingBoxRight + m.actualBoundingBoxLeft,
            m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
            t,
          );
        ctx.fillText(c, x, baseline);
        ctx.restore();
      }
      x += m.width;
    });
    offset += line.length;
    ctx.restore();
  });
  ctx.restore();
}
