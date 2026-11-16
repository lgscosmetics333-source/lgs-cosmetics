import "./config/env.js";
import { razorpayWebhook } from "./services/razorpayService.js";
import { startOrderEmailWorker } from "./services/orderEmailService.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import { uploadsDirectory } from "./config/paths.js";
import { initializeDatabase } from "./config/database.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { authRoutes } from "./routes/authRoutes.js";
import { productRoutes } from "./routes/productRoutes.js";
import { productCategoryRoutes } from "./routes/productCategoryRoutes.js";
import { blogRoutes } from "./routes/blogRoutes.js";
import { blogCategoryRoutes } from "./routes/blogCategoryRoutes.js";
import { orderRoutes } from "./routes/orderRoutes.js";
import { enquiryRoutes } from "./routes/enquiryRoutes.js";
import { couponRoutes } from "./routes/couponRoutes.js";
import { dashboardRoutes } from "./routes/dashboardRoutes.js";
import { instagramPostRoutes } from "./routes/instagramPostRoutes.js";
import { siteSettingRoutes } from "./routes/siteSettingRoutes.js";
import { adminUserRoutes } from "./routes/adminUserRoutes.js";
import { reviewRoutes } from "./routes/reviewRoutes.js";
import { toNodeHandler } from "better-auth/node";
import { getMigrations } from "better-auth/db/migration";
import { customerAuth, customerPool } from "./config/customer-auth.js";
import { customerRoutes } from "./routes/customerRoutes.js";
import { shippingRoutes, startEkartTrackingWorker } from "./routes/shippingRoutes.js";
import { Product, ProductCategory } from "./models/index.js";

export function createBackendApp({ frontend, publicDirectory, isReady = () => true } = {}) {
  const app = express();
  app.set("trust proxy", 1);

  app.use(
    cors({
      origin: (origin, callback) => {
        const configured = process.env.FRONTEND_URL || "http://localhost:8082";
        const allowed =
          !origin ||
          origin === configured ||
          (process.env.NODE_ENV !== "production" &&
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
        callback(null, allowed);
      },
      credentials: true,
    }),
  );
  // The combined deployment reads the catalog directly, avoiding network
  // calls back to the host's own public or loopback address.
  if (frontend) app.get("/sitemap.xml", async (_req, res) => {
    if (!isReady()) return res.status(503).set("Retry-After", "300").set("Cache-Control", "no-store").send("Sitemap temporarily unavailable. Please retry shortly.");
    try {
      const [products, categories] = await Promise.all([
        Product.findAll({ attributes: ["slug"], where: { status: "Active" }, raw: true }),
        ProductCategory.findAll({ attributes: ["slug"], where: { status: "Active" }, raw: true }),
      ]);
      const pages = ["/", "/shop", "/new-arrivals", "/best-sellers", "/lgs-products", "/offers", "/about", "/contact", "/blog", "/gallery", "/faqs", "/shipping-information", "/return-policy", "/privacy-policy", "/terms-and-conditions"];
      const paths = new Set([...pages, ...products.filter(p => p.slug).map(p => `/product/${encodeURIComponent(p.slug)}`), ...categories.filter(c => c.slug).map(c => `/shop/${encodeURIComponent(c.slug)}`)]);
      const urls = [...paths].map(path => `  <url><loc>https://lgscosmetics.com${path.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</loc></url>`).join("\n");
      return res.set("Cache-Control", "public, max-age=3600").type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
    } catch (error) {
      console.error("Unable to generate sitemap from database", error);
      return res.status(503).set("Retry-After", "300").set("Cache-Control", "no-store").send("Sitemap temporarily unavailable. Please retry shortly.");
    }
  });
  app.get("/api/health", (_req, res) => {
    const ready = isReady();
    res
      .status(ready ? 200 : 503)
      .json({
        success: ready,
        message: ready ? "LGS backend is healthy" : "Database is connecting. Please retry shortly.",
      });
  });
  app.use("/api", (_req, res, next) => {
    if (isReady()) return next();
    return res
      .status(503)
      .set("Retry-After", "30")
      .json({
        success: false,
        message: "The store service is temporarily unavailable. Please retry shortly.",
      });
  });
  app.all("/api/customer-auth/*splat", toNodeHandler(customerAuth));
  app.post(
    "/api/payments/razorpay/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    razorpayWebhook,
  );
  app.use("/api", express.json({ limit: "10mb" }), express.urlencoded({ extended: true }));
  app.use("/uploads", express.static(uploadsDirectory));
  if (publicDirectory) app.use("/uploads", express.static(path.join(path.dirname(publicDirectory), "legacy-uploads")));
  app.use("/uploads", notFound);

  app.use("/api/auth", authRoutes);
  app.use("/api/products", productRoutes);
  app.use("/api/product-categories", productCategoryRoutes);
  app.use("/api/blogs", blogRoutes);
  app.use("/api/blog-categories", blogCategoryRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/enquiries", enquiryRoutes);
  app.use("/api/coupons", couponRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/instagram-posts", instagramPostRoutes);
  app.use("/api/site-settings", siteSettingRoutes);
  app.use("/api/admin-users", adminUserRoutes);
  app.use("/api/reviews", reviewRoutes);
  app.use("/api/customer", customerRoutes);
  app.use("/api/shipping", shippingRoutes);

  // Unknown API routes must never fall through to the storefront HTML handler.
  app.use("/api", notFound);
  if (publicDirectory) app.use(express.static(publicDirectory, { index: false }));
  if (frontend) app.use(frontend);
  else app.use(notFound);
  app.use(errorHandler);
  return app;
}

export async function initializeBackend() {
  await initializeDatabase({ required: true });
  const migration = await getMigrations(customerAuth.options);
  // DATETIME is supported by Better Auth and avoids legacy MariaDB's implicit
  // zero defaults on additional TIMESTAMP columns. Only auth-generated DDL runs.
  const authSql = await migration.compileMigrations();
  for (const statement of authSql
    .split(/;\s*(?:\n|$)/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    await customerPool.query(statement.replace(/\btimestamp\(3\)/gi, "datetime(3)"));
  }
  startOrderEmailWorker();
  startEkartTrackingWorker();
}
