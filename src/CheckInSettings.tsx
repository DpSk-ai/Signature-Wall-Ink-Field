import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./live";

type Source = "off" | "link" | "auto" | "qr";
type Config = {
  mode: "off" | "link" | "qr";
  url: string;
  hasQr: boolean;
  revision: string;
};
const status = { off: "尚未发布", link: "打开学校网页", qr: "展示官方二维码" };

async function imagePayload(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg"].includes(file.type) ||
    file.size > 10 * 1024 * 1024
  )
    throw Error("请选择 10 MiB 以内的 PNG 或 JPEG 图片");
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(Error("图片读取失败"));
      img.src = objectUrl;
    });
    const scale = Math.min(
      1,
      1200 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("当前浏览器无法读取图片");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.toDataURL("image/png").split(",")[1];
    if (!encoded || encoded.length > Math.ceil((2 * 1024 * 1024) / 3) * 4)
      throw Error("请裁切至二维码及周围白边后重试");
    return encoded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CheckInSettings({ token }: { token: string }) {
  const [saved, setSaved] = useState<Config>();
  const [source, setSource] = useState<Source>("off"),
    [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState(""),
    [busy, setBusy] = useState(false);
  function display(c: Config) {
    setSaved(c);
    setUrl(c.url);
    if (fileInput.current) fileInput.current.value = "";
    setSource(c.hasQr ? (c.mode === "link" ? "auto" : "qr") : c.mode);
  }
  const load = useCallback(async () => {
    setBusy(true);
    try {
      display(
        await api<Config>("/api/admin/check-in", {
          headers: { authorization: "Bearer " + token },
          cache: "no-store",
        }),
      );
      setFeedback("");
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!saved || busy) return;
    setBusy(true);
    setFeedback("");
    try {
      const body: {
        source: Source;
        revision: string;
        url?: string;
        png?: string;
      } = { source, revision: saved.revision };
      const file = fileInput.current?.files?.[0];
      if (source === "link") body.url = url;
      if ((source === "qr" || source === "auto") && file)
        body.png = await imagePayload(file);
      const c = await api<Config>("/api/admin/check-in", {
        method: "PUT",
        headers: { authorization: "Bearer " + token },
        body: JSON.stringify(body),
      });
      display(c);
      setFeedback("已保存 · " + status[c.mode]);
    } catch (e) {
      setFeedback((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const uploading = source === "auto" || source === "qr";
  return (
    <section className="admin-section configuration">
      <div className="section-head">
        <h2>学校二课入口</h2>
        <span className="config-status">
          {saved ? status[saved.mode] : "读取配置中"}
        </span>
      </div>
      <p>大屏二维码始终进入墨场欢迎页。仅在这里配置主办方提供的学校入口。</p>
      <form onSubmit={save}>
        <fieldset disabled={busy || !saved}>
          <label>
            入口方式
            <select
              value={source}
              onChange={(e) => {
                setSource(e.target.value as Source);
                setFeedback("");
              }}
            >
              <option value="off">暂不发布</option>
              <option value="link">官方 HTTPS 链接</option>
              <option value="auto">从二维码识别链接</option>
              <option value="qr">仅展示官方二维码</option>
            </select>
          </label>
          {source === "link" && (
            <label>
              官方签到地址
              <input
                type="url"
                required
                autoComplete="off"
                spellCheck={false}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
          )}
          {uploading && (
            <>
              <label>
                官方二维码图片
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  required={!saved?.hasQr}
                />
              </label>
              <p>
                {source === "auto"
                  ? "识别出 HTTPS 地址时直接跳转，并保留原码供备用；其余内容仅展示二维码。"
                  : "专用协议、动态码或不支持直接打开的活动，使用学校提供的原码。"}
              </p>
              {saved?.hasQr && (
                <details>
                  <summary>查看当前已保存的二维码</summary>
                  <img
                    className="saved-qr"
                    src={"/api/check-in/qr?v=" + saved.revision}
                    alt="当前已保存的学校二维码"
                  />
                </details>
              )}
            </>
          )}
          {source === "off" && saved?.mode !== "off" && (
            <p>保存后将撤下当前学校入口，数字签名继续开放。</p>
          )}
          <button type="submit" disabled={busy || !saved}>
            {busy ? "正在处理…" : "保存二课入口"}
          </button>
        </fieldset>
      </form>
      {feedback && (
        <p role="status">
          {feedback}{" "}
          <button
            type="button"
            className="quiet"
            onClick={load}
            disabled={busy}
          >
            重新载入配置
          </button>
        </p>
      )}
    </section>
  );
}
