(function () {
  var form = document.getElementById("search-form");
  var input = document.getElementById("q");
  var results = document.getElementById("results");
  var status = document.getElementById("status");
  if (!form || !input || !results) return;

  var SYNONYMS = {
    kopfhorer: ["headphones", "earbuds", "airpods"],
    kopfhoerer: ["headphones", "earbuds", "airpods"],
    kopfhörer: ["headphones", "earbuds"],
    ohrhorer: ["earbuds", "earphones"],
    staubsauger: ["vacuum", "aspirateur"],
    fernseher: ["television"],
    waschmaschine: ["washing machine"],
    kuhlschrank: ["refrigerator"],
    kuehlschrank: ["refrigerator"]
  };
  var CATEGORIES = {
    kopfhorer: ["headphones", "earphones"],
    kopfhoerer: ["headphones", "earphones"],
    headphones: ["headphones", "earphones"]
  };
  var ACCESSORY = /\b(beutel|sack|sacs?|bags?|hoesje|huelle|hulle|hülle|case|cover|folie|schutz|etui)\b/i;

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9äöüß\s]/gi, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) {
    return norm(s).split(" ").filter(function (t) { return t.length > 1; });
  }
  function containsAll(text, q) {
    var qt = tokens(q);
    if (!qt.length) return false;
    var hay = norm(text);
    for (var i = 0; i < qt.length; i++) if (hay.indexOf(qt[i]) === -1) return false;
    return true;
  }
  function extraTerms(q) {
    var out = [];
    tokens(q).forEach(function (t) {
      (SYNONYMS[t] || []).forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    });
    return out;
  }
  function categorySlugs(q) {
    var out = [];
    tokens(q).forEach(function (t) {
      (CATEGORIES[t] || []).forEach(function (s) { if (out.indexOf(s) === -1) out.push(s); });
    });
    return out;
  }
  function isSpecific(name, q) {
    var nt = tokens(name);
    var qt = tokens(q);
    if (nt.length < 2 && !/\d/.test(name)) return false;
    if (qt.length && nt.join(" ") === qt.join(" ")) return false;
    return true;
  }
  function nameFits(name, brand, q, extras) {
    var hay = name + " " + brand;
    if (ACCESSORY.test(name)) return false;
    if (containsAll(hay, q) && isSpecific(name, q)) return true;
    for (var i = 0; i < extras.length; i++) {
      if (containsAll(hay, extras[i]) && isSpecific(name, extras[i])) return true;
    }
    return false;
  }
  function titleMatchesProduct(title, name) {
    var parts = tokens(name).filter(function (t) { return t.length > 2; }).slice(0, 3);
    if (parts.length < 1) parts = tokens(name).slice(0, 2);
    if (!parts.length) return false;
    return containsAll(title, parts.join(" "));
  }
  function euro(n) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
  }
  function enc(s) { return encodeURIComponent(s); }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function offSearch(host, q, n) {
    return "https://" + host + "/cgi/search.pl?search_terms=" + enc(q) +
      "&search_simple=1&action=process&json=1&page_size=" + n;
  }
  function offCategory(slug) {
    return "https://world.openproductsfacts.org/category/" + enc(slug) + ".json?page_size=24";
  }
  function collect(pack, q, extras, seen, out) {
    (pack.products || []).forEach(function (p) {
      var name = p.product_name || p.product_name_de || p.product_name_en || "";
      var code = p.code;
      if (!name || !code || seen[code]) return;
      if (!nameFits(name, p.brands || "", q, extras)) return;
      seen[code] = 1;
      out.push({
        name: name,
        brand: p.brands || "",
        code: code,
        image: p.image_front_url || p.image_url || ""
      });
    });
  }

  function searchCatalog(q) {
    var extras = extraTerms(q);
    var cats = categorySlugs(q);
    var seen = {};
    var out = [];
    var jobs = [
      fetchJson(offSearch("world.openproductsfacts.org", q, 16)).catch(function () { return { products: [] }; }),
      fetchJson(offSearch("de.openproductsfacts.org", q, 12)).catch(function () { return { products: [] }; })
    ];
    extras.slice(0, 2).forEach(function (term) {
      jobs.push(fetchJson(offSearch("world.openproductsfacts.org", term, 12)).catch(function () { return { products: [] }; }));
    });
    cats.slice(0, 2).forEach(function (slug) {
      jobs.push(fetchJson(offCategory(slug)).catch(function () { return { products: [] }; }));
    });
    return Promise.all(jobs).then(function (packs) {
      packs.forEach(function (pack) { collect(pack, q, extras.concat(cats), seen, out); });
      return out;
    });
  }

  function addPrices(products) {
    return Promise.all(products.slice(0, 20).map(function (p) {
      return fetchJson("https://pricelists.org/api/v1/products/by-gtin/" + enc(p.code))
        .then(function (d) {
          var hit = (d.data || []).find(function (x) {
            return titleMatchesProduct(x.title || "", p.name);
          });
          if (!hit) return null;
          return fetchJson("https://pricelists.org/api/v1/products/" + enc(hit.id) + "/offers?currency=EUR")
            .then(function (od) {
              var offers = (od.data || []).filter(function (o) {
                return o && typeof o.price === "number" && o.price > 0;
              });
              if (!offers.length) return null;
              offers.sort(function (a, b) { return a.price - b.price; });
              p.plistTitle = hit.title;
              p.price = offers[0].price;
              p.shop = (offers[0].merchant && offers[0].merchant.name) || "";
              p.shopUrl = offers[0].url || "";
              p.offerCount = offers.length;
              p.updated = offers[0].last_changed_at || offers[0].updated_at || "";
              return p;
            })
            .catch(function () { return null; });
        })
        .catch(function () { return null; });
    })).then(function (rows) {
      return rows.filter(function (p) { return p && typeof p.price === "number" && p.shopUrl; });
    });
  }

  function card(p) {
    var title = p.plistTitle || p.name;
    var img = p.image
      ? '<img src="' + escapeHtml(p.image) + '" alt="">'
      : '<div class="ph"></div>';
    var src = p.shop + (p.offerCount > 1 ? " · " + p.offerCount + " Angebote" : "") +
      (p.updated ? " · " + String(p.updated).slice(0, 10) : "");
    return '<article class="row offer product">' +
      '<div class="thumb">' + img + "</div>" +
      "<div class=\"meta\">" +
      "<header><h3>" + escapeHtml(title) + "</h3>" +
      '<p class="shop">' + escapeHtml(p.brand || "") + "</p></header>" +
      '<p class="price">ab ' + escapeHtml(euro(p.price)) + "</p>" +
      '<p class="src">' + escapeHtml(src) + "</p>" +
      '<p class="out"><a href="' + escapeHtml(p.shopUrl) + '" rel="noopener noreferrer">Zum Shop</a></p>' +
      "</div></article>";
  }

  function show(q) {
    q = String(q || "").replace(/^\s+|\s+$/g, "");
    results.innerHTML = "";
    if (!q) { status.textContent = ""; return; }
    status.textContent = "Suche Angebote…";
    searchCatalog(q).then(function (products) {
      if (!products.length) {
        status.textContent = "Keine konkreten Produkte gefunden.";
        return;
      }
      return addPrices(products).then(function (rows) {
        rows.sort(function (a, b) { return a.price - b.price; });
        if (!rows.length) {
          status.textContent = "Produkte gefunden, aber noch kein Händlerpreis dazu.";
          return;
        }
        status.textContent = rows.length + " Produkte, günstigster Preis zuerst.";
        results.innerHTML = '<div class="sheet products">' + rows.map(card).join("") + "</div>" +
          '<p class="src note">Nur Treffer mit nachgewiesenem Händlerpreis. Link geht in diesen Shop, nicht in eine andere Suche.</p>';
      });
    }).catch(function () {
      status.textContent = "Suche gerade nicht erreichbar.";
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value;
    show(q);
    if (history.replaceState) history.replaceState(null, "", q ? ("/?q=" + enc(q)) : "/");
  });

  var start = "";
  try { start = new URLSearchParams(location.search).get("q") || ""; } catch (e) {}
  if (start) { input.value = start; show(start); }
})();
