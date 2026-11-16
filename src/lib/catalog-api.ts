import { getApiBase } from "./admin-api";

export type CatalogProduct = {
  id: number;
  slug: string;
  name: string;
  status: string;
  brand?: string;
  type?: string;
  subtitle?: string;
  shortDescription?: string;
  description?: string;
  price: string | number;
  salePrice?: string | number | null;
  stock: number;
  mainImage?: string;
  additionalImages?: unknown;
  variants?: unknown;
  size?: string;
  rating?: string | number;
  reviews?: number;
  tags?: unknown;
  usage?: string;
  benefits?: unknown;
  ingredients?: unknown;
  metaTitle?: string;
  metaDescription?: string;
  updatedAt?: string;
  category?: { slug: string; name: string };
};
export type CatalogCategory = {
  slug: string;
  name: string;
  description?: string;
  status: string;
  updatedAt?: string;
};

// On same-origin production hosting, SSR needs an absolute URL; browsers can
// continue using the existing relative /api proxy. No credentials are involved.
export async function readCatalog<T>(
  resource: "products" | "product-categories",
  signal: AbortSignal,
  baseOverride?: string,
): Promise<T[]> {
  const base = baseOverride ?? getApiBase();
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${base}/api/${resource}?limit=100&page=${page}`, { signal });
    if (!response.ok) throw new Error(`Unable to load ${resource}: ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error(`Invalid ${resource} response`);
    items.push(...payload.data);
    if (page >= (payload.pagination?.totalPages ?? 1)) return items;
  }
}
