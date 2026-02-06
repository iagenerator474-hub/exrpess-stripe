import { useState, useEffect } from "react";
import { api } from "../lib/api.ts";
import { Notice } from "../components/Notice.tsx";

interface Product {
  id: string;
  name: string;
  amountCents: number;
  currency: string;
}

export function Checkout() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingCheckout, setLoadingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<Product[]>("/products")
      .then(({ data }) => {
        if (cancelled || !Array.isArray(data)) return;
        setProducts(data);
        if (data.length > 0 && !selectedProductId) {
          setSelectedProductId(data[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger les produits");
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handlePay() {
    if (!selectedProductId) {
      setError("Veuillez sélectionner un produit");
      return;
    }
    setError(null);
    setLoadingCheckout(true);
    try {
      const { data } = await api.post<{ checkoutUrl: string; orderId: string }>(
        "/payments/checkout-session",
        { productId: selectedProductId }
      );
      if (data.checkoutUrl) {
        if (data.orderId) {
          localStorage.setItem("lastOrderId", data.orderId);
        }
        window.location.href = data.checkoutUrl;
        return;
      }
      setError("Réponse invalide : pas d’URL de paiement");
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { error?: string }; status?: number } }).response?.data?.error
          : null;
      setError(msg && typeof msg === "string" ? msg : "Impossible de créer la session de paiement");
    } finally {
      setLoadingCheckout(false);
    }
  }

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  return (
    <div className="page">
      <h1>Checkout</h1>
      <div className="card flow">
        {error && <Notice type="error" message={error} onDismiss={() => setError(null)} />}
        {loadingProducts ? (
          <p>Chargement des produits…</p>
        ) : products.length === 0 ? (
          <p>Aucun produit disponible.</p>
        ) : (
          <>
            {products.length > 1 ? (
              <div className="flow">
                <label htmlFor="checkout-product">Produit</label>
                <select
                  id="checkout-product"
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  disabled={loadingCheckout}
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} – {(p.amountCents / 100).toFixed(2)} {p.currency.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              selectedProduct && (
                <p>
                  {selectedProduct.name} – {(selectedProduct.amountCents / 100).toFixed(2)}{" "}
                  {selectedProduct.currency.toUpperCase()}
                </p>
              )
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handlePay()}
              disabled={loadingCheckout || !selectedProductId}
            >
              {loadingCheckout ? "Redirection…" : "Payer"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
