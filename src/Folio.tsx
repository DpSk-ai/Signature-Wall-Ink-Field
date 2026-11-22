import { useEffect } from "react";
import { loadFace } from "./fonts";

export function Seal() {
  return (
    <span className="seal" aria-hidden="true">
      墨
    </span>
  );
}
export function Imprint() {
  return (
    <div className="imprint">
      <Seal />
      <strong>墨场</strong>
      <span>INK FIELD</span>
    </div>
  );
}
export function BookCover({ eventName }: { eventName: string }) {
  useEffect(() => {
    void loadFace("ma-shan-zheng", "墨").catch(() => {});
  }, []);
  return (
    <header className="book-cover">
      <Imprint />
      <div className="cover-title">
        <span className="micro">SIGNATURE REGISTER</span>
        <h1>现场题名录</h1>
        <p>{eventName}</p>
      </div>
      <div className="cover-art" aria-hidden="true">
        <span>墨</span>
        <b>题名</b>
      </div>
    </header>
  );
}
