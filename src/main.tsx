import { createRoot } from "react-dom/client";
import { Sign } from "./Sign";
import { Wall } from "./Wall";
import { Admin } from "./Admin";
import "./styles.css";
const Page = location.pathname.startsWith("/wall")
  ? Wall
  : location.pathname.startsWith("/admin")
    ? Admin
    : Sign;
createRoot(document.getElementById("root")!).render(<Page />);
