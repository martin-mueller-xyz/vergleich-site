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
  function containsAll(text, q) {
    var qt = tokens(q);
    if (!qt.length) return false;
    var hay = norm(text);
    for (var i = 0; i < qt.length; i++) if (hay.indexOf(qt[i]) === -1) return false;
    return true;
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
          if (!containsAll(name + " " + (p.brands || ""), q)) return;
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
          return containsAll(p.plistTitle || p.name, q);
        });
        rows.sort(function (a, b) {
          var ap = typeof a.price === "number" ? a.price : 1e12;
          var bp = typeof b.price === "number" ? b.price : 1e12;
          return ap - bp;
        });
        status.textContent = rows.length + " Produkte. Link geht auf die Suche nach genau diesem Modell.";
        results.innerHTML = '<div class="sheet products">' + rows.map(card).join("") + "</div>" +
          '<p class="src note">Nur Treffer, deren Name zur Suche passt. Klick sucht dieses Modell bei Idealo oder Amazon — kein fremder Redirect mehr.</p>';
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
