import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.tsx";

export function NavBar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand">
          Démo
        </Link>
        <div className="navbar-links">
          <Link to="/">Accueil</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/checkout">Checkout</Link>
          {user ? (
            <button type="button" className="btn-link" onClick={() => void logout()}>
              Déconnexion
            </button>
          ) : (
            <Link to="/login">Connexion</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
