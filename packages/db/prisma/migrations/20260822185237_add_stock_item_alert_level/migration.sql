-- AlterTable
ALTER TABLE "stock_item" ADD COLUMN     "alertLevel" "AlertLevel" NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE INDEX "stock_item_siteId_alertLevel_idx" ON "stock_item"("siteId", "alertLevel");
