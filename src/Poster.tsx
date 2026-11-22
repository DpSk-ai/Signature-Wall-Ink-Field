import { useEffect, useRef } from "react";
import { drawSculpture, drawGrid } from "./art";
export function Seal() {
  return (
    <svg className="seal" viewBox="0 0 40 40" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => (
        <ellipse
          key={i}
          cx="20"
          cy="20"
          rx="16"
          ry="6"
          transform={`rotate(${i * 17 - 45} 20 20)`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
        />
      ))}
    </svg>
  );
}
export function Poster({ count }: { count: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const draw = () => {
      const { width: w, height: h } = c.getBoundingClientRect(),
        d = Math.min(devicePixelRatio, 2);
      c.width = Math.round(w * d);
      c.height = Math.round(h * d);
      const ctx = c.getContext("2d")!;
      ctx.scale(d, d);
      drawGrid(ctx, w, h);
      const compact = w / h > 1.05;
      drawSculpture(
        ctx,
        compact ? w * 0.78 : w * 0.56,
        compact ? h * 0.47 : h * 0.54,
        compact ? Math.min(w * 0.225, h * 0.52) : Math.min(w * 0.38, h * 0.3),
        count,
      );
    };
    const observer = new ResizeObserver(draw);
    observer.observe(c);
    return () => observer.disconnect();
  }, [count]);
  return (
    <section className="poster">
      <canvas aria-hidden="true" ref={ref} />
      <div className="brand">
        <Seal />
        <span>
          TRAE <em>on Campus</em>
        </span>
        <span className="campus">@四川大学</span>
      </div>
      <div className="poster-heading">
        <div className="micro kicker">
          <i /> SIGNATURE WALL
        </div>
        <h1>
          Ink <em>Field.</em>
        </h1>
        <span className="poster-zh">墨 场</span>
      </div>
      <div className="poster-foot">
        <div className="poster-event">AI Coding Hackathon</div>
        <div className="poster-meta">
          <span>
            11.28 <b>/</b> 13:00–18:20
          </span>
          <span>江安校区 · 综合楼 C103</span>
        </div>
      </div>
    </section>
  );
}
