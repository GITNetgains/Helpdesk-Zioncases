-- Saved replies get a category (and optional sub-category) so the reply box can
-- suggest the ones that fit the ticket. Empty means a general reply.
ALTER TABLE "HelpDeskMacro" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "HelpDeskMacro" ADD COLUMN "subcategory" TEXT NOT NULL DEFAULT '';

-- Categorise the starter replies stores already have.
UPDATE "HelpDeskMacro" SET "category" = 'Product Damage', "subcategory" = '' WHERE "title" = 'Broken on arrival: replacement' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Shipping Damage', "subcategory" = '' WHERE "title" = 'Shipping damage: photos of the box' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Missing Parts', "subcategory" = '' WHERE "title" = 'Missing parts: sending now' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Product Compatibility', "subcategory" = '' WHERE "title" = 'Will it fit? (compatibility)' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Product Education', "subcategory" = 'Assembly help' WHERE "title" = 'Assembly help' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Manufacturing Defect', "subcategory" = 'Scratches' WHERE "title" = 'Scratches: protective film' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Wrong Item Received', "subcategory" = '' WHERE "title" = 'Wrong item: we''ll swap it' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Order Issues', "subcategory" = 'Order status or tracking' WHERE "title" = 'Shipping update' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Wholesale Questions', "subcategory" = '' WHERE "title" = 'Wholesale: next steps' AND "category" = '';
UPDATE "HelpDeskMacro" SET "category" = 'Returns', "subcategory" = '' WHERE "title" = 'Return instructions' AND "category" = '';

-- Add the new starter replies to stores that were already set up, unless they have one with the same name.
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Broken on arrival: replacement', 'Hi {{ customer.first_name }},

We''re really sorry your case arrived broken. Thanks for the photos. We''ll send a replacement for order {{ order.number }} and email you the tracking as soon as it ships. There''s no need to send the damaged one back.

Best regards,
{{ store.name }}', 'Product Damage', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Broken on arrival: replacement');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Shipping damage: photos of the box', 'Hi {{ customer.first_name }},

We''re sorry it arrived damaged. So we can sort this out quickly, please reply with a photo of the outer shipping box and one of the damaged part.

Thanks,
{{ store.name }}', 'Shipping Damage', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Shipping damage: photos of the box');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Missing parts: sending now', 'Hi {{ customer.first_name }},

Sorry, part of order {{ order.number }} didn''t make it into the box. We''re sending the missing parts today and will email you the tracking as soon as they ship.

Thanks for your patience,
{{ store.name }}', 'Missing Parts', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Missing parts: sending now');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Will it fit? (compatibility)', 'Hi {{ customer.first_name }},

Great question. To make sure you get the right case, could you tell us which card or slab you want to display (for example PSA, BGS, CGC, a One Touch or a top loader) and whether it''s in a sleeve?

We''ll confirm the best fit for you.

Thanks,
{{ store.name }}', 'Product Compatibility', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Will it fit? (compatibility)');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Assembly help', 'Hi {{ customer.first_name }},

Happy to help you put it together. Could you tell us which step you''re on, or send a photo of where you''re stuck? We''ll walk you through it.

Thanks,
{{ store.name }}', 'Product Education', 'Assembly help', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Assembly help');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Scratches: protective film', 'Hi {{ customer.first_name }},

Thanks for the photos. Our acrylic ships with a thin protective film on both sides, which can look like scratches or haze. Please peel it gently from one corner on each side and let us know if the marks are still there.

If they are, we''ll make it right.

Best regards,
{{ store.name }}', 'Manufacturing Defect', 'Scratches', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Scratches: protective film');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Wrong item: we''ll swap it', 'Hi {{ customer.first_name }},

Sorry, we sent the wrong item on order {{ order.number }}. We''ll ship the right one to you and email the tracking as soon as it''s on its way.

Thanks for your patience,
{{ store.name }}', 'Wrong Item Received', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Wrong item: we''ll swap it');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Shipping update', 'Hi {{ customer.first_name }},

Thanks for checking in on order {{ order.number }}. We''re looking up the latest tracking now and will update you here shortly.

Best regards,
{{ store.name }}', 'Order Issues', 'Order status or tracking', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Shipping update');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Wholesale: next steps', 'Hi {{ customer.first_name }},

Thanks for your interest in stocking our cases. Could you share your store name, website and where you''re based? Our wholesale team will get back to you with pricing and minimum order details.

Best regards,
{{ store.name }}', 'Wholesale Questions', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Wholesale: next steps');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Return instructions', 'Hi {{ customer.first_name }},

No problem. We''ll send you the return instructions for order {{ order.number }} here shortly. Please keep the case and packaging in their original condition.

Thanks,
{{ store.name }}', 'Returns', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Return instructions');
