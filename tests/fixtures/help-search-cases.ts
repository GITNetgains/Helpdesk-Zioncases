// Search-box queries, the way customers type them, and the article(s) that
// should be among the suggestions.
const WHERE = "Where is my order?";
const DELIVERED = "My tracking says delivered, but I don't have my package";
const CONFIRM = "I can't find my purchase confirmation";
const PARTIAL = "Only part of my order arrived";
const CANCEL = "Can I cancel my order?";
const EDIT = "Can I change an item, colour or quantity on my order?";
const ADDRESS = "Can I change my shipping address?";
const LOST = "My package is lost or the tracking hasn't moved";
const DELAYED = "My order is delayed";
const FAILED = "The carrier couldn't deliver my package";
const WRONGADDR = "My order was delivered to the wrong address";
const SHIPTIME = "How long does shipping take, and what does it cost?";
const EXPEDITE = "Can I get faster or expedited shipping?";
const INTL = "Do you ship internationally?";
const HAWAII = "Do you ship to Hawaii, Alaska and U.S. territories?";
const CUSTOMS = "Will I pay customs, duties or taxes?";
const RETURN = "What is your return policy?";
const EXCHANGE = "I ordered the wrong model or colour. Can I exchange it?";
const EXTRA = "I ordered more than I need. Can I return the extra?";
const NOFIT = "It doesn't fit my slabs or cards. Can I return it?";
const REFUND = "Where is my refund?";
const EXPECTED = "The product isn't what I expected";
const DAMAGED = "My item arrived damaged or broken";
const RISER = "A riser arrived broken or the pins snapped";
const MISSING = "Something is missing from my order";
const WRONG = "I received the wrong item, colour or risers";
const SCRATCH = "My case looks scratched, cloudy or not clear";
const LID = "The lid doesn't close properly or the latches don't line up";
const LOCK = "The lock won't open or won't take the combination";
const BOWING = "The bottom of my case is bowing or not flat";
const WARRANTY = "Is my case covered by warranty?";
const PARTS = "Can I buy replacement parts like wheels, risers, lids or foam?";
const CONVENTION = "I bought my product at a convention or event";
const FIT = "Which slabs and cards fit my case?";
const CLEAN = "How do I clean my case?";
const ASSEMBLE = "How do I put my case together?";
const DISCOUNT = "My discount code isn't working";
const HOLD = "Why is my order on hold?";
const PROTECTION = "How do I cancel shipping protection?";
const INVOICE = "Can I get an invoice or receipt?";
const WHOLESALE = "Do you offer wholesale?";
const AFFILIATE = "How do I join the affiliate program?";
const NOTSHIPPED = "My order hasn't shipped yet";
const PREORDER = "What happens with my pre-order?";
const GIFT = "Is the free gift included with my order?";
const SIGN = "Do I need to sign for my package?";
const CONTACT = "How do I contact customer support?";
const PAYMENT = "My payment didn't go through, or I was charged twice";
const INTLPRE = "Can I pre-order from outside the U.S.?";
const MISTAKE = "Can I return something I ordered by mistake?";
const RETSHIP = "Who pays for return shipping?";
const CLAIM = "What's the status of my warranty claim or request?";
const COVER = "What does the warranty cover?";
const WHEEL = "Can a wheel be replaced?";
const PSA = "Will PSA slabs fit in my case?";
const BGS = "Will BGS slabs fit in my case?";
const CGC = "Will CGC slabs fit in my case?";
const SGC = "Will SGC or TAG slabs fit in my case?";
const GUARDS = "Will graded guards fit in my case?";
const ONETOUCH = "Will One Touch or magnetic holders fit in my case?";
const TOPLOADER = "Will top loaders and sleeves fit in my case?";
const BINDER = "How many cards fit in a binder?";
const DIMS = "What are the dimensions of a case?";
const FILM = "How do I remove the protective film?";
const RESETLOCK = "How do I set or reset the lock combination?";
const VAULT = "I forgot my vault code or can't open my vault";
const DISPLAY = "How should I display my cards?";
const CHECKOUT = "Checkout isn't working";
const SITEERR = "The website shows an error";
const SIGNIN = "I can't sign in to my account";
const UNHAPPY = "I'm not happy with my product";
const COLOUR = "Will you make it in another colour?";
const SIZE = "Will you make a bigger or smaller size?";
const IDEA = "I have an idea for a new product";
const PACKAGING = "Feedback about packaging";
const SUGGEST = "I have another suggestion";
const WSPRICE = "How much is wholesale pricing?";
const MOQ = "Is there a minimum order for wholesale?";
const WSAPP = "What's the status of my wholesale application?";
const TAXFREE = "Can I buy tax-free with a resale certificate?";
const BULK = "Do you offer discounts on bulk orders?";
const LOGO = "Can you make cases with my logo?";
const WSOTHER = "I have another wholesale question";
const BECOMEAFF = "How do I become an affiliate?";
const AFFHELP = "I'm an affiliate and need help";
const COMMISSION = "When are affiliate commissions paid?";
const FREESHIP = "Do you offer free shipping?";
const ARMOR = "What is ARMORSHIP® package protection?";
const HOWMANY = "How many slabs fit in a slab case?";
const WATER = "Are your cases waterproof?";
const PLANE = "Can I take my case on a plane?";
const STOCK = "Is it in stock, and when will a sold-out product be back?";
const GIFTCARD = "How do gift cards work?";

const LIFESPAN = "How do I make my case last, and is it good for long-term storage?";
const EMBROIDER = "Can you embroider a name or logo on a backpack?";

const any = (...questions: string[]) => questions.join(" | ");

// What customers write in the chat: whole messages, the way people talk, with
// the answer the assistant should give. "": it must not answer on its own
// (nothing fits, or it's for a person): asking back is right.
export const chats: [string, string][] = [
  // Orders
  ["Hi, I placed an order last week and I still have no idea where it is. Can you check?", WHERE],
  ["hey where is my order?? its been forever", any(WHERE, DELAYED)],
  ["I ordered on Monday, when will it ship?", any(NOTSHIPPED, SHIPTIME)],
  ["my tracking hasnt updated in 5 days, is my package lost?", LOST],
  ["The tracking says it was delivered yesterday but there is nothing at my door. What do I do?", DELIVERED],
  ["UPS says delivered but I never got it, I checked with my neighbours too", DELIVERED],
  ["I only got one box but I ordered 3 cases", PARTIAL],
  ["I need to cancel my order please, I ordered the wrong one", any(CANCEL, MISTAKE, EXCHANGE)],
  ["can i still cancel? it hasnt shipped", CANCEL],
  ["I put the wrong address on my order, can you change it?", ADDRESS],
  ["I moved last week, please ship to my new address", ADDRESS],
  ["Can I add a sling bag to my order before it ships?", EDIT],
  ["I want to change the color of my case from black to blue", any(EDIT, EXCHANGE)],
  ["Why is my order on hold?", HOLD],
  ["I didn't get an order confirmation email", CONFIRM],
  ["my order says delayed whats going on", DELAYED],
  ["The carrier left a note saying they couldn't deliver", FAILED],
  ["it got delivered to the wrong house", WRONGADDR],
  ["Do I need to be home to sign for the package?", SIGN],
  ["When will my pre-order ship?", PREORDER],
  // Shipping
  ["How much is shipping to California?", SHIPTIME],
  ["how long does shipping usually take", SHIPTIME],
  ["Is shipping free?", FREESHIP],
  ["Can I get it by Friday? It's a birthday gift", EXPEDITE],
  ["do you have express shipping", EXPEDITE],
  ["Do you ship to the UK? How much would it be?", INTL],
  ["I live in Canada, can you ship there?", INTL],
  ["Will I have to pay customs when it arrives in Germany?", CUSTOMS],
  ["Can you ship to Hawaii?", HAWAII],
  // Returns, refunds, exchanges
  ["What's your return policy?", RETURN],
  ["I want to return my case, how do I do that?", RETURN],
  ["Can I return it if I already opened it?", RETURN],
  ["I ordered the horizontal case but I wanted the vertical one, can I swap it?", EXCHANGE],
  ["I accidentally ordered two, can I send one back?", any(EXTRA, MISTAKE)],
  ["The case is too small for my BGS slabs, can I return it?", any(NOFIT, RETURN)],
  ["I returned my case two weeks ago and still no refund", REFUND],
  ["when will i get my money back", any(REFUND, RETURN)],
  ["Who pays for the return shipping?", RETSHIP],
  ["Honestly the case isn't what I expected from the pictures", EXPECTED],
  // Problems
  ["My case arrived with a big crack in the lid", DAMAGED],
  ["the box was crushed and the case inside is broken", DAMAGED],
  ["One of the risers snapped when I took it out", RISER],
  ["The risers were missing from my display case", MISSING],
  ["I got the wrong color, I ordered black and got white", WRONG],
  ["There are scratches all over the acrylic, is that normal?", SCRATCH],
  ["the lid is cloudy, can I clean that?", any(SCRATCH, CLEAN, FILM)],
  ["how do I get the plastic film off", FILM],
  ["The lid won't close all the way", LID],
  ["I can't open the lock, the combination doesn't work", LOCK],
  ["what's the default code for the lock", RESETLOCK],
  ["How do I set my own combination?", RESETLOCK],
  ["I forgot the code to my vault", VAULT],
  ["the bottom of my case is warped and wobbles", BOWING],
  ["The wheel came off after a couple of months of using it", any(WARRANTY, WHEEL)],
  ["Is there a warranty on the cases?", any(WARRANTY, COVER)],
  ["Can I buy extra foam inserts?", PARTS],
  ["I bought it at a card show, can I still get help?", CONVENTION],
  // Products
  ["Will my PSA slabs fit in the Slab Case X?", any(PSA, FIT, HOWMANY)],
  ["Does it fit graded guards?", GUARDS],
  ["how many slabs does the XL hold", HOWMANY],
  ["Which case should I buy for about 50 slabs?", HOWMANY],
  ["Can I put PSA and BGS slabs in the same case?", any(FIT, PSA, BGS)],
  ["What are the dimensions of the slab case?", DIMS],
  ["Is it waterproof? I want to take it to shows", any(WATER, DISPLAY)],
  ["Can I bring it on a plane as carry on?", PLANE],
  ["How do I clean it without scratching?", CLEAN],
  ["How do I keep my case in good shape for years?", LIFESPAN],
  ["Is it good for long term storage of my cards?", LIFESPAN],
  ["When will the black one be back in stock?", STOCK],
  ["How do I put the risers in?", ASSEMBLE],
  ["Do you make a bigger version?", SIZE],
  ["Can you embroider my company name on the backpack?", EMBROIDER],
  // Payments, codes, account
  ["My discount code says invalid", DISCOUNT],
  ["Can I use a gift card and a discount code together?", GIFTCARD],
  ["I was charged twice for the same order!", PAYMENT],
  ["I need an invoice for my order for my business", INVOICE],
  ["Checkout keeps giving me an error", any(CHECKOUT, SITEERR)],
  ["I can't log into my account", SIGNIN],
  ["how do i remove the shipping protection from my order", PROTECTION],
  ["what is armorship and do I have to buy it", ARMOR],
  // Wholesale and partners
  ["I own a card shop, do you do wholesale?", WHOLESALE],
  ["What's the minimum order for wholesale?", MOQ],
  ["Can I get a discount if I buy 20 cases?", BULK],
  ["How do I join your affiliate program?", any(AFFILIATE, BECOMEAFF)],
  ["Can you put my logo on the cases?", LOGO],
  // Hinglish
  ["mera order kab aayega bhai", WHERE],
  ["order cancel karna hai", CANCEL],
  ["case toota hua aaya hai", DAMAGED],
  ["return kaise kare", RETURN],
  ["refund kab milega", REFUND],
  ["address galat daal diya, change kar do", ADDRESS],
  // Upset, but asking something
  ["This is ridiculous, my case came broken AGAIN", DAMAGED],
  ["I'm really frustrated, I've been waiting 3 weeks for my order", any(WHERE, DELAYED)],
  // Nothing the articles answer: ask back, never guess
  askBack("Do you have a store in Los Angeles I can visit?"),
  askBack("Can you recommend a good grading company?"),
  askBack("What's the value of my Charizard card?"),
  ["my order number is 101170", ""],
  ["asdfgh", ""],
];
function askBack(text: string): [string, string] { return [text, ""]; }

// A third set, written last and never tuned on: the honest score.
export const fresh: [string, string][] = [
  ["wher my order", WHERE], ["ordr status", WHERE], ["trakcing", WHERE], ["tracking link", WHERE], ["has it been delivered yet", any(WHERE, DELIVERED)], ["parcel tracking", WHERE],
  ["delivered not recieved", DELIVERED], ["it shows delivered", DELIVERED], ["someone stole my package", DELIVERED],
  ["confirmation number", CONFIRM], ["didnt get order email", CONFIRM],
  ["got half my order", PARTIAL], ["only 1 package came", PARTIAL],
  ["cancell order", CANCEL], ["cancel pls", CANCEL], ["dont want the order", CANCEL], ["cancel subscription", any(CANCEL, PROTECTION)],
  ["change colour", EDIT], ["change item", EDIT], ["add a pouch", EDIT], ["edit my order before it ships", EDIT],
  ["wrong adress", any(ADDRESS, WRONGADDR)], ["change delivery address", ADDRESS], ["address update", ADDRESS],
  ["parcel lost", LOST], ["tracking not moving", LOST], ["stuck in transit", LOST], ["package went missing", any(LOST, DELIVERED)],
  ["delay", DELAYED], ["running late", DELAYED], ["why so slow", any(DELAYED, SHIPTIME)],
  ["failed delivery attempt", FAILED], ["held at ups", FAILED], ["pick up from post office", FAILED],
  ["wrong house", WRONGADDR], ["sent to the wrong address", any(WRONGADDR, ADDRESS)],
  ["shipping price", SHIPTIME], ["delivery fee", SHIPTIME], ["how long till it arrives", any(SHIPTIME, WHERE)], ["transit time", SHIPTIME],
  ["expedite", EXPEDITE], ["fast shipping", EXPEDITE], ["can it arrive by friday", EXPEDITE],
  ["ship to canada", INTL], ["shipping to japan", INTL], ["do you deliver internationally", INTL], ["ship overseas", INTL], ["australia delivery", INTL],
  ["shipping to alaska", HAWAII], ["us territories", HAWAII],
  ["custom fees", CUSTOMS], ["duty charges", CUSTOMS], ["import fees canada", CUSTOMS],
  ["how to return", RETURN], ["return window days", RETURN], ["refund policy", any(RETURN, REFUND)], ["can i return after 30 days", RETURN], ["return it for money back", any(RETURN, REFUND)],
  ["exchange item", EXCHANGE], ["want to swap it", EXCHANGE], ["exchange for bigger one", EXCHANGE],
  ["ordered 3 need 2", EXTRA], ["too many cases", EXTRA],
  ["slab too big for case", NOFIT], ["doesnt fit", NOFIT],
  ["refund?", REFUND], ["no refund", REFUND], ["refund taking long", REFUND], ["paise wapas kab milenge", any(REFUND, RETURN)],
  ["not as shown", EXPECTED], ["different from website", EXPECTED],
  ["broke", DAMAGED], ["arrived cracked", DAMAGED], ["broken corner", DAMAGED], ["damaged in shipping", DAMAGED], ["case damaged", DAMAGED], ["crushed box and case broken", DAMAGED],
  ["riser snapped", RISER], ["riser pin", RISER],
  ["missing piece", MISSING], ["didn't come with risers", MISSING], ["lids not in box", MISSING],
  ["incorrect item", WRONG], ["received different product", WRONG], ["wrong one sent", WRONG],
  ["scratch on lid", SCRATCH], ["cloudy lid", SCRATCH], ["marks on acrylic", SCRATCH],
  ["lid issue", LID], ["lid wont close properly", LID], ["hinge problem", LID],
  ["lock issue", LOCK], ["cant open the lock", LOCK], ["lock jammed", LOCK],
  ["case bowed", BOWING], ["bottom not flat", BOWING],
  ["warranty period", COVER], ["warranty coverage", COVER], ["wheel broke after a month", any(WARRANTY, WHEEL)],
  ["spare parts", PARTS], ["buy risers", PARTS], ["extra lid", PARTS],
  ["got it at a card show", CONVENTION],
  ["psa slab", PSA], ["bgs slab", BGS], ["cgc cards", any(CGC, FIT)], ["sgc slab fit", SGC], ["one touch magnetic", ONETOUCH], ["top loaders", TOPLOADER],
  ["binder", BINDER], ["size", any(DIMS, FIT, SIZE)], ["case measurements", DIMS],
  ["cleaning", CLEAN], ["put together", ASSEMBLE], ["film on case", FILM], ["reset lock", RESETLOCK], ["default combination", RESETLOCK], ["vault", VAULT],
  ["promo", DISCOUNT], ["coupon code", DISCOUNT], ["hold", HOLD], ["insurance", any(PROTECTION, ARMOR)], ["receipt please", INVOICE],
  ["declined", PAYMENT], ["charged 2 times", PAYMENT], ["not shipped", NOTSHIPPED], ["pre order delay", any(PREORDER, DELAYED)],
  ["gift missing", GIFT], ["sign", SIGN], ["contact number", CONTACT], ["help me", any(CONTACT)], ["email", CONTACT],
  ["return postage", RETSHIP], ["status of my request", CLAIM], ["new wheel", WHEEL],
  ["cart error", CHECKOUT], ["site not loading", SITEERR], ["account login", SIGNIN],
  ["complain", UNHAPPY], ["colour options", COLOUR], ["larger size", SIZE], ["new idea", IDEA], ["packing", PACKAGING],
  ["wholesale inquiry", WHOLESALE], ["dealer pricing", WSPRICE], ["minimum order quantity", MOQ], ["resale", TAXFREE], ["bulk", BULK], ["custom", LOGO], ["question about wholesale", any(WSOTHER, WHOLESALE)],
  ["affiliate signup", any(AFFILIATE, BECOMEAFF)], ["affiliate commission", COMMISSION],
  ["free ship", FREESHIP], ["armor ship", ARMOR], ["how many fit", HOWMANY], ["water", WATER], ["airport security", PLANE], ["sold out when back", STOCK], ["gift cards", GIFTCARD],
  ["hey so i ordered a case like 3 weeks ago and its still not here, whats going on", any(WHERE, DELAYED)],
  ["the case came but the lid is all scratched up and cloudy", SCRATCH],
  ["i need to change my order to the black one instead of the blue", EDIT],
  ["can you guys ship to the uk and how much would it cost", INTL],
  ["mera case toot gaya aaya hai", DAMAGED],
  ["return kaise karu", RETURN],
];

// Written separately from the tuning above, to check the search understands
// new wordings and not just the ones it was taught.
export const held: [string, string][] = [
  ["has my parcel been sent", any(NOTSHIPPED, WHERE)], ["where is my parcel", WHERE], ["order tracking", WHERE], ["is my order on the way", any(WHERE, NOTSHIPPED)],
  ["i never got my case", any(WHERE, DELIVERED, LOST)], ["order still not here", WHERE], ["when do i get my stuff", WHERE],
  ["driver said delivered but nothing at my door", DELIVERED], ["app says delivered", DELIVERED], ["package not at my door", DELIVERED],
  ["i didnt get a receipt email", any(CONFIRM, INVOICE)], ["no email after ordering", CONFIRM],
  ["only some items came", PARTIAL], ["one box arrived the other didnt", PARTIAL],
  ["please cancel", CANCEL], ["i want to cancel my order now", CANCEL], ["can my order be cancelled", CANCEL], ["cancellation request", CANCEL], ["cancel karo", CANCEL],
  ["can i add another case to my order", EDIT], ["change the item i ordered", EDIT], ["switch the color before it ships", any(EDIT, EXCHANGE)],
  ["new address", ADDRESS], ["need to fix my shipping address", ADDRESS], ["send it to my work address instead", ADDRESS], ["address galat hai", ADDRESS],
  ["package hasn't moved", LOST], ["my parcel is lost", LOST], ["tracking frozen", LOST], ["no tracking updates for a week", any(LOST, WHERE)],
  ["my order is late", DELAYED], ["order taking forever", DELAYED], ["why is it delayed", DELAYED],
  ["ups couldn't deliver", FAILED], ["missed the delivery", any(FAILED, SIGN)], ["returned to sender", FAILED],
  ["neighbour got my package", WRONGADDR], ["delivered to another address", WRONGADDR],
  ["how long to deliver", SHIPTIME], ["shipping charges", SHIPTIME], ["delivery charges", SHIPTIME], ["how fast do you ship", any(SHIPTIME, EXPEDITE, NOTSHIPPED)], ["how much does delivery cost", SHIPTIME],
  ["faster delivery", EXPEDITE], ["priority shipping", EXPEDITE], ["urgent delivery", EXPEDITE], ["can you rush it", EXPEDITE],
  ["do you ship to the uk", INTL], ["shipping to europe", INTL], ["deliver to dubai", INTL], ["ship to philippines", INTL], ["worldwide shipping", INTL],
  ["ship to guam", HAWAII], ["hawaii shipping cost", HAWAII],
  ["import duties", CUSTOMS], ["will i be charged customs", CUSTOMS], ["extra taxes at delivery", CUSTOMS],
  ["return process", RETURN], ["how to send back", RETURN], ["return policy days", RETURN], ["can i get my money back", any(RETURN, REFUND)], ["return request", RETURN],
  ["exchange for another color", EXCHANGE], ["swap horizontal for vertical", EXCHANGE], ["exchange policy", any(EXCHANGE, RETURN)],
  ["bought two only want one", EXTRA], ["return extra case", EXTRA],
  ["too small for my slabs", NOFIT], ["my cards don't fit", any(NOFIT, FIT)],
  ["refund pending", REFUND], ["waiting for refund", REFUND], ["refund still not here", REFUND], ["when is my refund coming", REFUND],
  ["not like the photos", EXPECTED], ["doesn't look like the picture", EXPECTED],
  ["case arrived cracked", DAMAGED], ["broken on arrival", DAMAGED], ["came damaged", DAMAGED], ["the glass is broken", DAMAGED], ["crack in the acrylic", DAMAGED], ["it arrived busted", DAMAGED],
  ["riser pins broke", RISER], ["broken insert", any(RISER, DAMAGED, "My product has a manufacturing defect or is damaged inside")],
  ["parts missing", MISSING], ["no foam inside", MISSING], ["risers not included", MISSING], ["missing risers", MISSING],
  ["you sent the wrong color", WRONG], ["got someone else's order", WRONG], ["wrong product delivered", WRONG],
  ["lid scratched", SCRATCH], ["scratches on acrylic", SCRATCH], ["acrylic is foggy", SCRATCH],
  ["lid not closing", LID], ["latches not aligned", LID], ["lid loose", LID],
  ["can't unlock", LOCK], ["lock not opening", LOCK], ["combination wont work", LOCK], ["locked case won't open", LOCK],
  ["bottom warped", BOWING], ["case rocks on table", BOWING],
  ["warranty info", any(WARRANTY, COVER)], ["is it covered", any(WARRANTY, COVER)], ["handle stopped working", WARRANTY], ["broke after using it", WARRANTY],
  ["buy spare risers", PARTS], ["replacement foam", PARTS], ["order a new lid", PARTS],
  ["bought it at a show", CONVENTION], ["bought in person", CONVENTION],
  ["does it fit psa slabs", PSA], ["psa fit", PSA], ["will bgs fit", BGS], ["cgc slab fit", CGC], ["do graded guards fit", GUARDS], ["magnetic one touch fit", ONETOUCH], ["toploader fit", TOPLOADER],
  ["binder size", BINDER], ["cards per binder", BINDER],
  ["case dimensions", DIMS], ["how big are the cases", DIMS], ["how much does it weigh", DIMS],
  ["clean acrylic", CLEAN], ["remove fingerprints", CLEAN], ["how to assemble", ASSEMBLE], ["setup instructions", ASSEMBLE],
  ["peel the film", FILM], ["blue film on acrylic", FILM],
  ["change combination", RESETLOCK], ["set new code", RESETLOCK], ["lock reset", RESETLOCK],
  ["vault locked", VAULT], ["vault combination", VAULT],
  ["discount not applied", DISCOUNT], ["promo not working", DISCOUNT], ["code doesn't work", DISCOUNT],
  ["order held", HOLD], ["order stuck on hold", HOLD],
  ["remove armorship", PROTECTION], ["don't want shipping protection", PROTECTION], ["insurance claim", any(ARMOR, PROTECTION)],
  ["get a receipt", INVOICE], ["tax invoice", INVOICE],
  ["payment error", PAYMENT], ["charged two times", PAYMENT], ["card not accepted", PAYMENT],
  ["hasn't shipped", NOTSHIPPED], ["when will you ship my order", any(NOTSHIPPED, SHIPTIME)], ["order still processing", NOTSHIPPED],
  ["pre order status", PREORDER], ["preorder delay", any(PREORDER, DELAYED)], ["pre-order to canada", INTLPRE],
  ["where is my free gift", GIFT], ["didn't get the free sling bag", GIFT],
  ["signature", SIGN], ["need to sign for delivery", SIGN],
  ["how can i contact you", CONTACT], ["support email", CONTACT], ["call you", CONTACT], ["talk to a person", CONTACT], ["customer support number", CONTACT],
  ["i ordered the wrong thing", any(MISTAKE, EXCHANGE)], ["return shipping cost", RETSHIP], ["do i pay for returns", RETSHIP],
  ["update on my claim", CLAIM], ["no reply to my email", any(CLAIM, CONTACT)],
  ["replace wheel", WHEEL], ["wheel came off", any(WHEEL, WARRANTY)],
  ["can't checkout", CHECKOUT], ["checkout button not working", CHECKOUT], ["site error", SITEERR], ["website down", SITEERR], ["can't sign in", SIGNIN], ["password reset", SIGNIN],
  ["unhappy with purchase", UNHAPPY], ["bad quality", any(UNHAPPY, EXPECTED)], ["other colors coming", COLOUR], ["bigger version", SIZE], ["idea for a product", IDEA],
  ["packaging was bad", PACKAGING], ["feedback on product", any(SUGGEST, UNHAPPY)],
  ["become a dealer", WHOLESALE], ["wholesale pricing", WSPRICE], ["minimum quantity", MOQ], ["application status wholesale", WSAPP], ["tax exemption", TAXFREE],
  ["buying in bulk", BULK], ["logo on case", LOGO], ["custom engraving", LOGO],
  ["affiliate program", AFFILIATE], ["join as influencer", any(AFFILIATE, BECOMEAFF)], ["affiliate link not working", AFFHELP], ["when do affiliates get paid", COMMISSION],
  ["is shipping free", FREESHIP], ["free shipping over", FREESHIP], ["armorship what is it", ARMOR], ["slab capacity", HOWMANY],
  ["is it water proof", WATER], ["can it get wet", WATER], ["carry on luggage", PLANE], ["take on flight", PLANE],
  ["is it available", STOCK], ["when back in stock", STOCK], ["gift card balance", GIFTCARD], ["use gift card", GIFTCARD],
  ["my order hasnt come and its been forever", any(WHERE, DELAYED)],
  ["the lock on my new case is stuck and wont open with 000", LOCK],
  ["i got my order but one of the lids is cracked down the middle", DAMAGED],
  ["can i send it back for a different colour", EXCHANGE],
  ["i want my money back the case is not good", any(RETURN, REFUND, UNHAPPY, EXPECTED)],
];

export const cases: [string, string][] = [
  // ---- Where is my order
  ["where's my package", WHERE], ["wheres my stuff", WHERE], ["order status", WHERE], ["when will my order arrive", any(WHERE, SHIPTIME)],
  ["track my order", WHERE], ["tracking number", WHERE], ["i havent recieved my order", WHERE], ["haven't received my case yet", WHERE],
  ["no update on my order", WHERE], ["when is it coming", WHERE], ["eta", any(WHERE, SHIPTIME)], ["order not arrived", WHERE],
  ["still waiting for my order", any(WHERE, DELAYED)], ["didnt get my order", any(WHERE, DELIVERED)], ["track", WHERE], ["trac", WHERE], ["wher is my ordr", WHERE],
  ["how do i track my package", WHERE], ["where is my shipment", WHERE], ["order kab aayega", WHERE], ["mera order kahan hai", WHERE],
  ["can you give me tracking info", WHERE], ["package status", WHERE],
  // ---- Delivered but not received
  ["says delivered but not here", DELIVERED], ["marked as delivered never got it", DELIVERED], ["ups says delivered", DELIVERED],
  ["package was stolen", any(DELIVERED, LOST)], ["porch pirate took my package", any(DELIVERED, LOST)], ["delivered but missing", DELIVERED],
  ["usps shows delivered but i didnt get it", DELIVERED], ["fedex delivered not received", DELIVERED],
  // ---- Confirmation
  ["no order confirmation email", CONFIRM], ["didn't get confirmation email", CONFIRM], ["confirmation email", CONFIRM], ["did my order go through", any(CONFIRM, CHECKOUT, PAYMENT)],
  ["can't find my order number", CONFIRM],
  // ---- Partial
  ["only got one of my items", PARTIAL], ["half my order came", PARTIAL], ["rest of my order", PARTIAL], ["received 1 of 2 packages", PARTIAL], ["second package", PARTIAL],
  // ---- Cancel
  ["cancel", CANCEL], ["cancle order", CANCEL], ["cancel my purchase", CANCEL], ["how to cancel order", CANCEL], ["i dont want it anymore", any(CANCEL, RETURN)],
  ["ordered by accident", any(CANCEL, MISTAKE)], ["stop my order", CANCEL], ["cancellation", CANCEL], ["canc", CANCEL], ["order cancel karna hai", CANCEL],
  ["can i still cancel", CANCEL], ["changed my mind", any(CANCEL, RETURN, MISTAKE)],
  // ---- Edit order
  ["change my order", EDIT], ["edit order", EDIT], ["add item to my order", EDIT], ["change quantity", EDIT], ["change color of my order", EDIT],
  ["modify order", EDIT], ["add something to my order", EDIT], ["wrong colour ordered", any(EDIT, EXCHANGE)], ["update my order", any(EDIT, WHERE)],
  // ---- Address
  ["change address", ADDRESS], ["wrong shipping address", any(ADDRESS, WRONGADDR)], ["update my address", ADDRESS], ["i moved", ADDRESS],
  ["typo in my address", ADDRESS], ["address change", ADDRESS], ["entered wrong address", ADDRESS], ["ship to different address", ADDRESS], ["adress", ADDRESS],
  // ---- Lost
  ["lost package", LOST], ["tracking not updating", LOST], ["package stuck", LOST], ["tracking hasn't changed in days", LOST], ["my package is missing", any(LOST, DELIVERED)],
  ["never arrived", any(LOST, DELIVERED)], ["package lost in transit", LOST], ["tracking stuck in label created", any(LOST, NOTSHIPPED)],
  // ---- Delayed
  ["order delayed", DELAYED], ["why is my order late", DELAYED], ["taking so long", DELAYED], ["its been 2 weeks", any(DELAYED, WHERE)], ["late delivery", DELAYED],
  // ---- Failed delivery
  ["missed delivery", any(FAILED, SIGN)], ["delivery attempted", FAILED], ["return to sender", FAILED], ["they left a notice", FAILED], ["package held at post office", FAILED],
  // ---- Wrong address delivered
  ["delivered to neighbor", WRONGADDR], ["delivered to wrong house", WRONGADDR], ["went to the wrong address", WRONGADDR],
  // ---- Shipping time / cost
  ["shipping cost", SHIPTIME], ["how long shipping", SHIPTIME], ["delivery time", SHIPTIME], ["how many days to deliver", SHIPTIME], ["shipping rates", SHIPTIME],
  ["what carrier do you use", any(SHIPTIME, WHERE)], ["shipping fee", SHIPTIME], ["how much to ship", SHIPTIME], ["shiping", any(SHIPTIME, NOTSHIPPED)],
  // ---- Expedite
  ["express shipping", EXPEDITE], ["overnight shipping", EXPEDITE], ["can i get it faster", EXPEDITE], ["rush order", EXPEDITE], ["2 day shipping", EXPEDITE], ["need it asap", EXPEDITE],
  ["next day delivery", EXPEDITE], ["upgrade shipping", EXPEDITE],
  // ---- International
  ["ship to uk", INTL], ["shipping to australia", INTL], ["do you deliver to germany", INTL], ["international shipping", INTL], ["ship outside usa", INTL], ["do you ship to india", INTL],
  ["international", INTL], ["intl shipping", INTL], ["ship to mexico", INTL],
  // ---- Hawaii
  ["alaska shipping", HAWAII], ["puerto rico", HAWAII], ["apo address", HAWAII], ["military address", HAWAII],
  // ---- Customs
  ["import tax", CUSTOMS], ["duties", CUSTOMS], ["customs fees", CUSTOMS], ["vat", CUSTOMS], ["do i have to pay customs", CUSTOMS], ["tariff", CUSTOMS],
  // ---- Returns
  ["return", RETURN], ["returns", RETURN], ["how do i return", RETURN], ["send it back", RETURN], ["return window", RETURN], ["can i return it", RETURN],
  ["retrun policy", RETURN], ["money back", any(RETURN, REFUND)], ["return item", RETURN], ["wapas karna hai", RETURN], ["return kaise kare", RETURN],
  ["how many days to return", RETURN], ["return a used item", RETURN],
  // ---- Exchange
  ["exchange", EXCHANGE], ["swap for different color", EXCHANGE], ["exchange for vertical", EXCHANGE], ["exchange size", EXCHANGE], ["exchnage", EXCHANGE],
  ["ordered wrong model", EXCHANGE],
  // ---- Extra
  ["ordered too many", EXTRA], ["return one of them", EXTRA], ["ordered two by mistake", any(EXTRA, MISTAKE)], ["duplicate order", any(EXTRA, CANCEL)],
  // ---- Doesn't fit
  ["doesn't fit my slabs", NOFIT], ["slabs don't fit", any(NOFIT, FIT)], ["too tight", NOFIT], ["cards wont fit", any(NOFIT, FIT)],
  // ---- Refund
  ["refund", REFUND], ["refund status", REFUND], ["when will i get my refund", REFUND], ["refund not received", REFUND], ["where's my money", REFUND],
  ["refnd", REFUND], ["still no refund", REFUND], ["refund kab milega", REFUND], ["how long does refund take", REFUND], ["reimbursement", REFUND],
  // ---- Not expected
  ["not as described", EXPECTED], ["looks different than pictures", EXPECTED], ["poor quality", any(EXPECTED, UNHAPPY)], ["cheap plastic", any(EXPECTED, UNHAPPY)],
  // ---- Damaged
  ["broken", DAMAGED], ["damaged", DAMAGED], ["arrived broken", DAMAGED], ["cracked case", DAMAGED], ["box was crushed", any(DAMAGED, PACKAGING)], ["damged item", DAMAGED],
  ["defective", any(DAMAGED, WARRANTY)], ["it came smashed", DAMAGED], ["shattered acrylic", DAMAGED], ["case is broken", DAMAGED], ["toota hua aaya", DAMAGED], ["damage", DAMAGED],
  ["dent on the case", DAMAGED], ["handle broken", any(DAMAGED, WARRANTY)],
  // ---- Riser
  ["riser broken", RISER], ["pins snapped", RISER], ["riser tabs broke", RISER], ["broken riser", RISER],
  // ---- Missing
  ["missing item", MISSING], ["something missing", MISSING], ["missing parts", any(MISSING, PARTS)], ["box was empty", MISSING], ["no risers in box", MISSING],
  ["missing lid", MISSING], ["item not in the box", MISSING], ["missing", MISSING], ["mising", MISSING],
  // ---- Wrong item
  ["wrong item", WRONG], ["got the wrong product", WRONG], ["received wrong color", WRONG], ["sent me the wrong thing", WRONG], ["not what i ordered", WRONG],
  ["wrong size sent", WRONG],
  // ---- Scratch
  ["scratched", SCRATCH], ["scratches on case", SCRATCH], ["cloudy acrylic", SCRATCH], ["case is foggy", SCRATCH], ["scuffed", SCRATCH], ["not clear", SCRATCH],
  // ---- Lid
  ["lid won't close", LID], ["latch doesn't line up", LID], ["hinge loose", any(LID, WARRANTY)], ["cover not closing", LID], ["lid wont shut", LID],
  // ---- Lock
  ["can't open lock", LOCK], ["lock stuck", LOCK], ["locked out of my case", LOCK], ["combination not working", LOCK], ["cant open case", LOCK], ["lock broken", LOCK],
  // ---- Bowing
  ["warped", BOWING], ["case not flat", BOWING], ["wobbles on table", BOWING], ["bottom bent", BOWING],
  // ---- Warranty
  ["warranty", any(WARRANTY, COVER)], ["warranty claim", any(WARRANTY, CLAIM)], ["wheel fell off", any(WARRANTY, WHEEL)], ["stopped working", WARRANTY], ["rusting", WARRANTY],
  ["warrenty", any(WARRANTY, COVER)], ["guarantee", any(WARRANTY, COVER)], ["broke after a month", WARRANTY], ["how long is the warranty", COVER], ["lifetime warranty", COVER],
  // ---- Parts
  ["replacement parts", PARTS], ["buy extra risers", PARTS], ["spare wheels", any(PARTS, WHEEL)], ["new foam", PARTS], ["replacement lid", PARTS], ["extra inserts", PARTS],
  // ---- Convention
  ["bought at card show", CONVENTION], ["bought at convention", CONVENTION], ["purchased in person", CONVENTION], ["no receipt", any(CONVENTION, INVOICE)],
  // ---- Fit
  ["will it fit", FIT], ["what fits", FIT], ["compatible slabs", FIT], ["fit psa", PSA], ["psa", PSA], ["psa slabs", PSA], ["beckett", BGS], ["bgs", BGS], ["cgc", CGC],
  ["sgc", SGC], ["tag slabs", SGC], ["slab guards", GUARDS], ["graded guard", GUARDS], ["one touch", ONETOUCH], ["magnetic", ONETOUCH], ["mag holder", ONETOUCH],
  ["35pt", ONETOUCH], ["top loader", TOPLOADER], ["toploaders", TOPLOADER], ["penny sleeves", TOPLOADER], ["sleeves", TOPLOADER],
  // ---- Binder
  ["binder capacity", BINDER], ["how many cards in binder", BINDER], ["binder pages", BINDER],
  // ---- Dimensions
  ["dimensions", DIMS], ["size of case", DIMS], ["how big is it", DIMS], ["measurements", DIMS], ["weight", DIMS], ["how heavy", DIMS], ["inside dimensions", DIMS], ["dimentions", DIMS],
  // ---- Film
  ["peel film", FILM], ["protective film", FILM], ["sticker on acrylic", FILM], ["remove plastic", FILM],
  // ---- Reset lock
  ["reset combination", RESETLOCK], ["set lock code", RESETLOCK], ["forgot combination", any(RESETLOCK, LOCK)], ["default code", any(RESETLOCK, LOCK)], ["change lock code", RESETLOCK],
  ["tsa lock", any(RESETLOCK, LOCK, PLANE)],
  // ---- Vault
  ["vault code", VAULT], ["forgot vault code", VAULT], ["vault wont open", VAULT],
  // ---- Clean / assemble / display
  ["clean", CLEAN], ["how to clean", CLEAN], ["fingerprints on case", CLEAN], ["polish acrylic", CLEAN], ["assembly", ASSEMBLE], ["instructions", ASSEMBLE],
  ["how to set up", ASSEMBLE], ["how do i install risers", ASSEMBLE], ["display tips", DISPLAY], ["how to arrange cards", DISPLAY],
  // ---- Discount
  ["promo code", DISCOUNT], ["coupon not working", DISCOUNT], ["discount", DISCOUNT], ["code invalid", DISCOUNT], ["discount code expired", DISCOUNT], ["coupon", DISCOUNT],
  ["forgot to use my discount code", DISCOUNT],
  // ---- Hold
  ["order on hold", HOLD], ["why on hold", HOLD], ["verification", HOLD], ["fraud check", HOLD],
  // ---- Protection / armorship
  ["remove shipping protection", PROTECTION], ["shipping insurance", any(PROTECTION, ARMOR)], ["armorship", any(PROTECTION, ARMOR)], ["package protection", any(PROTECTION, ARMOR)],
  ["armorship claim", any(ARMOR, PROTECTION)],
  // ---- Invoice
  ["invoice", INVOICE], ["receipt", INVOICE], ["need a receipt", INVOICE], ["bill", INVOICE],
  // ---- Payment
  ["charged twice", PAYMENT], ["double charge", PAYMENT], ["card declined", PAYMENT], ["payment failed", PAYMENT], ["payment not going through", PAYMENT],
  ["paypal", any(PAYMENT, CHECKOUT)], ["afterpay", any(PAYMENT, CHECKOUT)], ["pending charge", PAYMENT],
  // ---- Not shipped
  ["not shipped yet", NOTSHIPPED], ["when will it ship", any(NOTSHIPPED, SHIPTIME)], ["still processing", NOTSHIPPED], ["unfulfilled", NOTSHIPPED], ["has it shipped", NOTSHIPPED],
  // ---- Pre-order
  ["preorder", PREORDER], ["pre order", PREORDER], ["pre-order", PREORDER], ["when does preorder ship", PREORDER], ["preorder international", INTLPRE],
  // ---- Gift
  ["free gift", GIFT], ["sling bag missing", GIFT], ["free bag", GIFT], ["promo gift", GIFT],
  // ---- Sign
  ["signature required", SIGN], ["do i have to sign", SIGN],
  // ---- Contact
  ["contact", CONTACT], ["phone number", CONTACT], ["talk to someone", CONTACT], ["customer service", CONTACT], ["email address", CONTACT], ["live chat", CONTACT],
  ["speak to a human", CONTACT], ["agent", CONTACT], ["how to reach you", CONTACT], ["support", CONTACT], ["contct", CONTACT], ["no one is replying", any(CONTACT, CLAIM)],
  ["customer care number", CONTACT],
  // ---- Mistake / return shipping
  ["ordered wrong one", any(MISTAKE, EXCHANGE)], ["return label", RETSHIP], ["who pays return shipping", RETSHIP], ["free returns", any(RETSHIP, RETURN)], ["prepaid label", RETSHIP],
  // ---- Claim status
  ["claim status", CLAIM], ["any update on my request", CLAIM], ["haven't heard back", CLAIM], ["follow up on my ticket", CLAIM],
  // ---- Wheel
  ["wheel replacement", WHEEL], ["broken wheel", any(WHEEL, WARRANTY, DAMAGED)], ["wheels", any(WHEEL, PARTS)],
  // ---- Website
  ["checkout error", CHECKOUT], ["can't place order", CHECKOUT], ["cart not working", CHECKOUT], ["website not working", SITEERR], ["page not loading", SITEERR], ["404", SITEERR],
  ["login", SIGNIN], ["forgot password", SIGNIN], ["can't log in", SIGNIN], ["create account", SIGNIN], ["sign in", SIGNIN],
  // ---- Feedback
  ["complaint", UNHAPPY], ["not happy", UNHAPPY], ["disappointed", any(UNHAPPY, EXPECTED)], ["more colors", COLOUR], ["new colour", COLOUR], ["pink case", COLOUR],
  ["bigger case", SIZE], ["smaller size", SIZE], ["product idea", IDEA], ["packaging", PACKAGING], ["feedback", any(SUGGEST, PACKAGING)], ["suggestion", any(SUGGEST, IDEA)],
  // ---- Wholesale
  ["wholesale", WHOLESALE], ["reseller", any(WHOLESALE, TAXFREE)], ["dealer", WHOLESALE], ["wholesale price", WSPRICE], ["price list", WSPRICE], ["moq", MOQ],
  ["minimum order", MOQ], ["wholesale application", WSAPP], ["tax exempt", TAXFREE], ["resale certificate", TAXFREE], ["bulk order", BULK], ["bulk discount", BULK],
  ["custom logo", LOGO], ["engraving", LOGO], ["personalized case", LOGO], ["sell your cases in my store", WHOLESALE], ["wholsale", WHOLESALE],
  // ---- Affiliate
  ["affiliate", any(AFFILIATE, BECOMEAFF, AFFHELP)], ["influencer", any(AFFILIATE, BECOMEAFF)], ["become a partner", any(AFFILIATE, BECOMEAFF)], ["commission", any(COMMISSION, AFFILIATE)],
  ["affiliate payout", COMMISSION], ["my affiliate link", AFFHELP], ["collab", any(AFFILIATE, BECOMEAFF)], ["sponsorship", any(AFFILIATE, BECOMEAFF)],
  // ---- Free shipping / armor / capacity / water / plane / stock / gift card
  ["free shipping", FREESHIP], ["free delivery", FREESHIP], ["free shipping minimum", FREESHIP], ["what is armorship", ARMOR], ["how many slabs", HOWMANY],
  ["capacity", any(HOWMANY, BINDER)], ["how many cards does it hold", any(HOWMANY, BINDER)], ["waterproof", WATER], ["rain", WATER], ["water resistant", WATER],
  ["plane", PLANE], ["carry on", PLANE], ["airplane", PLANE], ["flight", PLANE], ["travel with case", PLANE], ["in stock", STOCK], ["sold out", STOCK], ["restock", STOCK],
  ["back in stock", STOCK], ["out of stock", STOCK], ["when available", STOCK], ["gift card", GIFTCARD], ["giftcard balance", GIFTCARD], ["gift card expire", GIFTCARD],
  // ---- Longer messages
  ["Hi, I ordered a case 10 days ago and still haven't received it, can you tell me where it is?", WHERE],
  ["my slab case came today and the acrylic lid has a big crack in it", DAMAGED],
  ["I need to return this because it is too small for my graded cards", any(NOFIT, RETURN)],
  ["hello i accidentally put the wrong address on my order can you fix it", ADDRESS],
  ["is there any way to get my order quicker i need it for a show this weekend", EXPEDITE],
  ["the code on my lock doesn't work anymore and I can't get it open", LOCK],
];
