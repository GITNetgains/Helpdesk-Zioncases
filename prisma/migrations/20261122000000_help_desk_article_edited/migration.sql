-- Help articles the team saved in Settings: the app never updates them with a newer starter version.
ALTER TABLE "HelpDeskFaq" ADD COLUMN "edited" BOOLEAN NOT NULL DEFAULT false;
