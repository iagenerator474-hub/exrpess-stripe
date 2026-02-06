# Risques P2 acceptés / documentés (prod-ready)

Ce document liste les risques P2 qui ne sont **pas** corrigés par du code mais **acceptés et documentés** pour une version prod-ready. Les mitigations sont procédurales (checklist, runbook, monitoring).

| P2 | Risque | Statut | Justification / mitigation |
|----|--------|--------|---------------------------|
| 1 | Dashboard webhook PROD sans events refunds → Order jamais à refunded | **Documenté** | Checklist § 2 : souscription obligatoire à `charge.refunded` et/ou `payment_intent.refunded` ; impact explicité. Validation manuelle avant déploiement. |
| 2 | TRUST_PROXY non défini derrière proxy → mauvaise IP / rate-limit | **Documenté + guard** | En prod, TRUST_PROXY exigé par défaut (crash au boot si absent). Doc : comment savoir si on est derrière un proxy. Warning log au boot si TRUST_PROXY non set (quand REQUIRE_TRUST_PROXY_IN_PROD=false). |
| 3 | Pas d’alertes 4xx/5xx webhook ni sur le 429 | **Documenté** | DEPLOYMENT_CHECKLIST § 3 et § 6 + OPS_RUNBOOK § Alertes webhook : alertes à créer côté hébergeur (taux 4xx/5xx, message 429). Pas d’alerting interne. |
| 4 | STRIPE_API_VERSION non alignée avec le Dashboard | **Documenté** | Checklist § 1 + OPS_RUNBOOK § STRIPE_API_VERSION : alignement et revalidation après upgrade Stripe. |
| 5 | Log au démarrage (non-prod) avec bout de clé Stripe | **Corrigé** | Plus aucun préfixe/suffixe de clé loggé ; remplacé par un log safe : `stripeKeyMode: "test" \| "live"`. |
| 6 | Rate limit webhook 429 en cas de burst Stripe | **Documenté** | Message 429 stable ; doc (checklist § 3, OPS_RUNBOOK § 429) : action si 429 (augmenter limite / exclusions IP / revue burst). Limite par défaut inchangée. |
| 7 | Rétention logs + requestId à configurer côté hébergeur | **Documenté** | Checklist § 6 + README « Logs & rétention » + OPS_RUNBOOK § Ops logs : rétention 14–30 j, usage requestId, champs autorisés/interdits. |
| 8 | /health et /ready : pas d’infos sensibles | **Vérifié** | /health : `status`, `db`, optionnellement `env` (NODE_ENV uniquement si HEALTH_EXPOSE_ENV=true). /ready : `status: "ready" \| "not ready"` uniquement. Aucune version, secret ni détail exposé. |
| 9 | Secret webhook révoqué sans mise à jour env → webhooks 400 | **Documenté** | OPS_RUNBOOK § Rotation / révocation webhook secret : procédure (vérifier secret, rotation, redeploy, test Stripe CLI / Dashboard). |
| 10 | Migrations : en prod exit(1) si colonne refund manquante | **Corrigé + documenté** | Check au boot en prod : colonne `Order.stripe_payment_intent_id` absente → exit(1) avec message clair. Checklist § 4 : `prisma migrate deploy` + vérifier absence du log après déploiement. |

---

**Résumé** : P2 5 et 10 = corrigés par le code. P2 1, 2, 3, 4, 6, 7, 8, 9 = acceptés et documentés (checklist, runbook, ou vérification).
