-- Internal ticket classification: category, sub-category, root cause and resolution.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "subcategory" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "rootCause" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "resolutionType" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "HelpDeskTicket_shop_category_idx" ON "HelpDeskTicket"("shop", "category");
