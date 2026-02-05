# Security — Modèle de menaces et mesures

Vue synthétique des risques et des contrôles en place pour l’API Stripe (webhooks, auth, paiements). À compléter côté client (hébergement, rotation, monitoring).

---

## Modèle de menaces (simplifié)

| Menace | Description |
|--------|-------------|
| **Webhook spoofing** | Envoi de faux événements Stripe pour faire croire à un paiement ou modifier des ordres. |
| **Replay** | Réutilisation d’un même event ou d’un même token pour déclencher plusieurs fois une action. |
| **Double charge** | Un même paiement entraîne plusieurs mises à jour ou plusieurs créations d’ordre. |
| **Secrets leakage** | Fuite de clés API, JWT, ou secrets webhook (code, logs, support). |
| **CORS / origine** | Requêtes depuis des origines non autorisées (vol de token, abus). |

---

## Mesures en place

- **Webhook Stripe**  
  - Vérification de signature : `stripe.webhooks.constructEvent(rawBody, signature, secret)` sur le **body brut** (aucun parsing JSON avant).  
  - **Durable** : pas d’ACK 200 avant persistance en base ; en cas d’échec DB → 500 → Stripe retente.

- **Idempotence**  
  - Ledger : chaque event Stripe est persisté avec un identifiant unique (`stripe_event_id`). Contrainte unique en base → rejeu = 200 sans retraitement.  
  - Ordre : mise à jour conditionnelle (ex. `status != 'paid'`) et unicité de la session Stripe par ordre pour éviter double mise à jour.

- **Rate limiting**  
  - Limites sur auth (login, refresh) et sur le webhook Stripe pour limiter abus et force brute.

- **Headers / Helmet**  
  - Sécurisation des en-têtes HTTP (Helmet) pour réduire les risques XSS, clickjacking, etc.

- **Cookies refresh**  
  - HttpOnly (non accessible en JS).  
  - SameSite configurable (lax / strict / none).  
  - Si SameSite = none, Secure est imposé (HTTPS uniquement).

- **CORS**  
  - En production, liste d’origines explicite requise ; pas de wildcard `*`.

- **Erreurs 500 en prod**  
  - Réponse client générique ; pas d’exposition de stack ou de détails internes. Détails uniquement dans les logs côté serveur.

---

## À configurer côté client

- **Rotation des secrets** : politique de rotation pour `JWT_ACCESS_SECRET`, `STRIPE_WEBHOOK_SECRET`, clés Stripe ; en cas de fuite : rotation immédiate et révocation/regénération côté Stripe.
- **HTTPS** : obligatoire en production ; pas de service exposé en clair sur Internet.
- **Rétention des logs** : politique de conservation et d’accès (conformité, enquêtes).
- **Monitoring** : surveillance dispo DB, erreurs 5xx, échecs webhook (Stripe Dashboard + logs applicatifs) et alertes adaptées.

---

*Document livraison client — pas de secret, pas de valeur réelle.*
