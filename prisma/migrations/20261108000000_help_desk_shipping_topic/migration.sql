-- The storefront's shipping topic now covers domestic and international
-- shipping, so its tickets move from "International Shipping" to "Shipping Inquiry".
-- Their sub-category (International Shipping, Hawaii...) is unchanged.
UPDATE "HelpDeskTicket" SET "topic" = 'Shipping Inquiry' WHERE "topic" = 'International Shipping';
