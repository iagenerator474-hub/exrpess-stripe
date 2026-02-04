import { Link } from "react-router-dom";

export function Cancel() {
  return (
    <div className="page">
      <h1>Paiement annulé</h1>
      <div className="card flow">
        <p>Le paiement a été annulé. Vous pouvez réessayer.</p>
        <Link to="/checkout" className="btn btn-primary">
          Réessayer le checkout
        </Link>
      </div>
    </div>
  );
}
