-- Rodada 10: torcida no perfil (expand-first: só colunas novas NULLABLE; nada existente muda ou é apagado).
-- supporterGroup = id da torcida (dados: public/gameplay/supporters.json) ou o id neutro; NULL = nunca escolheu.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "supporterChangedAt" TIMESTAMP(3),
ADD COLUMN     "supporterGroup" TEXT,
ADD COLUMN     "supporterPending" TEXT;
