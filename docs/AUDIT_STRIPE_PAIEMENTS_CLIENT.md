# Audit Stripe – Paiements & fiabilité production

**Périmètre :** flux Checkout, webhooks, idempotence, pricing, logs, config.  
**Référence :** CURSOR 0 à 8 (inventaire, webhook, transitions, logs, config).  
**Orientation :** risque financier et fiabilité prod.

---

## 1. Résumé exécutif

- **Prix** : 100 % côté serveur (client envoie uniquement `productId` ; montant/devise issus de la table `Product`). Pas de risque de manipulation du montant par le front.
- **Source de vérité « payé »** : Uniquement le webhook Stripe signé. Aucun passage à `paid` via redirect ou front. ACK 200 après persistance en base (ou doublon P2002).
- **Idempotence** : Ledger `PaymentEvent` avec contrainte unique sur `stripe_event_id` ; rejeu → 200 sans double application ; passage à `paid` conditionné par `status ≠ paid` et, après correctifs, prise en charge du cas « webhook en avance » (Order sans `stripeSessionId` encore renseigné).
- **Webhook** : Body brut conservé, signature vérifiée via `constructEvent`, secret en env. Réponses 400/5xx cohérentes. Isolation correcte : route `/stripe` montée avant `express.json()` et `cookieParser()`.
- **Logs / erreurs** : Pas de stack ni message technique 5xx côté client en prod. Pas de log headers/cookies/body. Corrélation possible via `requestId` et header `x-request-id`. Détail d’erreur DB dans les logs webhook à durcir en prod.
- **Config** : Variables Stripe validées (Zod). CORS `*` refusé en prod. TRUST_PROXY à définir derrière reverse proxy (rate limit / IP). Pas de contrôle automatique « clé live en prod ».

**Verdict global :** **GO PROD** sous réserve du respect de la checklist déploiement et des correctifs déjà appliqués (CURSOR 3, 6). Aucun bloquant identifié. Les points listés en « Importants » et « Améliorations » restent à traiter ou documenter.

---

## 2. Bloquants / Importants / Améliorations

### Bloquants (aucun)

Aucun point bloquant identifié dans le périmètre audité.

### Importants (à traiter ou documenter avant / en prod)

| # | Thème | Risque | Référence |
|---|--------|--------|-----------|
| I1 | **TRUST_PROXY** non défini derrière reverse proxy | Rate limit et logs par IP incorrects (une IP pour tous les clients). | CURSOR 8 |
| I2 | **Clés Stripe test en prod** | Déploiement avec `sk_test_` / webhook secret de test → paiements test ou rejets. | CURSOR 8 |
| I3 | **Détail d’erreur DB dans logs webhook** | En prod, `String(createErr)` peut exposer schéma / contraintes. Recommandation : ne pas logger le détail brut en prod. | CURSOR 7 |
| I4 | **Validation montant au webhook** | Pas de comparaison `session.amount_total` vs `Order.amountCents`. Défense en profondeur non implémentée. | CURSOR 4 |

### Améliorations (non bloquantes)

| # | Thème | Détail |
|---|--------|--------|
| A1 | requestId dans le body des 4xx/5xx webhook | Pour homogénéité avec le reste de l’API et corrélation côté client (Stripe / support). |
| A2 | Rétention des logs | Documenter politique (ex. 14–30 jours) et usage de `requestId` pour support / audit. |
| A3 | Refus explicite `sk_test_` en prod | Optionnel : en `loadConfig()`, si NODE_ENV=production et STRIPE_SECRET_KEY commence par `sk_test_` → refuser le démarrage. |

---

## 3. Recommandations patch minimal (ordre priorisé)

1. **Checklist déploiement (obligatoire)**  
   - Vérifier en prod : `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` issus de l’environnement **production** (clés live + secret webhook prod).  
   - Si l’API est derrière Nginx / Render / Fly : **TRUST_PROXY=1** obligatoire.  
   - Documenter dans GO_LIVE_CHECKLIST / runbook.

2. **Logs webhook en prod (recommandé)**  
   - Pour « Webhook persist failed » et « Webhook processing failed » : en prod, ne pas logger le détail brut de l’exception (ex. `String(createErr)`). Logger uniquement un code ou message générique + `requestId` + `stripeEventId`.

3. **requestId dans les réponses 4xx/5xx du webhook (optionnel)**  
   - Inclure `requestId` dans le JSON des réponses 400/500 du webhook (en plus du header `x-request-id`) pour corrélation côté client.

4. **Validation montant au webhook (optionnel, défense en profondeur)**  
   - Avant de marquer l’Order en `paid` : si `orderId` présent, charger l’Order et vérifier `session.amount_total === order.amountCents` et `session.currency` cohérent. En cas d’écart : traiter en orphan ou refuser (ne pas passer en paid).  
   - Ajouter un test (unitaire ou intégration) vérifiant la cohérence montant Order / payload webhook.

5. **Refus sk_test_ en prod (optionnel)**  
   - Dans `loadConfig()` : si `NODE_ENV === "production"` et `STRIPE_SECRET_KEY.startsWith("sk_test_")` → throw avec message explicite pour bloquer le démarrage.

---

## 4. Checklist GO / NO-GO prod

### GO PROD (toutes les cases doivent être cochées)

- [ ] **Stripe** : `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` de l’environnement **production** (clés live, secret webhook prod).
- [ ] **Stripe** : `STRIPE_SUCCESS_URL` et `STRIPE_CANCEL_URL` en HTTPS et pointant vers le front prod.
- [ ] **Proxy** : Si l’API est derrière un reverse proxy → **TRUST_PROXY=1** (ou équivalent) défini.
- [ ] **CORS** : `CORS_ORIGINS` liste explicite (pas `*`) en prod.
- [ ] **Webhook** : URL webhook Stripe prod en HTTPS ; secret webhook prod distinct du dev.
- [ ] **Correctifs appliqués** : Idempotence P2002 (CURSOR 3) et transition « webhook en avance » (CURSOR 6) déployés.
- [ ] **Aucun** `.env` ou secret committé / livré dans un artefact client.

### NO-GO (ne pas partir en prod si)

- Clés Stripe de test ou secret webhook de dev utilisés en prod.
- CORS `*` en production.
- API derrière reverse proxy sans TRUST_PROXY configuré (sans acceptation explicite du risque rate limit / IP).
- Webhook sans body brut (route webhook passant par `express.json()`).

---

## 5. Références rapides (matrices CURSOR)

| CURSOR | Sujet | Verdict |
|--------|--------|---------|
| 0 | Inventaire Stripe (endpoints, services, modèles) | — |
| 1 | Déclenchement `paid` (webhook uniquement) | Conforme |
| 2 | Route webhook (raw body, signature, 400/5xx) | Conforme |
| 3 | Idempotence (ledger, P2002, ACK après persistance) | Conforme (après patch) |
| 4 | Création Checkout (prix serveur) ; validation montant webhook | Conforme / Partiel (validation montant en amélioration) |
| 5 | Lien Order / Stripe (SessionId, unicité) | Conforme |
| 6 | Transitions pending → paid (webhook en avance, doublons, abandon) | Conforme (après patch) |
| 7 | Logs, erreurs, fuites client, corrélation | Conforme ; recommandations logs webhook |
| 8 | Config Stripe prod, proxy, isolement middlewares | Conforme ; TRUST_PROXY à documenter |

---

*Document généré à partir des analyses CURSOR 0 à 8. À faire valider par l’équipe technique et la sécurité avant mise en production.*
