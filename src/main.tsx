import { createRoot } from "react-dom/client";
import { Welcome } from "./Welcome";
import { Sign } from "./Sign";
import { Wall } from "./Wall";
import { Admin } from "./Admin";
import "./styles.css";
const Page = location.pathname.startsWith("/wall")
  ? Wall
  : location.pathname.startsWith("/admin")
    ? Admin
    : /^\/sign\/?$/.test(location.pathname)
      ? Sign
      : Welcome;
createRoot(document.getElementById("root")!).render(<Page />);
