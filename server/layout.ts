export type Box = { x: number; y: number; width: number; height: number };
const columns = 12,
  rows = 12;
const left = 70,
  top = 270,
  dx = 145,
  dy = 58;
const slots: (Box & { rank: number })[] = [];
const used = new Set<number>();
function add(col: number, row: number, w: number, h: number, rank: number) {
  for (let j = row; j < row + h; j++)
    for (let i = col; i < col + w; i++) used.add(j * columns + i);
  // Offset the rows independently in each column. A two-column opening space
  // uses the shared vertical interval, so its neighbours keep their clearance.
  const edge = (c: number, r: number) =>
    top +
    r * dy +
    19 * Math.sin(c * 1.42 + 0.3) * Math.sin((Math.PI * r) / rows);
  const lane = Array.from({ length: w }, (_, i) => col + i);
  const upper = Math.max(...lane.map((c) => edge(c, row))),
    lower = Math.min(...lane.map((c) => edge(c, row + h)));
  slots.push({
    x: left + col * dx,
    y: upper,
    width: dx * w,
    height: lower - upper,
    rank,
  });
}
// Three larger spaces for the opening signatures. All later reservations avoid them.
add(4, 3, 2, 2, -3);
add(1, 8, 2, 2, -2);
add(9, 1, 2, 2, -1);
for (let n = 0; n < columns * rows; n++) {
  const cell = (n * 53 + 19) % (columns * rows);
  if (!used.has(cell)) add(cell % columns, Math.floor(cell / columns), 1, 1, n);
}
const configuredScale = Number(process.env.LAYOUT_SCALE);
const scaleLimit = configuredScale ? Math.min(1, Math.max(0.4, configuredScale)) : 1;
const qr = { x: 1590, y: 730, width: 300, height: 320 };
function intersects(a: Box, b: Box, pad: number) {
  return (
    a.x < b.x + b.width + pad &&
    a.x + a.width + pad > b.x &&
    a.y < b.y + b.height + pad &&
    a.y + a.height + pad > b.y
  );
}
export function place(
  width: number,
  height: number,
  prior: Box[],
  seed: string,
  splitAt: number,
) {
  const fraction = parseInt(seed.slice(0, 4), 16) / 65535;
  for (const slot of slots) {
    const isLarge = slot.rank < 0;
    const maxSize = (isLarge ? 64 : 43) * (0.83 + fraction * 0.17);
    const scale = Math.min(
      scaleLimit,
      maxSize / 64,
      (slot.width - 20) / width,
      (slot.height - 18) / height,
    );
    const w = width * scale,
      h = height * scale;
    const box = {
      x: slot.x + 10 + (slot.width - w - 20) * fraction,
      y: slot.y + 9 + (slot.height - h - 18) * (1 - fraction),
      width: w,
      height: h,
    };
    if (intersects(box, qr, 8) || prior.some((p) => intersects(box, p, 17)))
      continue;
    return { ...box, size: 64 * scale, rotation: 0, split_at: splitAt };
  }
  throw Object.assign(new Error("签名墙空间已满"), { statusCode: 409 });
}

export function occupiedBounds(box: Box & { rotation: number }): Box {
  if (!box.rotation) return box;
  const angle = (box.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const points = [
    [0, 0],
    [box.width, 0],
    [0, box.height],
    [box.width, box.height],
  ].map(([x, y]) => [box.x + x * cos - y * sin, box.y + x * sin + y * cos]);
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
