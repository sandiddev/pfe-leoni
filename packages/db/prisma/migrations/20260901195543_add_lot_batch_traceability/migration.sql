-- AlterTable
ALTER TABLE "stock_lot" ADD COLUMN     "batchReference" TEXT,
ADD COLUMN     "supplierReference" TEXT;

-- CreateIndex
CREATE INDEX "stock_lot_batchReference_idx" ON "stock_lot"("batchReference");

