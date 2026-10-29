-- Shipping address change requests: Pending, Updated or Rejected.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "addressStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "addressNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "addressApplied" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "addressDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "addressDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_addressStatus_idx" ON "HelpDeskTicket"("shop", "addressStatus");

-- Address changes sent from the form before this existed, still unresolved, wait for a decision.
UPDATE "HelpDeskTicket" SET "addressStatus" = 'Pending'
WHERE "channel" = 'form' AND "status" <> 'Resolved' AND "details" LIKE '%"update":"Update Shipping Details"%';
