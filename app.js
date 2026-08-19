(function () {
  const form = document.getElementById("search-form");
  const input = document.getElementById("q");
  const results = document.getElementById("results");
  const status = document.getElementById("status");
  if (!form || !input || !results) return;

  const shops = [
    { name: "Amazon", href: (q) => "https://www.amazon.de/s?k=" + encodeURIComponent(q) },
    { name: "Otto", href: (q) => "https://www.otto.de/suche/" + encodeURIComponent(q.replace(/\s+/g, "+")) },
    { name: "MediaMarkt", href: (q) => "https://www.mediamarkt.de/de/search.html?query=" + encodeURIComponent(q) },
    { name: "Idealo", href: (q) => "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=" + encodeURIComponent(q) }
  ];

  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9äöüß\s]/gi, " ").replace(/\s+/g, " ").trim();
  }
  function money(n, c) {
    const cur = c === "EUR" ? "EUR" : "USD";
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: cur }).format(n);
  }
  function score(offer, query) {
    const nq = norm(query);
    if (!nq) return 0;
    const hay = norm([offer.product, offer.shop].concat(offer.q || []).join(" "));
    if (hay.indexOf(nq) !== -1) return 100;
    const parts = nq.split(" ").filter(function (p) { return p.length > 1; });
    if (!parts.length) return 0;
    var hit = 0;
    for (var i = 0; i < parts.length; i++) if (hay.indexOf(parts[i]) !== -1) hit++;
    return hit === 0 ? 0 : (hit / parts.length) * 80;
  }

  function card(title, shop, priceText, source, href, cta) {
    const art = document.createElement("article");
    art.className = "row offer";
    art.innerHTML = "<header><h3></h3><p class=\"shop\"></p></header><p class=\"price\"></p><p class=\"src\"></p><p class=\"out\"><a rel=\"noopener noreferrer\"></a></p>";
    art.querySelector("h3").textContent = title;
    art.querySelector(".shop").textContent = shop;
    art.querySelector(".price").textContent = priceText;
    art.querySelector(".src").textContent = source;
    const a = art.querySelector("a");
    a.href = href;
    a.textContent = cta || "Zum Angebot";
    return art;
  }

  function render(query, offers) {
    results.innerHTML = "";
    const q = (query || "").trim();
    if (!q) {
      status.textContent = "";
      return;
    }
    const list = document.createElement("div");
    list.className = "sheet";

    const ranked = (offers || [])
      .map(function (o) { return { o: o, s: score(o, q) }; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) {
        if (a.o.currency !== b.o.currency) return a.o.currency < b.o.currency ? -1 : 1;
        return a.o.price - b.o.price;
      });

    ranked.forEach(function (x) {
      var o = x.o;
      list.appendChild(card(
        o.product,
        o.shop,
        money(o.price, o.currency) + (o.period ? " / " + o.period : ""),
        o.source,
        o.url,
        "Zum Angebot"
      ));
    });

    shops.forEach(function (s) {
      list.appendChild(card(
        q,
        s.name,
        "Preis im Shop",
        "Suche bei " + s.name,
        s.href(q),
        "Im Shop öffnen"
      ));
    });

    status.textContent = (ranked.length + shops.length) + " Treffer für „" + q + "“";
    results.appendChild(list);
  }

  function load() {
    return fetch("angebote.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : { offers: [] }; })
      .then(function (d) { return d.offers || []; })
      .catch(function () { return []; });
  }

  function run(q) {
    load().then(function (offers) { render(q, offers); });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var q = input.value.trim();
    var url = new URL(location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    run(q);
  });

  var start = new URLSearchParams(location.search).get("q") || "";
  if (start) {
    input.value = start;
    run(start);
  }
})();
