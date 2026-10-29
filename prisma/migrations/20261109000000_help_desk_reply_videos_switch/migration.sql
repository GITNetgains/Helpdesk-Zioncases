-- Staff can let a customer add a video to their reply.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "allowVideos" BOOLEAN NOT NULL DEFAULT false;
