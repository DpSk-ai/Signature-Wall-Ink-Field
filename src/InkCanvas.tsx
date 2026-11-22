import { useEffect, useRef } from "react";
import { drawName, duration, writingData } from "./ink";
import { loadFace } from "./fonts";
import type { Sig } from "./live";
type Props = {
  s: Sig;
  paused?: boolean;
  onFinish?: () => void;
  replay?: number;
  onError?: (message: string) => void;
};
export function InkCanvas({
  s,
  paused = false,
  onFinish,
  replay = 0,
  onError,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null),
    live = useRef({ paused, onFinish, onError });
  live.current = { paused, onFinish, onError };
  useEffect(() => {
    const c = ref.current!,
      ctx = c.getContext("2d")!,
      d = 2;
    c.width = Math.max(1, Math.ceil(s.width * d));
    c.height = Math.max(1, Math.ceil(s.height * d));
    ctx.scale(d, d);
    let cancelled = false,
      frame = 0,
      timer = 0;
    const local = { ...s, x: 0, y: 0, rotation: 0 };
    if (s.status === "queued") return;
    async function start() {
      try {
        const animate =
          s.status === "writing" &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches;
        const paths = animate
          ? await writingData(s)
          : (await loadFace(s.font_id, s.name), {});
        if (cancelled) return;
        let elapsed = 0,
          last = performance.now();
        function paint(now: number) {
          if (cancelled) return;
          cancelAnimationFrame(frame);
          clearTimeout(timer);
          if (live.current.paused) {
            last = now;
            timer = window.setTimeout(() => paint(performance.now()), 100);
            return;
          }
          elapsed += Math.max(0, now - last);
          last = now;
          const t = animate ? Math.min(1, elapsed / duration(s.name)) : 1;
          ctx.clearRect(0, 0, s.width + 1, s.height + 1);
          drawName(ctx, local, t, paths);
          if (t < 1) {
            frame = requestAnimationFrame(paint);
            // Background tabs and busy projectors can delay animation frames.
            // Only the active name has a fallback clock; the first callback wins.
            timer = window.setTimeout(() => paint(performance.now()), 180);
          } else if (s.status === "writing") live.current.onFinish?.();
        }
        if (s.status === "complete") {
          drawName(ctx, local);
          return;
        }
        paint(last);
      } catch {
        if (!cancelled) {
          live.current.onError?.("字体加载中，正在重试");
          timer = window.setTimeout(start, 1800);
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [
    s.id,
    s.name,
    s.font_id,
    s.status,
    s.width,
    s.height,
    s.size,
    s.split_at,
    replay,
  ]);
  return (
    <canvas ref={ref} aria-label={s.name}>
      {s.name}
    </canvas>
  );
}
