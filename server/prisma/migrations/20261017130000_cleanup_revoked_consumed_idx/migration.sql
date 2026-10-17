-- Limpeza (rodada 8.1): o CleanupService apaga por "expiresAt < x OR revokedAt/consumedAt < y"; com os dois lados
-- indexados o PostgreSQL usa BitmapOr em vez de varrer a tabela inteira.

-- CreateIndex
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");

-- CreateIndex
CREATE INDEX "VerificationCode_consumedAt_idx" ON "VerificationCode"("consumedAt");
