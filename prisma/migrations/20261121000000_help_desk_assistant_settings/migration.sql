-- The request page's chat assistant: on or off, and the store's wording for its messages.
ALTER TABLE "HelpDeskSettings" ADD COLUMN "assistantEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "HelpDeskSettings" ADD COLUMN "assistantCopy" TEXT NOT NULL DEFAULT '';
