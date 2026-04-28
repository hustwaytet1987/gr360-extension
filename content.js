// ─────────────────────────────────────────────────────────
// GR360 LISTING IMPORTER — CONTENT SCRIPT v6
// Runs on supported listing pages after full JS render.
// ─────────────────────────────────────────────────────────

(() => {
  const hostname = window.location.hostname;

  function text(el) {
    return el ? el.innerText?.trim() || el.textContent?.trim() || "" : "";
  }
  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return [...document.querySelectorAll(s)]; }

  function parsePrice(str) {
    if (!str) return null;
    const match = str.match(/R[\s\u00a0]?([\d\s\u00a0,]+)/);
    if (!match) return null;
    const num = parseFloat(match[1].replace(/[\s\u00a0,]/g, ""));
    return isNaN(num) || num > 999_000_000_000 ? null : num;
  }

  function parseNum(str) {
    if (!str) return null;
    const n = parseFloat(String(str).replace(",", ".").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  }

  function parseSize(str) {
    if (!str) return null;
    if (/ha|hectare/i.test(str)) {
      const n = parseFloat(str.replace(/[^\d.]/g, ""));
      return isNaN(n) ? null : Math.round(n * 10000);
    }
    const n = parseFloat(str.replace(/[\s\u00a0,]/g, "").replace(/m²|m2|sqm/g, ""));
    return isNaN(n) ? null : n;
  }

  function cleanTitle(str) {
    if (!str) return null;
    return str
      .replace(/\s*\|.*/g, "")
      .replace(/\s*-\s*(Property24|Seeff|Private Property).*/gi, "")
      .trim();
  }

  function detectCategory(title) {
    const t = (title || "").toLowerCase();
    if (/apartment|flat|townhouse|cluster/.test(t)) return "apartment";
    if (/plot|vacant land|vacant erf/.test(t)) return "plot";
    if (/farm|smallholding|agricultural|lifestyle estate/.test(t)) return "farm";
    if (/commercial|office|retail|shop/.test(t)) return "commercial";
    if (/industrial|warehouse|factory/.test(t)) return "industrial";
    if (/yacht|boat/.test(t)) return "yacht";
    if (/airplane|aircraft/.test(t)) return "airplane";
    return "house";
  }

  function cleanDescription(raw) {
    if (!raw) return null;
    return raw
      .replace(/Read (full )?description\s*\+?/gi, "")
      .replace(/Show more/gi, "")
      .replace(/window\.\w+[^;]+;/g, "")
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .join("\n\n")
      .trim() || null;
  }

  function cleanArea(raw) {
    if (!raw) return null;
    const cleaned = raw
      .replace(/Street (map|view).*/gi, "")
      .replace(/Get directions.*/gi, "")
      .replace(/Google.*/gi, "")
      .trim();
    if (cleaned.length > 60) return null;
    const bad = ["optional", "interested", "contact", "enquire", "submit", "form", "property for sale", "to rent"];
    if (bad.some(w => cleaned.toLowerCase().includes(w))) return null;
    return cleaned || null;
  }

  // ── Image filtering ─────────────────────────────────────

  const AGENT_URL_PATTERNS = [
    "agentpictures", "agent-pictures", "agentpic", "/agents/", "/agentimages/",
    "agentimage", "mugshot", "portrait", "headshot", "avatar",
    "consultant", "advisor", "staff", "team-member",
    "-logo.", "_logo.", "brand-logo",
    "remax", "re-max", "harcourts", "century21", "sotheby",
    "lew", "jawitz", "chas", "everitt", "fine-country", "fine_country",
    "engel", "voelkers", "rawson", "tyson", "just-property"
  ];

  const AGENT_ALT_PATTERNS = [
    "logo", "brand", "agency", "agent", "consultant", "re/max",
    "seeff", "harcourts", "pam golding", "property group"
  ];

  const AGENT_CONTAINER_CLASSES = [
    "agent", "contact", "broker", "realtor", "consultant", "negotiator",
    "p24-agent", "agent-card", "contact-agent",
    "agency-logo", "office-logo", "powered-by", "team", "people", "staff"
  ];

  function isAgentImage(img) {
    const src = (img.src || img.dataset?.src || "").toLowerCase();
    const alt = (img.alt || "").toLowerCase();
    if (AGENT_URL_PATTERNS.some(p => src.includes(p))) return true;
    if (AGENT_ALT_PATTERNS.some(p => alt.includes(p))) return true;
    let el = img.parentElement;
    for (let i = 0; i < 5; i++) {
      if (!el) break;
      const cls = (el.className || "").toLowerCase();
      const id = (el.id || "").toLowerCase();
      if (AGENT_CONTAINER_CLASSES.some(c => cls.includes(c) || id.includes(c))) return true;
      el = el.parentElement;
    }
    return false;
  }

  function collectImages() {
    const seen = new Set();
    const images = [];

    function add(url) {
      if (!url) return;
      url = url.trim();
      if (!url.startsWith("http")) return;
      if (seen.has(url)) return;
      if (/blank\.gif|\.svg|\.gif|icon_/i.test(url)) return;
      const hasExt = /\.(jpg|jpeg|png|webp)/i.test(url);
      const isCDN = /prop24|property24|privateproperty|pamgolding|seeff|listing-image|mediacdn/i.test(url);
      if (!hasExt && !isCDN) return;
      seen.add(url);
      images.push(url);
    }

    qsa("img").forEach(img => {
      if (isAgentImage(img)) return;
      if (img.srcset) {
        const parts = img.srcset.split(",").map(s => s.trim().split(/\s+/));
        const largest = parts.sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0];
        if (largest?.[0]) add(largest[0]);
      }
      add(img.src);
      add(img.dataset?.src);
      add(img.dataset?.original);
      add(img.dataset?.lazy);
    });

    qsa("[class*='gallery'] [style], [class*='carousel'] [style], [class*='photo'] [style]").forEach(el => {
      const m = (el.getAttribute("style") || "").match(/url\(['"]?(https?[^'")\s]+)['"]?\)/i);
      if (m) add(m[1]);
    });

    qsa('meta[property="og:image"]').forEach(m => add(m.content));

    qsa('script[type="application/ld+json"]').forEach(s => {
      try {
        const json = JSON.stringify(JSON.parse(s.textContent));
        const matches = json.match(/"(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi);
        matches?.forEach(u => add(u.replace(/"/g, "")));
      } catch {}
    });

    qsa("script:not([src])").forEach(s => {
      const c = s.textContent;
      if (!/imageGallery|listingImages|galleryImages|ImageUrl|FullUrl|LargeUrl|prop24/i.test(c)) return;
      const matches = c.match(/"(https?:\/\/[^"]+)"/gi);
      matches?.forEach(u => {
        const url = u.replace(/"/g, "");
        if (/prop24|property24|privateproperty|pamgolding|seeff/i.test(url)) add(url);
      });
    });

    return images.slice(0, 30);
  }

  // ── Property24 extractor ────────────────────────────────

  function extractProperty24() {
    const title = cleanTitle(
      text(qs("h1")) ||
      qs('meta[property="og:title"]')?.content
    );

    // Price — walk text nodes for first "R XXXXX" pattern
    let price = null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim();
      if (/^R[\s\u00a0]?[\d]/.test(t)) {
        price = parsePrice(t);
        if (price) break;
      }
    }

    // Beds/baths/garages — find icon images with alt text, get sibling number
    function findFeatureCount(keywords) {
      for (const kw of keywords) {
        const el = qs(`[data-testid*="${kw}"]`);
        if (el) { const n = parseNum(text(el)); if (n !== null) return n; }
      }
      const imgs = qsa("img[alt]");
      for (const img of imgs) {
        const alt = img.alt.toLowerCase();
        if (keywords.some(kw => alt.includes(kw))) {
          const li = img.closest("li, div");
          if (li) {
            const nums = text(li).match(/\d+/);
            if (nums) { const n = parseInt(nums[0]); if (n > 0 && n < 100) return n; }
          }
        }
      }
      const lis = qsa("li");
      for (const li of lis) {
        const html = li.innerHTML.toLowerCase();
        if (keywords.some(kw => html.includes(kw))) {
          const t = text(li).trim();
          if (/^\d+$/.test(t)) { const n = parseInt(t); if (n > 0 && n < 50) return n; }
        }
      }
      return null;
    }

    const beds = findFeatureCount(["bedroom", "bed"]);
    const baths = findFeatureCount(["bathroom", "bath"]);
    const garages = findFeatureCount(["garage", "parking"]);

    // ── Property Overview table — label/value pairs ─────────
    function findTableValue(labelText) {
      const candidates = qsa("td, th, dt, li, div, span, p");
      for (const el of candidates) {
        if (text(el).trim().toLowerCase() !== labelText.toLowerCase()) continue;
        const next = el.nextElementSibling;
        if (next && text(next).trim()) return text(next).trim();
        const row = el.closest("tr, li, div[class*='row'], div[class*='item']");
        if (row) {
          const cells = [...row.querySelectorAll("td, span, div, a")].filter(c => c !== el);
          for (const cell of cells) {
            const t = text(cell).trim();
            if (t && t.toLowerCase() !== labelText.toLowerCase()) return t;
          }
        }
      }
      return null;
    }

    const floor_size = parseSize(findTableValue("Floor Size"));
    const erf_size = parseSize(findTableValue("Erf Size"));

    // Address from overview table
    let address = null;
    const addrRaw = findTableValue("Street Address");
    if (addrRaw && !/contact agent/i.test(addrRaw)) address = addrRaw;

    // Description
    let description = null;
    const descEl = qs('[data-testid="listing-description"]') ||
      qs("[class*='description']") ||
      qsa("div, section").find(el =>
        !el.querySelector("nav, header, footer, input, select") &&
        el.querySelectorAll("p").length >= 2 &&
        el.textContent.length > 200
      );
    if (descEl) {
      const paras = [...descEl.querySelectorAll("p")]
        .map(p => text(p))
        .filter(t => t.length > 20 && !t.includes("window."));
      description = paras.length > 0
        ? cleanDescription(paras.join("\n\n"))
        : cleanDescription(text(descEl));
    }

    // Sub heading
    let sub_heading = null;
    if (description) {
      const firstLine = description.split("\n")[0];
      if (firstLine && firstLine.length < 80 &&
        !/^(exclusive|this|welcome|discover|located|perched|nestled|set in|situated)/i.test(firstLine)) {
        sub_heading = firstLine;
      }
    }

    // Area — use the breadcrumb ol/nav specifically, not main nav menu
    // Property24 breadcrumb: Property for Sale > Western Cape > Wilderness > Wilderness Central
    let area = null;
    const breadcrumbNav = qs("nav ol, ol[class*='breadcrumb'], [class*='breadcrumb'] ol, [class*='breadcrumb']");
    if (breadcrumbNav) {
      const crumbLinks = [...breadcrumbNav.querySelectorAll("a")]
        .filter(a => /\/for-sale\/|\/to-rent\/|\/to-let\//i.test(a.href));
      if (crumbLinks.length >= 2) {
        const suburb = text(crumbLinks[crumbLinks.length - 1]);
        const town = text(crumbLinks[crumbLinks.length - 2]);
        area = cleanArea(suburb && town && suburb !== town ? `${suburb}, ${town}` : suburb);
      } else if (crumbLinks.length === 1) {
        area = cleanArea(text(crumbLinks[0]));
      }
    }
    // Fallback: look for inline breadcrumb text pattern "Wilderness > Wilderness Central"
    if (!area) {
      const breadcrumbText = qs("[class*='breadcrumb'], nav[aria-label*='breadcrumb']");
      if (breadcrumbText) {
        const items = text(breadcrumbText)
          .split(/[>|\/]/)
          .map(s => s.trim())
          .filter(s => s.length > 1 && s.length < 50 &&
            !/property for sale|to rent|western cape|gauteng|kwazulu/i.test(s) &&
            !/^\d+$/.test(s));
        if (items.length >= 2) {
          area = cleanArea(`${items[items.length - 1]}, ${items[items.length - 2]}`);
        }
      }
    }

    return { title, sub_heading, price, beds, baths, garages, floor_size, erf_size, description, area, address };
  }

  // ── Pam Golding extractor ───────────────────────────────

  function extractPamGolding() {
    const title = cleanTitle(text(qs("h1")) || qs('meta[property="og:title"]')?.content);
    const price = parsePrice(
      text(qs("[class*='price'], [class*='Price'], .listing-price")) ||
      qs('meta[property="product:price:amount"]')?.content ||
      qs('meta[property="og:description"]')?.content || ""
    );
    const beds = parseNum(text(qs("[class*='bed']")));
    const baths = parseNum(text(qs("[class*='bath']")));
    const garages = parseNum(text(qs("[class*='garage'], [class*='parking']")));
    const floor_size = parseSize(text(qs("[class*='floor']")));
    const erf_size = parseSize(text(qs("[class*='erf'], [class*='stand']")));
    const descEl = qs(".property-description, [class*='description'], [class*='details']") ||
      qsa("div, section").find(el =>
        el.querySelectorAll("p").length >= 2 && el.textContent.length > 150 &&
        !el.querySelector("input, button, form")
      );
    const description = cleanDescription(text(descEl));
    const breadcrumbs = qsa("nav ol li, nav ul li, [class*='breadcrumb'] li");
    const area = cleanArea(breadcrumbs.length > 1
      ? text(breadcrumbs[breadcrumbs.length - 2])
      : text(qs("[class*='suburb'], [class*='location']")));
    return { title, sub_heading: null, price, beds, baths, garages, floor_size, erf_size, description, area, address: null };
  }

  // ── Seeff extractor ─────────────────────────────────────

  function extractSeeff() {
    const title = cleanTitle(text(qs("h1")) || qs('meta[property="og:title"]')?.content);
    const priceMatch = document.body.innerText.match(/R[\s\u00a0]?([\d\s\u00a0,]+)/);
    const price = priceMatch ? parsePrice("R" + priceMatch[1]) : null;
    const beds = parseNum(text(qs("[class*='bed'], [data-beds]")));
    const baths = parseNum(text(qs("[class*='bath'], [data-baths]")));
    const garages = parseNum(text(qs("[class*='garage'], [data-garages]")));
    const floor_size = parseSize(text(qs("[class*='floor']")));
    const erf_size = parseSize(text(qs("[class*='erf'], [class*='stand']")));
    const descEl = qs(".listing-description, .property-description, [class*='description'], #description") ||
      qsa("div, section, article").find(el =>
        el.textContent.length > 200 && !el.querySelector("input, button, form, nav")
      );
    const description = cleanDescription(text(descEl));
    const breadcrumbs = qsa("nav ol li, nav ul li, [class*='breadcrumb'] li");
    const area = cleanArea(breadcrumbs.length > 1
      ? text(breadcrumbs[breadcrumbs.length - 2])
      : text(qs("[class*='suburb'], [class*='location'], [class*='area']")));
    return { title, sub_heading: null, price, beds, baths, garages, floor_size, erf_size, description, area, address: null };
  }

  // ── Private Property extractor ──────────────────────────

  function extractPrivateProperty() {
    const title = cleanTitle(text(qs("h1")) || qs('meta[property="og:title"]')?.content);
    const price = parsePrice(text(qs(".price-display, [itemprop='price'], [class*='price']")));
    const beds = parseNum(text(qs("[data-label='Bedrooms'], .beds-value, [class*='bed']")));
    const baths = parseNum(text(qs("[data-label='Bathrooms'], .baths-value, [class*='bath']")));
    const garages = parseNum(text(qs("[data-label='Garages'], .garages-value, [class*='garage']")));
    const floor_size = parseSize(text(qs("[data-label='Floor Size'], [class*='floor']")));
    const erf_size = parseSize(text(qs("[data-label='Erf Size'], [class*='erf']")));
    const descEl = qs(".property-description, [itemprop='description'], [class*='description']");
    const description = cleanDescription(text(descEl));
    const breadcrumbs = qsa("nav ol li, nav ul li, [class*='breadcrumb'] li");
    const area = cleanArea(breadcrumbs.length > 1
      ? text(breadcrumbs[breadcrumbs.length - 2])
      : text(qs(".suburb-name, [class*='suburb']")));
    return { title, sub_heading: null, price, beds, baths, garages, floor_size, erf_size, description, area, address: null };
  }

  // ── Main ────────────────────────────────────────────────

  function isListingPage() {
    if (hostname.includes("property24.com"))
      return /\/for-sale\/|\/to-let\/|\/to-rent\//i.test(location.pathname) ||
        qs('[data-testid="listing-price"]') !== null ||
        qs("h1") !== null;
    if (hostname.includes("pamgolding.co.za"))
      return qs("[class*='price'], [class*='Price']") !== null;
    if (hostname.includes("seeff.com"))
      return /\/property\//i.test(location.pathname) || qs("[class*='listing']") !== null;
    if (hostname.includes("privateproperty.co.za"))
      return qs(".price-display, [itemprop='price']") !== null;
    return false;
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type !== "EXTRACT_LISTING") return;
    if (!isListingPage()) { respond({ error: "not_a_listing" }); return; }

    let fields = {};
    if (hostname.includes("property24.com")) fields = extractProperty24();
    else if (hostname.includes("pamgolding.co.za")) fields = extractPamGolding();
    else if (hostname.includes("seeff.com")) fields = extractSeeff();
    else if (hostname.includes("privateproperty.co.za")) fields = extractPrivateProperty();

    const images = collectImages();
    const category = detectCategory(fields.title);

    respond({ ...fields, category, images, source_url: window.location.href, source: hostname });
    return true;
  });

  chrome.runtime.sendMessage({ type: "ON_LISTING_PAGE", isListing: isListingPage() });
})();
