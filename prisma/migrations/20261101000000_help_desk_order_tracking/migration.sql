-- The ticket's Shopify order and tracking, saved on the ticket.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderValue" REAL;
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderCurrency" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "carrier" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "trackingNumber" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "trackingUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "shipmentStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderSkus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HelpDeskTicket" ADD COLUMN "orderSyncedAt" DATETIME;

-- CreateIndex
CREATE INDEX "HelpDeskTicket_shop_carrier_idx" ON "HelpDeskTicket"("shop", "carrier");
