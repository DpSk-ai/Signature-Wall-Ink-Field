import catalog from "./catalog.json";
export { catalog };
export const fontRows = catalog.map((f) => [f.id, f.label, f.group]);
const catalogById = new Map(catalog.map((f) => [f.id, f]));
const resolve = (id: string) =>
  catalogById.get(id) || catalogById.get("source-han-sans")!;
export const family = (id: string) =>
  [...new Set([resolve(id).family, "LXGW WenKai", "Noto Sans SC"])]
    .map((f) => '"' + f + '"')
    .join(", ") + ", sans-serif";
const styles = new Map<string, Promise<void>>();
const maps = new Map<string, Promise<number[][]>>();
function stylesheet(id: string) {
  if (!styles.has(id))
    styles.set(
      id,
      new Promise((ok, fail) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = `/fonts/${id}/font.css`;
        link.onload = () => ok();
        link.onerror = () => {
          link.remove();
          styles.delete(id);
          fail(Error("字库未能加载，请重试"));
        };
        document.head.append(link);
      }),
    );
  return styles.get(id)!;
}
function coverage(id: string) {
  if (!maps.has(id))
    maps.set(
      id,
      fetch(`/fonts/${id}/coverage.json`)
        .then((r) => r.json())
        .then((s: string) =>
          s
            .split(",")
            .map((part) => part.split("-").map((v) => parseInt(v, 16))),
        )
        .catch((e) => {
          maps.delete(id);
          throw e;
        }),
    );
  return maps.get(id)!;
}
async function loadOne(rawId: string, text: string) {
  const font = resolve(rawId),
    runes = [...new Set(text)];
  const [, ranges] = await Promise.all([
    stylesheet(font.id),
    coverage(font.id),
  ]);
  const missing = runes.filter((c) => {
    const cp = c.codePointAt(0)!;
    return !ranges.some(([lo, hi]) => cp >= lo && cp <= (hi ?? lo));
  });
  const available = runes.filter((c) => !missing.includes(c)).join("");
  if (available) await document.fonts.load(`64px "${font.family}"`, available);
  return missing;
}

export async function loadFace(id: string, text: string) {
  const missing = await loadOne(id, text);
  let remaining = missing;
  for (const fallback of ["lxgw-wenkai", "source-han-sans"]) {
    if (remaining.length && resolve(id).id !== fallback)
      remaining = await loadOne(fallback, remaining.join(""));
  }
  return { missing, device: remaining };
}
