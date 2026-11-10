-- Browser notifications of team replies: the store's VAPID keys and the customers' subscribed browsers.
ALTER TABLE "HelpDeskSettings" ADD COLUMN "pushPublicKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskSettings" ADD COLUMN "pushPrivateKey" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "HelpDeskPushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HelpDeskPushSubscription_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "HelpDeskTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HelpDeskPushSubscription_endpoint_idx" ON "HelpDeskPushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "HelpDeskPushSubscription_ticketId_endpoint_key" ON "HelpDeskPushSubscription"("ticketId", "endpoint");
