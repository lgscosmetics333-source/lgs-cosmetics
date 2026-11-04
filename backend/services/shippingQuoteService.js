import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { Op } from "sequelize";
import { Product, Coupon } from "../models/index.js";
import { ekartEnabled, ekartReadiness, getEkartQuote, parcelForItems, shippingError, validPincode } from "./ekartClient.js";

export const fixedDelivery = subtotal => Number(subtotal) >= 900 ? 0 : 40;
const cents = value => Math.round(Number(value) * 100);
const signature = value => {
  const secret = process.env.EKART_QUOTE_SECRET;
  if (!secret || secret.length < 32) throw shippingError("Shipping quote signing is not configured.", 503);
  return createHmac("sha256", secret).update(value).digest("base64url");
};
export function quoteFingerprint({ customerId, pincode, paymentMethod, items, subtotal, discount, couponCode, parcel }) {
  return createHash("sha256").update(JSON.stringify({ customerId, pincode: String(pincode), paymentMethod,
    items: items.map(i => [i.productId, i.quantity, i.variant || null]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    subtotal: cents(subtotal), discount: cents(discount), couponCode: String(couponCode || "").trim().toUpperCase(), parcel,
    mode: ekartReadiness().rateMode, pickup: process.env.EKART_PICKUP_PINCODE, service: process.env.EKART_SERVICE || "SURFACE",
  })).digest("hex");
}
export function signShippingQuote(fingerprint, quote) {
  const payload = Buffer.from(JSON.stringify({ fingerprint, quote, expires: Date.now() + 10 * 60_000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function verifyShippingQuote(token, fingerprint) {
  if (typeof token !== "string" || token.length > 5000) throw shippingError("Check delivery again before placing your order.", 409);
  const [payload, mac, extra] = token.split(".");
  const expected = Buffer.from(signature(payload || "")), actual = Buffer.from(mac || "");
  if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw shippingError("Delivery quote is invalid. Check delivery again.", 409);
  let signed;
  try { signed = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { throw shippingError("Invalid delivery quote.", 409); }
  if (signed.fingerprint !== fingerprint || signed.expires < Date.now()) throw shippingError("Delivery details changed or quote expired. Check delivery again.", 409);
  if (!Number.isFinite(signed.quote?.shippingCharge) || signed.quote.shippingCharge < 0) throw shippingError("Invalid delivery price.", 409);
  return signed.quote;
}

export async function quoteCustomerShipping(customer, body) {
  if (!ekartEnabled()) throw shippingError("Live shipping checks are not enabled.", 503);
  const pincode = validPincode(body.pincode);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) throw shippingError("Add between 1 and 50 products.");
  const items = body.items.map(i => {
    if (!Number.isInteger(i.productId) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99 || (i.variant != null && (typeof i.variant !== "string" || i.variant.length > 120))) throw shippingError("Invalid product quantity or variant.");
    return { productId: i.productId, quantity: i.quantity, variant: i.variant || null };
  });
  const products = await Product.findAll({ where: { id: { [Op.in]: items.map(i => i.productId) }, status: "Active" } });
  let subtotal = 0;
  const quantities = new Map();
  for (const item of items) {
    const p = products.find(p => p.id === item.productId);
    if (!p) throw shippingError("A product is no longer available.");
    quantities.set(p.id, (quantities.get(p.id) || 0) + item.quantity);
    if (quantities.get(p.id) > p.stock) throw shippingError(`Not enough stock for ${p.name}.`, 409);
    let variants;
    try { variants = typeof p.variants === "string" ? JSON.parse(p.variants) : p.variants || []; } catch { throw shippingError("Invalid product options."); }
    if (!Array.isArray(variants)) throw shippingError("Invalid product options.");
    const variant = item.variant ? variants.find(v => v.label === item.variant) : variants[0];
    if (item.variant && !variant) throw shippingError("Choose an available product option.");
    const price = cents(variant?.price ?? p.salePrice ?? p.price);
    if (!Number.isSafeInteger(price) || price < 0) throw shippingError("Product pricing is unavailable.");
    subtotal += price * item.quantity;
  }
  let discount = 0;
  const couponCode = String(body.couponCode || "").trim().toUpperCase();
  if (couponCode) {
    const coupon = await Coupon.findOne({ where: { code: couponCode, status: "Active" } });
    if (!coupon || (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) || (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) || subtotal < cents(coupon.minOrderAmount)) throw shippingError("Coupon is no longer available.");
    discount = coupon.discountType === "fixed" ? cents(coupon.discountValue) : Math.round(subtotal * Number(coupon.discountValue) / 100);
    if (coupon.maxDiscount != null) discount = Math.min(discount, cents(coupon.maxDiscount));
    discount = Math.min(subtotal, Math.max(0, discount));
  }
  const parcel = parcelForItems(items, products);
  const invoiceAmount = (subtotal - discount) / 100;
  if (invoiceAmount <= 0) throw shippingError("Please contact the store to arrange delivery of this order.");
  let shippingCharge = fixedDelivery(subtotal / 100), quote;
  // COD collection includes delivery. Re-quote until the fee stabilizes (bounded).
  for (let attempt = 0; attempt < 4; attempt++) {
    quote = await getEkartQuote({ pincode, paymentMethod: body.paymentMethod, invoiceAmount, codAmount: invoiceAmount + shippingCharge, parcel });
    const updated = ekartReadiness().rateMode === "live" ? quote.estimate : shippingCharge;
    if (body.paymentMethod !== "cod" || updated === shippingCharge) { shippingCharge = updated; break; }
    shippingCharge = updated;
    if (attempt === 3) throw shippingError("Delivery cost could not be confirmed. Please contact the store.", 503);
  }
  const result = { ...quote, shippingCharge, subtotal: subtotal / 100, discount: discount / 100 };
  return { ...result, quoteToken: signShippingQuote(quoteFingerprint({ customerId: customer.id, pincode, paymentMethod: body.paymentMethod, items, subtotal: subtotal / 100, discount: discount / 100, couponCode, parcel }), result) };
}
