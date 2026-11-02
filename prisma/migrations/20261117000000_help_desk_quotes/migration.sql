-- International shipping quotes: Pending, Quoted or Unavailable, with what the team sent.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteCarrier" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteDelivery" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteShipping" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteTaxes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "quoteDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_quoteStatus_idx" ON "HelpDeskTicket"("shop", "quoteStatus");
