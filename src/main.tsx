import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/outfit/400.css";
import "@fontsource/outfit/500.css";
import "@fontsource/outfit/600.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./App";
import { Board } from "./pages/Board";
import { MatchPage } from "./pages/MatchPage";
import { RecordPage } from "./pages/RecordPage";
import { SourcesPage } from "./pages/SourcesPage";
import { StatusProvider } from "./status";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StatusProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Board />} />
            <Route path="match/:id" element={<MatchPage />} />
            <Route path="uspesnost" element={<RecordPage />} />
            <Route path="sources" element={<SourcesPage />} />
            <Route path="*" element={<p className="empty">Tahle stránka neexistuje.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StatusProvider>
  </StrictMode>,
);
