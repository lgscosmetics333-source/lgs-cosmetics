# LGS Cosmetics SEO

Production origin: https://lgscosmetics.com

Implemented:

- Separate titles and descriptions for public pages, category names from the catalog, and product meta title/description fields from the admin catalog.
- Canonical URLs without tracking parameters; Open Graph and Twitter previews, with product images on product pages.
- Server-rendered active product catalog, including product details and links before JavaScript runs.
- Store, WebSite, BreadcrumbList and Product/Offer JSON-LD. Product prices and availability come from the catalog. No invented ratings, hours or review counts.
- One home-page H1 and visible store introduction with links to the LGS collection and contact details.
- `noindex` for admin, account, checkout, wishlist, order and unknown pages. These HTML routes remain crawlable so search engines can read the rule; authentication must still protect private data.
- `/sitemap.xml` includes public pages and all paginated active products/categories. `/robots.txt` links to it. Sitemap returns HTTP 503 with Retry-After if the catalog is unavailable, rather than publishing an incomplete catalog sitemap.
- Missing or inactive products/categories return 404; catalog outages produce temporary server errors instead of false product 404s.

Validation: `npm run check:seo` runs an isolated Vite server against a fixture API, without touching the database. `npx tsc --noEmit` checks TypeScript. Fixture tests do not establish production connectivity or Google's rich-result eligibility.

## After deployment

1. Ensure the database and backend are available. Check `/sitemap.xml` returns HTTP 200 and includes real product URLs. Check product pages contain their description and Product JSON-LD in View Source.
2. Verify domain ownership in Google Search Console and submit `https://lgscosmetics.com/sitemap.xml`. Inspect the home, collection and product URLs and monitor indexing, impressions, clicks and search queries. Account access or a verification token is needed to complete this externally.
3. Test the live homepage/contact page and a real product in Google's Rich Results Test. Confirm structured addresses, phone numbers, prices and availability match visible content and business records.
4. Confirm the store name, address, phone and map link in Admin → Settings; use identical business information in Google Business Profile and legitimate directory/social profiles. The current code defaults are the existing LGS store details, rather than the older README's Lucky Varieties details.
5. Complete/verify Google Business Profile, add accurate business hours, real store/product photos and product categories. Request honest reviews from actual customers. No purchased reviews, paid link schemes or mass directory submissions.
6. Publish original product descriptions, ingredients, usage and useful skin/hair care articles through the existing admin tools. Avoid unsupported medical claims, repeated location pages or keyword stuffing.
7. Measure the deployed site on PageSpeed Insights, particularly mobile LCP, INP and CLS. Optimize the actual slow images/scripts identified there; no performance score has been claimed from local fixture tests.
8. Verify GA4 events in Tag Manager Preview/GA4 DebugView and publish the GA4 tag in container `GTM-PPVH6DSD`. Installing the container alone does not establish GA4 collection.

Rankings are an ongoing outcome, not something a code change can guarantee. No external listing, backlink, Search Console submission or deployment has been performed by these changes.

References:

- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://developers.google.com/search/docs/appearance/structured-data/product-snippet
- https://developers.google.com/search/docs/appearance/structured-data/local-business
- https://developers.google.com/search/docs/crawling-indexing/block-indexing
