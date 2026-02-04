import { Link } from "react-router-dom";

export function Success() {
  return (
    <div className="page">
      <h1>Paiement réussi</h1>
      <div className="card flow">
        <p>Merci pour votre paiement.</p>
        <Link to="/dashboard" className="btn btn-primary">
          Retour au tableau de bord
        </Link>
      </div>
    </div>
  );
}
