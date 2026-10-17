-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "reportedNicknameAtTime" TEXT;

-- CreateTable
CREATE TABLE "MuteRelationship" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "mutedUserId" TEXT NOT NULL,
    "mutedNicknameAtTime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MuteRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MuteRelationship_mutedUserId_idx" ON "MuteRelationship"("mutedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MuteRelationship_ownerUserId_mutedUserId_key" ON "MuteRelationship"("ownerUserId", "mutedUserId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "MuteRelationship" ADD CONSTRAINT "MuteRelationship_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MuteRelationship" ADD CONSTRAINT "MuteRelationship_mutedUserId_fkey" FOREIGN KEY ("mutedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dados (rodada 8.1): mutes antigos guardados por APELIDO normalizado em Profile.preferences.chatMuted viram
-- relações por userId (o apelido normalizado é o mesmo Profile.nicknameKey usado na unicidade). Apelidos que não
-- casam com nenhum perfil (contas apagadas/renomeadas antes desta migração) são descartados — não há como
-- recuperar a identidade a partir de um apelido antigo, justamente o defeito corrigido aqui.
INSERT INTO "MuteRelationship" ("id", "ownerUserId", "mutedUserId", "mutedNicknameAtTime", "createdAt")
SELECT gen_random_uuid()::text, owner."userId", target."userId", target."nickname", now()
FROM "Profile" owner
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(owner."preferences"->'chatMuted') = 'array' THEN owner."preferences"->'chatMuted' ELSE '[]'::jsonb END
) AS m(nick_key)
JOIN "Profile" target ON target."nicknameKey" = m.nick_key
WHERE target."userId" <> owner."userId"
ON CONFLICT ("ownerUserId", "mutedUserId") DO NOTHING;

-- a lista por apelido deixa de existir (a autoridade passa a ser MuteRelationship)
UPDATE "Profile" SET "preferences" = "preferences" - 'chatMuted' WHERE "preferences" ? 'chatMuted';
