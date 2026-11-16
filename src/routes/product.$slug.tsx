import { createFileRoute, notFound } from "@tanstack/react-router";
import { AppShell, ProductPage } from "@/components/commerce";
import { useShop } from "@/lib/shop-store";
export const Route = createFileRoute("/product/$slug")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    const products = parent?.loaderData?.products;
    // A database outage is a temporary error, never proof a product is gone.
    if (!products)
      throw new Error("Products are temporarily unavailable. Please try again shortly.");
    if (!products.some((product) => product.slug === params.slug)) throw notFound();
  },
  component: Page,
});
function Page() {
  return (
    <AppShell>
      <ProductDetails />
    </AppShell>
  );
}
function ProductDetails() {
  const { slug } = Route.useParams();
  const { catalogProducts } = useShop();
  const p = catalogProducts.find((product) => product.slug === slug);
  if (!p) throw notFound();
  return <ProductPage product={p} />;
}
