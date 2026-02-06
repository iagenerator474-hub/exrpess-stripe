# Runbook Ops (Stripe + Node)

Procédures opérationnelles pour la prod. Complément à [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md). Risques résiduels webhook : [STRIPE_WEBHOOK_RESIDUAL_RISKS.md](STRIPE_WEBHOOK_RESIDUAL_RISKS.md).

---

## Incident runbook minimal (webhook)

| Cas | Symptôme | Cause probable | Action |
|-----|----------|----------------|--------|
| **Webhook 400 signature** | Logs "Stripe webhook signature verification failed" ; réponses 400 sur `POST /stripe/webhook`. | `STRIPE_WEBHOOK_SECRET` ne correspond plus au signing secret du Dashboard (révocation, rotation, mauvaise env). | Vérifier le secret dans Dashboard → Webhooks → endpoint → Signing secret. Mettre à jour `STRIPE_WEBHOOK_SECRET` en prod, redémarrer l’app. Tester avec *Send test webhook* ou Stripe CLI. Détail : § Rotation / révocation webhook secret ci-dessous. |
| **Webhook rate limit exceeded (429)** | Logs avec le message exact `"Webhook rate limit exceeded (429)"` ; réponses 429 sur le webhook. | Burst de requêtes Stripe (replay, nombreux events) au-dessus de la limite (défaut 100/min). | Surveiller le volume ; si 429 récurrents et burst légitime : envisager d’augmenter `RATE_LIMIT_WEBHOOK_MAX` ou exclusions IP Stripe ; documenter. Détail : § 429 ci-dessous. |
| **Refund non appliqué** | Remboursement effectué côté Stripe mais l’Order reste en `paid` en base. | Events `charge.refunded` / `payment_intent.refunded` non souscrits sur l’endpoint webhook PROD dans le Dashboard. | Dashboard → Webhooks → endpoint prod → ajouter les events `charge.refunded` et/ou `payment_intent.refunded`. Tester un remboursement et vérifier que l’Order passe à `refunded`. |

---

## Alertes webhook

À configurer côté hébergeur / monitoring :

1. **Taux 4xx/5xx** sur la route `POST /stripe/webhook` (ex. seuil % ou nombre sur fenêtre glissante).
2. **Occurrence du log exact** : `"Webhook rate limit exceeded (429)"` (avec `requestId` dans le même log).

Pas d’alerting interne dans l’app ; tout est basé sur les logs et les métriques HTTP.

---

## 429 (rate limit webhook)

- **Message de log stable** : chaque 429 produit exactement `"Webhook rate limit exceeded (429)"` (+ `requestId`).
- **Action si 429 observés** :
  1. Vérifier si burst légitime (replay Stripe, nombreux events) ou abus.
  2. Si légitime : envisager d’augmenter `RATE_LIMIT_WEBHOOK_MAX` (défaut 100/min) et documenter la décision.
  3. Si hébergeur le permet : exclusions IP Stripe pour le endpoint webhook.
  4. Ne pas augmenter la limite sans justification.

---

## STRIPE_API_VERSION

- Doit être **alignée avec la version du Stripe Dashboard** (paramètre dans l’app : `STRIPE_API_VERSION`).
- **À revalider après chaque upgrade Stripe** (Dashboard ou SDK) pour éviter erreurs d’API ou champs manquants.
- Valeur par défaut dans la config ; documentée dans `.env.example` et [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) § 1.

---

## Ops logs (rétention + requestId)

- **Rétention** : 14–30 jours côté hébergeur / centralisation logs.
- **Investigation** : utiliser le **requestId** (présent dans les logs et en header `x-request-id`) pour filtrer les logs et tracer une requête de bout en bout.
- **Champs autorisés en logs** : `requestId`, `orderId`, `stripeSessionId`, `stripeEventId`, `status`, codes d’erreur.
- **Champs interdits** : email, cookies, token, headers d’auth, body, clés Stripe. Voir README « Logs & rétention ».

---

## Rotation / révocation webhook secret

Si les webhooks Stripe renvoient **400 (signature invalide)** ou que le secret a été révoqué / régénéré :

1. **Vérifier** : Dashboard Stripe → Webhooks → endpoint prod → *Signing secret*. Comparer avec `STRIPE_WEBHOOK_SECRET` en env.
2. **Rotation** : générer un nouveau secret dans le Dashboard (ou recréer l’endpoint), copier la valeur.
3. **Mise à jour** : mettre à jour la variable `STRIPE_WEBHOOK_SECRET` dans l’environnement de prod (env vars hébergeur, secrets manager).
4. **Redeploy** : redémarrer l’app (ou redéployer) pour charger le nouveau secret.
5. **Test** :
   - **Stripe CLI** : `stripe listen --forward-to https://api.example.com/stripe/webhook` (env de test) ou envoyer un event de test depuis le Dashboard (Webhooks → endpoint → *Send test webhook*).
   - **Vérifier** : logs sans erreur "Invalid signature", et Order mise à jour si event `checkout.session.completed` test.

En cas de doute sur l’URL ou la version d’API, vérifier aussi [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) § 2 et § 1 (STRIPE_API_VERSION).
