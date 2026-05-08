import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { exposeDevFixtures } from "./lib/devFixtures";

// Dev-only: exposes window.__noahDev for visual fixture testing.
// Stripped from production builds via the import.meta.env.DEV check inside.
exposeDevFixtures();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
