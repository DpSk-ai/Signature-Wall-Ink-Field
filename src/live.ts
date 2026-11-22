import { useEffect, useState } from "react";
export type Sig = {
  id: string;
  name: string;
  font_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  size: number;
  rotation: number;
  split_at?: number;
  status: "queued" | "writing" | "complete";
  hidden?: number;
  created_at: string;
};
export type State = {
  signatures: Sig[];
  eventName: string;
  eventStatus: string;
  animationPaused: boolean;
  connections: number;
};
export async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
}
export function useLive() {
  const [state, setState] = useState<State>({
    signatures: [],
    eventName: "",
    eventStatus: "loading",
    connections: 0,
    animationPaused: false,
  });
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let timer = 0,
      closed = false,
      ws: WebSocket;
    function connect() {
      ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/ws");
      ws.onmessage = (e) => {
        const { type, data } = JSON.parse(e.data);
        if (type === "snapshot") {
          setState(data);
          setOnline(true);
          return;
        }
        setState((s) => {
          switch (type) {
            case "signature.created":
              return s.signatures.some((x) => x.id === data.id)
                ? s
                : { ...s, signatures: [...s.signatures, data] };
            case "signature.updated":
              return {
                ...s,
                signatures: s.signatures.map((x) =>
                  x.id === data.id ? { ...x, ...data } : x,
                ),
              };
            case "signature.deleted":
              return {
                ...s,
                signatures: s.signatures.filter((x) => x.id !== data.id),
              };
            case "signatures.cleared":
              return { ...s, signatures: [] };
            case "settings.updated":
              return { ...s, ...data };
            case "connections":
              return { ...s, connections: data };
            default:
              return s;
          }
        });
      };
      ws.onclose = () => {
        if (!closed) {
          setOnline(false);
          timer = window.setTimeout(connect, 1200);
        }
      };
    }
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws.onmessage = null;
      ws.close();
    };
  }, []);
  return { ...state, online };
}
