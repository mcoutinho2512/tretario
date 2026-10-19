-- Rodada 11: título equipado no perfil (expand-first: só uma coluna nova NULLABLE; nada existente muda ou é apagado).
-- titleKey = texto de uma recompensa `title` que a conta ganhou (RewardGrant.item = 'title:<texto>'); NULL = nenhum.

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "titleKey" TEXT;
