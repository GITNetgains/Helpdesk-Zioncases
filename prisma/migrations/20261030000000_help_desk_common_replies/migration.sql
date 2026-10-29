-- Starter replies for Zion Cases' most common requests (from the daily issues
-- list), added to stores that were already set up unless they have one with the same name.
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Missing risers: sending now', 'Hi {{ customer.first_name }},

Sorry, the risers didn''t make it into your box for order {{ order.number }}. We''re sending them out now and will email you the tracking as soon as they ship.

Thanks for your patience,
{{ store.name }}', 'Missing Parts', 'Risers missing', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Missing risers: sending now');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Free sling bag missing', 'Hi {{ customer.first_name }},

Sorry, the free sling bag was left out of order {{ order.number }}. We''re sending it to you now and will share the tracking once it ships.

Thanks,
{{ store.name }}', 'Missing Parts', 'Free gift missing', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Free sling bag missing');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Broken risers: replacement', 'Hi {{ customer.first_name }},

Sorry one of your risers arrived broken. Thanks for letting us know. We''ll send a replacement for order {{ order.number }} and email you the tracking once it ships.

Best regards,
{{ store.name }}', 'Product Damage', 'Broken risers', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Broken risers: replacement');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Lock code help', 'Hi {{ customer.first_name }},

Happy to help with the lock. Could you tell us which case you have and send a short video of what happens when you set the code? We''ll walk you through it, and if the lock is faulty we''ll make it right.

Thanks,
{{ store.name }}', 'Product Education', 'Setting the lock code', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Lock code help');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Marked delivered, not received', 'Hi {{ customer.first_name }},

Sorry your package hasn''t turned up even though it shows as delivered. Please check with neighbours and around your building, as carriers sometimes leave parcels nearby. We''re also opening a claim with the carrier for order {{ order.number }} and will update you here.

Best regards,
{{ store.name }}', 'Order Issues', 'Marked delivered, not received', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Marked delivered, not received');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Cancellation request', 'Hi {{ customer.first_name }},

We''ve received your request to cancel order {{ order.number }}. If it hasn''t shipped yet we''ll cancel it and refund you in full, and we''ll confirm here once it''s done.

Best regards,
{{ store.name }}', 'Order Issues', 'Cancellation', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Cancellation request');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'International shipping', 'Hi {{ customer.first_name }},

Thanks for your interest. Could you share the full delivery address and the products you''d like? We''ll check shipping options and costs to your location and get back to you.

Best regards,
{{ store.name }}', 'International Shipping', '', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'International shipping');
