-- Missing or lost parts replaced: Pending, Approved, Shipped or Rejected, with the replacement's tracking.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementCarrier" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementTracking" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementTrackingUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_replacementStatus_idx" ON "HelpDeskTicket"("shop", "replacementStatus");
