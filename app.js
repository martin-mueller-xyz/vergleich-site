(function () {
  var form = document.getElementById("search-form");
  var input = document.getElementById("q");
  var results = document.getElementById("results");
  var status = document.getElementById("status");
  if (!form || !input || !results) return;

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9äöüß\s]/gi, " ").replace(/\s+/g, " ").trim();
  }
  function tokens(s) {
    return norm(s).split(" ").filter(function (t) { return t.length > 1; });
  }
  function matchesQuery(text, q) {
    var qt = tokens(q);
    if (!qt.length) return false;
    var hay = norm(text);
    var hit = 0;
    for (var i = 0; i < qt.length; i++) if (hay.indexOf(qt[i]) !== -1) hit++;
    return hit >= Math.ceil(qt.length / 2);
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

  function searchCatalog(q) {
    var u = "https://world.openproductsfacts.org/cgi/search.pl?search_terms=" + enc(q) +
      "&search_simple=1&action=process&json=1&page_size=16";
    var u2 = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + enc(q) +
      "&search_simple=1&action=process&json=1&page_size=8";
    return Promise.all([
      fetchJson(u).catch(function () { return { products: [] }; }),
      fetchJson(u2).catch(function () { return { products: [] }; })
    ]).then(function (both) {
      var seen = {};
      var out = [];
      both.forEach(function (pack) {
        (pack.products || []).forEach(function (p) {
          var name = p.product_name || p.product_name_en || p.product_name_de || "";
          var code = p.code;
          if (!name || !code || seen[code]) return;
          if (!matchesQuery(name + " " + (p.brands || ""), q)) return;
          seen[code] = 1;
          out.push({
            name: name,
            brand: p.brands || "",
            code: code,
            image: p.image_front_url || p.image_url || ""
          });
        });
      });
      return out;
    });
  }

  function addPrices(products) {
    return Promise.all(products.slice(0, 12).map(function (p) {
      return fetchJson("https://pricelists.org/api/v1/products/by-gtin/" + enc(p.code))
        .then(function (d) {
          var hit = (d.data || []).find(function (x) {
            return matchesQuery((x.title || "") + " " + p.name, p.name);
          }) || (d.data || [])[0];
          if (!hit) return p;
          var offer = (hit.offers || [])[0];
          p.plistId = hit.id;
          p.plistTitle = hit.title || p.name;
          p.priceUsd = hit.best_price_usd;
          if (offer && offer.price) {
            p.price = offer.original_currency === "EUR" ? offer.original_price : offer.price;
            p.currency = offer.original_currency === "EUR" ? "EUR" : (offer.currency || "USD");
            p.shop = (offer.merchant && offer.merchant.name) || "";
            p.url = offer.url;
          }
          return fetchJson("https://pricelists.org/api/v1/products/" + enc(hit.id) + "/offers?currency=EUR")
            .then(function (od) {
              var offers = od.data || [];
              if (offers[0] && typeof offers[0].price === "number") {
                p.price = offers[0].price;
                p.currency = "EUR";
                p.shop = (offers[0].merchant && offers[0].merchant.name) || p.shop;
                p.url = offers[0].url || p.url;
                p.updated = offers[0].last_changed_at || offers[0].updated_at || "";
              }
              p.offers = offers;
              return p;
            })
            .catch(function () { return p; });
        })
        .catch(function () { return p; });
    }));
  }

  function card(p) {
    var title = p.plistTitle || p.name;
    var priceText = typeof p.price === "number"
      ? (p.currency === "EUR" ? euro(p.price) : new Intl.NumberFormat("de-DE", { style: "currency", currency: p.currency || "USD" }).format(p.price))
      : "Preis beim Händler";
    var href = p.url || ("https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=" + enc(title));
    var img = p.image
      ? '<img src="' + escapeHtml(p.image) + '" alt="">'
      : '<div class="ph"></div>';
    var src = p.shop
      ? (p.shop + (p.updated ? " · " + String(p.updated).slice(0, 10) : ""))
      : "Open Products Facts · EAN " + p.code;
    return '<article class="row offer product">' +
      '<div class="thumb">' + img + "</div>" +
      "<div class=\"meta\">" +
      "<header><h3>" + escapeHtml(title) + "</h3>" +
      '<p class="shop">' + escapeHtml(p.brand || p.shop || "") + "</p></header>" +
      '<p class="price">' + escapeHtml(priceText) + "</p>" +
      '<p class="src">' + escapeHtml(src) + "</p>" +
      '<p class="out"><a href="' + escapeHtml(href) + '" rel="noopener noreferrer">Zum Angebot</a></p>' +
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
        rows.sort(function (a, b) {
          var ap = typeof a.price === "number" ? a.price : 1e12;
          var bp = typeof b.price === "number" ? b.price : 1e12;
          return ap - bp;
        });
        var priced = rows.filter(function (r) { return typeof r.price === "number"; }).length;
        status.textContent = rows.length + " Produkte, " + priced + " mit Händlerpreis. Günstigster zuerst.";
        results.innerHTML = '<div class="sheet products">' + rows.map(card).join("") + "</div>" +
          '<p class="src note">Produktdaten: Open Products Facts / Open Food Facts. Preise: Pricelists.org über den Händler. Kein erfundenes Ranking.</p>';
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
