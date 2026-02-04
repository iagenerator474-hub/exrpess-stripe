import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext.tsx";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/** Wraps a route that requires authentication. Redirects to /login if not authenticated. */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="page centered">
        <p>Chargement…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
