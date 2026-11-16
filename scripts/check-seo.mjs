import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";

// Isolated public API fixtures: never reads or changes the real database.
let unavailable = false;
const products = [
  {
    id: 1,
    slug: "seo-test-cleanser",
    name: "SEO Test Cleanser",
    status: "Active",
    price: "299.00",
    salePrice: "249.00",
    stock: 5,
    brand: "LGS",
    shortDescription: "Gentle cleanser for your routine.",
    description: "Gentle cleanser for your routine.",
    mainImage: "/og-image.png",
    category: { slug: "skin-care", name: "Skin Care" },
    tags: ["bestseller"],
  },
  {
    id: 2,
    slug: "seo-test-shampoo",
    name: "SEO Test Shampoo",
    status: "Active",
    price: "199.00",
    stock: 0,
    category: { slug: "hair-care", name: "Hair Care" },
  },
  {
    id: 3,
    slug: "seo-test-inactive",
    name: "Inactive Product",
    status: "Inactive",
    price: "99.00",
    stock: 1,
  },
];
const categories = [
  {
    slug: "skin-care",
    name: "Skin Care",
    status: "Active",
    description: "Explore skin care products.",
  },
  { slug: "hair-care", name: "Hair Care", status: "Active" },
  { slug: "inactive-category", name: "Inactive Category", status: "Inactive" },
];
const api = createHttpServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Content-Type", "application/json");
  if (unavailable) {
    response.writeHead(503);
    response.end(JSON.stringify({ success: false }));
    return;
  }
  const url = new URL(request.url, "http://localhost");
  if (url.pathname.startsWith("/api/site-settings/")) {
    response.end(JSON.stringify({ data: null }));
    return;
  }
  const items =
    url.pathname === "/api/products"
      ? products
      : url.pathname === "/api/product-categories"
        ? categories
        : [];
  const page = Number(url.searchParams.get("page") || 1);
  response.end(
    JSON.stringify({
      data: items.slice((page - 1) * 2, page * 2),
      pagination: { totalPages: Math.max(1, Math.ceil(items.length / 2)) },
    }),
  );
});
await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
process.env.VITE_API_URL = `http://127.0.0.1:${api.address().port}`;
let vite;
try {
  vite = await createViteServer({ server: { port: 8093, strictPort: true, host: "127.0.0.1" } });
  await vite.listen();
  const base = vite.resolvedUrls.local[0];
  const read = async (path) => {
    const response = await fetch(new URL(path, base));
    return { response, html: await response.text() };
  };
  const schemas = (html) =>
    [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1]),
    );
  const home = await read("/");
  assert.equal(home.response.status, 200);
  assert.equal((home.html.match(/<h1\b/g) || []).length, 1);
  assert.ok(home.html.includes("SEO Test Cleanser"), "Products must be present in server HTML");
  assert.ok(schemas(home.html).some((item) => item["@type"] === "Store"));
  const store = schemas(home.html).find((item) => item["@type"] === "Store");
  assert.equal(store.address.addressLocality, "Koregaon");
  assert.equal(store.address.addressRegion, "Maharashtra");
  assert.equal(store.address.postalCode, "415501");
  assert.ok(schemas(home.html).some((item) => item["@type"] === "WebSite"));
  const shop = await read("/shop");
  assert.ok(shop.html.includes("Shop Beauty, Skin &amp; Hair Care Products"));
  assert.ok(shop.html.includes('rel="canonical" href="https://lgscosmetics.com/shop"'));
  const product = await read("/product/seo-test-cleanser");
  assert.equal(product.response.status, 200);
  assert.ok(product.html.includes("Gentle cleanser for your routine."));
  const schema = schemas(product.html).find((item) => item["@type"] === "Product");
  assert.equal(schema.name, "SEO Test Cleanser");
  assert.equal(schema.offers.price, 249);
  assert.equal(schema.offers.priceCurrency, "INR");
  assert.equal(schema.offers.availability, "https://schema.org/InStock");
  assert.ok(!("aggregateRating" in schema), "Do not invent review ratings");
  const outOfStock = await read("/product/seo-test-shampoo");
  assert.equal(
    schemas(outOfStock.html).find((item) => item["@type"] === "Product").offers.availability,
    "https://schema.org/OutOfStock",
  );
  assert.equal((await read("/product/missing-product")).response.status, 404);
  assert.equal((await read("/product/seo-test-inactive")).response.status, 404);
  assert.equal((await read("/shop/missing-category")).response.status, 404);
  const category = await read("/shop/skin-care");
  assert.equal(category.response.status, 200);
  assert.ok(category.html.includes("Skin Care Products | LGS Cosmetics"));
  const account = await read("/account");
  assert.ok(account.html.includes('name="robots" content="noindex, nofollow"'));
  const unknown = await read("/missing-information-page");
  assert.equal(unknown.response.status, 404);
  assert.ok(unknown.html.includes('name="robots" content="noindex, nofollow"'));
  const sitemap = await read("/sitemap.xml");
  assert.equal(sitemap.response.status, 200);
  assert.equal((sitemap.html.match(/<loc>/g) || []).length, 19);
  assert.ok(sitemap.html.includes("https://lgscosmetics.com/product/seo-test-cleanser"));
  assert.ok(!sitemap.html.includes("inactive"));
  assert.ok(!sitemap.html.includes("/account"));
  const robots = await read("/robots.txt");
  assert.ok(robots.html.includes("Sitemap: https://lgscosmetics.com/sitemap.xml"));
  assert.ok(!robots.html.includes("Disallow: /account"), "Crawler must be able to read noindex");
  unavailable = true;
  const failedSitemap = await read("/sitemap.xml");
  assert.equal(failedSitemap.response.status, 503);
  assert.equal(failedSitemap.response.headers.get("retry-after"), "300");
  const failedProduct = await read("/product/seo-test-cleanser");
  assert.ok(
    failedProduct.response.status >= 500,
    "API outages must not mark real products as missing",
  );
  console.log(
    "SEO checks passed: SSR products, unique metadata, JSON-LD, stock/price, real 404s, noindex, paginated sitemap, and outage behavior.",
  );
} finally {
  await vite?.close();
  await new Promise((resolve) => api.close(resolve));
}
