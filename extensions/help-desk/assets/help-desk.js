(() => {
  function node(tag, text, attributes = {}) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  // Sign in, then back to this page. New customer accounts take return_to on
  // /customer_authentication/login; classic accounts take return_url.
  function signInLink(root) {
    const back = location.pathname + location.search;
    const home = window.Shopify?.routes?.root || '/';
    const login = new URL(root.dataset.loginUrl || `${home}account/login`, location.origin);
    if (login.pathname.includes('customer_authentication')) {
      const link = new URL(`${home}customer_authentication/login`, location.origin);
      link.searchParams.set('return_to', back);
      return link.href;
    }
    login.searchParams.set('return_url', back);
    return login.href;
  }

  async function initialize(root) {
    if (root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const status = root.querySelector('[data-help-desk-status]');
    function message(text, error = false, focus = true) {
      status.textContent = text;
      status.dataset.error = String(error);
      if (focus) status.focus();
    }
    let endpoint;
    try {
      endpoint = new URL(root.dataset.endpoint, location.origin);
      if (endpoint.origin !== location.origin) throw new Error();
    } catch {
      message('The help desk address is not configured correctly. Please contact the store.', true, false);
      return;
    }
    // Sign-in first (the block's setting): a guest sees only a prompt to sign
    // in, not the topics. The theme editor still shows the form, to style it.
    const guest = !root.querySelector('[data-help-desk-customer]');
    if (guest && root.dataset.requireLogin === 'true' && !window.Shopify?.designMode) {
      const gate = node('div', '', { class: 'help-desk-login help-desk-gate' });
      const text = node('div');
      text.append(node('strong', 'Sign in to get help'), node('span', 'Sign in to see your orders and send us a request. Your details are filled in for you.'));
      const actions = node('div', '', { class: 'help-desk-gate-actions' });
      actions.append(node('a', 'Sign in', { href: signInLink(root), class: 'help-desk-login-button' }));
      if (root.dataset.registerUrl) actions.append(node('a', 'Create an account', { href: root.dataset.registerUrl, class: 'help-desk-link' }));
      gate.append(text, actions);
      root.querySelector('[data-help-desk-form]').replaceChildren(gate);
      message('', false, false);
      return;
    }
    let config;
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error();
      config = await response.json();
      if (!Array.isArray(config.topics) || !Array.isArray(config.groups)) throw new Error();
    } catch {
      message('The help desk could not load. Please try again.', true, false);
      const retry = node('button', 'Try again', { type: 'button' });
      retry.onclick = () => { retry.disabled = true; delete root.dataset.initialized; initialize(root); };
      status.append(retry);
      return;
    }
    const { topics, issues, countries } = config;
    const cancelReasons = Array.isArray(config.cancelReasons) ? config.cancelReasons : [];
    // "How can we help you?" groups, each with its "What's going on?" options
    // (app/services/help-desk-form.ts). An option carries the ticket's category,
    // sub-category and the form values it implies, and names the fields to show.
    const groups = config.groups;
    const trackingLink = token => `${endpoint.pathname}?ticket=${encodeURIComponent(token)}`;
    let requestKey = '';
    // Signed-in customers: the block renders their contact details and recent orders.
    let customer = null;
    try { customer = JSON.parse(root.querySelector('[data-help-desk-customer]')?.textContent || 'null'); } catch { customer = null; }
    // A signed-in customer's orders: live ones from the app (signed proxy
    // request, up-to-date fulfillment) merged with the theme's copy, which also
    // has orders older than the 60 days the app can read. Newest first.
    const byName = new Map();
    for (const order of [...(Array.isArray(customer?.orders) ? customer.orders : []), ...(Array.isArray(config.orders) ? config.orders : [])]) {
      if (order?.name) byName.set(order.name, { ...byName.get(order.name), ...order });
    }
    const placed = order => Date.parse(order.date) || 0;
    const orders = [...byName.values()].filter(order => !order.cancelled).sort((a, b) => placed(b) - placed(a));
    const signedIn = Boolean(customer);
    const items = order => (Array.isArray(order?.items) ? order.items : []);
    const shipped = order => order.fulfillment === 'fulfilled' || order.fulfillment === 'partial';
    const itemLine = item => [item.title, item.variant].filter(Boolean).join(' - ') + ` × ${item.quantity || 1}`;
    // Chosen products: the products the request is about (to ship, with a problem, or for a part).
    const selected = new Map();
    const form = node('form');
    const controls = node('fieldset');
    // The form is four steps, one at a time: the topic, the issue, the
    // customer's details, then the request itself. A bar on top shows progress.
    const counter = node('p', '', { class: 'help-desk-progress-count', 'aria-live': 'polite' });
    const progress = node('ol', '', { class: 'help-desk-progress', 'aria-label': 'Progress' });
    // Beside the form on wide screens: who's signed in, the steps and past requests.
    const aside = node('aside', '', { class: 'help-desk-aside' });
    aside.append(counter, progress);
    const review = node('div', '', { class: 'help-desk-review', 'aria-live': 'polite' });
    const panels = [];
    function section(title, description, short) {
      const stepNames = ['topic', 'issue', 'details', 'request', 'review'];
      const container = node('section', '', { class: `help-desk-section help-desk-section-${stepNames[panels.length] || 'step'}`, 'aria-label': title });
      const heading = node('div', '', { class: 'help-desk-section-heading' });
      const text = node('div');
      text.append(node('h3', title, { tabindex: '-1' }), node('p', description));
      heading.append(node('span', String(panels.length + 1), { class: 'help-desk-step', 'aria-hidden': 'true' }), text);
      container.append(heading);
      controls.append(container);
      panels.push(container);
      progress.append(node('li', short));
      return container;
    }
    let step = -1;
    function go(index) {
      const moved = step !== -1 && index !== step;
      step = index;
      panels.forEach((panel, at) => { panel.hidden = at !== index; });
      [...progress.children].forEach((item, at) => { item.dataset.state = at < index ? 'done' : at === index ? 'current' : ''; });
      const active = [...progress.children].map((item, at) => ({ item, at })).filter(({ item }) => !item.hidden);
      const position = active.findIndex(({ at }) => at === index) + 1;
      counter.textContent = `Step ${position} of ${active.length} · ${progress.children[index].textContent}`;
      for (const line of chosenLines) line.refresh();
      if (moved && form.isConnected) {
        if (form.getBoundingClientRect().top < 0) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        panels[index].querySelector('h3').focus({ preventScroll: true });
      }
    }
    // Back at the top of a step, where it's easy to reach.
    function backButton(panel, back) {
      const previous = node('button', 'Back', { type: 'button', class: 'help-desk-back' });
      previous.onclick = back;
      panel.prepend(previous);
      return previous;
    }
    // Back above a step and, if it has one, Next under it.
    function nav(panel, back, next) {
      const previous = backButton(panel, back);
      if (!next) return previous;
      const bar = node('div', '', { class: 'help-desk-nav' });
      const forward = node('button', 'Next', { type: 'button' });
      forward.onclick = next;
      bar.append(forward);
      panel.append(bar);
      return previous;
    }
    // A big clickable choice: its name and, if it has one, a line about it.
    function tile(title, text, icon) {
      const button = node('button', '', { type: 'button', class: 'help-desk-tile', 'aria-pressed': 'false', ...(icon ? { 'data-icon': icon } : {}) });
      // The name and its line, then a radio circle that fills in when it's picked.
      const words = node('span', '', { class: 'help-desk-tile-text' });
      words.append(node('strong', title));
      if (text) words.append(node('span', text));
      button.append(words, node('span', '', { class: 'help-desk-radio', 'aria-hidden': 'true' }));
      return button;
    }
    const fields = node('div', '', { 'data-fields': '' });
    function field(parent, name, label, options = {}) {
      const wrap = node('label');
      const title = node('span', label);
      if (!options.optional) title.append(' ', node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }));
      wrap.append(title);
      let input;
      if (options.choices) {
        input = node('select');
        input.append(node('option', options.placeholder || 'Select an option', { value: '' }));
        for (const choice of options.choices) {
          const [value, title] = Array.isArray(choice) ? choice : [choice, choice];
          input.append(node('option', title, { value }));
        }
      } else {
        input = node(options.multiline ? 'textarea' : 'input');
        if (!options.multiline) input.type = options.type || 'text';
        input.maxLength = options.multiline ? 5000 : 200;
        if (options.placeholder) input.placeholder = options.placeholder;
        if (options.autocomplete) input.autocomplete = options.autocomplete;
      }
      input.name = name;
      input.required = !options.optional;
      wrap.append(input);
      parent.append(wrap);
      return input;
    }

    // OpenStreetMap suggestions straight from the browser (Photon allows it),
    // which skips the trip through Shopify and the app: much faster. Each one
    // carries its whole address; same rules as help-desk-places.server.ts.
    // Countries that don't use postal codes, and the format where it's well known.
    const NO_POSTAL_CODE = ['AE', 'AG', 'AO', 'AW', 'BF', 'BI', 'BJ', 'BO', 'BS', 'BW', 'BZ', 'CD', 'CF', 'CG', 'CI', 'CK', 'CM', 'DJ', 'DM', 'ER', 'FJ', 'GA', 'GD', 'GH', 'GM', 'GQ', 'GY', 'HK', 'KI', 'KM', 'KN', 'KP', 'LC', 'LY', 'ML', 'MO', 'MR', 'MW', 'NR', 'NU', 'QA', 'RW', 'SB', 'SC', 'SL', 'SO', 'SR', 'ST', 'SY', 'TF', 'TG', 'TK', 'TL', 'TO', 'TT', 'TV', 'UG', 'VU', 'YE', 'ZW'];
    const POSTAL_FORMATS = {
      US: ['\\d{5}(-\\d{4})?', '12345'], CA: ['[A-Za-z]\\d[A-Za-z] ?\\d[A-Za-z]\\d', 'K1A 0B1'], IN: ['\\d{6}', '560001'], AU: ['\\d{4}', '2000'],
      GB: ['[A-Za-z]{1,2}\\d[A-Za-z\\d]? ?\\d[A-Za-z]{2}', 'SW1A 1AA'], DE: ['\\d{5}', '10115'], FR: ['\\d{5}', '75001'], MX: ['\\d{5}', '06000'],
    };
    const PHOTON = 'https://photon.komoot.io/api/';
    const NUMBER_LAST = ['DE', 'AT', 'CH', 'NL', 'BE', 'IT', 'ES', 'PT', 'PL', 'CZ', 'DK', 'NO', 'SE', 'FI', 'MX', 'BR', 'AR'];
    const placeCache = new Map();
    // Opens the connection early (the handshake is half the wait), once.
    let warmed = false;
    function warmPlaces() {
      if (warmed || config.addressProvider === 'google') return;
      warmed = true;
      document.head.append(node('link', '', { rel: 'preconnect', href: 'https://photon.komoot.io', crossorigin: '' }));
    }
    async function photonSuggest(query, country, signal) {
      const params = new URLSearchParams({ q: query, limit: '6', lang: 'en' });
      if (country) params.set('countrycode', country);
      params.append('layer', 'house');
      params.append('layer', 'street');
      const response = await fetch(`${PHOTON}?${params}`, { signal });
      if (!response.ok) throw new Error(`Photon answered ${response.status}`);
      const { features = [] } = await response.json();
      const seen = new Set();
      const results = [];
      for (const { properties: place = {} } of features) {
        const code = String(place.countrycode || country || '').toUpperCase();
        if (country && code !== country) continue;
        const ordered = NUMBER_LAST.includes(code) ? [place.street, place.housenumber] : [place.housenumber, place.street];
        const line = place.type === 'street' ? place.name || '' : ordered.filter(Boolean).join(' ');
        const named = place.type !== 'street' && place.name && !place.housenumber ? place.name : '';
        // Wards and mandals aren't cities: the city is left blank, the neighbourhood goes on the street line.
        const city = place.city || place.town || place.village || '';
        const area = !['US', 'CA'].includes(code) && place.locality && place.locality !== city
          && !`${named} ${line}`.toLowerCase().includes(place.locality.toLowerCase()) ? place.locality : '';
        const parts = [...new Set([named, line, area].filter(Boolean))];
        const address1 = parts.filter(part => !parts.some(other => other !== part && other.includes(part))).join(', ').slice(0, 200);
        if (!address1) continue;
        const main = named || line;
        const secondary = [named ? line : '', area, city, place.state, place.postcode].filter(Boolean).join(', ');
        if (seen.has(`${main}|${secondary}`)) continue;
        seen.add(`${main}|${secondary}`);
        results.push({ id: `osm:${place.osm_type || ''}${place.osm_id || ''}`, main, secondary,
          address: { address1, address2: '', city, province: '', provinceName: place.state || '', zip: place.postcode || '', country: code } });
      }
      return results.slice(0, 5);
    }

    // Address suggestions under a grid's street field, in the chosen country,
    // like checkout: Google Places through the app (config.addressSuggestions
    // is off until the store adds a key). Picking one fills in the street,
    // city, state and postal code; the customer can still type it all by hand.
    function addressSuggest(grid, getCountry) {
      const street = grid.querySelector('[name=shipAddress1]');
      if (!config.addressSuggestions || !street) return;
      const holder = street.parentElement;
      holder.classList.add('help-desk-address-search');
      const listId = `help-desk-places-${Math.random().toString(36).slice(2)}`;
      const list = node('ul', '', { class: 'help-desk-suggestions help-desk-address-suggestions', role: 'listbox', id: listId, hidden: '' });
      holder.append(list);
      // The browser's own autofill list would cover ours. Chrome ignores "off"
      // on address fields but skips a field with a token it doesn't know.
      street.setAttribute('autocomplete', 'help-desk-address-search');
      street.placeholder = 'Start typing your address';
      street.setAttribute('role', 'combobox');
      street.setAttribute('aria-autocomplete', 'list');
      street.setAttribute('aria-controls', listId);
      street.setAttribute('aria-expanded', 'false');
      // One search (typing, then picking) is one Google session.
      let session = crypto.randomUUID(), timer, version = 0, active = -1, found = [];
      const request = async params => {
        const url = new URL(endpoint);
        for (const [key, value] of Object.entries({ ...params, session })) url.searchParams.set(key, value);
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        return response.ok ? response.json() : {};
      };
      const close = () => {
        list.hidden = true;
        list.replaceChildren();
        found = [];
        active = -1;
        street.setAttribute('aria-expanded', 'false');
        street.removeAttribute('aria-activedescendant');
      };
      const highlight = index => {
        active = index;
        [...list.querySelectorAll('[role=option]')].forEach((item, at) => item.setAttribute('aria-selected', String(at === index)));
        if (index >= 0) street.setAttribute('aria-activedescendant', `${listId}-${index}`);
        else street.removeAttribute('aria-activedescendant');
      };
      const show = suggestions => {
        list.replaceChildren();
        found = suggestions;
        active = -1;
        if (!suggestions.length) { close(); return; }
        suggestions.forEach((suggestion, index) => {
          const item = node('li', '', { role: 'option', id: `${listId}-${index}`, 'aria-selected': 'false' });
          const text = node('span', '', { class: 'help-desk-place-text' });
          text.append(node('strong', suggestion.main), ...(suggestion.secondary ? [node('span', suggestion.secondary)] : []));
          item.append(node('span', '', { class: 'help-desk-place-pin', 'aria-hidden': 'true' }), text);
          // mousedown, so it's picked before the field loses focus.
          item.onmousedown = event => { event.preventDefault(); pick(suggestion); };
          item.onmouseenter = () => highlight(index);
          list.append(item);
        });
        list.append(node('li', config.addressProvider === 'google' ? 'Powered by Google' : '© OpenStreetMap contributors', { class: 'help-desk-places-credit', 'aria-hidden': 'true' }));
        list.hidden = false;
        street.setAttribute('aria-expanded', 'true');
      };
      // Sets a field the way typing would, so the form's own listeners see it.
      const fill = (name, value) => {
        const input = grid.querySelector(`[name=${name}]`);
        if (!input || value === undefined) return;
        if (input.tagName === 'SELECT') {
          const option = [...input.options].find(entry => entry.value && (entry.value.toUpperCase() === String(value.code || '').toUpperCase() || entry.textContent.trim().toLowerCase() === String(value.name || '').toLowerCase()));
          if (!option) return;
          input.value = option.value;
        } else input.value = typeof value === 'object' ? (value.name || value.code || '') : value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      async function pick(suggestion) {
        close();
        street.value = suggestion.address?.address1 || suggestion.main;
        try {
          // OpenStreetMap suggestions carry their address; Google's is asked for once picked.
          const address = suggestion.address || (await request({ places: 'details', id: suggestion.id })).address;
          if (!address) return;
          fill('shipAddress1', address.address1 || suggestion.main);
          if (address.address2) fill('shipAddress2', address.address2);
          fill('shipCity', address.city);
          fill('shipProvince', { code: address.province, name: address.provinceName });
          fill('shipZip', address.zip);
        } catch { /* what they picked stays in the street field */ }
        finally {
          session = crypto.randomUUID();
          street.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      let inflight = null;
      // Suggestions for a query: remembered, else OpenStreetMap from the
      // browser (the app as a fallback), or Google through the app.
      const lookup = async (query, country, signal) => {
        const key = `${country}|${query.toLowerCase()}`;
        if (placeCache.has(key)) return placeCache.get(key);
        let suggestions;
        if (config.addressProvider !== 'google') {
          try { suggestions = await photonSuggest(query, country, signal); } catch (error) { if (error.name === 'AbortError') throw error; }
        }
        if (!suggestions) {
          const result = await request({ places: 'suggest', q: query, country });
          if (result.error) console.warn('Help desk: address suggestions are unavailable.', result.error);
          suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];
        }
        if (placeCache.size > 200) placeCache.delete(placeCache.keys().next().value);
        placeCache.set(key, suggestions);
        return suggestions;
      };
      street.addEventListener('focus', warmPlaces);
      street.addEventListener('input', event => {
        if (!event.isTrusted) return;
        clearTimeout(timer);
        inflight?.abort();
        const query = street.value.trim();
        const current = ++version;
        if (query.length < 3) { close(); return; }
        const country = getCountry() || '';
        const cached = placeCache.get(`${country}|${query.toLowerCase()}`);
        if (cached) { show(cached); return; }
        // Meanwhile, keep showing what still matches every word typed so far.
        const words = query.toLowerCase().split(/\s+/).filter(Boolean);
        const still = found.filter(item => words.every(word => `${item.main} ${item.secondary}`.toLowerCase().includes(word)));
        if (still.length) show(still);
        timer = setTimeout(async () => {
          const controller = new AbortController();
          inflight = controller;
          try {
            const suggestions = await lookup(query, country, controller.signal);
            if (current === version && document.activeElement === street) show(suggestions);
          } catch (error) {
            if (error.name !== 'AbortError') { console.warn('Help desk: address suggestions failed.', error); close(); }
          } finally { if (inflight === controller) inflight = null; }
        }, 120);
      });
      street.addEventListener('keydown', event => {
        if (list.hidden || !found.length) return;
        if (event.key === 'ArrowDown') { event.preventDefault(); highlight((active + 1) % found.length); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); highlight(active <= 0 ? found.length - 1 : active - 1); }
        else if (event.key === 'Enter' && active >= 0) { event.preventDefault(); pick(found[active]); }
        else if (event.key === 'Escape') { event.preventDefault(); close(); }
      });
      street.addEventListener('blur', () => setTimeout(close, 150));
    }

    // Step 1: the topic. The cards set the (hidden) topic dropdown.
    const topicSection = section('How can we help?', 'Choose a topic to get started.', 'Topic');
    const group = field(topicSection, 'group', 'How can we help?', { choices: groups.map((entry, index) => [String(index), entry.label]), placeholder: 'Select a topic' });
    group.removeAttribute('name');
    group.classList.add('help-desk-category-select');
    group.parentElement.hidden = true;
    const topicTiles = node('div', '', { class: 'help-desk-tiles' });
    groups.forEach((entry, index) => {
      const card = tile(entry.label, entry.hint, entry.label.split(/[\s,]/)[0].toLowerCase());
      card.onclick = () => { if (group.value === String(index)) go(1); else { group.value = String(index); group.onchange(); } };
      topicTiles.append(card);
      group.addEventListener('change', () => card.setAttribute('aria-pressed', String(group.value === String(index))));
    });
    topicSection.append(topicTiles);

    // Step 2: the issue, within the topic.
    const issueSection = section('What do you need help with?', '', 'Issue');
    const groupHint = issueSection.querySelector('p');
    groupHint.className = 'help-desk-hint help-desk-category-hint';
    const optionFields = node('div', '', { 'data-fields': '', class: 'help-desk-request-type' });
    const issueTiles = node('div', '', { class: 'help-desk-tiles help-desk-tiles-list' });
    issueSection.append(optionFields, issueTiles);
    nav(issueSection, () => go(0));
    // Where Back and Change go: the issue step, unless the topic has just one issue.
    const issueStep = () => groups[Number(group.value)]?.options.length === 1 ? 0 : 1;

    // Step 3: how to reach them. Signed-in customers skip it: their name and
    // email come from their account. Guests are asked to sign in first.
    const known = Boolean(customer?.name && customer?.email);
    const detailsStep = known ? 3 : 2;
    // "Shipping › Domestic Shipping · Change" on the later steps.
    const chosenLines = [];
    function chosenLine(panel) {
      const line = node('div', '', { class: 'help-desk-chosen' });
      const text = node('span');
      const change = node('button', 'Change', { type: 'button', class: 'help-desk-link' });
      change.onclick = () => go(issueStep());
      line.append(text, change);
      line.refresh = () => { text.textContent = [groups[Number(group.value)]?.label, current?.label].filter(Boolean).join(' › '); line.hidden = !current; };
      panel.querySelector('.help-desk-section-heading').after(line);
      chosenLines.push(line);
    }
    const contactSection = section('Your details', 'How we can reach you. Fields marked * are required.', 'Your details');
    const contactFields = node('div', '', { class: 'help-desk-contact-fields' });
    if (!customer) {
      const prompt = node('div', '', { class: 'help-desk-login' });
      const text = node('div');
      text.append(node('strong', 'Have an account? Sign in for faster help'), node('span', 'We\'ll fill in your details and show your orders, so you can pick one instead of typing it.'));
      prompt.append(text, node('a', 'Sign in', { href: signInLink(root), class: 'help-desk-login-button' }));
      contactSection.append(prompt, node('p', 'Or continue as a guest:', { class: 'help-desk-guest' }));
    }
    contactSection.append(contactFields);
    const contact = [
      [field(contactFields, 'name', 'Full name', { autocomplete: 'name' }), 'name'],
      [field(contactFields, 'email', 'Email address', { type: 'email', autocomplete: 'email' }), 'email'],
      [field(contactFields, 'phone', 'Phone number (optional)', { type: 'tel', optional: true, autocomplete: 'tel' }), 'phone'],
    ];
    function prefill() { for (const [input, key] of contact) if (!input.value && customer?.[key]) input.value = String(customer[key]); }
    nav(contactSection, () => go(issueStep()), () => {
      const invalid = contact.map(([input]) => input).find(input => !input.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      go(3);
    });

    // Step 4: collect the fields needed for this request.
    chosenLine(contactSection);
    const requestSection = section('Your request', '', 'Request');
    chosenLine(requestSection);
    const requestTitle = requestSection.querySelector('h3');
    const requestText = requestSection.querySelector('p');
    requestSection.append(fields);
    let current = null;
    const trap = field(controls, 'website', 'Leave this blank', { optional: true });
    trap.parentElement.className = 'help-desk-trap';
    trap.tabIndex = -1;
    trap.autocomplete = 'off';
    const reviewSection = section('Review and submit', 'Check your request before sending it to our team.', 'Review');
    chosenLine(reviewSection);
    reviewSection.append(review);
    const requestBack = nav(requestSection, () => (stageBack ? stageBack() : go(known ? issueStep() : 2)), () => {
      if (!current) { message('Choose the issue that best describes your request.', true); return; }
      // The flow's own check first (the item comes first on the screen), then the fields.
      if (nextCheck && !nextCheck()) return;
      const invalid = [...requestSection.querySelectorAll('input, select, textarea')].find(input => input.willValidate && !input.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      if (current?.flow === 'international' && !selected.size) { message('Select at least one product.', true); return; }
      updateReview();
      go(4);
    });
    const requestNav = requestSection.querySelector('.help-desk-nav');
    const requestNext = requestNav.lastElementChild;
    // A check's answer (order status, shipping options, can this order change?)
    // opens as a screen of its own within the request step:
    // ask: the inputs and the Check button; answer: only the answer, with its
    // own Back and next action; request: what to send. Back walks back through them.
    let stageBack = null;
    // A flow's own check before Review (null: none).
    let nextCheck = null;
    function stage(name, title = '', text = '', back = null) {
      fields.dataset.stage = name;
      stageBack = back;
      // An answer screen has its own Back.
      requestNav.hidden = requestBack.hidden = name === 'answer';
      requestTitle.textContent = title || current?.label || 'Your request';
      requestText.textContent = title ? text : current?.description || 'A few details and we’ll take it from here.';
      if (form.isConnected) {
        if (form.getBoundingClientRect().top < 0) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        requestTitle.focus({ preventScroll: true });
      }
    }
    // An answer screen: what was found, then Back and the next action.
    function answerScreen(back, next, nextLabel, prompt) {
      const screen = node('div', '', { class: 'help-desk-answer', 'data-part': 'answer' });
      const result = node('div', '', { class: 'help-desk-track-result', 'aria-live': 'polite' });
      const actions = node('div', '', { class: 'help-desk-answer-actions' });
      const previous = node('button', 'Back', { type: 'button', class: 'help-desk-secondary' });
      const forward = node('button', nextLabel, { type: 'button' });
      previous.onclick = back;
      forward.onclick = next;
      const text = node('div');
      if (prompt) text.append(node('strong', prompt[0]), node('span', prompt[1]));
      actions.append(previous, text, forward);
      screen.append(result, actions);
      return { screen, result };
    }
    const submit = node('button', 'Submit Request', { type: 'submit' });
    const footer = node('div', '', { class: 'help-desk-footer' });
    backButton(reviewSection, () => go(3));
    footer.append(node('p', 'You’ll get a private page to follow your request and reply to our team.'), submit);
    reviewSection.append(footer);
    if (known) progress.children[2].hidden = true;
    go(0);
    // Signed in: who, and that their details are filled in.
    if (customer) {
      const who = customer.name || customer.email;
      const signed = node('div', '', { class: 'help-desk-signed' });
      const initials = String(who).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('');
      const text = node('div');
      text.append(node('small', 'Signed in as', { class: 'help-desk-signed-label' }), node('strong', who), node('span', `Your details${orders.length ? ' and recent orders' : ''} have been added for you.`));
      signed.append(node('span', initials, { class: 'help-desk-avatar', 'aria-hidden': 'true' }), text);
      aside.prepend(signed);
    }
    form.append(aside, controls);
    prefill();
    // Signed-in customers' earlier requests, each linking to its private request page.
    const history = Array.isArray(config.tickets) && config.tickets.length ? node('details', '', { class: 'help-desk-history' }) : null;
    if (history) {
      const summary = node('summary');
      const waiting = config.tickets.filter(ticket => ticket.status === 'Waiting on customer').length;
      summary.append(node('span', 'Your requests'), node('span', String(config.tickets.length), { class: 'help-desk-count', 'aria-label': `${config.tickets.length} requests` }));
      if (waiting) summary.append(node('span', `${waiting} waiting on you`, { class: 'help-desk-pill', 'data-status': 'Waiting on customer' }));
      history.append(summary);
      const list = node('ul');
      const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
      for (const ticket of config.tickets) {
        const item = node('li');
        const link = node('a', `#${ticket.number} · ${ticket.topic}`, { href: trackingLink(ticket.token) });
        item.append(link, node('span', ticket.status, { class: 'help-desk-pill', 'data-status': ticket.status }));
        // A cancellation request also shows where the cancellation stands.
        if (ticket.cancelStatus) item.append(node('span', `Cancellation: ${ticket.cancelStatus}`, { class: 'help-desk-pill', 'data-cancel': ticket.cancelStatus }));
        if (ticket.addressStatus) item.append(node('span', `Address change: ${ticket.addressStatus}`, { class: 'help-desk-pill', 'data-cancel': ticket.addressStatus === 'Updated' ? 'Cancelled' : ticket.addressStatus }));
        item.append(node('small', `Updated ${date.format(new Date(ticket.updatedAt))}`));
        list.append(item);
      }
      history.append(list);
      history.open = config.tickets.some(ticket => ticket.status === 'Waiting on customer');
      // Who's signed in first, then their requests, then the form.
      aside.append(history);
    }
    root.querySelector('[data-help-desk-form]').replaceChildren(form);
    message('', false, false);

    // A drop zone over the native file input; picks add to the chosen images,
    // which show as thumbnails that can be removed before submitting.
    function imageField(parent, required, name = 'images') {
      const types = ['image/jpeg', 'image/png', 'image/webp'];
      const wrap = node('div', '', { class: 'help-desk-upload' });
      const label = node('label');
      const title = node('span');
      const drop = node('span', '', { class: 'help-desk-drop' });
      const upload = node('input', '', { type: 'file', name, accept: types.join(','), multiple: '' });
      const previews = node('div', '', { class: 'help-desk-previews' });
      drop.append(node('span', '', { class: 'help-desk-drop-icon', 'aria-hidden': 'true' }), node('strong', 'Upload photos'), node('small', 'JPG, PNG, WebP · up to 5, max 10 MB each'), upload);
      label.append(title, drop);
      wrap.append(label, previews);
      parent.append(wrap);
      let files = [];
      let urls = [];
      function sync() {
        const transfer = new DataTransfer();
        files.forEach(file => transfer.items.add(file));
        upload.files = transfer.files;
        upload.setCustomValidity(files.length > 5 || files.some(file => !types.includes(file.type) || !file.size || file.size > 10 * 1024 * 1024)
          ? 'Choose up to five JPG, PNG or WebP images, no more than 10 MB each.' : '');
        urls.forEach(url => URL.revokeObjectURL(url));
        urls = files.map(file => URL.createObjectURL(file));
        previews.replaceChildren(...files.map((file, index) => {
          const item = node('figure', '', { class: file.size > 10 * 1024 * 1024 || !types.includes(file.type) ? 'help-desk-invalid' : '' });
          const remove = node('button', '×', { type: 'button', 'aria-label': `Remove ${file.name}` });
          remove.onclick = () => { files.splice(index, 1); sync(); };
          item.append(node('img', '', { src: urls[index], alt: '' }), node('figcaption', file.name), remove);
          return item;
        }));
        drop.dataset.count = files.length ? `${files.length} of 5 selected` : '';
      }
      upload.onchange = () => {
        for (const file of upload.files) if (!files.some(item => item.name === file.name && item.size === file.size)) files.push(file);
        sync();
      };
      for (const [type, active] of [['dragenter', true], ['dragover', true], ['dragleave', false], ['drop', false]]) upload.addEventListener(type, () => drop.classList.toggle('help-desk-dragging', active));
      upload.setRequired = value => {
        upload.required = value;
        title.replaceChildren('Photos ', value ? node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }) : '(optional)');
      };
      upload.setRequired(required);
      return upload;
    }

    // One optional video in any common format (phones record MOV, MP4 or 3GP;
    // cameras AVI, MKV or MTS), checked here and by its bytes on the server.
    // Browsers don't always know a video's type, so its extension counts too.
    const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'mov', 'qt', '3gp', '3g2', 'webm', 'mkv', 'avi', 'wmv', 'asf', 'mpg', 'mpeg', 'm2v', 'ts', 'mts', 'm2ts', 'flv'];
    const isVideo = file => file.type.startsWith('video/') || VIDEO_EXTENSIONS.includes(file.name.split('.').pop().toLowerCase());
    function videoField(parent, hint, fieldName = 'videos') {
      const wrap = node('div', '', { class: 'help-desk-upload help-desk-video' });
      const label = node('label');
      const drop = node('span', '', { class: 'help-desk-drop' });
      const input = node('input', '', { type: 'file', name: fieldName, accept: ['video/*', ...VIDEO_EXTENSIONS.map(extension => `.${extension}`)].join(',') });
      const name = node('strong', 'Upload a video');
      drop.append(node('span', '', { class: 'help-desk-drop-icon', 'aria-hidden': 'true' }), name, node('small', `Any video format · 1 video, max 50 MB${hint ? ` · ${hint}` : ''}`), input);
      label.append(node('span', 'Video (optional)'), drop);
      // Outside the label, so it doesn't open the file picker again.
      const remove = node('button', 'Remove video', { type: 'button', class: 'help-desk-link help-desk-remove-video', hidden: '' });
      wrap.append(label, remove);
      parent.append(wrap);
      input.onchange = () => {
        const file = input.files?.[0];
        input.setCustomValidity(file && (!isVideo(file) || file.size > 50 * 1024 * 1024) ? 'Choose a video file, up to 50 MB.' : '');
        name.textContent = file ? file.name : 'Upload a video';
        drop.dataset.count = file ? 'Video selected' : '';
        remove.hidden = !file;
      };
      remove.onclick = () => {
        input.value = '';
        input.onchange();
        input.focus();
      };
      return input;
    }
    // Product thumbnails: theme-rendered URLs are already small; search results get a width hint.
    function sized(url) {
      if (!url) return '';
      try { const target = new URL(url, location.origin); target.searchParams.set('width', '120'); return target.href; } catch { return ''; }
    }
    function thumb(src) {
      return src ? node('img', '', { src, alt: '', loading: 'lazy', class: 'help-desk-thumb' }) : node('span', '', { class: 'help-desk-thumb', 'aria-hidden': 'true' });
    }

    // Signed-in customers pick from their orders (or type another number); the
    // chosen order's items are shown and passed to onPick. include narrows the list.
    function orderField(parent, onPick, include = () => true, showItems = true) {
      // Orders that suit this query come first; when none do, all orders are
      // offered rather than asking a signed-in customer to type a number.
      const matching = orders.filter(include);
      const choices = matching.length ? matching : orders;
      if (!choices.length) {
        const input = field(parent, 'orderNumber', 'Order Number', { placeholder: 'e.g. #1001' });
        if (!signedIn) {
          const hint = node('p', 'Sign in to select from your recent orders. ', { class: 'help-desk-hint' });
          hint.append(node('a', 'Sign in', { href: signInLink(root) }));
          parent.append(hint);
        }
        return input;
      }
      const count = order => items(order).reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
      const pick = field(parent, 'orderNumber', 'Order Number', {
        choices: [...choices.map(order => [order.name, `${order.name} · ${order.date} · ${count(order)} item${count(order) === 1 ? '' : 's'}`]), ['', 'My order is not listed']],
      });
      pick.lastElementChild.value = 'other';
      const extra = node('div', '', { 'data-fields': '' });
      parent.append(extra);
      pick.onchange = () => {
        extra.replaceChildren();
        pick.name = pick.value === 'other' ? '' : 'orderNumber';
        if (pick.value === 'other') { field(extra, 'orderNumber', 'Enter Order Number', { placeholder: 'e.g. #1001' }); onPick?.(null); return; }
        const order = choices.find(entry => entry.name === pick.value);
        if (!order) return onPick?.(null);
        if (!showItems) return onPick?.(order);
        const list = node('div', '', { class: 'help-desk-order-items' });
        for (const item of items(order)) {
          const row = node('div');
          const text = node('span', item.title);
          text.append(node('small', [item.variant, `Qty ${item.quantity || 1}`].filter(Boolean).join(' · ')));
          row.append(thumb(item.image), text);
          list.append(row);
        }
        extra.append(list);
        onPick?.(order);
      };
      // Preselect the most recent matching order so signed-in customers don't have to pick or type one.
      pick.value = choices[0].name;
      pick.onchange();
      return pick;
    }

    // The store's products, with the signed-in customer's ordered products first.
    function catalog() {
      const products = Array.from(root.querySelector('[data-help-desk-products]').options).map(option => ({ id: option.value, title: option.textContent, image: option.dataset.image || '' }));
      const ordered = new Map();
      for (const item of orders.flatMap(items)) if (item.id && !ordered.has(item.id)) ordered.set(item.id, { id: item.id, title: item.title, image: item.image, ordered: true });
      return [...ordered.values(), ...products.filter(product => !ordered.has(product.id))];
    }

    // Multi-select product list. With a fixed source (one order's items) it's
    // a list to tick; otherwise a search box that suggests products as the
    // customer types, and each one picked shows as a chip below.
    function productPicker(parent, title = 'Select Products', source = null, selection = selected, options = {}) {
      if (!source) return productSearch(parent, title, selection, () => {}, options);
      const dropdown = node('details');
      const summary = node('summary');
      const results = node('div', '', { class: 'help-desk-results' });
      const chips = node('div', '', { class: 'help-desk-selected' });
      dropdown.append(summary, node('p', 'Choose the products from this order.'), results);
      dropdown.open = true;
      parent.append(dropdown, chips);
      function render() {
        summary.textContent = `${title} * (${selection.size} selected)`;
        results.replaceChildren();
        chips.replaceChildren();
        for (const product of source) {
          const label = node('label', '', { class: 'help-desk-choice' });
          const checkbox = node('input', '', { type: 'checkbox' });
          checkbox.checked = selection.has(product.id);
          checkbox.onchange = () => { if (checkbox.checked) selection.set(product.id, product); else selection.delete(product.id); render(); };
          label.append(checkbox, thumb(product.image), node('span', product.title));
          results.append(label);
        }
        for (const [id, { title: name, image }] of selection) {
          const remove = node('button', '', { type: 'button', 'aria-label': `Remove ${name}` });
          remove.append(thumb(image), node('span', name), node('span', '×', { 'aria-hidden': 'true' }));
          remove.onclick = () => { selection.delete(id); render(); };
          chips.append(remove);
        }
      }
      render();
    }
    // Type a name, pick from the suggestions: the theme's products match
    // straight away, then the store's search adds the rest.
    // chips: false when the caller shows the picked products itself.
    // quantities: each picked product is a row with how many they want.
    function productSearch(parent, title, selection, onChange = () => {}, { chips: showChips = true, required = true, quantities = false } = {}) {
      const wrap = node('div', '', { class: 'help-desk-product-search' });
      const input = field(wrap, '', title, { type: 'search', optional: true, placeholder: 'Start typing a product name' });
      if (required) input.parentElement.querySelector('span').append(' ', node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }));
      input.autocomplete = 'off';
      const list = node('ul', '', { class: 'help-desk-suggestions', role: 'listbox', hidden: '' });
      const chips = node('div', '', { class: quantities ? 'help-desk-quantities' : 'help-desk-selected' });
      wrap.append(list);
      parent.append(wrap, chips);
      const local = catalog();
      let version = 0, timer;
      const close = () => { list.hidden = true; list.replaceChildren(); };
      const show = products => {
        list.replaceChildren();
        for (const product of products.filter(entry => !selection.has(entry.id)).slice(0, 8)) {
          const item = node('li', '', { role: 'option', tabindex: '-1' });
          item.append(thumb(product.image), node('span', product.title));
          // mousedown, so it's picked before the box loses focus.
          item.onmousedown = event => { event.preventDefault(); add(product); };
          item.onclick = () => add(product);
          list.append(item);
        }
        if (!list.childElementCount) list.append(node('li', 'No products found. Try another name.', { class: 'help-desk-suggestions-empty' }));
        list.hidden = false;
      };
      chips.hidden = !showChips;
      // A product row: its picture and name, how many (− and +, or typed), and Remove.
      const quantityRow = (id, product) => {
        const row = node('div', '', { class: 'help-desk-quantity-row' });
        const stepper = node('div', '', { class: 'help-desk-stepper', role: 'group', 'aria-label': `Quantity of ${product.title}` });
        const less = node('button', '−', { type: 'button', 'aria-label': 'One less' });
        const more = node('button', '+', { type: 'button', 'aria-label': 'One more' });
        const count = node('input', '', { type: 'number', min: '1', max: '99', inputmode: 'numeric', 'aria-label': `Quantity of ${product.title}` });
        const set = value => {
          product.qty = Math.min(99, Math.max(1, Math.trunc(Number(value)) || 1));
          count.value = String(product.qty);
          less.disabled = product.qty <= 1;
          more.disabled = product.qty >= 99;
          onChange();
        };
        less.onclick = () => set((product.qty || 1) - 1);
        more.onclick = () => set((product.qty || 1) + 1);
        count.onchange = () => set(count.value);
        stepper.append(less, count, more);
        const remove = node('button', '×', { type: 'button', class: 'help-desk-quantity-remove', 'aria-label': `Remove ${product.title}` });
        remove.onclick = () => { selection.delete(id); chipsRender(); onChange(); };
        row.append(thumb(product.image), node('span', product.title, { class: 'help-desk-quantity-name' }), stepper, remove);
        count.value = String(product.qty || 1);
        less.disabled = (product.qty || 1) <= 1;
        return row;
      };
      const chipsRender = () => {
        chips.replaceChildren();
        if (quantities) {
          if (selection.size) chips.append(node('div', 'How many of each?', { class: 'help-desk-quantity-title' }));
          for (const [id, product] of selection) chips.append(quantityRow(id, product));
          return;
        }
        for (const [id, { title: name, image }] of selection) {
          const remove = node('button', '', { type: 'button', 'aria-label': `Remove ${name}` });
          remove.append(thumb(image), node('span', name), node('span', '×', { 'aria-hidden': 'true' }));
          remove.onclick = () => { selection.delete(id); chipsRender(); onChange(); };
          chips.append(remove);
        }
      };
      function add(product) {
        selection.set(product.id, quantities ? { ...product, qty: 1 } : product);
        input.value = '';
        close();
        chipsRender();
        onChange();
        input.focus();
      }
      input.oninput = () => {
        const query = input.value.trim().toLowerCase();
        clearTimeout(timer);
        const current = ++version;
        if (query.length < 2) { close(); return; }
        const matches = local.filter(product => product.title.toLowerCase().includes(query));
        show(matches);
        timer = setTimeout(async () => {
          try {
            const base = window.Shopify?.routes?.root || '/';
            const params = new URLSearchParams({ q: query, 'resources[type]': 'product', 'resources[limit]': '8', 'resources[options][unavailable_products]': 'show' });
            const response = await fetch(`${base}search/suggest.json?${params}`);
            if (!response.ok) return;
            const found = (await response.json()).resources.results.products.map(product => ({ id: `gid://shopify/Product/${product.id}`, title: product.title, image: sized(product.featured_image?.url || product.image) }));
            if (current !== version) return;
            show([...matches, ...found.filter(product => !matches.some(entry => entry.id === product.id))]);
          } catch { /* the theme's matches stay */ }
        }, 250);
      };
      input.onkeydown = event => {
        if (event.key === 'Escape') close();
        if (event.key === 'Enter') {
          event.preventDefault();
          list.querySelector('[role=option]')?.click();
        }
      };
      input.onblur = () => setTimeout(close, 150);
      chipsRender();
    }

    // A required question answered with one of a few cards: entries are
    // [value, title, hint?]; nothing is picked to start with. review: its label on Review.
    function choiceCards(parent, name, title, entries, onPick = () => {}, review = '') {
      const set = node('fieldset', '', { class: `help-desk-choices${entries.some(entry => entry[2]) ? '' : ' help-desk-choices-compact'}` });
      const legend = node('legend', `${title} `);
      legend.append(node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }));
      set.append(legend);
      for (const [value, label, hint] of entries) {
        const card = node('label', '', { class: 'help-desk-choice-card' });
        const radio = node('input', '', { type: 'radio', name, value, required: '' });
        if (review) radio.dataset.review = review;
        const text = node('span');
        text.append(node('strong', label));
        if (hint) text.append(node('small', hint));
        card.append(radio, text);
        radio.onchange = () => onPick(value);
        set.append(card);
      }
      parent.append(set);
      return set;
    }
    // A quantity box, 1 up to max.
    function quantityField(parent, name, label, max) {
      const input = field(parent, name, label, { type: 'number' });
      // inputMode: a number pad on phones.
      Object.assign(input, { min: 1, max, value: '1', inputMode: 'numeric' });
      return input;
    }

    // Products from orders, once each (the newest order's copy).
    function orderedProducts(list) {
      const unique = new Map();
      for (const item of list) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
      return [...unique.values()];
    }
    // Product cards to pick from (shared by the product issue flows). Each one
    // picked expands into its own box right under it, which fill(box, product, id)
    // fills in, so every note, photo and video belongs to one product. Nothing is
    // picked to start with. search: also search the store for a product not listed.
    // tips: a line shown above the cards once something is picked.
    function productCards(parent, choices, title, fill, { search = true, tips = null } = {}) {
      const boxes = new Map();
      const cards = new Map();
      const rows = node('div', '', { class: 'help-desk-items help-desk-items-stack' });
      const refresh = () => {
        for (const [id, box] of boxes) if (!selected.has(id)) { box.remove(); boxes.delete(id); }
        for (const [id, product] of selected) {
          if (!cards.has(id)) addCard(product);
          if (boxes.has(id)) continue;
          const box = node('section', '', { class: 'help-desk-product-issue', 'aria-label': product.title });
          const head = node('div', '', { class: 'help-desk-product-issue-head' });
          head.append(thumb(product.image), node('strong', product.title));
          box.append(head, node('input', '', { type: 'hidden', name: `itemTitle:${id}`, value: product.title }));
          fill(box, product, id);
          boxes.set(id, box);
          cards.get(id).parentElement.append(box);
        }
        for (const [id, card] of cards) {
          card.setAttribute('aria-pressed', String(selected.has(id)));
          card.parentElement.toggleAttribute('data-open', selected.has(id));
        }
        if (tips) tips.hidden = !selected.size;
      };
      function addCard(item) {
        const row = node('div', '', { class: 'help-desk-item-row' });
        const card = node('button', '', { type: 'button', class: 'help-desk-item', 'aria-pressed': 'false' });
        const text = node('span');
        text.append(node('strong', item.title));
        const detail = [item.variant, item.quantity && `Qty ${item.quantity}`].filter(Boolean).join(' · ');
        if (detail) text.append(node('small', detail));
        card.append(thumb(item.image), text, node('span', '', { class: 'help-desk-check', 'aria-hidden': 'true' }));
        card.onclick = () => {
          if (selected.has(item.id)) selected.delete(item.id); else selected.set(item.id, { id: item.id, title: item.title, image: item.image, variant: item.variant || '', quantity: Number(item.quantity) || 0 });
          refresh();
        };
        row.append(card);
        rows.append(row);
        cards.set(item.id, card);
      }
      if (choices.length) {
        const group = node('div', '', { class: 'help-desk-pick', role: 'group', 'aria-label': title });
        const heading = node('span', `${title} `, { class: 'help-desk-pick-title' });
        heading.append(node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }));
        group.append(heading);
        if (choices.length > 1) group.append(node('p', 'Select all that apply.', { class: 'help-desk-hint' }));
        if (tips) group.append(tips);
        choices.forEach(addCard);
        group.append(rows);
        parent.append(group);
        if (search) productSearch(parent, 'Search other products', selected, refresh, { chips: false, required: false });
      } else {
        productSearch(parent, title, selected, refresh, { chips: false });
        if (tips) parent.append(tips);
        parent.append(rows);
      }
      refresh();
    }

    // Self-service answers (order status, shipping times): the customer checks
    // first and only sends a request if that doesn't answer their question.
    // ask() gives the endpoint's parameters (or nothing to stop), render() shows
    // the answer (false: there's none), request() adds the request's fields.
    function selfCheck(label, ask, render, request, unavailable, answerTitle = 'Here\'s what we found', answerText = 'Here’s the latest from our records.') {
      const panel = node('div', '', { class: 'help-desk-track', 'data-part': 'ask' });
      const check = node('button', label, { type: 'button' });
      panel.append(check);
      // What to send, if the answer doesn't help.
      const more = node('div', '', { 'data-fields': '', 'data-part': 'request' });
      const asking = () => { stage('ask'); requestNext.hidden = true; };
      const answering = () => { stage('answer', answerTitle, answerText); requestNext.hidden = true; };
      const showRequest = (fromAnswer, error) => {
        // Nothing more to ask (request: null): on to Review, where they send it.
        if (!request) { updateReview(); go(4); return; }
        if (!more.querySelector('[name]')) request(more);
        more.querySelector('.help-desk-track-error')?.remove();
        if (error) more.prepend(node('p', error, { class: 'help-desk-track-error', role: 'alert' }));
        stage('request', '', '', fromAnswer ? answering : asking);
        requestNext.hidden = false;
      };
      const { screen, result } = answerScreen(asking, () => showRequest(true), 'I Still Need Help', ['Didn\'t answer your question?', 'Our team will look into it and reply by email.']);
      fields.append(panel, screen, more);
      requestNext.hidden = true;
      check.onclick = async () => {
        const params = ask();
        if (!params) return;
        if (params.local) { result.replaceChildren(); params.local(result); answering(); return; }
        // Nothing to look up (say, a country we quote by hand): straight to the request.
        if (params.request) { showRequest(false); return; }
        check.disabled = true;
        check.textContent = 'Checking...';
        message('', false, false);
        try {
          const url = new URL(endpoint);
          for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          const data = await response.json();
          result.replaceChildren();
          // No answer to show: the request opens, with why only when there's something to say.
          if (!response.ok || !render(result, data)) { showRequest(false, unavailable === '' ? '' : data.error || unavailable); return; }
          answering();
        } catch (error) {
          console.warn('Help desk: the check failed.', error);
          showRequest(false, unavailable || '');
        } finally {
          check.disabled = false;
          check.textContent = label;
        }
      };
    }
    // Where it ships: the countries with rates set up first (config.shippingCountries),
    // then "Another country", which asks which one. The chosen country's code is sent as `name`.
    const served = Array.isArray(config.shippingCountries) ? config.shippingCountries : ['US', 'CA'];
    function countryPicker(parent, name, label, { only = null, other = true } = {}) {
      const wrap = node('div', '', { class: 'help-desk-country' });
      const ours = countries.filter(entry => served.includes(entry.code) && (!only || only.includes(entry.code)));
      const pick = field(wrap, '', label, { choices: [...ours.map(entry => [entry.code, entry.name]), ...(other ? [['OTHER', 'Another country']] : [])], placeholder: 'Select a country' });
      const input = node('input', '', { type: 'hidden', name });
      const elsewhere = node('div', '', { class: 'help-desk-elsewhere', hidden: '' });
      const which = field(elsewhere, '', 'Which country?', { choices: countries.filter(entry => !served.includes(entry.code)).map(entry => [entry.code, entry.name]), placeholder: 'Select your country' });
      wrap.append(input, elsewhere);
      parent.append(wrap);
      const sync = () => {
        const outside = pick.value === 'OTHER';
        elsewhere.hidden = !outside;
        which.required = outside;
        input.value = outside ? which.value : pick.value;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      pick.addEventListener('change', sync);
      which.addEventListener('change', sync);
      which.required = false;
      return {
        wrap, input, isElsewhere: () => pick.value === 'OTHER',
        set(code) { pick.value = ours.some(entry => entry.code === code) ? code : ''; sync(); },
        name: () => countries.find(entry => entry.code === input.value)?.name || '',
      };
    }
    // Order status: shown only when the order number and email match.
    function trackingCheck(option) {
      selfCheck('Check Order Status', () => {
        const order = String(form.elements.orderNumber?.value || '').trim();
        const email = String(form.elements.email?.value || '').trim();
        if (order && email) return { track: '1', order, email };
        message('Please enter your email address and order number to check your order status.', true);
      }, (result, data) => data.tracking && (renderTracking(result, data.tracking), true),
      more => field(more, 'details', 'How can we help with this order?', { multiline: true, optional: true, placeholder: option.placeholder || 'For example: the tracking has not updated in 5 days.' }),
      'Order status is unavailable right now. Please submit a request below.', 'Your order status');
    }
    // A card in the answer: heading and badge, then a highlighted message.
    function answerCard(parent, tone, heading, badge, title, text) {
      const card = node('div', '', { class: 'help-desk-track-card', 'data-tone': tone });
      const head = node('div', '', { class: 'help-desk-track-head' });
      const name = node('div');
      name.append(node('strong', heading));
      head.append(name, node('span', badge, { class: 'help-desk-track-badge' }));
      const summary = node('div', '', { class: 'help-desk-track-message' });
      summary.append(node('strong', title));
      if (text) summary.append(node('p', text));
      card.append(head, summary);
      parent.append(card);
      return card;
    }
    // Shipping times for a destination, from the store's Shopify rates, and
    // the customer's own order when they gave its number. Dates are calendar
    // days (YYYY-MM-DD), so they're shown in UTC to stay on the same day.
    function renderShipping(parent, data) {
      const ship = data.shipping;
      if (!ship) return false;
      const day = value => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
      const dates = range => range[0] === range[1] ? day(range[0]) : `${day(range[0])} – ${day(range[1])}`;
      const days = range => `${range[0] === range[1] ? range[0] : range.join('–')} business day${range[1] === 1 ? '' : 's'}`;
      const order = data.order;
      if (order) {
        const arrives = order.arrives ? `Expected to arrive ${dates(order.arrives)}.` : '';
        const [tone, badge, title, text] = {
          cancelled: ['critical', 'Cancelled', 'This order was cancelled', 'It won\'t be shipped.'],
          delivered: ['success', 'Delivered', 'Your order has been delivered', order.date ? `Delivered on ${day(order.date)}.` : ''],
          shipped: ['progress', 'Shipped', 'Your order is on its way', arrives || 'Follow your package with the tracking link.'],
          onHold: ['warning', 'On hold', 'Your order is on hold', `We've paused it for a quick check, so its dates may change. ${arrives}`],
          processing: ['progress', 'Processing', 'We\'re getting your order ready', arrives || 'We\'ll email you tracking as soon as it ships.'],
        }[order.status];
        const card = answerCard(parent, tone, `Order ${order.order}${order.method ? ` · ${order.method}` : ''}`, badge, title, text);
        if (order.trackingUrl) card.append(node('a', 'Track Package', { href: order.trackingUrl, target: '_blank', rel: 'noopener', class: 'help-desk-track-link' }));
      }
      if (data.orderError) parent.append(node('p', data.orderError, { class: 'help-desk-track-error' }));
      const state = config.provinces?.[ship.country]?.find(([code]) => code === ship.province)?.[1];
      const place = [state, ship.countryName].filter(Boolean).join(', ');
      // quoted: Shopify's checkout prices for the customer's own products.
      const lead = ship.processing ? [`Orders ship within ${days(ship.processing)}`, `Order today and it leaves us by ${dates(ship.shipsBy)}. Business days are Monday to Friday.`]
        : ['Our shipping options', 'Delivery dates are confirmed at checkout.'];
      if (ship.quoted) lead[1] = `Live prices for your products from our checkout. ${lead[1]}`;
      const card = ship.ships
        ? answerCard(parent, 'progress', `Shipping to ${place}`, ship.quoted ? 'Your products' : 'We ship here', ...lead)
        : answerCard(parent, 'progress', `Shipping to ${place}`, 'Quote', `We ship to ${ship.countryName}`, 'Prices aren\'t shown online for this country. Select "I Still Need Help" and our team will reply with a shipping quote.');
      const list = node('ul', '', { class: 'help-desk-ship-rates' });
      for (const rate of ship.rates) {
        const item = node('li');
        const what = node('div');
        what.append(node('strong', rate.name), node('small', [rate.price, rate.condition].filter(Boolean).join(' · ')));
        const when = node('div');
        when.append(node('strong', rate.arrives ? dates(rate.arrives) : 'Shown at checkout'), node('small', rate.days ? `${days(rate.days)} in transit` : 'Delivery time'));
        item.append(what, when);
        list.append(item);
      }
      if (ship.rates.length) card.append(list);
      if (ship.note) card.append(node('p', ship.note, { class: 'help-desk-hint' }));
      return true;
    }
    // Cancel Order and Modify Address: the app checks the order (number and
    // email must match) and the request's fields open only if it can still
    // change; otherwise the customer sees why. Changing the order closes them again.
    function orderGate(kind, reveal) {
      const area = node('div', '', { 'data-fields': '', 'data-part': 'ask' });
      orderField(area, null, order => order.fulfillment !== 'fulfilled' && order.fulfillment !== 'partial');
      const panel = node('div', '', { class: 'help-desk-track', 'data-part': 'ask' });
      const check = node('button', 'Continue', { type: 'button' });
      const result = node('p', '', { class: 'help-desk-track-error', role: 'alert', hidden: '' });
      const more = node('div', '', { 'data-fields': '', 'data-part': 'request' });
      panel.append(check, result);
      fields.append(area, panel, more);
      requestNext.hidden = true;
      const close = () => { more.replaceChildren(); panel.hidden = false; requestNext.hidden = true; stage('ask'); };
      for (const type of ['input', 'change']) area.addEventListener(type, () => { if (more.childElementCount) close(); result.hidden = true; });
      check.onclick = async () => {
        const orderNumber = String(area.querySelector('[name=orderNumber]')?.value || '').trim();
        const email = String(form.elements.email?.value || '').trim();
        const show = text => { result.textContent = text; result.hidden = false; };
        if (!orderNumber || !email) { show('Please enter your email address and order number first.'); return; }
        check.disabled = true;
        check.textContent = 'Checking your order...';
        try {
          const url = new URL(endpoint);
          url.searchParams.set('check', kind);
          url.searchParams.set('order', orderNumber);
          url.searchParams.set('email', email);
          const data = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
          if (!data.allowed) { show(data.error || 'We couldn\'t check your order right now. Please try again in a moment.'); return; }
          result.hidden = true;
          // The order checked out: say so, then its fields, as the next screen.
          const verified = node('div', '', { class: 'help-desk-verified' });
          verified.append(node('strong', `Order ${orderNumber}`), node('span', kind === 'cancel' ? 'This order hasn\'t shipped yet, so you can send a cancellation request.' : 'This order\'s address can still be changed.'));
          more.append(verified);
          reveal(more, data.country || '');
          stage('request', '', '', close);
          requestNext.hidden = false;
        } catch { show('We couldn\'t check your order right now. Please try again in a moment.'); }
        finally { check.disabled = false; check.textContent = 'Continue'; }
      };
    }
    // The order's progress: Ordered, Processing, Shipped, Out for delivery, Delivered.
    const TRACK_STEPS = ['Ordered', 'Processing', 'Shipped', 'Out for delivery', 'Delivered'];
    // Which step a carrier status reaches, and whether it's a delivery problem.
    function shipmentStep(status) {
      if (['DELIVERED', 'PICKED_UP'].includes(status)) return { step: 4 };
      if (status === 'OUT_FOR_DELIVERY') return { step: 3 };
      if (['ATTEMPTED_DELIVERY', 'NOT_DELIVERED', 'FAILURE'].includes(status)) return { step: 3, problem: true };
      if (['LABEL_PRINTED', 'LABEL_PURCHASED', 'SUBMITTED', 'LABEL_VOIDED'].includes(status)) return { step: 1, label: true };
      return { step: 2 };
    }
    function renderTracking(parent, tracking) {
      const long = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
      const short = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
      const format = (value, formatter = long) => { const time = Date.parse(value || ''); return time ? formatter.format(new Date(time)) : ''; };
      // The order is only as far along as its slowest package.
      const progress = tracking.shipments.map(shipment => ({ shipment, ...shipmentStep(shipment.status) }));
      const slowest = progress.reduce((low, entry) => (!low || entry.step < low.step ? entry : low), null);
      const problem = progress.find(entry => entry.problem);
      const lead = problem || slowest;
      const shipment = lead?.shipment;
      const carrier = shipment?.carrier || 'the carrier';
      const help = 'select "I Still Need Help" below';

      // tone colours the badge and progress bar; step is the current step.
      let tone = 'progress', badge, title, text, step = lead ? lead.step : 1;
      if (tracking.cancelled) {
        tone = 'critical'; badge = 'Cancelled'; title = 'This order was cancelled';
        text = `If you have a question about this cancellation or a refund, ${help}.`;
      } else if (problem) {
        tone = 'critical'; badge = shipment.label || 'Delivery problem'; title = `${carrier[0].toUpperCase()}${carrier.slice(1)} couldn't deliver your package`;
        text = `Check the tracking for next steps from ${carrier}, or ${help} and we'll help.`;
      } else if (!tracking.shipped) {
        if (tracking.onHold) {
          tone = 'warning'; badge = 'On hold'; title = 'Your order is on hold';
          text = 'We\'ve paused this order for a quick check. Our team will email you if we need anything.';
        } else {
          badge = 'Processing'; title = 'We\'re getting your order ready';
          text = 'Your order hasn\'t shipped yet. We\'ll email you a shipping confirmation with tracking as soon as it\'s on its way.';
        }
      } else if (step === 4) {
        tone = 'success'; badge = 'Delivered'; title = 'Your order has been delivered';
        const when = format(shipment.deliveredAt);
        text = `${when ? `Delivered on ${when}. ` : ''}Can't find it? Check around your door, mailbox and with neighbours. If it's still missing, ${help}.`;
      } else if (step === 3) {
        badge = 'Out for delivery'; title = 'Your package is out for delivery';
        text = `${carrier[0].toUpperCase()}${carrier.slice(1)} is delivering your package today. Make sure someone can receive it if a signature is needed.`;
      } else if (lead.label) {
        badge = 'Label created'; title = 'Your order is packed and ready to ship';
        text = `A shipping label has been created. Tracking will update once ${carrier} scans your package.`;
      } else {
        badge = 'In transit'; title = 'Your order is on its way';
        const expected = format(shipment.estimatedAt);
        text = expected ? `Estimated delivery: ${expected}.` : 'Follow your package with the tracking details below.';
      }
      if (progress.length > 1) text += ` Your order is shipping in ${progress.length} packages.`;

      const card = node('div', '', { class: 'help-desk-track-card', 'data-tone': tone });
      const head = node('div', '', { class: 'help-desk-track-head' });
      const heading = node('div');
      heading.append(node('strong', `Order ${tracking.order}`));
      if (format(tracking.placedAt)) heading.append(node('small', `Placed ${format(tracking.placedAt)}`));
      head.append(heading, node('span', badge, { class: 'help-desk-track-badge' }));
      const summary = node('div', '', { class: 'help-desk-track-message' });
      summary.append(node('strong', title), node('p', text));
      card.append(head, summary);

      if (!tracking.cancelled) {
        // Dates under the steps where Shopify has them.
        const dates = [format(tracking.placedAt, short), '', format(shipment?.shippedAt, short), step === 3 && !problem ? 'Today' : '',
          step === 4 ? format(shipment?.deliveredAt, short) : format(shipment?.estimatedAt, short) && `Est. ${format(shipment.estimatedAt, short)}`];
        const steps = node('ol', '', { class: 'help-desk-track-steps', style: `--hd-track-progress: ${step / (TRACK_STEPS.length - 1)}` });
        TRACK_STEPS.forEach((name, index) => {
          const state = index < step || step === 4 ? 'done' : index === step ? 'current' : 'upcoming';
          const item = node('li', '', { 'data-step': String(index), 'data-state': state, ...(state === 'current' ? { 'aria-current': 'step' } : {}) });
          item.append(node('span', '', { class: 'help-desk-track-dot', 'aria-hidden': 'true' }), node('span', name));
          if (dates[index]) item.append(node('small', dates[index]));
          steps.append(item);
        });
        card.append(steps);
      }

      for (const [index, entry] of progress.entries()) {
        const { carrier: name, number, url } = entry.shipment;
        const box = node('div', '', { class: 'help-desk-track-package' });
        const info = node('div');
        info.append(node('small', progress.length > 1 ? `Package ${index + 1} of ${progress.length} · ${entry.shipment.label}` : name ? `Shipped with ${name}` : 'Tracking'));
        info.append(number ? node('strong', number) : node('span', 'Tracking details aren\'t available for this shipment.'));
        if (number && progress.length > 1 && name) info.firstChild.textContent += ` · ${name}`;
        box.append(info);
        if (url) box.append(node('a', 'Track Package', { href: url, target: '_blank', rel: 'noopener', class: 'help-desk-track-link' }));
        card.append(box);
      }
      parent.append(card);
    }

    // Fields for each kind of request, after the customer picks an option.
    const flows = {
      // Where is my order, partial or missing deliveries, faster shipping.
      delivery(option) {
        orderField(fields, null, () => true);
        if (option.selfService === 'tracking') { trackingCheck(option); return; }
        const required = Boolean(option.detailsLabel);
        field(fields, 'details', required ? option.detailsLabel : 'Additional Details (optional)', { multiline: true, optional: !required, placeholder: option.placeholder || 'For example: the tracking status shown, or which items have not arrived.' });
      },
      // Changes to an order that hasn't shipped yet.
      orderUpdate(option) {
        orderField(fields, null, order => order.fulfillment !== 'fulfilled');
        field(fields, 'details', option.detailsLabel || 'Request Details', { multiline: true, placeholder: option.placeholder || '' });
      },
      // Cancelling the whole order before it ships: the order, why, and anything else.
      // The team approves or rejects it; the request page shows where it stands.
      cancel(option) {
        const notice = node('div', '', { class: 'help-desk-cancel-notice', role: 'note' });
        notice.append(node('strong', 'This sends a cancellation request. It doesn\'t cancel your order.'), node('span', 'Our team reviews every request and cancels the whole order only if it hasn\'t shipped yet. Enter your order number and continue: we\'ll check your order first. You can follow the request (Pending, Approved, Rejected or Cancelled) on your request page.'));
        fields.append(notice);
        orderGate('cancel', more => {
          const reason = field(more, 'cancelReason', 'Reason for Cancellation', { choices: cancelReasons, placeholder: 'Select a reason' });
          const extra = node('div', '', { 'data-fields': '' });
          more.append(extra);
          // "Other" needs a few words; any other reason can add a note.
          const details = () => {
            const other = reason.value === 'Other';
            const value = extra.querySelector('textarea')?.value || '';
            extra.replaceChildren();
            field(extra, 'details', other ? 'Tell Us Why' : 'Additional Details (optional)', { multiline: true, optional: !other, placeholder: other ? 'Please tell us why you\'d like to cancel.' : option.placeholder || '' }).value = value;
          };
          reason.onchange = details;
          details();
        });
      },
      // A new shipping address, part by part, so the team can update the order in Shopify.
      address(option) {
        const notice = node('div', '', { class: 'help-desk-cancel-notice', role: 'note' });
        notice.append(node('strong', 'When can the address be changed?'), node('span', 'Only before your order ships or is packed, and only to an address in the same country. Enter your order number and continue: we\'ll check your order first. Once it has shipped, please contact the carrier to redirect it.'));
        fields.append(notice);
        orderGate('address', (more, country) => {
          const grid = node('div', '', { class: 'help-desk-address', role: 'group', 'aria-label': 'New shipping address' });
          grid.append(node('h4', 'New Shipping Address'));
          more.append(grid);
          const wide = input => input.parentElement.classList.add('help-desk-wide');
          field(grid, 'shipName', 'Recipient Name', { autocomplete: 'shipping name' }).value = customer?.name || '';
          field(grid, 'shipPhone', 'Phone (optional)', { type: 'tel', optional: true, autocomplete: 'shipping tel' });
          wide(field(grid, 'shipAddress1', 'Street Address', { placeholder: 'Start typing your address', autocomplete: 'shipping address-line1' }));
          wide(field(grid, 'shipAddress2', 'Apartment, Suite (optional)', { optional: true, autocomplete: 'shipping address-line2' }));
          // Only the order's own country: a new country means a new order.
          const own = countries.filter(entry => entry.code === country);
          const code = own.length ? country : 'US';
          field(grid, 'shipCity', 'City', { autocomplete: 'shipping address-level2' });
          // A list for countries with states or provinces (codes Shopify accepts), else free text.
          const states = config.provinces?.[code];
          field(grid, 'shipProvince', states ? (code === 'CA' ? 'Province' : 'State') : 'State / Province (optional)', states ? { choices: states } : { optional: true, autocomplete: 'shipping address-level1' });
          field(grid, 'shipZip', 'ZIP / Postal Code', { autocomplete: 'shipping postal-code' });
          const shipCountry = field(grid, 'shipCountry', 'Country', { choices: (own.length ? own : countries).map(entry => [entry.code, entry.name]) });
          shipCountry.value = code;
          addressSuggest(grid, () => shipCountry.value);
          field(more, 'details', option.detailsLabel || 'Anything Else? (optional)', { multiline: true, optional: true, placeholder: option.placeholder || '' });
        });
      },
      // Damaged, defective or missing. First the order (checked with Shopify),
      // then, as the next screen, the products with a problem and, for each,
      // what's wrong and its own photos and video.
      productIssue(option) {
        const area = node('div', '', { 'data-fields': '', 'data-part': 'ask' });
        orderField(area, null, shipped, false);
        const panel = node('div', '', { class: 'help-desk-track', 'data-part': 'ask' });
        const check = node('button', 'Continue', { type: 'button' });
        const note = node('p', '', { class: 'help-desk-track-error', role: 'alert', hidden: '' });
        // An order the app can't see (older than 60 days, say, for a warranty claim): pick the product instead.
        const skip = node('button', 'Continue without it', { type: 'button', class: 'help-desk-secondary', hidden: '' });
        panel.append(check, note, skip);
        const more = node('div', '', { 'data-fields': '', 'data-part': 'request' });
        fields.append(area, panel, more);
        requestNext.hidden = true;
        const wrong = option.flow === 'wrongItem';
        const missing = !wrong && option.preset.issue === issues[2];
        const warranty = option.category === 'Warranty';
        // Damaged or defective: "What happened?" decides, and with it the photo tips.
        let transit = option.category === 'Shipping Damage' && !option.kinds;
        // What they'd like done (values: issueResolutions): a replacement, with the products they want, or a refund.
        const resolutions = [['Replacement', 'Replacement'], ['Refund', 'Refund']]
          .filter(([value]) => !Array.isArray(config.issueResolutions) || config.issueResolutions.includes(value));
        // Each product's own "What would you like?" and, for a replacement, the
        // products wanted instead of it: that product to start with; they can
        // remove it or search for another. Only when the replacement is another
        // product: a wrong colour or quantity is replaced by the variant or count asked above it.
        const resolutionBoxes = new Map();
        function askResolution(box, product, id) {
          const replacements = new Map();
          const replacement = node('input', '', { type: 'hidden', name: `itemReplacement:${id}`, 'data-review': `${product.title} · Replacement` });
          const wanted = node('div', '', { class: 'help-desk-replacement', hidden: '' });
          // A refund: what happens next, so they know what to expect.
          const refundNote = node('p', 'We\'ll review your request and refund to your original payment method. We may ask you to return the item first.', { class: 'help-desk-hint help-desk-refund-note', role: 'note', hidden: '' });
          const sync = () => { replacement.value = [...replacements.values()].map(entry => entry.title).join(', '); };
          const show = () => {
            const value = box.querySelector(`input[name="itemResolution:${id}"]:checked`)?.value;
            refundNote.hidden = value !== 'Refund';
            const open = value === 'Replacement' && (!wrong || wrongKind === 'Wrong product');
            if (open === !wanted.hidden) return;
            replacements.clear();
            wanted.replaceChildren();
            wanted.hidden = !open;
            if (open) {
              replacements.set(id, product);
              productSearch(wanted, 'Add product', replacements, sync, { required: true });
            }
            sync();
          };
          choiceCards(box, `itemResolution:${id}`, 'What would you like?', resolutions, show, `${product.title} · Wants`);
          box.append(refundNote, wanted, replacement);
          resolutionBoxes.set(id, { product, wanted, replacements, show });
        }
        // Wrong item: the answer to "What happened?" (its sub-category) and each product's questions.
        let wrongKind = '';
        const wrongAreas = new Map();
        const variantLists = new Map();
        // A product's variants from the app, fetched once each; null when they couldn't be loaded.
        const loadVariants = id => {
          if (!variantLists.has(id)) {
            const url = new URL(endpoint);
            url.searchParams.set('check', 'variants');
            url.searchParams.set('product', id);
            variantLists.set(id, fetch(url, { headers: { Accept: 'application/json' } }).then(response => response.json())
              .then(data => (Array.isArray(data.variants) ? data.variants : null)).catch(() => null));
          }
          return variantLists.get(id);
        };
        // The variant they want, as Shopify sells it: one row of choices per
        // option (Color, Size...). Values with nothing in stock for what's already
        // picked can't be chosen; the one they ordered is marked. The variant's
        // name goes in itemVariant:<id> for the team.
        function variantPicker(slot, product, id, variants) {
          const names = [...new Set(variants.flatMap(variant => Object.keys(variant.options || {})))];
          // Older answers without options: one row of whole variant names.
          const rows = names.length ? names : ['Option'];
          const optionsOf = variant => (names.length ? variant.options : { Option: variant.title });
          const ordered = variants.find(variant => variant.title === product.variant);
          const chosen = {};
          const hidden = node('input', '', { type: 'hidden', name: `itemVariant:${id}` });
          const wrap = node('div', '', { class: 'help-desk-variants' });
          wrap.append(node('span', 'Which colour or size do you want?', { class: 'help-desk-variants-title' }));
          const inputs = [];
          rows.forEach((name, row) => {
            const set = node('fieldset', '', { class: 'help-desk-variant-row' });
            set.append(node('legend', rows.length > 1 || names.length ? name : 'Choose one'));
            const chips = node('div', '', { class: 'help-desk-variant-chips' });
            for (const value of [...new Set(variants.map(variant => optionsOf(variant)[name]).filter(Boolean))]) {
              const label = node('label', '', { class: 'help-desk-variant-chip' });
              const radio = node('input', '', { type: 'radio', name: `variantOption:${id}:${row}`, value });
              radio.required = true;
              radio.dataset.review = `${product.title} · ${names.length ? name : 'Wants'}`;
              radio.dataset.option = name;
              label.append(radio, node('span', value));
              if (ordered && optionsOf(ordered)[name] === value) label.append(node('small', 'Ordered'));
              chips.append(label);
              inputs.push(radio);
            }
            set.append(chips);
            wrap.append(set);
          });
          // Like a product page: a value nothing in stock has can't be picked; one
          // that doesn't go with what's already chosen is dimmed but can be, and
          // then the choices that don't fit it are cleared.
          const inStock = (name, value, others) => variants.some(variant => variant.available && optionsOf(variant)[name] === value
            && others.every(([other, picked]) => optionsOf(variant)[other] === picked));
          const refresh = () => {
            for (const radio of inputs) {
              const others = Object.entries(chosen).filter(([name]) => name !== radio.dataset.option);
              radio.disabled = !inStock(radio.dataset.option, radio.value, []);
              radio.closest('label').toggleAttribute('data-soldout', !inStock(radio.dataset.option, radio.value, others));
            }
            const match = rows.every(name => chosen[name]) && variants.find(variant => variant.available && rows.every(name => optionsOf(variant)[name] === chosen[name]));
            hidden.value = match ? match.title : '';
          };
          for (const radio of inputs) {
            radio.addEventListener('change', () => {
              chosen[radio.dataset.option] = radio.value;
              for (const other of inputs) {
                const name = other.dataset.option;
                if (name === radio.dataset.option || !other.checked) continue;
                if (!inStock(name, other.value, [[radio.dataset.option, radio.value]])) { other.checked = false; delete chosen[name]; }
              }
              refresh();
            });
          }
          refresh();
          wrap.append(hidden);
          slot.append(wrap);
        }
        // What arrived and, by answer: nothing more (another product is added under
        // Replacement), the variant they wanted, or how many arrived and how many they want.
        function askWrong(area, product, id) {
          const before = area.querySelector('textarea')?.value || '';
          area.replaceChildren();
          const ordered = [product.variant, product.quantity && `Qty ${product.quantity}`].filter(Boolean).join(' · ');
          if (wrongKind === 'Wrong quantity') {
            if (ordered) area.append(node('p', `You ordered: ${ordered}`, { class: 'help-desk-hint' }));
            // Side by side, even on a phone: two short numbers.
            const pair = node('div', '', { class: 'help-desk-pair' });
            area.append(pair);
            const got = field(pair, `itemReceived:${id}`, 'Qty arrived', { type: 'number' });
            Object.assign(got, { min: 0, max: 999, inputMode: 'numeric' });
            got.dataset.review = `${product.title} · Arrived`;
            const want = quantityField(pair, `itemWanted:${id}`, 'Qty you want', 999);
            want.inputMode = 'numeric';
            want.value = String(product.quantity || 1);
            want.dataset.review = `${product.title} · Wants`;
            field(area, `itemNote:${id}`, 'Details (optional)', { multiline: true, optional: true }).dataset.review = product.title;
          } else {
            field(area, `itemNote:${id}`, 'What did you receive instead?', { multiline: true, placeholder: wrongKind === 'Wrong colour or variant' ? 'e.g. Black instead of Blue' : 'e.g. a different case' }).dataset.review = product.title;
            if (wrongKind === 'Wrong colour or variant') {
              if (ordered) area.append(node('p', `You ordered: ${ordered}`, { class: 'help-desk-hint' }));
              // The product's own colours and sizes, option by option, else a few words.
              const slot = node('div', '', { 'data-fields': '' });
              area.append(slot);
              slot.append(node('p', 'Loading colours and sizes...', { class: 'help-desk-hint' }));
              loadVariants(id).then(list => {
                if (!slot.isConnected) return;
                slot.replaceChildren();
                if (list?.some(variant => variant.available)) { variantPicker(slot, product, id, list); return; }
                // One variant only, or everything sold out: a few words instead.
                const single = Boolean(list) && !list.length;
                if (list) slot.append(node('p', single ? 'This product comes in one colour and size only.' : 'Every colour and size of this product is sold out right now. Tell us what you wanted and we\'ll help.', { class: 'help-desk-hint' }));
                field(slot, `itemVariant:${id}`, single ? 'What did you expect instead? (optional)' : 'Which colour or size do you want?', { optional: single, placeholder: 'e.g. Blue, Large' })
                  .dataset.review = `${product.title} · Wants`;
              });
            }
          }
          const note = area.querySelector('textarea');
          if (note && before) note.value = before;
        }
        const purchasePlaces = Array.isArray(config.purchasePlaces) ? config.purchasePlaces : [];
        const back = () => { more.replaceChildren(); selected.clear(); nextCheck = null; stage('ask'); requestNext.hidden = true; };
        const open = found => {
          more.replaceChildren();
          selected.clear();
          wrongAreas.clear();
          resolutionBoxes.clear();
          wrongKind = '';
          if (found) {
            const verified = node('div', '', { class: 'help-desk-verified' });
            verified.append(node('strong', `Order ${found.order}`), node('span', 'Verified'));
            more.append(verified);
          }
          // What photos help, for this kind of problem, in one line.
          const tips = node('p', '', { class: 'help-desk-photo-tips' });
          const tipText = document.createTextNode('');
          const showTips = () => { tipText.textContent = (wrong ? ['What arrived', 'Its label or packaging'] : missing ? ['Everything received', 'Box and packing slip']
            : transit ? ['Damage close-up', 'Whole item', 'Shipping box and label'] : ['Problem close-up', 'Whole item']).join(' · '); };
          tips.append(node('strong', 'Photo tips: '), tipText);
          showTips();
          const orderNumber = String(area.querySelector('[name=orderNumber]')?.value || '').trim();
          const local = orders.find(order => order.name === orderNumber);
          // Missing: part of the order hasn't shipped yet, so it may still be on its way.
          if (missing && (found?.partial || local?.fulfillment === 'partial')) {
            const notice = node('div', '', { class: 'help-desk-cancel-notice', role: 'note' });
            notice.append(node('strong', 'Part of this order hasn\'t shipped yet.'), node('span', 'The item may still be on its way. Check Track Order first.'));
            more.append(notice);
          }
          // One option for several categories: what happened sets the ticket's category.
          if (option.kinds) {
            const category = fields.querySelector('[name=category]');
            const subcategory = fields.querySelector('[name=subcategory]');
            category.value = option.category;
            subcategory.value = option.subcategory;
            choiceCards(more, 'kind', 'What happened?', option.kinds.map(kind => [kind.label, kind.label, kind.hint]), value => {
              const kind = option.kinds.find(entry => entry.label === value);
              category.value = kind.category;
              subcategory.value = kind.subcategory;
              transit = kind.category === 'Shipping Damage';
              showTips();
              // A wrong item asks different things per answer: re-ask them in every product's box.
              wrongKind = kind.subcategory;
              for (const [id, entry] of wrongAreas) if (entry.area.isConnected) askWrong(entry.area, entry.product, id); else wrongAreas.delete(id);
              for (const entry of resolutionBoxes.values()) entry.show();
            });
          }
          // The products to pick from: the order's items when the app found it,
          // else the chosen order's (or every shipped order's) items from the
          // customer's account, so a signed-in customer picks instead of typing.
          const choices = orderedProducts(found?.items?.length ? found.items : local ? items(local) : orders.filter(shipped).flatMap(items));
          // Each product's box: which part, how many, what's wrong (or what came
          // instead), its photos and video. Review lists each under its product's name.
          productCards(more, choices, wrong ? 'Which product was wrong?' : 'Which product has a problem?', (box, product, id) => {
            const many = product.quantity > 1;
            // Missing: told in their own words, a photo or a video (the team reads the part from it).
            if (missing) {
              field(box, `itemNote:${id}`, 'What\'s missing?', { multiline: true, placeholder: option.placeholder || 'e.g. the risers, or 3 of 6 lids arrived' }).dataset.review = product.title;
            } else if (wrong) {
              // Its questions follow "What happened?" and change with it.
              const area = node('div', '', { 'data-fields': '' });
              box.append(area);
              wrongAreas.set(id, { area, product });
              askWrong(area, product, id);
            } else {
              if (many) quantityField(box, `itemQty:${id}`, 'How many are affected?', product.quantity).dataset.review = `${product.title} · How many`;
              field(box, `itemNote:${id}`, 'Describe the issue', { multiline: true, placeholder: option.placeholder || 'Briefly describe the problem' }).dataset.review = product.title;
            }
            imageField(box, wrong || option.preset.issue === issues[0], `images:${id}`);
            videoField(box, '', `videos:${id}`);
            askResolution(box, product, id);
          }, { search: !found?.items?.length, tips });
          // A warranty claim without an order we found: where and when it was bought.
          if (warranty && !found && purchasePlaces.length) {
            const bought = node('div', '', { class: 'help-desk-address', role: 'group', 'aria-label': 'Purchase' });
            field(bought, 'purchasedFrom', 'Where did you buy it?', { choices: purchasePlaces, placeholder: 'Select one' });
            const month = field(bought, 'purchaseDate', 'When? (month)', { type: 'month' });
            month.max = new Date().toISOString().slice(0, 7);
            more.append(bought);
          }
          nextCheck = () => {
            if (!selected.size) { message(wrong ? 'Select the product that was wrong.' : 'Select the product with the problem.', true); return false; }
            const empty = [...resolutionBoxes.values()].find(entry => entry.wanted.isConnected && !entry.wanted.hidden && !entry.replacements.size);
            if (empty) { message(`Add the product you'd like instead of ${empty.product.title}.`, true); return false; }
            return true;
          };
          stage('request', '', '', back);
          requestNext.hidden = false;
        };
        skip.onclick = () => open(null);
        check.onclick = async () => {
          const orderNumber = String(area.querySelector('[name=orderNumber]')?.value || '').trim();
          const email = String(form.elements.email?.value || '').trim();
          const show = (text, offerSkip) => { note.textContent = text; note.hidden = false; skip.hidden = !offerSkip; };
          if (!orderNumber || !email) { show('Please enter your order number first.'); return; }
          check.disabled = true;
          check.textContent = 'Finding your order...';
          try {
            const url = new URL(endpoint);
            for (const [key, value] of Object.entries({ check: 'items', order: orderNumber, email })) url.searchParams.set(key, value);
            const data = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
            note.hidden = true;
            skip.hidden = true;
            if (data.found) open(data.found);
            else if (data.unavailable) open(null);
            else show(data.notFound ? `${data.error} If it's an older order, you can continue without it.` : data.error || 'We couldn\'t check your order right now.', data.notFound);
          } catch { open(null); }
          finally { check.disabled = false; check.textContent = 'Continue'; }
        };
      },
      // The wrong item: like a product issue, each product from the order with what came instead and its photos.
      wrongItem(option) { flows.productIssue(option); },
      // Sending something back or swapping it, with the order's details filled in.
      return(option) {
        let orderDetails, productDetails;
        // Fill the order's date and items in, unless the customer has typed their own.
        const autofill = (input, value) => { if (input && (!input.value || input.dataset.auto)) { input.value = value; input.dataset.auto = value ? 'true' : ''; } };
        orderField(fields, order => {
          autofill(orderDetails, order ? `Order ${order.name} placed on ${order.date}` : '');
          autofill(productDetails, order ? items(order).map(itemLine).join('\n') : '');
        }, shipped);
        orderDetails = field(fields, 'orderDetails', 'Order Details', { multiline: true, placeholder: 'Order date and any relevant information' });
        productDetails = field(fields, 'productDetails', 'Products to Return', { multiline: true, placeholder: 'Product name, variant and quantity' });
        for (const input of [orderDetails, productDetails]) input.addEventListener('input', () => { input.dataset.auto = ''; });
        field(fields, 'details', 'Reason for Return', { multiline: true, placeholder: option.placeholder || 'For example: I ordered two and only need one.' });
        if (!option.preset.resolution) field(fields, 'resolution', 'Preferred Resolution', { choices: [['Return', 'Return'], ['Exchange', 'Exchange'], ['Refund', 'Refund']] });
        imageField(fields, false);
      },
      // Shipping products to an address (domestic, international or anywhere):
      // the products, the address part by part and, if they like, our shipping
      // options there with prices and delivery dates, before they send it.
      international(option) {
        const home = config.home || 'US';
        const list = countries.filter(entry => option.region === 'domestic' ? entry.code === home : option.region === 'international' ? entry.code !== home : true);
        productPicker(fields, 'Products You Want Shipped', null, selected, { quantities: true });
        const grid = node('div', '', { class: 'help-desk-address', role: 'group', 'aria-label': 'Shipping address' });
        grid.append(node('h4', 'Shipping Address'));
        fields.append(grid);
        const wide = input => { input.parentElement.classList.add('help-desk-wide'); return input; };
        // Domestic: the store's own country. Otherwise every country we ship to (the U.S. and Canada), then any other.
        const picker = countryPicker(grid, 'country', 'Country', { only: option.region === 'domestic' ? list.map(entry => entry.code) : null, other: option.region !== 'domestic' });
        picker.wrap.classList.add('help-desk-wide');
        const country = picker.input;
        if (option.region !== 'international') picker.set(option.region === 'domestic' ? home : 'US');
        const street = wide(field(grid, 'shipAddress1', 'Street Address', { placeholder: 'Start typing your address', autocomplete: 'shipping address-line1' }));
        const city = field(grid, 'shipCity', 'City', { autocomplete: 'shipping address-level2' });
        const area = node('div');
        grid.append(area);
        const zip = field(grid, 'shipZip', 'ZIP / Postal Code', { autocomplete: 'shipping postal-code' });
        // The country's name on Review (the picker sends its code).
        const countryReview = node('input', '', { type: 'hidden', 'data-review': 'Country' });
        fields.append(countryReview);
        // The address is sent as one line, as the team reads it.
        const address = node('input', '', { type: 'hidden', name: 'address' });
        fields.append(address);
        const state = () => area.querySelector('select, input');
        const named = select => select?.value ? (select.options ? select.options[select.selectedIndex].textContent : select.value) : '';
        const compose = () => { address.value = [street.value, city.value, named(state()), zip.value].map(part => part.trim()).filter(Boolean).join(', '); };
        const states = () => {
          const provinces = config.provinces?.[country.value];
          countryReview.value = countries.find(entry => entry.code === country.value)?.name || '';
          // Countries without postal codes don't need one; the rest in their own format.
          const postal = !NO_POSTAL_CODE.includes(country.value);
          zip.required = postal;
          zip.parentElement.querySelector('span').replaceChildren(postal ? 'ZIP / Postal Code' : 'ZIP / Postal Code (optional)',
            ...(postal ? [' ', node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' })] : []));
          const format = POSTAL_FORMATS[country.value];
          if (format) { zip.pattern = format[0]; zip.title = `Enter a valid postal code, like ${format[1]}.`; } else { zip.removeAttribute('pattern'); zip.removeAttribute('title'); }
          area.replaceChildren();
          if (provinces) field(area, 'shipProvince', country.value === 'CA' ? 'Province' : 'State', { choices: provinces, placeholder: 'Select one' });
          else field(area, 'shipProvince', 'State / Province (optional)', { optional: true, autocomplete: 'shipping address-level1' });
          compose();
        };
        country.addEventListener('change', states);
        grid.addEventListener('input', compose);
        grid.addEventListener('change', compose);
        states();
        addressSuggest(grid, () => country.value);

        // No prices on the form: once the products and address are in, the
        // request is sent, and our team replies with shipping options and costs.
        selfCheck('Review Request', () => {
          message('', false, false);
          if (!selected.size) { message('Select the products you want shipped first.', true); return; }
          if ([...selected.values()].some(product => !(product.qty >= 1 && product.qty <= 99))) { message('Enter a quantity from 1 to 99 for each product.', true); return; }
          if (!country.value) { message('Please select the country.', true); picker.wrap.querySelector('select')?.focus(); return; }
          for (const input of [street, city]) input.value = input.value.trim();
          zip.value = zip.value.trim().toUpperCase();
          // The browser's own checks (required, the postal format) on every field, in order.
          const invalid = [...grid.querySelectorAll('input, select, textarea')].find(input => input.willValidate && !input.checkValidity());
          if (invalid) { invalid.reportValidity(); invalid.focus(); return; }
          if (street.value.length < 5) { message('Please enter the full street address, with the house or building number.', true); street.focus(); return; }
          compose();
          return { request: true };
        }, () => false, null, '');
      },
      partner(option) {
        const wholesale = option.preset.topic === topics[1];
        const radios = node('fieldset');
        const legend = node('legend', `Are you an existing ${wholesale ? 'wholesale partner' : 'affiliate partner'}? `);
        legend.append(node('span', '*', { class: 'help-desk-required', 'aria-hidden': 'true' }));
        radios.append(legend);
        const partnerFields = node('div', '', { 'data-fields': '' });
        for (const answer of ['Yes', 'No']) {
          const label = node('label', '', { class: 'help-desk-choice' });
          const radio = node('input', '', { type: 'radio', name: 'existing', value: answer, required: '' });
          label.append(radio, document.createTextNode(answer));
          radios.append(label);
          radio.onchange = () => {
            partnerFields.replaceChildren();
            if (answer === 'Yes') field(partnerFields, 'registeredEmail', 'Registered Email Address', { type: 'email' });
            else {
              const url = wholesale ? root.dataset.wholesaleUrl : root.dataset.affiliateUrl;
              const prompt = node('p', `Interested in becoming ${wholesale ? 'a wholesale partner' : 'an affiliate partner'}? `);
              if (url) {
                const target = new URL(url, location.origin);
                if (['http:', 'https:'].includes(target.protocol)) prompt.append(node('a', 'Apply here', { href: target.href, target: '_blank', rel: 'noopener' }));
              }
              prompt.append(document.createTextNode(' You may also submit your inquiry below.'));
              partnerFields.append(prompt);
            }
            field(partnerFields, 'query', 'Your Inquiry', { multiline: true, placeholder: 'How can we assist you?' });
          };
        }
        fields.append(radios, partnerFields);
      },
      // Product questions, how-tos, the website and anything else.
      question(option) {
        field(fields, 'orderNumber', 'Order Number (optional)', { optional: true, placeholder: 'e.g. #1001' });
        field(fields, 'query', 'Your Inquiry', { multiline: true, placeholder: option.placeholder || 'How can we assist you?' });
        imageField(fields, false);
      },
      // Sales tax, customs and import duties: where it ships to decides which
      // apply, so the country comes first, then the order (if any) and the question.
      customs(option) {
        const home = config.home || 'US';
        const picker = countryPicker(fields, 'country', 'Shipping To');
        const country = picker.input;
        picker.set(home);
        const hint = node('p', '', { class: 'help-desk-hint' });
        fields.append(hint);
        // Another country has its own coming-soon note.
        const explain = () => { hint.textContent = !country.value || picker.isElsewhere() ? '' : country.value === home ? 'We\'ll answer about the sales tax on your order.' : 'Import duties and taxes depend on the country. We\'ll check what applies to orders shipped to you.'; };
        country.addEventListener('change', explain);
        explain();
        field(fields, 'orderNumber', 'Order Number (optional)', { optional: true, placeholder: 'e.g. #1001' });
        field(fields, 'query', 'Your Question', { multiline: true, placeholder: option.placeholder || 'How can we help?' });
      },
      // Where it's going (and the order, for its own dates): answered from the
      // store's shipping rates, with a question only if that didn't answer it.
      shippingTimes(option) {
        const where = node('div', '', { class: 'help-desk-address', role: 'group', 'aria-label': 'Shipping to' });
        // The countries Shipping Times covers for now, then "Another country".
        const country = field(where, 'shipTo', 'Shipping To', { choices: [...countries.filter(entry => served.includes(entry.code)).map(entry => [entry.code, entry.name]), ['OTHER', 'Another country']] });
        const area = node('div');
        const states = () => {
          const list = config.provinces?.[country.value];
          area.replaceChildren();
          if (list) field(area, 'shipToState', country.value === 'CA' ? 'Province (optional)' : 'State (optional)', { choices: list, optional: true, placeholder: 'Any' });
        };
        country.value = countries.some(entry => entry.code === 'US') ? 'US' : '';
        country.onchange = states;
        states();
        where.append(area);
        fields.append(where);
        field(fields, 'orderNumber', 'Order Number (optional)', { optional: true, placeholder: 'Add it to see when your order arrives, e.g. #1001' });
        const value = name => String(form.elements[name]?.value || '').trim();
        const elsewhere = () => country.value === 'OTHER';
        selfCheck('Check Shipping Times', () => {
          // Another country: no rates online, so straight to their question.
          if (elsewhere()) return { request: true };
          if (value('orderNumber') && !value('email')) message('Please enter your email address to check your order.', true);
          else if (value('shipTo')) return { shipping: '1', country: value('shipTo'), province: value('shipToState'), order: value('orderNumber'), email: value('email') };
          message('Please select the country we\'re shipping to.', true);
        }, renderShipping, more => {
          const named = select => select?.value ? select.options[select.selectedIndex].textContent : '';
          const place = [named(area.querySelector('select')), named(country)].filter(Boolean).join(', ');
          if (elsewhere()) field(more, 'query', 'Your Country and Question', { multiline: true, placeholder: 'Which country are you shipping to, and what would you like to order? We\'ll reply with shipping options and prices.' });
          else field(more, 'query', 'Your Question', { multiline: true, placeholder: option.placeholder || 'How can we help?' }).value = place ? `Shipping to ${place}.\n` : '';
        }, 'Shipping times are unavailable right now. Please send us your question below.', 'Shipping options');
      },
    };

    // Step 3: the option's hidden values (category, sub-category, topic...) and its fields.
    function renderOption(option) {
      fields.replaceChildren();
      selected.clear();
      message('', false, false);
      delete fields.dataset.stage;
      stageBack = null;
      nextCheck = null;
      requestNav.hidden = false;
      requestNext.hidden = false;
      current = option;
      requestTitle.textContent = option?.label || 'Your request';
      requestText.textContent = option?.description || 'A few details and we’ll take it from here.';
      if (!option) return;
      for (const [name, value] of Object.entries({ category: option.category, subcategory: option.subcategory, ...option.preset })) {
        fields.append(node('input', '', { type: 'hidden', name, value }));
      }
      flows[option.flow]?.(option);
    }

    function updateReview() {
      review.replaceChildren();
      const addRow = (label, value) => {
        if (!value) return;
        const row = node('div', '', { class: 'help-desk-review-row' });
        row.append(node('span', label), node('strong', value));
        review.append(row);
      };
      addRow('Topic', groups[Number(group.value)]?.label);
      addRow('Issue', current?.label);
      addRow('Name', contact[0][0].value.trim());
      addRow('Email', contact[1][0].value.trim());
      addRow('Phone', contact[2][0].value.trim());
      for (const radio of fields.querySelectorAll('input[type=radio]:checked')) {
        addRow(radio.dataset.review || radio.closest('fieldset')?.querySelector('legend')?.textContent?.replace('*', '').trim() || radio.name, radio.closest('label')?.querySelector('strong')?.textContent || radio.value);
      }
      // Hidden answers with a Review label (a product's replacement).
      for (const input of fields.querySelectorAll('input[type=hidden][data-review]')) addRow(input.dataset.review, input.value.trim());
      for (const input of fields.querySelectorAll('input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]), select, textarea')) {
        if (!input.name || !input.value.trim()) continue;
        const label = input.dataset.review || input.closest('label')?.querySelector('span')?.textContent?.replace('*', '').trim() || input.name;
        addRow(label, input.tagName === 'SELECT' ? input.options[input.selectedIndex]?.textContent.trim() || input.value : input.value.trim());
      }
      if (selected.size) addRow('Products', [...selected.values()].map(product => product.qty ? `${product.title} × ${product.qty}` : product.title).join(', '));
      const count = selector => [...form.querySelectorAll(selector)].reduce((sum, input) => sum + (input.files?.length || 0), 0);
      const photos = count('input[type=file][accept^="image"]');
      if (photos) addRow('Photos', `${photos} attached`);
      const videos = count('input[type=file][accept^="video"]');
      if (videos) addRow('Videos', `${videos} attached`);
    }

    // Step 2: what's going on, within the chosen group.
    group.onchange = () => {
      optionFields.replaceChildren();
      renderOption(null);
      const chosen = group.value === '' ? null : groups[Number(group.value)];
      groupHint.textContent = chosen ? chosen.hint : '';
      groupHint.hidden = !chosen;
      issueTiles.replaceChildren();
      if (!chosen) { go(0); return; }
      go(1);
      const option = field(optionFields, 'option', 'What do you need help with?', { choices: [], placeholder: 'Select an option' });
      // The chosen option's one-line description (Orders), under the dropdown.
      const optionHint = node('p', '', { class: 'help-desk-hint help-desk-option-hint', hidden: '' });
      optionFields.append(optionHint);
      // A topic spanning several ticket categories lists its subcategories under
      // a heading per category, unless its options are in a hand-picked order (Orders).
      const runs = chosen.options.filter((entry, index) => entry.section !== chosen.options[index - 1]?.section).length;
      const headed = !chosen.flat && new Set(chosen.options.map(entry => entry.section)).size > 1 && runs === new Set(chosen.options.map(entry => entry.section)).size;
      chosen.options.forEach((entry, index) => {
        let parent = option;
        if (headed) {
          parent = [...option.querySelectorAll('optgroup')].find(element => element.label === entry.section);
          if (!parent) option.append(parent = node('optgroup', '', { label: entry.section }));
        }
        parent.append(node('option', entry.label, { value: String(index) }));
      });
      option.removeAttribute('name');
      option.classList.add('help-desk-issue-select');
      option.parentElement.hidden = true;
      // The cards set the (hidden) issue dropdown, under a heading per category when there are several.
      chosen.options.forEach((entry, index) => {
        if (headed && entry.section !== chosen.options[index - 1]?.section) issueTiles.append(node('h4', entry.section, { class: 'help-desk-tiles-heading' }));
        const card = tile(entry.label, entry.description);
        card.onclick = () => { if (option.value === String(index)) go(detailsStep); else { option.value = String(index); option.onchange(); } };
        issueTiles.append(card);
      });
      option.onchange = () => {
        const entry = option.value === '' ? null : chosen.options[Number(option.value)] || null;
        optionHint.textContent = entry?.description || '';
        optionHint.hidden = !entry?.description;
        renderOption(entry);
        for (const [at, card] of [...issueTiles.querySelectorAll('.help-desk-tile')].entries()) card.setAttribute('aria-pressed', String(String(at) === option.value));
        go(entry ? detailsStep : 1);
      };
      // A group with one option needs no second choice.
      if (chosen.options.length === 1) { option.value = '0'; option.onchange(); }
    };
    form.onsubmit = async event => {
      event.preventDefault();
      if (controls.disabled) return;
      if (step !== 4) return;
      if (!current) { message('Select a topic and what you need help with before submitting your request.', true); return; }
      if (current?.flow === 'international' && !selected.size) { message('Select at least one product.', true); return; }
      if (!requestKey) requestKey = crypto.randomUUID();
      const body = new FormData(form);
      body.set('requestKey', requestKey);
      for (const [id, product] of selected) {
        body.append('products', id);
        // How many they want shipped, by product.
        if (product.qty) { body.set(`itemQty:${id}`, String(product.qty)); body.set(`itemTitle:${id}`, product.title); }
      }
      controls.disabled = true;
      submit.textContent = 'Submitting...';
      message('', false, false);
      try {
        const response = await fetch(endpoint, { method: 'POST', body, headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (!response.ok || !result.ticketId) {
          message(Object.values(result.errors || {}).join(' ') || 'Your request could not be saved. Please try again.', true);
          return;
        }
        const sentFlow = current?.flow;
        form.reset();
        prefill();
        group.onchange();
        requestKey = '';
        const label = result.number ? `#${result.number}` : result.ticketId;
        // An address change isn't made yet: the team reviews it first.
        message(sentFlow === 'address'
          ? `Address change request ${label} submitted. It's pending review: your shipping address has not been changed yet. We'll email you once our team has reviewed it, and you can follow it on your request page. `
          : sentFlow === 'cancel'
          ? `Cancellation request ${label} submitted. It's pending review: your order has not been cancelled yet. We'll email you once our team has reviewed it, and you can follow it on your request page. `
          : `Thank you. Your request ${label} has been received. Our team will respond by email, and you can track its progress on your request page. `);
        if (result.token) status.append(node('a', 'View Request', { href: trackingLink(result.token) }));
      } catch { message('We could not confirm your submission. Please try again. Your information is still in the form.', true); }
      finally { controls.disabled = false; submit.textContent = 'Submit Request'; }
    };
  }
  function mount() { document.querySelectorAll('[data-help-desk]').forEach(initialize); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
  document.addEventListener('shopify:section:load', mount);
})();
