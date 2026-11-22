import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./live";
import { BookCover } from "./Folio";

type Guide = {
  mode: "link" | "qr" | "off";
  hasQr: boolean;
  revision: string;
  eventName: string;
};
export function Welcome() {
  const [guide, setGuide] = useState<Guide>();
  const [error, setError] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [visited, setVisited] = useState<string>(history.state?.inkVisit || "");
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await api<Guide>("/api/check-in", { cache: "no-store" });
      if (id === request.current) {
        setGuide(next);
        setError(false);
      }
    } catch {
      if (id === request.current) setError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const resume = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("pageshow", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      request.current++;
      window.removeEventListener("pageshow", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [refresh]);
  function markVisit() {
    const revision = guide?.revision || "";
    setVisited(revision);
    history.replaceState({ ...history.state, inkVisit: revision }, "");
  }
  const returned = !!visited && visited === guide?.revision;
  return (
    <main className="folio portal">
      <BookCover eventName={guide?.eventName || "活动手札"} />
      <div className="steps">
        <section id="official" className="step-block">
          <span className="eyebrow">STEP 01 — OFFICIAL CHECK-IN</span>
          <h2>学校二课签到</h2>
          <p>
            {returned
              ? "已打开过学校入口。签到结果请以二课页面为准。"
              : "在学校页面签到后，点微信左上角返回。若已关闭页面，可重扫大屏活动码。"}
          </p>
          {error ? (
            <button className="quiet" onClick={refresh}>
              入口加载失败，重新加载
            </button>
          ) : !guide ? (
            <p role="status">正在读取活动入口…</p>
          ) : guide.mode === "off" ? (
            <p className="notice">主办方暂未发布二课入口，可直接进行第二步。</p>
          ) : guide.mode === "link" ? (
            <a
              className="action-link"
              href="/api/check-in/open"
              referrerPolicy="no-referrer"
              onClick={markVisit}
            >
              前往二课签到 <span aria-hidden="true">↗</span>
            </a>
          ) : null}
          {guide?.hasQr &&
            (guide.mode === "qr" || showQr ? (
              <figure className="official-code">
                <img
                  src={"/api/check-in/qr?v=" + guide.revision}
                  alt="学校官方二课签到二维码"
                />
                <figcaption>
                  请长按识别或保存二维码，使用学校支持的扫码方式完成签到，再返回本页。
                </figcaption>
              </figure>
            ) : (
              <button className="quiet" onClick={() => setShowQr(true)}>
                打不开学校页面？查看官方二维码
              </button>
            ))}
        </section>
        <section className="step-block">
          <span className="eyebrow">STEP 02 — LEAVE YOUR MARK</span>
          <h2>数字签名上墙</h2>
          <p>
            输入姓名、选择字体，看你的名字在现场大屏上一笔一笔写成。可随时进入这一步。
          </p>
          <a className="primary" href="/sign">
            留下你的名字 <span aria-hidden="true">→</span>
          </a>
        </section>
      </div>
    </main>
  );
}
