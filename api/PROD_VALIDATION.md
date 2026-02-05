# Validation livraison prod (checklist manuelle)

À exécuter avant livraison client pour valider le comportement critique.

## 1. Migrations

- [ ] **Dev** : `npm run db:migrate` (ou `npx prisma migrate dev`) s’exécute sans erreur.
- [ ] **Prod** : `npx prisma migrate deploy` s’exécute sans erreur sur la base cible.

## 2. PaymentEvent audit-proof (FK SetNull)

- [ ] Créer une `Order` et un `PaymentEvent` lié (`orderId` = id de l’order).
- [ ] Supprimer l’`Order`.
- [ ] Vérifier que le `PaymentEvent` existe toujours et que `orderId` est `NULL`.
- La migration orphaned et la FK SetNull utilisent bien la table `"PaymentEvent"` (PascalCase).

## 3. Idempotence Stripe (duplicate stripeEventId)

- [ ] Envoyer deux fois le même `stripe_event_id` (ou rejouer un webhook) : la deuxième tentative doit être ignorée (P2002 unique constraint ou logique métier), pas d’erreur 500.

## 4. Erreurs 500 en prod

- [ ] En prod, provoquer une 500 (ex. route qui throw) : la réponse doit être un message générique (pas de stack trace ni détail technique).

## 5. Rate limit checkout

- [ ] Appeler l’endpoint de création de checkout-session (ex. POST `/payments/checkout-session`) au-delà de la limite (ex. 30 req/min) : réponse 429.

## 6. Graceful shutdown

- [ ] Démarrer le serveur, envoyer `SIGTERM` (ou `SIGINT`) : le serveur s’arrête proprement (connexions fermées, pas de crash).

---

*Checklist minimale ; à adapter selon l’environnement (staging/prod).*
