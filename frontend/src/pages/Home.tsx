import { Link } from "react-router-dom";

export function Home() {
  return (
    <div className="page">
      <h1>Démo Checkout</h1>
      <div className="card flow">
        <p>
          <strong>Flow :</strong> Connexion → Checkout → redirection Stripe → Success ou Cancel.
        </p>
        <div className="row gap">
          <Link to="/login" className="btn btn-primary">
            Se connecter
          </Link>
          <Link to="/checkout" className="btn">
            Aller au checkout
          </Link>
        </div>
      </div>
    </div>
  );
}
