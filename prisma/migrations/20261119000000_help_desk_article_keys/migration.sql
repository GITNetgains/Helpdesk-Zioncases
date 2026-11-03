-- Starter help articles by a lasting key, so stores get new ones and deleted ones stay deleted.
ALTER TABLE "HelpDeskFaq" ADD COLUMN "starterKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskSettings" ADD COLUMN "dismissedArticles" TEXT NOT NULL DEFAULT '';
CREATE INDEX "HelpDeskFaq_shop_starterKey_idx" ON "HelpDeskFaq"("shop", "starterKey");
