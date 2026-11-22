import { useEffect, useRef, useState } from "react";
import { catalog, family, loadFace } from "./fonts";
import { api, type Sig, useLive } from "./live";
import { Poster, Seal } from "./Poster";
import { InkCanvas } from "./InkCanvas";
const groups = [...new Set(catalog.map((f) => f.group))];
const arrow = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path d="M5 19 19 5M6 5h13v13" stroke="currentColor" strokeWidth="1.7" />
  </svg>
);
const number = (n: number) => String(n).padStart(2, "0");
function specimen(name: string, font: string): Sig {
  return {
    name,
    id: "specimen",
    font_id: font,
    status: "writing",
    x: 0,
    y: 0,
    width: 350,
    height: 74,
    size: 66,
    rotation: 0,
    created_at: "",
  };
}
export function Sign() {
  const state = useLive();
  const [name, setName] = useState(""),
    [font, setFont] = useState(catalog[0]),
    [group, setGroup] = useState(groups[0]);
  const [ready, setReady] = useState(false),
    [missing, setMissing] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [done, setDone] = useState<Sig>(),
    [replay, setReplay] = useState(0);
  const [sampleReady, setSampleReady] = useState(""),
    [reload, setReload] = useState(0);
  const request = useRef({ key: "", id: "" }),
    lock = useRef(false);
  const text = name.trim() || "山川",
    groupFonts = catalog.filter((f) => f.group === group);
  useEffect(() => {
    let active = true;
    setReady(false);
    setError("");
    loadFace(font.id, text)
      .then((m) => {
        if (active) {
          setMissing(
            m.missing.length
              ? "「" +
                  m.missing.join("、") +
                  "」" +
                  (m.device.length
                    ? "含设备补字，请核对预览"
                    : "使用本地补充字形")
              : "",
          );
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError("字库加载失败，请重新加载");
      });
    return () => {
      active = false;
    };
  }, [font, text, reload]);
  useEffect(() => {
    let active = true;
    setSampleReady("");
    Promise.all(
      catalog
        .filter((f) => f.group === group)
        .map((f) => loadFace(f.id, "山川")),
    )
      .then(() => {
        if (active) setSampleReady(group);
      })
      .catch(() => {
        if (active) setError("字体标本加载失败，请重试");
      });
    return () => {
      active = false;
    };
  }, [group, reload]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      lock.current ||
      !name.trim() ||
      !ready ||
      !state.online ||
      state.eventStatus !== "open"
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const actual = name.trim();
      await loadFace(font.id, actual);
      const ctx = document.createElement("canvas").getContext("2d")!;
      ctx.font = `64px ${family(font.id)}`;
      const metrics = [...actual].map((c) => ctx.measureText(c));
      const width =
        metrics.reduce((a, m) => a + m.width, 0) +
        Math.max(0, metrics[0].actualBoundingBoxLeft) +
        8;
      const height =
        Math.max(...metrics.map((m) => m.actualBoundingBoxAscent)) +
        Math.max(...metrics.map((m) => m.actualBoundingBoxDescent)) +
        8;
      const key = JSON.stringify([actual, font.id]);
      if (request.current.key !== key)
        request.current = {
          key,
          id: Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
            n.toString(16).padStart(8, "0"),
          ).join(""),
        };
      setDone(
        await api<Sig>("/api/signatures", {
          method: "POST",
          body: JSON.stringify({
            name: actual,
            fontId: font.id,
            requestId: request.current.id,
            metrics: {
              width: Math.max(8, Math.ceil(width)),
              height: Math.max(20, Math.ceil(height)),
            },
          }),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  if (done)
    return (
      <main className="success">
        <section className="receipt">
          <div className="receipt-top">
            <Seal />
            <span className="micro">INK FIELD / 墨场</span>
          </div>
          <div className="receipt-status">
            <i /> 签到已确认
          </div>
          <h1 style={{ fontFamily: family(done.font_id) }}>{done.name}</h1>
          <p>抬头看大屏，你的名字将在这里落笔。</p>
          <dl>
            <div>
              <dt>所选字体</dt>
              <dd>{font.label}</dd>
            </div>
            <div>
              <dt>落笔坐标</dt>
              <dd>
                {Math.round(done.x)} , {Math.round(done.y)}
              </dd>
            </div>
          </dl>
          <p className="receipt-event">
            TRAE on Campus @四川大学
            <br />
            AI Coding Hackathon
          </p>
          <button
            className="primary"
            onClick={() => {
              request.current = { key: "", id: "" };
              setDone(undefined);
              setName("");
            }}
          >
            继续签到 {arrow}
          </button>
        </section>
      </main>
    );
  return (
    <main className="studio">
      <Poster count={state.signatures.length} />
      <form className="desk" onSubmit={submit}>
        <div className="desk-top">
          <span className="micro">SIGNATURE STUDIO</span>
          <span className="live-pill">
            <i />
            {!state.online
              ? "连接中"
              : state.eventStatus === "open"
                ? "签到开放"
                : "签到暂停"}
          </span>
        </div>
        <h2>
          创作你的签名<span>.</span>
        </h2>
        <div className="name-label">
          <label htmlFor="name">姓名或昵称</label>
          <span className="micro">{[...name].length} / 12</span>
        </div>
        <input
          id="name"
          placeholder="输入你的名字"
          autoComplete="off"
          value={name}
          onChange={(e) => setName([...e.target.value].slice(0, 12).join(""))}
        />
        <section className="proof">
          <div className="proof-head">
            <span>签名预览</span>
            <button
              type="button"
              onClick={() => setReplay((n) => n + 1)}
              aria-label="重新书写预览"
            >
              ↻ 重写
            </button>
          </div>
          <div className="preview" style={{ fontFamily: family(font.id) }}>
            <InkCanvas s={specimen(text, font.id)} replay={replay} />
          </div>
          <div className="proof-foot">
            <span>{font.label}</span>
            <span>FIG. {number(catalog.indexOf(font) + 1)}</span>
          </div>
        </section>
        {missing && <p className="coverage">{missing}</p>}
        <div className="spec-head">
          <h3>字体标本</h3>
          <span className="micro">{catalog.length} TYPEFACES</span>
        </div>
        <div className="tabs" role="group" aria-label="字体类别">
          {groups.map((g) => (
            <button
              type="button"
              aria-pressed={group === g}
              className={group === g ? "active" : ""}
              key={g}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
        <div className="font-grid" key={group}>
          {groupFonts.map((f) => (
            <button
              type="button"
              className={"font-card " + (f.id === font.id ? "selected" : "")}
              key={f.id}
              aria-pressed={f.id === font.id}
              onClick={() => setFont(f)}
            >
              <span className="card-no">{number(catalog.indexOf(f) + 1)}</span>
              <span className="check" aria-hidden="true">
                {f.id === font.id ? "✓" : ""}
              </span>
              <strong
                style={{
                  fontFamily: family(f.id),
                  visibility: sampleReady === group ? "visible" : "hidden",
                }}
              >
                山川
              </strong>
              <small>{f.label}</small>
            </button>
          ))}
        </div>
        {error && (
          <div className="error" role="alert">
            {error}{" "}
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              重试
            </button>
          </div>
        )}
        <button
          className="primary"
          disabled={
            !name.trim() ||
            busy ||
            !ready ||
            !state.online ||
            state.eventStatus !== "open"
          }
        >
          {!state.online
            ? "正在连接"
            : state.eventStatus !== "open"
              ? "签到暂未开放"
              : busy
                ? "正在落款…"
                : "确认签到"}
          {arrow}
        </button>
      </form>
    </main>
  );
}
