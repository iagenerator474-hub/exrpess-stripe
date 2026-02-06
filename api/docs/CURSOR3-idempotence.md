# CURSOR 3 — Idempotence événement et métier

## Matrice

| Critère | Exigence | Implémentation | Conforme |
|--------|----------|----------------|----------|
| **Ledger** | Table dédiée aux events reçus (audit trail). | `PaymentEvent` avec `stripeEventId`, `type`, `payload`, `receivedAt`. | Oui |
| **Contrainte unique** | Un même `stripe_event_id` ne peut être inséré qu’une fois. | `PaymentEvent.stripeEventId` `@unique` (schema Prisma) ; migration `PaymentEvent_stripe_event_id_key` UNIQUE. | Oui |
| **Idempotence événement** | Rejeu du même event → 200 sans réappliquer (pas de doublon en DB). | `paymentEvent.create` → P2002 si rejeu → catch P2002 → 200. Pas de second insert. | Oui |
| **Idempotence métier** | Mise à jour Order en `paid` ne doit pas être appliquée deux fois. | `updateMany` avec `where: { id, stripeSessionId, status: { not: "paid" } }` → 0 ligne si déjà paid. | Oui |
| **ACK après persistance** | 200 uniquement après écriture en base (ou doublon avéré). | 200 envoyé après `create` réussi (puis updateMany) ou après P2002. Jamais 200 avant `create`. | Oui |
| **Retry corrige ordre** | Si 1ère livraison : persist OK, updateMany échoue → 500 ; retry → P2002. L’ordre doit quand même passer en paid. | **Écart** : branche P2002 retourne 200 sans appeler `updateMany` → ordre peut rester pending. | Non (patch ci‑dessous) |

## Verdict avant patch

**Partiel** : ledger, contrainte unique, ACK après persistance et idempotence métier (updateMany conditionnel) sont conformes. En revanche, en cas de rejeu (P2002) pour `checkout.session.completed`, l’ordre n’est pas repassé en `paid` si la première livraison avait persisté l’event mais échoué sur `updateMany`.

## Patch minimal (appliqué)

Dans la branche P2002 pour `checkout.session.completed` : avant de renvoyer 200, appeler `updateMany` avec les mêmes `where`/`data` que le flux normal. Ainsi, un retry Stripe après échec de la première mise à jour Order corrige l’état (idempotent : 0 ligne si déjà paid).

Voir `api/src/modules/stripe/stripe.webhook.ts` (branche P2002 checkout.session.completed).
