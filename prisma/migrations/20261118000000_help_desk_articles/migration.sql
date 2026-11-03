-- Help articles: answers customers find by searching the storefront form.
ALTER TABLE "HelpDeskFaq" ADD COLUMN "collection" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskFaq" ADD COLUMN "action" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskFaq" ADD COLUMN "helpful" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HelpDeskFaq" ADD COLUMN "notHelpful" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "HelpDeskFaq" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Stores without articles get the starter set, even if the old chat bot's FAQs were seeded once.
UPDATE "HelpDeskSettings" SET "faqsSeeded" = false WHERE "shop" NOT IN (SELECT DISTINCT "shop" FROM "HelpDeskFaq");
