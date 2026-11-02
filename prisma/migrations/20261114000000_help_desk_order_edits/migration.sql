-- Order edit requests (items changed, removed or added): Pending, Updated or Rejected.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "editStatus" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "editNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "editDecidedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "editDecidedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_editStatus_idx" ON "HelpDeskTicket"("shop", "editStatus");
