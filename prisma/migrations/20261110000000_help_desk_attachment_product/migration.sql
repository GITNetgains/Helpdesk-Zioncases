-- A product issue's photos and videos say which product they show.
ALTER TABLE "HelpDeskAttachment" ADD COLUMN "productId" TEXT NOT NULL DEFAULT '';
