import { Router } from "express";
import { body } from "express-validator";
import { createCrudController } from "../services/crudService.js";
import { Product, ProductImage, ProductCategory } from "../models/index.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

function attachProductImages(req, _res, next) {
  for (const key of ["shippingWeightGrams", "shippingLengthCm", "shippingWidthCm", "shippingHeightCm"]) {
    if (req.body[key] === "") req.body[key] = null;
    else if (req.body[key] != null) {
      const number = Number(req.body[key]);
      if (!Number.isSafeInteger(number) || number < 1 || number > (key === "shippingWeightGrams" ? 500000 : 500)) return next(Object.assign(new Error("Enter positive whole shipping measurements (grams and cm)."), { status: 400 }));
      req.body[key] = number;
    }
  }
  const main = req.files?.mainImage?.[0];
  const gallery = req.files?.galleryImages || [];
  if (main) req.body.mainImage = `/uploads/${main.filename}`;
  if (gallery.length) req.body.additionalImages = JSON.stringify(gallery.map((file) => `/uploads/${file.filename}`));
  next();
}

const controller = createCrudController(Product, {
  searchFields: ["name", "slug", "brand", "type", "subtitle", "sku"],
  includes: [
    { model: ProductCategory, as: "category" },
    { model: ProductImage, as: "images" },
  ],
});

export const productRoutes = Router();

productRoutes.get("/", controller.list);
productRoutes.get("/:id", controller.getById);
productRoutes.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.fields([{ name: "mainImage", maxCount: 1 }, { name: "galleryImages", maxCount: 4 }]),
  attachProductImages,
  [body("name").notEmpty(), body("categoryId").notEmpty()],
  controller.create,
);
productRoutes.put(
  "/:id",
  requireAuth,
  requireAdmin,
  upload.fields([{ name: "mainImage", maxCount: 1 }, { name: "galleryImages", maxCount: 4 }]),
  attachProductImages,
  controller.update,
);
productRoutes.delete("/:id", requireAuth, requireAdmin, controller.remove);
