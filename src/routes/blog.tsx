import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHero } from "@/components/commerce";
import { resolveImageUrl } from "@/lib/admin-api";
import { readCatalog } from "@/lib/catalog-api";
import skincareImage from "@/assets/cat-skincare.jpg";
import makeupImage from "@/assets/cat-makeup.jpg";

type Blog = {
  id: number;
  title: string;
  excerpt?: string;
  content?: string;
  featuredImage?: string;
  author?: string;
  status: string;
  category?: { slug?: string } | null;
};

function blogFallbackImage(blog: Blog) {
  return blog.category?.slug === "makeup-guides" ? makeupImage : skincareImage;
}

// Render editor-provided HTML as text; React escapes the result on both server and client.
function plainText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export const Route = createFileRoute("/blog")({
  loader: async () => {
    const posts = await readCatalog<Blog>("blogs", AbortSignal.timeout(5000));
    return posts.filter((post) => post.status === "Published").map((post) => ({
      ...post,
      excerpt: plainText(post.excerpt ?? ""),
      content: plainText(post.content ?? ""),
    }));
  },
  component: BlogPage,
});

function BlogPage() {
  const blogs = Route.useLoaderData();

  return (
    <AppShell>
      <PageHero title="LGS Cosmetics Blog" copy="Beauty tips, skin and hair care advice, and news from LGS Cosmetics." />
      <section aria-label="Blog articles" className="container-lv py-14">
        {blogs.length === 0 ? <p>Beauty stories are coming soon. Check back for our latest articles.</p> : (
          <div className="grid items-start gap-8 md:grid-cols-2 lg:grid-cols-3">
            {blogs.map((blog) => (
              <article key={blog.id} className="overflow-hidden border bg-white">
                <img
                  src={blog.featuredImage && blog.featuredImage !== "/assets/blog-placeholder.jpg" ? resolveImageUrl(blog.featuredImage) : blogFallbackImage(blog)}
                  alt={blog.title}
                  loading="lazy"
                  className="aspect-video w-full object-cover"
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = blogFallbackImage(blog);
                  }}
                />
                <div className="space-y-4 p-6">
                  <h2 className="text-2xl text-wine">{blog.title}</h2>
                  {blog.author && <p className="text-sm text-muted-foreground">By {blog.author}</p>}
                  <p className="leading-7 text-muted-foreground">{blog.excerpt}</p>
                  {blog.content && <details>
                    <summary className="cursor-pointer font-semibold text-wine">Read article</summary>
                    <p className="mt-4 whitespace-pre-line leading-7">{blog.content}</p>
                  </details>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
