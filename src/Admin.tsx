import { saveBlob } from "./download";
import { useEffect, useRef, useState } from "react";
import { api, useLive, type Sig } from "./live";
import { family, fontRows, loadFace } from "./fonts";
import { exportBoard } from "./board";
import { Imprint } from "./Folio";
import { CheckInSettings } from "./CheckInSettings";
export function Admin() {
  const state = useLive(),
    [token, setToken] = useState(sessionStorage.getItem("admin-token") || ""),
    [password, setPassword] = useState(""),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [showHidden, setShowHidden] = useState(false),
    [hiddenList, setHiddenList] = useState<Sig[]>([]),
    [exporting, setExporting] = useState(false);
  const loadedNames = useRef(new Set<string>());
  const refreshHidden = async () => {
    if (!token) return;
    try {
      const all = await api<Sig[]>("/api/admin/signatures", {
        headers: { authorization: `Bearer ${token}` },
      });
      setHiddenList(all.filter((s) => s.hidden));
    } catch (e) {
      if ((e as Error).message === "未授权") {
        sessionStorage.removeItem("admin-token");
        setToken("");
      }
    }
  };
  useEffect(() => {
    refreshHidden();
  }, [token, state.signatures.length]);
  const call = async (path: string, init: RequestInit = {}) => {
    try {
      const data = await api(path, {
        ...init,
        headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
      });
      setMessage("操作已保存");
      refreshHidden();
      return data;
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  useEffect(() => {
    if (!token) return;
    for (const record of [...state.signatures, ...hiddenList]) {
      const key = record.font_id + "|" + record.name;
      if (loadedNames.current.has(key)) continue;
      loadedNames.current.add(key);
      void loadFace(record.font_id, record.name).catch(() => {
        loadedNames.current.delete(key);
        setMessage("部分字体未能加载");
      });
    }
  }, [token, state.signatures, hiddenList]);
  if (!token)
    return (
      <main className="admin-login">
        <section className="login-card">
          <Imprint />
          <h1>管理署名墙</h1>
          <label>
            管理员密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {message && <p className="error">{message}</p>}
          <button
            className="primary"
            onClick={async () => {
              try {
                const d = await api("/api/admin/login", {
                  method: "POST",
                  body: JSON.stringify({ password }),
                });
                sessionStorage.setItem("admin-token", d.token);
                setMessage("");
                setToken(d.token);
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            登录后台
          </button>
        </section>
      </main>
    );
  const settings = (data: object) =>
    call("/api/admin/settings", { method: "PUT", body: JSON.stringify(data) });
  const export4k = async () => {
    setExporting(true);
    try {
      await exportBoard(state, location.origin + "/");
      setMessage("纪念图已导出");
    } catch (e) {
      setMessage("导出失败 · " + (e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const exportCsv = async () => {
    try {
      const all = await api<Sig[]>("/api/admin/signatures", {
        headers: { authorization: `Bearer ${token}` },
      });
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const head = ["姓名", "字体", "字体ID", "状态", "署名时间"].map(esc);
      const rows = all.map((s) =>
        [
          s.name,
          fontRows.find((f) => f[0] === s.font_id)?.[1] || "",
          s.font_id,
          s.status,
          s.created_at,
        ]
          .map(esc)
          .join(","),
      );
      const csv = "\uFEFF" + [head.join(","), ...rows].join("\r\n");
      saveBlob(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        "signature-wall-records.csv",
      );
    } catch (e) {
      setMessage("导出失败 · " + (e as Error).message);
    }
  };
  return (
    <main className="admin">
      <header>
        <div>
          <Imprint />
          <h1>现场控制台</h1>
        </div>
        <div className="header-actions">
          <a href="/wall" target="_blank">
            打开大屏
          </a>
          <button onClick={exportCsv}>导出署名记录</button>
          <button disabled={exporting || !state.online} onClick={export4k}>
            {exporting ? "正在生成 4K 图…" : "导出 4K 纪念图"}
          </button>
        </div>
      </header>
      <section className="admin-section">
        <h2>墨场署名管理</h2>
        <p className="admin-state">
          <i /> {state.online ? "实时连接" : "重新连接中"} ·{" "}
          {state.eventStatus === "open"
            ? "署名开放"
            : state.eventStatus === "ended"
              ? "署名结束"
              : "署名暂停"}{" "}
          · {state.animationPaused ? "动画暂停" : "动画开启"}
        </p>
        <div className="controls">
          <button onClick={() => settings({ eventStatus: "open" })}>
            开启署名
          </button>
          <button onClick={() => settings({ eventStatus: "paused" })}>
            暂停署名
          </button>
          <button onClick={() => settings({ eventStatus: "ended" })}>
            结束署名
          </button>
          <button
            onClick={() =>
              settings({ animationPaused: !state.animationPaused })
            }
          >
            {state.animationPaused ? "恢复动画" : "暂停动画"}
          </button>
          <button onClick={() => call("/api/admin/replay", { method: "POST" })}>
            重播最近姓名
          </button>
          <button
            onClick={() => {
              if (window.confirm("确认清空全部署名数据？此操作不可恢复。"))
                call("/api/admin/signatures", { method: "DELETE" });
            }}
          >
            清空全部署名
          </button>
          <span>
            {state.signatures.length} 人在墙 · {hiddenList.length} 已隐藏 ·{" "}
            {state.connections} 个连接
          </span>
        </div>
      </section>
      <CheckInSettings token={token} />
      <section className="admin-section">
        <div className="section-head">
          <h2>署名记录</h2>
          <div className="section-actions">
            <input
              value={query}
              placeholder="搜索姓名"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? "收起已隐藏" : "显示已隐藏"}
            </button>
          </div>
        </div>
        <div className="records">
          {!state.signatures.length && !showHidden && <p>还没有公开署名记录</p>}
          {(showHidden
            ? [
                ...state.signatures,
                ...hiddenList.filter(
                  (h) => !state.signatures.some((v) => v.id === h.id),
                ),
              ]
            : state.signatures
          )
            .filter((s) => s.name.includes(query))
            .map((s) => (
              <article key={s.id} className={s.hidden ? "is-hidden" : ""}>
                <b style={{ fontFamily: family(s.font_id) }}>{s.name}</b>
                <span>{fontRows.find((f) => f[0] === s.font_id)?.[1]}</span>
                <time>{new Date(s.created_at).toLocaleString()}</time>
                <span>
                  {s.hidden
                    ? "已隐藏"
                    : {
                        complete: "已署名",
                        queued: "等待书写",
                        writing: "书写中",
                      }[s.status]}
                </span>
                <span className="row-actions">
                  {s.hidden ? (
                    <button
                      onClick={() =>
                        call(`/api/admin/signatures/${s.id}`, {
                          method: "PATCH",
                          body: JSON.stringify({ hidden: false }),
                        })
                      }
                    >
                      恢复
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() =>
                          call(`/api/admin/signatures/${s.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ hidden: true }),
                          })
                        }
                      >
                        隐藏
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`确认删除「${s.name}」？`))
                            call(`/api/admin/signatures/${s.id}`, {
                              method: "DELETE",
                            });
                        }}
                      >
                        删除
                      </button>
                    </>
                  )}
                </span>
              </article>
            ))}
        </div>
      </section>
      <section className="admin-section">
        <h2>字体授权</h2>
        <p>
          {fontRows.length}{" "}
          款本地中文字体。完整授权、版本和覆盖范围见源码包字体台账。
        </p>
      </section>
      {message && <div className="toast">{message}</div>}
    </main>
  );
}
