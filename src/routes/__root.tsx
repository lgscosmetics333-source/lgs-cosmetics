import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import {
  GeneralSettingsProvider,
  buildSiteSettings,
  type GeneralSettings,
} from "@/lib/general-settings";
import { readSiteSetting, seoDefaults } from "@/lib/site-settings";
import { ShopProvider } from "@/lib/shop-store";
import { readCatalog, type CatalogProduct, type CatalogCategory } from "@/lib/catalog-api";
import { resolveImageUrl } from "@/lib/admin-api";
import {
  SITE_ORIGIN,
  SOCIAL_IMAGE,
  publicPageSeo,
  isPrivatePath,
  breadcrumbSchema,
  jsonLd,
} from "@/lib/seo";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

const metaPixelId = "2182835415602333";
const metaPixelScript = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${metaPixelId}');
fbq('track', 'PageView');`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: async ({ location }) => {
    try {
      const [seo, settings, products, categories] = await Promise.all([
        readSiteSetting<typeof seoDefaults>("seo", AbortSignal.timeout(2000)).catch(() => null),
        readSiteSetting<GeneralSettings>("general", AbortSignal.timeout(2000)).catch(() => null),
        isPrivatePath(location.pathname)
          ? Promise.resolve(null)
          : readCatalog<CatalogProduct>("products", AbortSignal.timeout(4000))
              .then((items) => items.filter((item) => item.status === "Active"))
              .catch(() => null),
        isPrivatePath(location.pathname)
          ? Promise.resolve(null)
          : readCatalog<CatalogCategory>("product-categories", AbortSignal.timeout(4000))
              .then((items) => items.filter((item) => item.status === "Active"))
              .catch(() => null),
      ]);
      return { seo: { ...seoDefaults, ...seo }, settings, products, categories };
    } catch {
      return { seo: seoDefaults, settings: null, products: null, categories: null };
    }
  },
  head: ({ loaderData, matches }) => {
    const pathname = matches[matches.length - 1]?.pathname.replace(/\/+$/, "") || "/";
    const pageUrl = new URL(pathname, SITE_ORIGIN).href;
    const socialImage = SOCIAL_IMAGE;
    const page = publicPageSeo[pathname];
    const product = pathname.startsWith("/product/")
      ? loaderData?.products?.find((item) => `/product/${item.slug}` === pathname)
      : undefined;
    const category = loaderData?.categories?.find((item) => `/shop/${item.slug}` === pathname);
    const title = product
      ? product.metaTitle || `${product.name} | LGS Cosmetics`
      : pathname === "/"
        ? loaderData?.seo.title || seoDefaults.title
        : page?.title ||
          (category ? `${category.name} Products | LGS Cosmetics` : "Page | LGS Cosmetics");
    const description = product
      ? product.metaDescription ||
        product.shortDescription ||
        product.subtitle ||
        `Explore ${product.name} at LGS Cosmetics in Koregaon, Satara.`
      : pathname === "/"
        ? loaderData?.seo.description || seoDefaults.description
        : page?.description ||
          (category
            ? category.description ||
              `Explore ${category.name} products at LGS Cosmetics. Browse our beauty collection online or visit our store in Koregaon, Satara.`
            : seoDefaults.description);
    const noindex = isPrivatePath(pathname) || (!page && !category && !product);
    const socialTitle = pathname === "/" ? loaderData?.seo.socialTitle || title : title;
    const socialDescription =
      pathname === "/" ? loaderData?.seo.socialDescription || description : description;
    const productImage = product?.mainImage
      ? new URL(resolveImageUrl(product.mainImage), SITE_ORIGIN).href
      : socialImage;
    const { site } = buildSiteSettings(loaderData?.settings);
    const [locality, region = ""] = site.address.line2.split(",");
    const postalCode = region.match(/\b\d{6}\b/)?.[0];
    const business = {
      "@context": "https://schema.org",
      "@type": "Store",
      "@id": `${SITE_ORIGIN}/#store`,
      name: site.name,
      url: SITE_ORIGIN,
      image: socialImage,
      logo: socialImage,
      telephone: site.phones[0],
      address: {
        "@type": "PostalAddress",
        streetAddress: site.address.line1,
        addressLocality: locality?.trim(),
        addressCountry: "IN",
        ...(region.trim() ? { addressRegion: region.replace(/\b\d{6}\b/, "").trim() } : {}),
        ...(postalCode ? { postalCode } : {}),
      },
      sameAs: [site.instagram, site.facebook].filter((value) => /^https?:\/\//.test(value)),
      ...(site.mapsLink ? { hasMap: site.mapsLink } : {}),
    };
    const structuredData: unknown[] = noindex ? [] : [breadcrumbSchema(pathname, title)];
    if (pathname === "/" || pathname === "/contact" || pathname === "/about")
      structuredData.push(business);
    if (pathname === "/")
      structuredData.push({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "@id": `${SITE_ORIGIN}/#website`,
        url: SITE_ORIGIN,
        name: site.name,
        publisher: { "@id": `${SITE_ORIGIN}/#store` },
      });
    if (product)
      structuredData.push({
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description,
        image: productImage,
        ...(product.brand ? { brand: { "@type": "Brand", name: product.brand } } : {}),
        offers: {
          "@type": "Offer",
          url: pageUrl,
          priceCurrency: "INR",
          price: Number(product.salePrice ?? product.price),
          availability: `https://schema.org/${Number(product.stock) > 0 ? "InStock" : "OutOfStock"}`,
          seller: { "@id": `${SITE_ORIGIN}/#store` },
        },
      });
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        {
          name: "description",
          content: description,
        },
        { name: "author", content: "LGS Cosmetics" },
        { name: "keywords", content: loaderData?.seo.keywords ?? seoDefaults.keywords },
        {
          name: "robots",
          content: noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large",
        },
        { property: "og:title", content: socialTitle },
        {
          property: "og:description",
          content: socialDescription,
        },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "LGS Cosmetics" },
        { property: "og:locale", content: "en_IN" },
        { property: "og:url", content: pageUrl },
        { property: "og:image", content: productImage },
        { property: "og:image:secure_url", content: productImage },
        { property: "og:image:alt", content: product?.name || "LGS Cosmetics logo" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: productImage },
        { name: "twitter:image:alt", content: product?.name || "LGS Cosmetics logo" },
        { name: "twitter:title", content: socialTitle },
        { name: "twitter:description", content: socialDescription },
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
        ...(!noindex ? [{ rel: "canonical", href: pageUrl }] : []),
      ],
      scripts: structuredData.map((data) => ({
        type: "application/ld+json",
        children: jsonLd(data),
      })),
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
var gtmScript = document.createElement('script');
gtmScript.async = true;
gtmScript.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-PPVH6DSD';
document.head.appendChild(gtmScript);`,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: metaPixelScript }} />
        <HeadContent />
      </head>
      <body>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${metaPixelId}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { settings, products } = Route.useLoaderData();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <GeneralSettingsProvider initialSettings={settings}>
        <ShopProvider initialProducts={products}>
          <Outlet />
        </ShopProvider>
      </GeneralSettingsProvider>
    </QueryClientProvider>
  );
}
