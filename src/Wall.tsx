import { memo, useCallback, useEffect, useRef, useState } from "react";
import { drawBoard, prepareBoard } from "./board";
import { useLive, api, type Sig } from "./live";
import { InkCanvas } from "./InkCanvas";
import { writingData } from "./ink";
export const signUrl = () => location.origin + "/";
const Name = memo(function Name({
  s,
  paused,
  finish,
  error,
  retry,
}: {
  retry: number;
  s: Sig;
  paused: boolean;
  finish: (id: string) => void;
  error: (m: string) => void;
}) {
  return (
    <div
      data-id={s.id}
      className={"signature " + s.status}
      style={{
        left: s.x,
        top: s.y,
        width: s.width,
        height: s.height,
        transform: `rotate(${s.rotation}deg)`,
      }}
    >
      <InkCanvas
        s={s}
        replay={retry}
        paused={paused}
        onFinish={() => finish(s.id)}
        onError={error}
      />
    </div>
  );
});
export function Wall() {
  const state = useLive(),
    ref = useRef<HTMLCanvasElement>(null),
    [warning, setWarning] = useState("");
  const [scale, setScale] = useState(() =>
    Math.min(innerWidth / 1920, innerHeight / 1080),
  );
  const [retry, setRetry] = useState(0);
  const timers = useRef(new Set<number>());
  const schedule = useCallback(() => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      setRetry((n) => n + 1);
    }, 1100);
    timers.current.add(id);
  }, []);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  useEffect(() => {
    const resize = () =>
      setScale(Math.min(innerWidth / 1920, innerHeight / 1080));
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const count = state.signatures.length;
  useEffect(() => {
    let active = true;
    const c = ref.current!,
      ctx = c.getContext("2d")!;
    const draw = () => {
      if (active) drawBoard(ctx, state, state.online, signUrl());
    };
    let frame = 0;
    prepareBoard()
      .then(() => {
        if (active) frame = requestAnimationFrame(draw);
      })
      .catch(() => {
        if (active) {
          setWarning("展签字体加载中");
          schedule();
        }
      });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [count, state.online, state.eventStatus, state.animationPaused, retry]);
  const next = state.signatures.find((s) => s.status !== "complete");
  useEffect(() => {
    if (
      !next ||
      next.status !== "queued" ||
      state.animationPaused ||
      !state.online
    )
      return;
    let active = true;
    writingData(next)
      .then(() => {
        if (active)
          return api(`/api/signatures/${next.id}/status`, {
            method: "PATCH",
            body: JSON.stringify({
              status: "writing",
              expectedStatus: "queued",
            }),
          });
      })
      .then(() => {
        if (active) setWarning("");
      })
      .catch(() => {
        if (active) {
          setWarning("书写准备中，正在重试");
          schedule();
        }
      });
    return () => {
      active = false;
    };
  }, [
    next?.id,
    next?.status,
    state.animationPaused,
    state.online,
    retry,
    schedule,
  ]);
  const complete = useCallback(
    (id: string) => {
      api(`/api/signatures/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "complete", expectedStatus: "writing" }),
      })
        .then(() => setWarning(""))
        .catch(() => {
          setWarning("正在同步书写状态");
          schedule();
        });
    },
    [schedule],
  );
  return (
    <main className="wall">
      <div
        className="board"
        style={{ transform: `translate(-50%,-50%) scale(${scale})` }}
      >
        <canvas
          width="1920"
          height="1080"
          ref={ref}
          aria-label="墨场 · TRAE on Campus @四川大学 · AI Coding Hackathon"
        />
        <div className="wall-count sr-only">
          <strong>{count}</strong> 人已署名
        </div>
        <a className="qr-link" href={signUrl()} aria-label="手机扫码签到" />
        {state.signatures.map((s) => (
          <Name
            key={s.id}
            retry={s.status === "writing" ? retry : 0}
            s={s}
            paused={state.animationPaused || !state.online}
            finish={complete}
            error={setWarning}
          />
        ))}
        {warning && (
          <p className="wall-note" role="status">
            {warning}
          </p>
        )}
      </div>
    </main>
  );
}
