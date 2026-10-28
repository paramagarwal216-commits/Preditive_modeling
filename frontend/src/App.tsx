import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { FilterProvider } from "./filters";
import Dashboard from "./pages/Dashboard";
import Data from "./pages/Data";
import Geography from "./pages/Geography";
import Models from "./pages/Models";
import Overview from "./pages/Overview";
import Report from "./pages/Report";
import Segments from "./pages/Segments";

export default function App() {
  return (
    <FilterProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="report" element={<Report />} />
          <Route path="overview" element={<Overview />} />
          <Route path="segments" element={<Segments />} />
          <Route path="geography" element={<Geography />} />
          <Route path="models" element={<Models />} />
          {/* Predictor now lives on the Models page; keep old links working. */}
          <Route path="predictor" element={<Navigate to={{ pathname: "/models", hash: "#predictor" }} replace />} />
          <Route path="data" element={<Data />} />
        </Route>
      </Routes>
    </FilterProvider>
  );
}
