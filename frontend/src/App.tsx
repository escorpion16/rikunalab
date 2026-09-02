import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider }   from "./contexts/ThemeContext";
import { AuthProvider }    from "./contexts/AuthContext";
import { HistoryProvider } from "./contexts/HistoryContext";
import { AppLayout }       from "./components/layout/AppLayout";
import { LoginPage }       from "./pages/LoginPage";
import { DashboardPage }   from "./pages/DashboardPage";
import { AnalysisPage }    from "./pages/AnalysisPage";
import { HistoryPage }     from "./pages/HistoryPage";

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <HistoryProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/analysis"  element={<AnalysisPage />} />
                <Route path="/history"   element={<HistoryPage />} />
              </Route>
              <Route path="/"  element={<Navigate to="/dashboard" replace />} />
              <Route path="*"  element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </HistoryProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
