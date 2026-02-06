# Risques résiduels Stripe Webhook (P2)

Ce document formalise les **risques résiduels** liés au webhook Stripe. Ils sont **opérationnels** ou **faibles** : aucun n’est un défaut de logique ou de sécurité du code. La checklist technique webhook (raw body, signature, idempotence, ledger, payment_status, amount/currency, logs sans PII) est **PASS**.

**État GO PROD** : ces risques sont **acceptés** et **documentés** ; les mitigations reposent sur la checklist déploiement, le runbook ops et la surveillance.

---

## 1. Secret webhook révoqué ou erroné → webhooks 400

| Champ | Contenu |
|-------|--------|
| **Niveau** | Moyen |
| **Description** | Si `STRIPE_WEBHOOK_SECRET` ne correspond plus au signing secret configuré côté Stripe (révocation, rotation, mauvaise variable d’env, déploiement avec ancien secret), chaque requête webhook échoue à la vérification de signature. |
| **Impact concret** | Réponses 400 "Invalid signature" ; Stripe retente selon sa politique. Aucun paiement ni refund enregistré tant que le secret n’est pas corrigé. Perte de revenus et incohérence Order/Stripe jusqu’à résolution. |
| **Mitigation / Procédure** | Vérifier le secret dans le Dashboard (Webhooks → endpoint → Signing secret). Mettre à jour `STRIPE_WEBHOOK_SECRET` en prod, redémarrer l’app. Tester avec un event envoyé depuis le Dashboard ou Stripe CLI. Voir [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § Rotation / révocation webhook secret et § Incident runbook – Webhook 400 signature. |

---

## 2. 429 rate limit webhook en cas de burst Stripe

| Champ | Contenu |
|-------|--------|
| **Niveau** | Moyen |
| **Description** | Le endpoint `/stripe/webhook` est soumis à un rate limit (défaut 100 req/min). En cas de burst légitime (replay Stripe, nombreux events, tests de charge), des requêtes reçoivent 429. Stripe retente ; selon la fenêtre et la fréquence, certains events peuvent être retardés ou nécessiter une intervention. |
| **Impact concret** | Logs "Webhook rate limit exceeded (429)" ; retries Stripe ; possible délai dans la mise à jour des Order (paid/refunded). Rare en trafic normal. |
| **Mitigation / Procédure** | Surveillance du message de log 429. Si 429 observés de façon récurrente : analyser burst légitime vs abus ; envisager d’augmenter `RATE_LIMIT_WEBHOOK_MAX` ou exclusions IP Stripe si l’hébergeur le permet ; documenter la décision. Ne pas augmenter la limite sans justification. Voir [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § 429 et § Incident runbook – 429. |

---

## 3. Events refunds non souscrits dans le Dashboard Stripe

| Champ | Contenu |
|-------|--------|
| **Niveau** | Moyen |
| **Description** | L’application gère correctement `charge.refunded` et `payment_intent.refunded`. Si ces events ne sont **pas** souscrits sur l’endpoint webhook PROD dans le Stripe Dashboard, Stripe ne les envoie pas. |
| **Impact concret** | Les Order restent en `paid` après un remboursement effectué côté Stripe. Incohérence compta / support ; impossible de distinguer commande payée vs remboursée en base. |
| **Mitigation / Procédure** | Avant go-live : souscrire à `charge.refunded` et/ou `payment_intent.refunded` sur l’endpoint webhook PROD (Dashboard → Webhooks → endpoint → Select events). Post go-live : effectuer un test de remboursement et vérifier qu’une Order passe à `refunded`. Voir [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) § 2 et [OPS_RUNBOOK.md](OPS_RUNBOOK.md) § Incident runbook – Refund non appliqué. |

---

## 4. Ordre de traitement en cas de P2002 (doublon)

| Champ | Contenu |
|-------|--------|
| **Niveau** | Faible |
| **Description** | En cas de retry Stripe après une première livraison qui a persisté l’event (PaymentEvent créé) mais échoué sur la mise à jour Order (ex. timeout DB), le retry provoque un P2002 sur la création PaymentEvent. Le code traite P2002 en ré-appliquant l’updateMany (checkout ou refund) avant de renvoyer 200. |
| **Impact concret** | Aucun. Comportement cohérent avec l’idempotence : l’Order est mise à jour au retry si elle ne l’était pas ; si elle était déjà à jour, updateMany ne modifie aucune ligne. |
| **Mitigation / Procédure** | Aucune action requise. Documenté pour clarté : le risque “ordre de traitement” est couvert par le design (ledger puis update conditionnel + reprise sur P2002). |

---

## 5. Absence de rejeu explicite du body (signature invalide → 400)

| Champ | Contenu |
|-------|--------|
| **Niveau** | Faible |
| **Description** | Le body n’est pas parsé en JSON avant la vérification de signature. Si le body est malformé ou non-JSON, `stripe.webhooks.constructEvent` échoue (signature invalide) et l’app renvoie 400. Il n’y a pas de branche dédiée “body invalide” avec un message distinct. |
| **Impact concret** | Aucun. Tout body qui ne passe pas la vérification de signature est rejeté en 400. Aucune utilisation du body non vérifié ; pas de fuite ni d’injection. |
| **Mitigation / Procédure** | Aucune action requise. Comportement conforme et sécurisé. La documentation rappelle que les risques résiduels liés au body sont couverts par le flux signature-first. |

---

*Référence : [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md), [OPS_RUNBOOK.md](OPS_RUNBOOK.md).*
