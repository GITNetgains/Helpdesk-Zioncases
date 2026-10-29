-- Saved replies that fill in the order's tracking, added to stores that were
-- already set up unless they have one with the same name.
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Tracking details', 'Hi {{ customer.first_name }},

Thank you for reaching out about order {{ order.number }}. It shipped with {{ order.carrier }}, and its current status is: {{ order.shipment_status }}.

Tracking number: {{ order.tracking_number }}
Track your package: {{ order.tracking_url }}

If it hasn''t arrived within a few days of the expected date, please reply here and we''ll look into it right away.

Best regards,
{{ store.name }}', 'Order Issues', 'Order status or tracking', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Tracking details');
INSERT INTO "HelpDeskMacro" ("id", "shop", "title", "body", "category", "subcategory", "createdAt")
SELECT lower(hex(randomblob(12))), s."shop", 'Order already shipped', 'Hi {{ customer.first_name }},

Thank you for letting us know. Order {{ order.number }} has already shipped with {{ order.carrier }}, so we''re no longer able to cancel or change it.

Tracking number: {{ order.tracking_number }}

Once it arrives, you''re welcome to request a return or exchange and we''ll take care of it.

Best regards,
{{ store.name }}', 'Order Issues', 'Cancellation', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM "HelpDeskSettings" s WHERE NOT EXISTS (SELECT 1 FROM "HelpDeskMacro" m WHERE m."shop" = s."shop" AND m."title" = 'Order already shipped');
