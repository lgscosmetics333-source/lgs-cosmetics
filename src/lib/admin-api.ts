import { createIsomorphicFn } from "@tanstack/react-start";
import { SITE_ORIGIN } from "./seo";

export const ADMIN_API_BASE =
  import.meta.env["VITE_API_MODE"] === "same-origin"
    ? ""
    : (import.meta.env["VITE_API_URL"]?.trim().replace(/\/+$/, "") ??
      (import.meta.env.DEV ? "http://localhost:5000" : ""));

export const getApiBase = createIsomorphicFn()
  .server(() => process.env["LGS_INTERNAL_API_ORIGIN"] || ADMIN_API_BASE || SITE_ORIGIN)
  .client(() => ADMIN_API_BASE);

/** Resolve uploaded backend files while keeping bundled frontend assets local. */
export function resolveImageUrl(value: string | null | undefined) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return value.startsWith("/uploads/") ? `${ADMIN_API_BASE}${value}` : value;
}
