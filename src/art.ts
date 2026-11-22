// A folded annulus. Project and depth-sort its strips once for each new edition.
type Point = { x: number; y: number; z: number };
type Facet = {
  a: Point;
  b: Point;
  c: Point;
  d: Point;
  depth: number;
  color: string;
  thread: string;
};
function project(t: number, u: number, phase: number): Point {
  const twist = t * 1.5 + 0.4 + 0.12 * Math.sin(phase);
  const r = 1 + 0.17 * Math.cos(3 * t - 0.5) + u * 0.42 * Math.cos(twist);
  const x = r * Math.cos(t);
  const y = r * Math.sin(t);
  const z =
    0.39 * Math.sin(2 * t + 0.5) + u * 0.58 * Math.sin(twist) + 0.09 * u * u;
  return {
    x: x + 0.18 * y,
    y: y * 0.55 - z * 0.85 - 0.2 * x,
    z: y * 0.85 + z * 0.55,
  };
}
export function drawSculpture(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  count: number,
) {
  const facets: Facet[] = [];
  const phase = Math.log1p(count) * 0.8;
  const segments = 128,
    threads = 48;
  const grid = Array.from({ length: segments + 1 }, (_, i) =>
    Array.from({ length: threads + 1 }, (_, j) =>
      project((i * 2 * Math.PI) / segments, (j * 2) / threads - 1, phase),
    ),
  );
  for (let i = 0; i < segments; i++) {
    const t = (i * Math.PI * 2) / segments;
    for (let j = 0; j < threads; j++) {
      const a = grid[i][j],
        b = grid[i + 1][j],
        c = grid[i + 1][j + 1],
        d = grid[i][j + 1];
      const u = j / threads;
      const glint = Math.pow((1 + Math.cos(t * 2 - 1.1 + u * 2.7)) * 0.5, 2);
      const warm = Math.max(0, Math.cos(t - 0.4) * 0.85 + u * 0.3);
      const edge = Math.pow(Math.abs(2 * u - 1), 5);
      const highlight = Math.pow(
        Math.max(0, Math.cos(t * 2.5 + u * 2 - 0.9)),
        16,
      );
      const intensity = Math.min(
        1.25,
        0.2 + glint * 0.65 + edge * 0.32 + highlight * 0.5,
      );
      const rgb = [150 + 100 * warm, 140 - 12 * warm, 241 - 139 * warm];
      const pigment = (k: number) =>
        "rgb(" +
        rgb.map((v) => Math.min(255, Math.round(8 + v * k))).join(",") +
        ")";
      facets.push({
        a,
        b,
        c,
        d,
        depth: (a.z + b.z + c.z + d.z) / 4,
        color: pigment(intensity * 0.7),
        thread: pigment(intensity + 0.19),
      });
    }
  }
  facets.sort((a, b) => a.depth - b.depth);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  for (const f of facets) {
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(f.a.x, f.a.y);
    ctx.lineTo(f.b.x, f.b.y);
    ctx.lineTo(f.c.x, f.c.y);
    ctx.lineTo(f.d.x, f.d.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = f.thread;
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    ctx.moveTo(f.a.x, f.a.y);
    ctx.lineTo(f.b.x, f.b.y);
    ctx.stroke();
  }
  ctx.restore();
}
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = "#171521";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#484251";
  for (let y = 18; y < h; y += 26)
    for (let x = 18; x < w; x += 26) ctx.fillRect(x, y, 1, 1);
}
export function mark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r = 5,
) {
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
}
