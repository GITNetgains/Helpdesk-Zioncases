-- Order cancellation requests: Pending, Approved, Rejected or Cancelled.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "cancelStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "cancelNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "cancelDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "cancelDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_cancelStatus_idx" ON "HelpDeskTicket"("shop", "cancelStatus");

-- Cancellation requests sent from the form before this existed, still unresolved, wait for a decision.
UPDATE "HelpDeskTicket" SET "cancelStatus" = 'Pending'
WHERE "channel" = 'form' AND "status" <> 'Resolved' AND "details" LIKE '%"update":"Cancel Order"%';
