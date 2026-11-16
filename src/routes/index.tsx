import { createFileRoute } from "@tanstack/react-router";
import { AppShell, HomePage } from "@/components/commerce";

// The home route inherits SEO metadata and structured data from __root.tsx.
export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <AppShell>
      <HomePage />
    </AppShell>
  );
}
