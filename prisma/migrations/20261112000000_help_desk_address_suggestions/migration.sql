-- Google Places key for address suggestions on the storefront form.
ALTER TABLE "HelpDeskSettings" ADD COLUMN "googlePlacesKey" TEXT NOT NULL DEFAULT '';
