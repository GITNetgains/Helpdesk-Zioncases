-- Warranty claims go through the replacement steps too: replacementKind tells them
-- from missing parts (missing or warranty), and replacementSolution is what the team approved.
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementKind" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskTicket" ADD COLUMN "replacementSolution" TEXT NOT NULL DEFAULT '';
UPDATE "HelpDeskTicket" SET "replacementKind" = 'missing' WHERE "replacementStatus" <> '';
