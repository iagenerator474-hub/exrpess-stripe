# Checklist de validation — hardening client-ready prod

À exécuter manuellement après déploiement ou en local pour valider les 5 axes de hardening.

---

## 1) Erreurs 500 « sanitized » en prod

- [ ] Lancer l’API avec `NODE_ENV=production` (ex. `set NODE_ENV=production` puis `npm run dev`).
- [ ] Déclencher une erreur interne (ex. appeler `GET /auth/me` avec un JWT valide alors que le service `getMe` throw `new Error("DB leak")` — ou temporairement faire throw dans une route).
- [ ] Vérifier que la réponse HTTP est **500** et que le body contient **`"error": "Internal server error"`** (pas le message réel).
- [ ] Vérifier dans les logs serveur : message réel + stack + requestId + method + path.

---

## 2) Webhook : event enregistré même si Order inexistante

- [ ] Avec Stripe CLI : `stripe listen --forward-to http://localhost:3000/stripe/webhook` (ou URL de prod).
- [ ] Envoyer un event de test avec un `metadata.orderId` ou `client_reference_id` qui ne correspond à aucune Order en DB (ex. `orderId: "inexistant-order-id"`).
- [ ] Vérifier que la réponse webhook est **200**.
- [ ] En base : une ligne `PaymentEvent` avec ce `stripe_event_id`, **orderId = null**, **orphaned = true**, et un log warning côté serveur.

---

## 3) Duplicate event ignoré

- [ ] Envoyer deux fois le même event (même body + même signature valide, ou rejeu depuis le Dashboard Stripe).
- [ ] Les deux réponses doivent être **200**.
- [ ] En base : une seule ligne `PaymentEvent` pour ce `stripe_event_id`.
- [ ] Logs : au moins un message du type « duplicate ignored » ou « already_processed » pour le second envoi.

---

## 4) Graceful shutdown

- [ ] Lancer l’API (`npm run dev` ou container).
- [ ] Envoyer **SIGTERM** (ex. `kill -TERM <pid>` sous Linux/Mac, ou arrêt du conteneur Docker).
- [ ] Vérifier dans les logs : « shutdown start », puis « shutdown complete ».
- [ ] Vérifier qu’aucun message d’erreur non géré (pas de crash brutal).

---

## 5) CORS : refus d’une origin non whitelistée

- [ ] Configurer `CORS_ORIGINS` avec une liste explicite (ex. `http://localhost:3000`).
- [ ] Requête avec header `Origin: https://evil.com` (ex. `curl -H "Origin: https://evil.com" http://localhost:3000/health`).
- [ ] Vérifier que la réponse **ne contient pas** `Access-Control-Allow-Origin: https://evil.com` (CORS refuse ; le navigateur bloquerait la réponse).
- [ ] Sans header Origin (ex. curl sans Origin) : la requête doit rester autorisée (200).

---

## 6) Rate limit checkout effectif

- [ ] S’authentifier (login) pour obtenir un token.
- [ ] Appeler **POST /payments/checkout-session** avec un body valide (amount, currency) et le token, plus de 30 fois en 1 minute (même IP).
- [ ] Vérifier qu’au moins une réponse est **429** avec un message du type « Too many checkout attempts ».

---

## Résumé

| # | Vérification                         | Critère de succès                          |
|---|--------------------------------------|--------------------------------------------|
| 1 | Erreurs 500 prod                     | Body générique, détail uniquement en logs  |
| 2 | Webhook sans Order                   | PaymentEvent créé avec orderId null, orphaned true |
| 3 | Duplicate event                      | Un seul PaymentEvent, 200 x2               |
| 4 | Graceful shutdown                    | Logs shutdown start/complete, pas de crash  |
| 5 | CORS                                 | Origin non whitelistée refusée              |
| 6 | Rate limit checkout                  | 429 après N appels (ex. 30/min)             |
