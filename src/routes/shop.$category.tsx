import { createFileRoute, notFound } from "@tanstack/react-router";
import { AppShell, CatalogPage } from "@/components/commerce";
export const Route = createFileRoute("/shop/$category")({
  loader: async ({ params, parentMatchPromise }) => {
    const parent = await parentMatchPromise;
    const categories = parent?.loaderData?.categories;
    if (!categories)
      throw new Error("Collections are temporarily unavailable. Please try again shortly.");
    const category = categories.find((item) => item.slug === params.category);
    if (!category) throw notFound();
    return { category };
  },
  component: Page,
});
function Page() {
  const { category } = Route.useParams();
  return (
    <AppShell>
      <CategoryContent category={category} />
    </AppShell>
  );
}

function CategoryContent({ category }: { category: string }) {
  const { category: current } = Route.useLoaderData();
  return <CatalogPage title={current.name} filter={(product) => product.category === category} />;
}
