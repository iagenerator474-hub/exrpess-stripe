-- AlterTable: RefreshToken token -> tokenHash, add revokedAt, replacedByTokenId
ALTER TABLE "RefreshToken" RENAME COLUMN "token" TO "token_hash";

ALTER TABLE "RefreshToken" ADD COLUMN "revoked_at" TIMESTAMP(3),
ADD COLUMN "replaced_by_token_id" TEXT;

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replaced_by_token_id_key" UNIQUE ("replaced_by_token_id");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replaced_by_token_id_fkey"
  FOREIGN KEY ("replaced_by_token_id") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
