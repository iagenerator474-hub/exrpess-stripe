import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.tsx";
import { ProtectedRoute } from "./auth/requireAuth.tsx";
import { NavBar } from "./components/NavBar.tsx";
import { Home } from "./pages/Home.tsx";
import { Login } from "./pages/Login.tsx";
import { Dashboard } from "./pages/Dashboard.tsx";
import { Checkout } from "./pages/Checkout.tsx";
import { Success } from "./pages/Success.tsx";
import { Cancel } from "./pages/Cancel.tsx";

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <NavBar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/checkout" element={<ProtectedRoute><Checkout /></ProtectedRoute>} />
            <Route path="/success" element={<Success />} />
            <Route path="/cancel" element={<Cancel />} />
            <Route path="/404" element={<NotFound />} />
            <Route path="*" element={<Navigate to="/404" replace />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  );
}

function NotFound() {
  return (
    <div className="page centered">
      <h1>404</h1>
      <p>Page non trouvée.</p>
    </div>
  );
}

export default App;
