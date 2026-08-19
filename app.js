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
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9äöüß\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function money(n, c) {
    if (c === "EUR") return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(n);
  }
  function score(offer, query) {
    const nq = norm(query);
    if (!nq) return 0;
    const hay = norm([offer.product, offer.shop].concat(offer.q || []).join(" "));
    if (hay.includes(nq)) return 100;
    const parts = nq.split(" ").filter(Boolean);
    let hit = 0;
    for (const p of parts) if (hay.includes(p)) hit += 1;
    return hit === 0 ? 0 : (hit / parts.length) * 80;
  }

  function shopRow(q) {
    const wrap = document.createElement("section");
    wrap.className = "shop-search";
    wrap.innerHTML = "<h2>In den Shops suchen</h2><p>Ohne unseren sourced Preis. Der Shop zeigt dir seine eigenen Angebote.</p>";
    const ul = document.createElement("ul");
    ul.className = "shop-list";
    shops.forEach((s) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = s.href(q);
      a.rel = "noopener noreferrer";
      a.textContent = "Suche auf " + s.name;
      li.appendChild(a);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function render(query, offers) {
    results.innerHTML = "";
    const q = query.trim();
    if (!q) {
      status.textContent = "";
      return;
    }
    const ranked = offers
      .map((o) => ({ o, s: score(o, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => {
        if (a.o.currency !== b.o.currency) return a.o.currency.localeCompare(b.o.currency);
        return a.o.price - b.o.price;
      });

    if (ranked.length) {
      status.textContent = ranked.length + " Angebote, günstigster Preis zuerst. Kein erfundenes Ranking.";
      const list = document.createElement("div");
      list.className = "sheet";
      ranked.forEach(({ o }) => {
        const art = document.createElement("article");
        art.className = "row offer";
        art.innerHTML =
          "<header><h3></h3><p class=\"shop\"></p></header>" +
          "<p class=\"price\"></p>" +
          "<p class=\"src\"></p>" +
          "<p class=\"out\"><a rel=\"noopener noreferrer\"></a></p>";
        art.querySelector("h3").textContent = o.product;
        art.querySelector(".shop").textContent = o.shop;
        art.querySelector(".price").textContent = money(o.price, o.currency) + (o.period ? " / " + o.period : "");
        art.querySelector(".src").textContent = o.source;
        const a = art.querySelector("a");
        a.href = o.url;
        a.textContent = "Zum Angebot";
        list.appendChild(art);
      });
      results.appendChild(list);
    } else {
      status.textContent = "Dazu haben wir noch keinen sourced Preis. Suche direkt im Shop.";
    }
    results.appendChild(shopRow(q));
  }

  let cache = null;
  function load() {
    if (cache) return Promise.resolve(cache);
    return fetch("angebote.json", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      cache = d.offers || [];
      return cache;
    });
  }

  function run(q) {
    load().then((offers) => render(q, offers)).catch(() => {
      status.textContent = "Angebote gerade nicht lesbar.";
    });
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    const url = new URL(location.href);
    if (q) url.searchParams.set("q", q); else url.searchParams.delete("q");
    history.replaceState(null, "", url);
    run(q);
  });

  const start = new URLSearchParams(location.search).get("q") || "";
  if (start) {
    input.value = start;
    run(start);
  }
})();
