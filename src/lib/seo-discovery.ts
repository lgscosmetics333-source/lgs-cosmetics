import { readCatalog, type CatalogProduct, type CatalogCategory } from "./catalog-api";
import { SITE_ORIGIN, publicPageSeo } from "./seo";

function escapeXml(value: string) {
  return value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );
}

/** Serve SEO discovery files with the canonical production domain. */
export async function seoDiscoveryResponse(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);
  const headers = { "Cache-Control": "public, max-age=3600" };

  if (pathname === "/robots.txt") {
    return new Response(
      [
        "User-agent: *",
        "Allow: /",
        // HTML noindex handles account/admin routes. Let crawlers read that rule.
        "Disallow: /api/",
        "",
        `Sitemap: ${SITE_ORIGIN}/sitemap.xml`,
        "",
      ].join("\n"),
      {
        headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
      },
    );
  }

  if (pathname === "/sitemap.xml") {
    try {
      const signal = AbortSignal.timeout(5000);
      const [products, categories] = await Promise.all([
        readCatalog<CatalogProduct>("products", signal),
        readCatalog<CatalogCategory>("product-categories", signal),
      ]);
      const paths = new Set([
        ...Object.keys(publicPageSeo),
        ...products
          .filter((item) => item.status === "Active" && item.slug)
          .map((item) => `/product/${encodeURIComponent(item.slug)}`),
        ...categories
          .filter((item) => item.status === "Active" && item.slug)
          .map((item) => `/shop/${encodeURIComponent(item.slug)}`),
      ]);
      const urls = [...paths]
        .map((path) => `  <url><loc>${escapeXml(new URL(path, SITE_ORIGIN).href)}</loc></url>`)
        .join("\n");
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        { headers: { ...headers, "Content-Type": "application/xml; charset=utf-8" } },
      );
    } catch (error) {
      console.error("Unable to generate complete sitemap", error);
      // Avoid telling crawlers that real product URLs disappeared during outages.
      return new Response("Sitemap temporarily unavailable. Please retry shortly.", {
        status: 503,
        headers: {
          "Retry-After": "300",
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  }

  return undefined;
}
