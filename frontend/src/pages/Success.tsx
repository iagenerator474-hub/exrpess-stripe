import { useState, useEffect, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { api } from "../lib/api.ts";
import { Notice } from "../components/Notice.tsx";

// Do not use the success_url redirect to validate payment. Always validate via GET /payments/orders/:id (poll until status is paid/failed/refunded).
const ORDER_STATUS_KEY = "lastOrderId";
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 10;

interface OrderSummary {
  id: string;
  status: string;
  productId: string | null;
  amountCents: number;
  currency: string;
  stripeSessionId: string | null;
  updatedAt: string;
}

function statusLabel(status: string): string {
  switch (status) {
    case "paid":
      return "Paiement réussi";
    case "failed":
      return "Échec du paiement";
    case "refunded":
      return "Remboursé";
    case "pending":
    default:
      return "En cours";
  }
}

export function Success() {
  const [searchParams] = useSearchParams();
  const orderIdFromQuery = searchParams.get("orderId");
  const [orderId] = useState<string | null>(() => orderIdFromQuery || localStorage.getItem(ORDER_STATUS_KEY));
  const [order, setOrder] = useState<OrderSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!orderId) return;

    const finalStatuses = ["paid", "failed", "refunded"];
    let timeoutId: ReturnType<typeof setTimeout>;

    function poll() {
      attemptRef.current += 1;
      api
        .get<OrderSummary>(`/payments/orders/${orderId}`)
        .then((res: { data: OrderSummary }) => {
          setOrder(res.data);
          if (finalStatuses.includes(res.data.status)) {
            return;
          }
          if (attemptRef.current < POLL_MAX_ATTEMPTS) {
            timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
          }
        })
        .catch(() => {
          setError("Impossible de récupérer le statut de la commande");
        });
    }

    poll();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [orderId]);

  if (!orderId) {
    return (
      <div className="page">
        <h1>Retour paiement</h1>
        <div className="card flow">
          <p>Aucune commande à afficher. Retournez au checkout pour effectuer un paiement.</p>
          <Link to="/checkout" className="btn btn-primary">
            Aller au checkout
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Retour paiement</h1>
      <div className="card flow">
        {error && <Notice type="error" message={error} onDismiss={() => setError(null)} />}
        {order ? (
          <>
            <p>
              <strong>Statut :</strong> {statusLabel(order.status)}
            </p>
            <p>
              Commande {order.id} · {(order.amountCents / 100).toFixed(2)} {order.currency.toUpperCase()}
            </p>
            <Link to="/dashboard" className="btn btn-primary">
              Retour au tableau de bord
            </Link>
          </>
        ) : !error ? (
          <p>Vérification du statut en cours…</p>
        ) : null}
      </div>
    </div>
  );
}
