ALTER TABLE "Sale" ADD COLUMN "offlineId" TEXT;

CREATE UNIQUE INDEX "Sale_storeId_offlineId_key" ON "Sale"("storeId", "offlineId");
