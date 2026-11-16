import path from "node:path";
import { fileURLToPath } from "node:url";
import "./env.js";

export const uploadsDirectory = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : fileURLToPath(new URL("../uploads", import.meta.url));
