#!/bin/sh
set -e
# Apply migrations before starting the app (prod / Docker). Dev: use prisma migrate dev.
npx prisma migrate deploy
exec node dist/index.js
