import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";
import { getApiBaseUrl } from "../lib/api.ts";

export function Dashboard() {
  const { user, logout } = useAuth();

  return (
    <div className="page">
      <h1>Tableau de bord</h1>
      <div className="card flow">
        <p>
          <strong>Connecté</strong> : {user?.email ?? "—"}
        </p>
        <div className="row gap">
          <button type="button" className="btn" onClick={() => void logout()}>
            Déconnexion
          </button>
          <Link to="/checkout" className="btn btn-primary">
            Aller au checkout
          </Link>
        </div>
        <div className="debug">
          <small>
            API : <code>{getApiBaseUrl()}</code> · Auth : {user ? "oui" : "non"}
          </small>
        </div>
      </div>
    </div>
  );
}
