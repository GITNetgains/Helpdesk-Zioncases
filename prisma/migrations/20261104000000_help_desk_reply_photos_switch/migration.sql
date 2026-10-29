-- Photo uploads on the customer's request page are off until staff turn them on for the ticket.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "allowPhotos" BOOLEAN NOT NULL DEFAULT false;
