import assert from "node:assert/strict";
import { access, cp, copyFile, mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

// Run outside the repository, so missing packaged dependencies cannot silently
// resolve from the developer's node_modules. Database persistence and providers
// use fixtures; the real HTTP server, API controllers and SSR renderer run.
process.env.NODE_ENV = "production";
process.env.FRONTEND_URL = "https://lgscosmetics.com";
process.env.CUSTOMER_AUTH_URL = "https://lgscosmetics.com";
process.env.JWT_SECRET = "hostinger-test-only-jwt-secret-32-characters";
process.env.CUSTOMER_AUTH_SECRET = "hostinger-test-only-auth-secret-32-characters";
process.env.RAZORPAY_ENABLED = "false";
process.env.RESEND_ENABLED = "false";
process.env.EKART_ENABLED = "false";
Object.assign(process.env, {
  DB_HOST: "127.0.0.1",
  DB_PORT: "1",
  DB_NAME: "fixture_only",
  DB_USER: "fixture_only",
  DB_PASSWORD: "fixture_only",
});
await access(new URL("../.output/app.mjs", import.meta.url));
const temporaryRelease = await mkdtemp(path.join(tmpdir(), "lgs-hostinger-check-"));
process.once("exit", () => {
  // Only remove the exact disposable directory created by this test.
  const resolved = path.resolve(temporaryRelease);
  if (
    path.dirname(resolved) === path.resolve(tmpdir()) &&
    path.basename(resolved).startsWith("lgs-hostinger-check-")
  ) {
    rmSync(resolved, { recursive: true, force: true });
  }
});
await cp(new URL("../.output/", import.meta.url), temporaryRelease, { recursive: true });
process.env.UPLOAD_DIR = path.join(temporaryRelease, "fixture-uploads");
await mkdir(process.env.UPLOAD_DIR);
await copyFile(
  new URL("../public/og-image.png", import.meta.url),
  path.join(process.env.UPLOAD_DIR, "fixture-image.png"),
);
const releaseModule = (relative) => pathToFileURL(path.join(temporaryRelease, relative)).href;
const packagedFiles = await readdir(new URL("../.output/backend", import.meta.url), {
  recursive: true,
});
assert.ok(
  !packagedFiles.some((file) => /(^|[\\/])\.env(?:$|\.)/.test(file)),
  "Never publish environment files",
);
const nitro = JSON.parse(await readFile(new URL("../.output/nitro.json", import.meta.url), "utf8"));
assert.equal(nitro.preset, "node-middleware");

const { startCombinedServer } = await import(releaseModule("hostinger.mjs"));
const { Product, ProductCategory, SiteSetting, syncModels } = await import(
  releaseModule("backend/models/index.js")
);
const { customerAuth, customerPool } = await import(
  releaseModule("backend/config/customer-auth.js")
);
syncModels();
syncModels(); // Database retries must not register duplicate Sequelize aliases.
assert.ok(Product.associations.category);
// The real auth adapter still runs, but its handler is a fixture: exercising
// Better Auth's schema/session persistence needs a separate MySQL integration test.
customerPool.query = customerPool.execute = async () => {
  throw new Error("Unexpected database access in fixture test");
};
customerAuth.handler = async (request) => {
  if (new URL(request.url).pathname.endsWith("/get-session")) {
    return Response.json(null, { headers: { "Set-Cookie": "lgs-fixture=1; Path=/; HttpOnly" } });
  }
  const body = await request.json();
  assert.deepEqual(body, {});
  return Response.json({ code: "MISSING_FIELDS" }, { status: 400 });
};
const product = {
  id: 1,
  slug: "combined-test-cleanser",
  name: "Combined Test Cleanser",
  status: "Active",
  price: "299.00",
  salePrice: "249.00",
  stock: 5,
  brand: "LGS",
  shortDescription: "Combined app test product.",
  mainImage: "/og-image.png",
  category: { slug: "skin-care", name: "Skin Care" },
  tags: ["bestseller"],
};
Product.findAndCountAll = async () => ({ count: 1, rows: [product] });
Product.findAll = async () => [{ slug: product.slug }];
ProductCategory.findAll = async () => [{ slug: "skin-care" }];
ProductCategory.findAndCountAll = async () => ({
  count: 1,
  rows: [{ slug: "skin-care", name: "Skin Care", status: "Active" }],
});
SiteSetting.findByPk = async () => null;

let initialized = 0;
let app = await startCombinedServer({
  port: 0,
  hostname: "127.0.0.1",
  initialize: async () => {
    initialized++;
  },
});
try {
  await app.initialization;
  assert.equal(initialized, 1);
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal(process.env.LGS_INTERNAL_API_ORIGIN, origin);
  const read = async (path, options) => {
    const response = await fetch(`${origin}${path}`, options);
    return { response, text: await response.text() };
  };
  const health = await read("/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(JSON.parse(health.text).success, true);
  const products = await read("/api/products");
  assert.equal(products.response.status, 200);
  assert.equal(JSON.parse(products.text).data[0].slug, product.slug);
  const home = await read("/");
  assert.equal(home.response.status, 200);
  assert.ok(home.text.includes(product.name), "SSR must get products from the API in this process");
  assert.ok(home.text.includes("GTM-PPVH6DSD"));
  assert.ok(
    !home.text.includes("http://localhost:5000"),
    "No browser request to a separate backend",
  );
  const details = await read(`/product/${product.slug}`);
  assert.equal(details.response.status, 200);
  assert.ok(details.text.includes("Combined app test product."));
  assert.ok(details.text.includes('"@type":"Product"'));
  assert.equal((await read("/product/missing-product")).response.status, 404);
  const sitemap = await read("/sitemap.xml");
  assert.equal(sitemap.response.status, 200);
  assert.ok(sitemap.text.includes(`/product/${product.slug}`));
  const robots = await read("/robots.txt");
  assert.equal(robots.response.status, 200);
  const verification = await read("/google1c15fb62e2b5282c.html");
  assert.equal(verification.response.status, 200);
  assert.equal(verification.text.trim(), "google-site-verification: google1c15fb62e2b5282c.html");
  const image = await fetch(`${origin}/og-image.png`);
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/png/);
  await image.arrayBuffer();
  const missingApi = await read("/api/not-a-route");
  assert.equal(missingApi.response.status, 404);
  assert.equal(JSON.parse(missingApi.text).success, false);
  assert.equal((await read("/uploads/missing-image.jpg")).response.status, 404);
  const upload = await fetch(`${origin}/uploads/fixture-image.png`);
  assert.equal(upload.status, 200);
  assert.match(upload.headers.get("content-type"), /image\/png/);
  await upload.arrayBuffer();
  const { saveInstagramPreview } = await import(
    releaseModule("backend/services/instagramPreview.js")
  );
  const realFetch = globalThis.fetch;
  let previewPath;
  try {
    globalThis.fetch = async (url) =>
      String(url).includes("cdninstagram.com")
        ? new Response("fixture-image", { headers: { "Content-Type": "image/jpeg" } })
        : new Response(
            '<meta property="og:image" content="https://test.cdninstagram.com/image.jpg">',
          );
    previewPath = await saveInstagramPreview("https://www.instagram.com/p/fixture/");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(
    (await fetch(`${origin}${previewPath}`)).status,
    200,
    "Instagram previews must use the shared persistent uploads directory",
  );
  const adminLogin = await read("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(adminLogin.response.status, 400, "Admin login JSON must reach the API body parser");
  const forbidden = await read("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(forbidden.response.status, 401, "Admin writes must remain authenticated");
  const session = await read("/api/customer-auth/get-session");
  assert.equal(session.response.status, 200);
  assert.equal(JSON.parse(session.text), null);
  assert.ok(session.response.headers.get("set-cookie").includes("lgs-fixture=1"));
  const signin = await read("/api/customer-auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://lgscosmetics.com" },
    body: "{}",
  });
  assert.equal(
    signin.response.status,
    400,
    "Better Auth must receive and validate its own request body",
  );
} finally {
  await app.close();
}

// Database failures must not take down static files or the whole storefront.
app = await startCombinedServer({
  port: 0,
  hostname: "127.0.0.1",
  initialize: async () => {
    throw new Error("Fixture database unavailable");
  },
});
try {
  await app.initialization;
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${origin}/api/health`)).status, 503);
  assert.equal((await fetch(`${origin}/api/products`)).status, 503);
  assert.equal((await fetch(`${origin}/`)).status, 200);
  assert.equal((await fetch(`${origin}/google1c15fb62e2b5282c.html`)).status, 200);
  assert.equal((await fetch(`${origin}/sitemap.xml`)).status, 503);
} finally {
  await app.close();
}
console.log(
  "Combined Hostinger checks passed: one listener, API routing, SSR catalog, auth guards/adapter/cookie forwarding, static files, sitemap and database-outage handling. Database/auth persistence uses fixtures.",
);
