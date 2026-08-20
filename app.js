(function () {
  var form = document.getElementById("search-form");
  var input = document.getElementById("q");
  var results = document.getElementById("results");
  var status = document.getElementById("status");
  if (!form || !input || !results) return;

  var SYNONYMS = {
    staubsauger: ["vacuum", "aspirateur"],
    kopfhorer: ["headphones", "earbuds"],
    kopfhoerer: ["headphones", "earbuds"],
    fernseher: ["television"],
    waschmaschine: ["washing machine"],
    kuhlschrank: ["refrigerator"],
    kuehlschrank: ["refrigerator"]
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
      (SYNONYMS[t] || []).forEach(function (s) { out.push(s); });
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
  function euro(n) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
  }
  function enc(s) { return encodeURIComponent(s); }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function shopSearch(name) {
    return {
      amazon: "https://www.amazon.de/s?k=" + enc(name),
      idealo: "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=" + enc(name)
    };
  }
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }
  function offUrl(host, q, n) {
    return "https://" + host + "/cgi/search.pl?search_terms=" + enc(q) +
      "&search_simple=1&action=process&json=1&page_size=" + n;
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
    var seen = {};
    var out = [];
    var jobs = [
      fetchJson(offUrl("world.openproductsfacts.org", q, 16)).catch(function () { return { products: [] }; }),
      fetchJson(offUrl("de.openproductsfacts.org", q, 12)).catch(function () { return { products: [] }; })
    ];
    if (extras[0]) {
      jobs.push(fetchJson(offUrl("world.openproductsfacts.org", extras[0], 12)).catch(function () { return { products: [] }; }));
    }
    return Promise.all(jobs).then(function (packs) {
      packs.forEach(function (pack) { collect(pack, q, extras, seen, out); });
      if (out.length >= 3) return out;
      return fetchJson(offUrl("world.openfoodfacts.org", q, 8))
        .catch(function () { return { products: [] }; })
        .then(function (food) {
          collect(food, q, extras, seen, out);
          return out;
        });
    });
  }

  function addPrices(products, q) {
    return Promise.all(products.slice(0, 12).map(function (p) {
      return fetchJson("https://pricelists.org/api/v1/products/by-gtin/" + enc(p.code))
        .then(function (d) {
          var hit = (d.data || []).find(function (x) {
            return containsAll(x.title || "", q) && containsAll(x.title || "", p.name.split(" ").slice(0, 2).join(" "));
          });
          if (!hit || !containsAll(hit.title || "", q)) return p;
          p.plistTitle = hit.title;
          return fetchJson("https://pricelists.org/api/v1/products/" + enc(hit.id) + "/offers?currency=EUR")
            .then(function (od) {
              var offers = od.data || [];
              if (offers[0] && typeof offers[0].price === "number") {
                p.price = offers[0].price;
                p.currency = "EUR";
                p.shop = (offers[0].merchant && offers[0].merchant.name) || "";
                p.updated = offers[0].last_changed_at || offers[0].updated_at || "";
              }
              return p;
            })
            .catch(function () { return p; });
        })
        .catch(function () { return p; });
    }));
  }

  function card(p) {
    var title = p.plistTitle || p.name;
    var shops = shopSearch(title);
    var priceText = typeof p.price === "number" ? euro(p.price) : "Preis im Shop";
    var img = p.image
      ? '<img src="' + escapeHtml(p.image) + '" alt="">'
      : '<div class="ph"></div>';
    var src = typeof p.price === "number"
      ? ("Preis laut Händlerliste" + (p.shop ? " · " + p.shop : "") + (p.updated ? " · " + String(p.updated).slice(0, 10) : ""))
      : ("EAN " + p.code);
    return '<article class="row offer product">' +
      '<div class="thumb">' + img + "</div>" +
      "<div class=\"meta\">" +
      "<header><h3>" + escapeHtml(title) + "</h3>" +
      '<p class="shop">' + escapeHtml(p.brand || "") + "</p></header>" +
      '<p class="price">' + escapeHtml(priceText) + "</p>" +
      '<p class="src">' + escapeHtml(src) + "</p>" +
      '<p class="out">' +
      '<a href="' + escapeHtml(shops.idealo) + '" rel="noopener noreferrer">Idealo</a>' +
      '<a href="' + escapeHtml(shops.amazon) + '" rel="noopener noreferrer">Amazon</a>' +
      "</p>" +
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
      return addPrices(products, q).then(function (rows) {
        rows = rows.filter(function (p) {
          var title = p.plistTitle || p.name;
          return nameFits(title, p.brand || "", q, extraTerms(q));
        });
        rows.sort(function (a, b) {
          var ap = typeof a.price === "number" ? a.price : 1e12;
          var bp = typeof b.price === "number" ? b.price : 1e12;
          return ap - bp;
        });
        status.textContent = rows.length + " Produkte. Link sucht genau dieses Modell.";
        results.innerHTML = '<div class="sheet products">' + rows.map(card).join("") + "</div>" +
          '<p class="src note">Nur Treffer, deren Name zur Suche passt. Klick öffnet Idealo oder Amazon für dieses Modell.</p>';
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
