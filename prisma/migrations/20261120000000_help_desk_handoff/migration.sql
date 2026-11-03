-- When a customer asked the request page's assistant for a person.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "humanRequestedAt" DATETIME;
CREATE INDEX "HelpDeskTicket_shop_humanRequestedAt_idx" ON "HelpDeskTicket"("shop", "humanRequestedAt");
