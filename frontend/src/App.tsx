import { Navigate, Route, Routes } from "react-router";

import { RequireAuth, RequireGuest } from "@/components/route-guards";
import LoginPage from "@/pages/login";
import SuccessPage from "@/pages/success";

export default function App() {
  return (
    <Routes>
      <Route element={<RequireGuest redirectTo="/landing" />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>

      <Route element={<RequireAuth redirectTo="/login" />}>
        <Route path="/landing" element={<SuccessPage />} />
      </Route>

      {/* RequireAuth bounces signed-out users on to /login */}
      <Route path="*" element={<Navigate to="/landing" replace />} />
    </Routes>
  );
}
