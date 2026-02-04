import { useState } from "react";
import { api } from "../lib/api.ts";
import { Notice } from "../components/Notice.tsx";

export function Checkout() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setLoading(true);
    try {
      const { data } = await api.post<{ checkoutUrl: string }>(
        "/payments/checkout-session",
        { amount: 1000, currency: "eur" }
      );
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setError("Réponse invalide : pas d’URL de paiement");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de la création du paiement");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <h1>Checkout</h1>
      <div className="card flow">
        {error && <Notice type="error" message={error} onDismiss={() => setError(null)} />}
        <p>Montant de démo : 10,00 €</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void handlePay()}
          disabled={loading}
        >
          {loading ? "Redirection…" : "Payer"}
        </button>
      </div>
    </div>
  );
}
