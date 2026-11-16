import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sequelize } from "../config/database.js";
import { syncModels } from "../models/index.js";
import { loadFrontendCatalog } from "./load-frontend-catalog.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const builtAssetsDirectory = path.join(projectRoot, ".output", "public", "assets");
const outputDirectory = path.join(projectRoot, "backend", "database");
const outputFile = path.join(outputDirectory, "hostinger-import.sql");
const seedFile = path.join(outputDirectory, "seed.sql");

if (!fs.existsSync(builtAssetsDirectory)) {
  throw new Error("Build the Hostinger app first with `npm run build:hostinger`.");
}

const builtAssets = fs.readdirSync(builtAssetsDirectory);
function publicAssetUrl(sourceUrl) {
  if (!sourceUrl?.startsWith("/assets/")) return sourceUrl ?? null;
  const sourceName = path.basename(sourceUrl);
  const extension = path.extname(sourceName);
  const stem = path.basename(sourceName, extension);
  const match = builtAssets.find((name) => name.startsWith(`${stem}-`) && name.endsWith(extension));
  if (!match) throw new Error(`Could not find built public asset for ${sourceUrl}.`);
  return `/assets/${match}`;
}

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  const hex = Buffer.from(String(value), "utf8").toString("hex");
  return `CONVERT(0x${hex} USING utf8mb4)`;
}

function sqlJson(value) {
  return value === null || value === undefined ? "NULL" : sqlString(JSON.stringify(value));
}

syncModels();
const queryGenerator = sequelize.getQueryInterface().queryGenerator;
const schemaStatements = [
  "-- LGS Cosmetics core schema for Hostinger MySQL/MariaDB.",
  "-- Import into a newly created, empty database selected in phpMyAdmin.",
  "-- Contains table structure only; no customer/order/review/admin data or credentials.",
  "-- Better Auth customer tables are created by the app during its first successful startup.",
  "SET NAMES utf8mb4;",
  "SET FOREIGN_KEY_CHECKS=0;",
];

for (const model of Object.values(sequelize.models)) {
  const tableName = model.getTableName();
  const attributes = queryGenerator.attributesToSQL(model.rawAttributes, {
    table: tableName,
    context: "createTable",
  });
  schemaStatements.push(
    queryGenerator.createTableQuery(tableName, attributes, {
      ...model.options,
      engine: "InnoDB",
      charset: "utf8mb4",
      uniqueKeys: model.uniqueKeys,
    }),
  );
}

const { categories, products } = loadFrontendCatalog();
const seedStatements = [
  "-- LGS Cosmetics public catalog seed for MySQL/MariaDB.",
  "-- Requires the application tables to exist. Safe to run against an existing catalog: INSERT IGNORE keeps existing slugs unchanged.",
  "-- Adds 5 public categories and 14 public products only; no admin, customer, order, or review rows.",
  "-- Product/category image URLs target the bundled /assets files from the matching Hostinger build.",
  "SET NAMES utf8mb4;",
];

for (const category of categories) {
  seedStatements.push(
    `INSERT IGNORE INTO \`product_categories\` (\`name\`, \`slug\`, \`description\`, \`image\`, \`group\`, \`types\`, \`status\`, \`displayOrder\`, \`createdAt\`, \`updatedAt\`) VALUES (` +
      [
        sqlString(category.name),
        sqlString(category.slug),
        sqlString(category.tagline),
        sqlString(publicAssetUrl(category.image)),
        sqlString(category.group),
        sqlJson(category.types),
        sqlString("Active"),
        "0",
        "CURRENT_TIMESTAMP",
        "CURRENT_TIMESTAMP",
      ].join(", ") +
      ");",
  );
}

const productImageUrls = new Map();
for (const product of products) {
  const mainImage = publicAssetUrl(product.image);
  const hoverImage = publicAssetUrl(product.hoverImage || product.image);
  productImageUrls.set(product.slug, mainImage);
  const category = categories.find((item) => item.slug === product.category);
  if (!category) throw new Error(`Catalog product ${product.slug} has no category.`);

  const columns = [
    "name", "slug", "brand", "type", "subtitle", "description", "short_description",
    "price", "sale_price", "sku", "stock", "main_image", "additional_images", "status",
    "featured", "ingredients", "benefits", "usage", "size", "variants", "tags", "rating",
    "reviews", "meta_title", "meta_description", "category_id", "createdAt", "updatedAt",
  ];
  const values = [
    sqlString(product.name),
    sqlString(product.slug),
    sqlString(product.brand),
    sqlString(product.type),
    sqlString(product.subtitle),
    sqlString(product.description),
    sqlString(product.subtitle),
    Number(product.mrp ?? product.price ?? 0),
    product.price == null ? "NULL" : Number(product.price),
    sqlString(String(product.id ?? product.slug).toUpperCase()),
    product.inStock ? 24 : 0,
    sqlString(mainImage),
    sqlJson([hoverImage].filter(Boolean)),
    sqlString(product.inStock ? "Active" : "Inactive"),
    product.tags?.some((tag) => ["bestseller", "trending"].includes(tag)) ? "1" : "0",
    sqlString(product.keyIngredients?.join(", ") ?? null),
    sqlString(product.benefits?.join(" | ") ?? null),
    sqlString(product.howToUse),
    sqlString(product.size),
    sqlJson(product.variants),
    sqlJson(product.tags),
    product.rating == null ? "NULL" : Number(product.rating),
    product.reviews == null ? "NULL" : Number(product.reviews),
    sqlString(product.name),
    sqlString(product.subtitle),
  ];

  seedStatements.push(
    `INSERT IGNORE INTO \`products\` (${columns.map((column) => `\`${column}\``).join(", ")}) ` +
      `SELECT ${values.join(", ")}, \`id\`, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP ` +
      `FROM \`product_categories\` WHERE \`slug\` = ${sqlString(category.slug)};`,
  );
}

for (const product of products) {
  const imageUrl = productImageUrls.get(product.slug);
  seedStatements.push(
    `INSERT INTO \`product_images\` (\`product_id\`, \`url\`, \`alt\`, \`is_primary\`, \`createdAt\`, \`updatedAt\`) ` +
      `SELECT p.\`id\`, ${sqlString(imageUrl)}, ${sqlString(product.name)}, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP ` +
      `FROM \`products\` p WHERE p.\`slug\` = ${sqlString(product.slug)} ` +
      `AND NOT EXISTS (SELECT 1 FROM \`product_images\` i WHERE i.\`product_id\` = p.\`id\` AND i.\`url\` = ${sqlString(imageUrl)});`,
  );
}

schemaStatements.push("SET FOREIGN_KEY_CHECKS=1;");
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(outputFile, `${schemaStatements.join("\n\n")}\n`, "utf8");
fs.writeFileSync(seedFile, `${seedStatements.join("\n\n")}\n`, "utf8");
console.log(`Created ${path.relative(projectRoot, outputFile)} and ${path.relative(projectRoot, seedFile)}. Seed rows: ${categories.length} categories, ${products.length} products.`);
await sequelize.close();
