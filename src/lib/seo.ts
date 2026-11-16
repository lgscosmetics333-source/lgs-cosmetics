export const SITE_ORIGIN = "https://lgscosmetics.com";
export const SOCIAL_IMAGE = `${SITE_ORIGIN}/og-image.png`;

export const publicPageSeo: Record<string, { title: string; description: string }> = {
  "/": {
    title: "LGS Cosmetics | Skin & Hair Care in Koregaon, Satara",
    description:
      "Explore LGS skincare, hair care and personal care products in Koregaon, Satara. Shop online or visit LGS Cosmetics on Koregaon-Rahimatpur Road.",
  },
  "/shop": {
    title: "Shop Beauty, Skin & Hair Care Products | LGS Cosmetics",
    description:
      "Browse skincare, hair care and everyday beauty products at LGS Cosmetics. Explore our collections online and visit our cosmetics store in Koregaon, Satara.",
  },
  "/new-arrivals": {
    title: "New Beauty & Skincare Arrivals | LGS Cosmetics",
    description:
      "Discover newly added skin care, hair care and personal care products at LGS Cosmetics, Koregaon. Explore the latest additions to our beauty collection.",
  },
  "/best-sellers": {
    title: "Best-Selling Beauty Products | LGS Cosmetics",
    description:
      "Explore the best-seller collection of skincare, hair care and beauty essentials at LGS Cosmetics in Koregaon, Satara.",
  },
  "/lgs-products": {
    title: "LGS Skin & Hair Care Collection | LGS Cosmetics",
    description:
      "Explore our own LGS range of skincare and hair care products. Find products for your everyday beauty routine online or at our Koregaon store.",
  },
  "/offers": {
    title: "Beauty & Skincare Offers | LGS Cosmetics",
    description:
      "Browse current offers on beauty, skin care and hair care products at LGS Cosmetics. View product prices and availability before placing your order.",
  },
  "/about": {
    title: "About Our Cosmetics Store in Koregaon | LGS Cosmetics",
    description:
      "Learn about LGS Cosmetics, your skin care, hair care and beauty destination in Koregaon, Satara. Discover our store and our own LGS product range.",
  },
  "/contact": {
    title: "Contact & Visit Our Koregaon Store | LGS Cosmetics",
    description:
      "Find the LGS Cosmetics address, phone number and directions. Visit us on Koregaon-Rahimatpur Road, near Police Station, Koregaon, Maharashtra.",
  },
  "/blog": {
    title: "Beauty, Skin & Hair Care Blog | LGS Cosmetics",
    description:
      "Read beauty tips, skincare and hair care articles, product information and the latest news from LGS Cosmetics in Koregaon, Satara.",
  },
  "/gallery": {
    title: "Beauty Store & Product Gallery | LGS Cosmetics",
    description:
      "Explore the LGS Cosmetics gallery for a look at our beauty collections, products and store in Koregaon, Satara.",
  },
  "/faqs": {
    title: "Shopping & Product FAQs | LGS Cosmetics",
    description:
      "Find answers to common questions about shopping, products, orders and visiting LGS Cosmetics in Koregaon, Satara.",
  },
  "/shipping-information": {
    title: "Shipping & Delivery Information | LGS Cosmetics",
    description:
      "Read shipping and delivery information for LGS Cosmetics orders, including the details to review before ordering your beauty products.",
  },
  "/return-policy": {
    title: "Cancellation & Return Policy | LGS Cosmetics",
    description:
      "Review the cancellation and return policy for LGS Cosmetics orders. Learn what to check before requesting a return or contacting our team.",
  },
  "/privacy-policy": {
    title: "Privacy Policy | LGS Cosmetics",
    description:
      "Read how LGS Cosmetics handles customer information, website data and privacy when you browse our store or place an order.",
  },
  "/terms-and-conditions": {
    title: "Terms & Conditions | LGS Cosmetics",
    description:
      "Read the terms and conditions for using the LGS Cosmetics website and purchasing beauty, skincare and hair care products.",
  },
};

export function isPrivatePath(path: string) {
  return /^\/(admin|account|checkout|wishlist|orders|api)(\/|$)/.test(path);
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function breadcrumbSchema(path: string, title: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
      ...(path === "/"
        ? []
        : [
            {
              "@type": "ListItem",
              position: 2,
              name: title.split(" | ")[0],
              item: `${SITE_ORIGIN}${path}`,
            },
          ]),
    ],
  };
}
