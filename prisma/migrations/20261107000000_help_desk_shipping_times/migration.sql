-- Shipping times shown on the storefront form.
ALTER TABLE "HelpDeskSettings" ADD COLUMN "shippingTimes" TEXT NOT NULL DEFAULT '';
