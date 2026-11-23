import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./index.css";
import { App } from "./App";

// No StrictMode: its second mount in dev would start every tab's shell twice.
createRoot(document.getElementById("root")!).render(<App />);
