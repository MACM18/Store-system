CREATE TYPE "AccountTokenType" AS ENUM ('INVITE', 'PASSWORD_RESET');

CREATE TABLE "AccountToken" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "AccountTokenType" NOT NULL,
    "email" TEXT NOT NULL,
    "inviteName" TEXT,
    "inviteRole" "Role",
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE INDEX "AccountToken_email_type_usedAt_idx" ON "AccountToken"("email", "type", "usedAt");
CREATE INDEX "AccountToken_userId_type_usedAt_idx" ON "AccountToken"("userId", "type", "usedAt");

ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountToken" ADD CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
