# Audit production — livraison client sous 7 jours

**Contexte :** Backend Express/Node.js, Stripe Checkout + webhooks, PostgreSQL/Prisma. Livrable PME / client payant. Pas de refonte ni de sur-engineering.

---

## Résumé exécutif

Le projet est **défendable en production** avec un petit nombre de corrections ciblées. L’architecture est claire (routes → services → Prisma), la signature Stripe est vérifiée, l’idempotence webhook repose sur la DB (PaymentEvent + Order), et le refresh token est consommé en transaction (anti double-usage). Les risques identifiés sont limités : aucun bloquant critique ; deux points à traiter rapidement (log de la clé Stripe au démarrage en prod, plafond éventuel sur le montant checkout) et le reste est acceptable pour une mise en prod sous 7 jours. Aucun changement majeur n’est nécessaire : corrections minimales, puis livraison possible.

---

## Tableau des risques

| # | Gravité | Zone | Risque | Justification |
|---|---------|------|--------|---------------|
| 1 | 🟠 | Démarrage | Clé Stripe (préfixe) loguée au démarrage | En prod les logs peuvent être visibles (plateforme, SI). Le préfixe `sk_live_...xyz` réduit la surface mais reste une fuite d’info. |
| 2 | 🟠 | Checkout | Montant non plafonné | `amount` validé en entier positif (cents) mais sans max. Un bug ou un abus peut créer des sessions à montant énorme. Risque métier plus que technique. |
| 3 | 🟢 | Webhook | Échec async après 200 | Après ACK 200, si la transaction échoue (hors P2002), l’event est logué mais Stripe ne retente pas. Acceptable pour une PME si les logs sont surveillés. |
| 4 | 🟢 | Global | Pas de handler unhandledRejection | Tous les handlers async utilisent try/catch + next(err). Aucun rejet non géré dans le code actuel. Rien à faire. |
| 5 | 🟢 | Auth | Rate limit sur /auth uniquement | /payments/checkout-session est protégé par auth ; un abus = beaucoup de sessions Stripe. Limite acceptable pour une première mise en prod. |
| 6 | 🟢 | Config | CORS_ORIGINS=* interdit en prod | Refus de démarrage si NODE_ENV=production et CORS_ORIGINS=*. Correct. |
| 7 | 🟢 | DB | Contraintes et transactions | PaymentEvent.stripeEventId unique, Order.stripeSessionId unique, transaction webhook (create + updateMany), refresh en transaction. Cohérence assurée. |
| 8 | 🟢 | Logs | Pas de secrets dans les logs | Webhook : requestId, stripeEventId, stripeSessionId, orderId, outcome. Pas de body brut ni de token. |
| 9 | 🟢 | Erreurs | Réponses et logs | errorHandler renvoie message + requestId ; stack uniquement en dev. Client reçoit un message exploitable. |

---

## Recommandations prioritaires (ordre d’exécution)

1. **Ne plus logger le préfixe de la clé Stripe en production**  
   - Fichier : `api/src/index.ts`.  
   - Action : n’ajouter `stripeKey` au log de démarrage que si `config.NODE_ENV !== "production"`.  
   - Effet : plus aucune fuite d’info sur la clé dans les logs prod.

2. **(Optionnel) Plafonner le montant checkout**  
   - Fichier : `api/src/modules/payments/checkout.validation.ts`.  
   - Action : par exemple `.refine((n) => n <= 1_000_000, { message: "Amount exceeds maximum (10000.00)" })` (1M cents = 10k€).  
   - Effet : limite les montants aberrants ; à adapter au métier.

3. **Ne rien changer d’autre pour la livraison sous 7 jours**  
   - Pas de nouveau rate limit sur /payments, pas de file de retry webhook, pas de handler unhandledRejection supplémentaire. Le code actuel est cohérent et maintenable.

---

## Ce que je livrerais tel quel à un client

- **Code** : structure api/, routes → services → Prisma, validation Zod sur les entrées, auth guard + cookies refresh (httpOnly, SameSite=Lax, Secure en prod), webhook signé + idempotence DB, refresh token à usage unique en transaction.
- **Config** : .env.example complet, refus de démarrage si CORS_ORIGINS=* en prod, secrets uniquement en variables d’environnement.
- **Docs** : README (quickstart, Stripe, sécurité), PROCEDURE_LANCEMENT, GO_LIVE_CHECKLIST, SMOKE_TEST.
- **Tests** : webhook idempotent, refresh double-usage, auth guard ; CI lint + tests.
- **Docker** : build depuis api/, healthcheck sur /ready, migrations dans l’entrypoint.

Après application de la recommandation 1 (et éventuellement 2), le livrable est **défendable en audit** et **compréhensible** par un autre dev sur une mission courte.

---

## Ce que je refuserais de livrer en l’état

- **Avec le log du préfixe Stripe en production** : je corrigerais d’abord (recommandation 1), puis je livrerais.
- **Sans** GO_LIVE_CHECKLIST **ou** sans **.env.example** à jour : le client ou le prochain dev ne pourrait pas déployer proprement.
- **Si** la signature webhook n’était pas vérifiée **ou** si l’idempotence ne reposait pas sur la DB : inacceptable pour des paiements. Ce n’est pas le cas ici.

---

## Synthèse par axe

| Axe | État | Commentaire |
|-----|------|-------------|
| 1. Architecture | OK | Routes → services → Prisma ; Stripe isolé dans un module ; lisible. |
| 2. Sécurité pragmatique | OK | Validation Zod, secrets via config, auth + cookies sécurisés, rate limit auth + webhook. |
| 3. Stripe Checkout & Webhooks | OK | Signature vérifiée, ACK 200 puis async, idempotence PaymentEvent + Order, retries Stripe gérés par non-5xx. |
| 4. Base de données | OK | Unicité utile, transactions aux bons endroits, DB source de vérité. |
| 5. Erreurs & logs | OK | requestId, pas de secrets en log, stack uniquement en dev. |
| 6. Tests | OK | 3 tests “golden” + CI ; pas besoin d’en ajouter pour la livraison. |
| 7. Prêt client freelance | OK | Défendable après correction 1 ; maintenable et compréhensible. |

**Conclusion :** Appliquer la recommandation 1, éventuellement 2, puis livrer. Aucun bloquant, pas de refonte nécessaire.
