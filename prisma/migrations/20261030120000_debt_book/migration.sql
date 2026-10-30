ALTER TABLE "Sale"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "creditCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "storeId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DebtPayment" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "businessDate" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DebtPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Customer_storeId_name_idx" ON "Customer"("storeId", "name");
CREATE UNIQUE INDEX "Customer_storeId_phone_key" ON "Customer"("storeId", "phone");
CREATE INDEX "DebtPayment_customerId_createdAt_idx" ON "DebtPayment"("customerId", "createdAt");
CREATE INDEX "DebtPayment_saleId_createdAt_idx" ON "DebtPayment"("saleId", "createdAt");
CREATE INDEX "DebtPayment_businessDate_method_idx" ON "DebtPayment"("businessDate", "method");
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DebtPayment"
  ADD CONSTRAINT "DebtPayment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DebtPayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DebtPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
