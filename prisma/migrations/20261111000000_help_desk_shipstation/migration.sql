-- ShipStation connection: shipping labels are checked before an address changes.
ALTER TABLE "HelpDeskSettings" ADD COLUMN "shipstationKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskSettings" ADD COLUMN "shipstationSecret" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskSettings" ADD COLUMN "shipstationStoreId" TEXT NOT NULL DEFAULT '';
