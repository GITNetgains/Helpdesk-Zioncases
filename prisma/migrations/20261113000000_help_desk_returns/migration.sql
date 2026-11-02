-- Damaged or defective items sent back: Pending, Label sent, Received or Rejected.
-- returnLabelId: the label staff sent (a HelpDeskAttachment).
ALTER TABLE "HelpDeskTicket" ADD COLUMN "returnStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "returnNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "returnLabelId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "returnDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "returnDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_returnStatus_idx" ON "HelpDeskTicket"("shop", "returnStatus");
