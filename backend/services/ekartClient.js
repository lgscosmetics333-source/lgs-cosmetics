// Ekart Elite OpenAPI 3.8.10. Credentials stay on the server.
export const shippingError = (message, status = 400) => Object.assign(new Error(message), { status });
export const ekartEnabled = () => process.env.EKART_ENABLED === "true";
export const ekartService = () => process.env.EKART_SERVICE === "EXPRESS" ? "EXPRESS" : "SURFACE";
export function ekartReadiness() {
  const required = ["EKART_CLIENT_ID", "EKART_USERNAME", "EKART_PASSWORD", "EKART_PICKUP_PINCODE", "EKART_PICKUP_ALIAS", "EKART_SELLER_NAME", "EKART_SELLER_ADDRESS", "EKART_QUOTE_SECRET"];
  return { enabled: ekartEnabled(), rateMode: process.env.EKART_RATE_MODE === "live" ? "live" : "fixed", missing: required.filter(key => !process.env[key]?.trim()) };
}
export function requireEkart() {
  if (!ekartEnabled()) throw shippingError("Ekart shipping is not enabled.", 503);
  if (ekartReadiness().missing.length) throw shippingError("Ekart pickup and account settings are incomplete. Please contact the store.", 503);
}
export function validPincode(value) {
  if (!/^[1-9]\d{5}$/.test(String(value))) throw shippingError("Enter a valid 6-digit PIN code.");
  return String(value);
}
export function validateParcel(input) {
  const parcel = {};
  for (const field of ["weight", "length", "width", "height"]) {
    const value = Number(input?.[field]);
    if (!Number.isSafeInteger(value) || value < 1 || value > (field === "weight" ? 500000 : 500)) throw shippingError("Enter measured parcel weight in grams and dimensions in whole centimeters.");
    parcel[field] = value;
  }
  return parcel;
}
export function parcelForItems(items, products) {
  let weight = 0, length = 0, width = 0, height = 0;
  for (const item of items) {
    const product = products.find(p => p.id === item.productId);
    if (!product) throw shippingError("A product is no longer available.");
    if (![product.shippingWeightGrams, product.shippingLengthCm, product.shippingWidthCm, product.shippingHeightCm].every(v => Number(v) > 0)) throw shippingError(`Delivery measurements for ${product.name} are not available. Please contact the store.`, 409);
    weight += Number(product.shippingWeightGrams) * item.quantity;
    length = Math.max(length, Number(product.shippingLengthCm));
    width = Math.max(width, Number(product.shippingWidthCm));
    height += Number(product.shippingHeightCm) * item.quantity;
  }
  // Conservative stacked packing estimate; staff confirms the actual packed parcel before booking.
  const packaging = Number(process.env.EKART_PACKAGING_WEIGHT_GRAMS || 0);
  const padding = Number(process.env.EKART_BOX_PADDING_CM || 0);
  if (!Number.isSafeInteger(packaging) || packaging < 0 || !Number.isSafeInteger(padding) || padding < 0) throw shippingError("Invalid shipping packaging settings.", 503);
  return validateParcel({ weight: weight + packaging, length: length + padding, width: width + padding, height: height + padding });
}

export function createEkartClient({ env = process.env, fetchImpl = (...args) => fetch(...args) } = {}) {
  let token = null, tokenExpires = 0, pendingToken;
  function origin() {
    const url = env.EKART_BASE_URL || "https://app.elite.ekartlogistics.in";
    // Never send credentials to a URL supplied by a browser/request.
    if (url !== "https://app.elite.ekartlogistics.in") throw shippingError("Unsupported Ekart API origin.", 503);
    return url;
  }
  async function accessToken() {
    if (token && Date.now() < tokenExpires) return token;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      if (![env.EKART_CLIENT_ID, env.EKART_USERNAME, env.EKART_PASSWORD].every(Boolean)) throw shippingError("Ekart API credentials are missing.", 503);
      let response;
      try {
        response = await fetchImpl(`${origin()}/integrations/v2/auth/token/${encodeURIComponent(env.EKART_CLIENT_ID)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: env.EKART_USERNAME, password: env.EKART_PASSWORD }), signal: AbortSignal.timeout(15000), redirect: "error",
        });
      } catch { throw shippingError("Could not connect to Ekart authentication.", 502); }
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.access_token || !(Number(body.expires_in) > 0)) throw shippingError(`Ekart authentication failed (HTTP ${response.status}). Check API user access and account activation.`, 503);
      token = body.access_token;
      tokenExpires = Date.now() + Math.max(0, Number(body.expires_in) - 60) * 1000;
      return token;
    })().finally(() => { pendingToken = null; });
    return pendingToken;
  }
  async function request(path, { method = "GET", body, binary = false } = {}, refreshed = false) {
    const auth = await accessToken();
    let response;
    try {
      response = await fetchImpl(`${origin()}${path}`, { method, headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000), redirect: "error" });
    } catch { throw shippingError("Ekart did not confirm the request. Check the Ekart dashboard before retrying shipment actions.", 502); }
    if (response.status === 401 && !refreshed) {
      token = null; tokenExpires = 0;
      return request(path, { method, body, binary }, true);
    }
    if (binary && response.ok && !response.headers.get("content-type")?.includes("json")) return Buffer.from(await response.arrayBuffer());
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status === false || !result) throw shippingError("Ekart rejected the request. Check account activation, pickup details and the Ekart dashboard.", 502);
    if (binary) throw shippingError("Ekart has not returned a shipping label yet.", 502);
    return result;
  }
  return { request, accessToken };
}
export const ekart = createEkartClient();

export async function getEkartQuote({ pincode, paymentMethod, invoiceAmount, codAmount = invoiceAmount, parcel }, client = ekart) {
  requireEkart();
  validPincode(pincode); validPincode(process.env.EKART_PICKUP_PINCODE);
  const measured = validateParcel(parcel);
  const amount = Number(invoiceAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999) throw shippingError("Invalid shipment invoice amount.");
  if (!["cod", "upi"].includes(paymentMethod)) throw shippingError("Choose COD or online payment for delivery.");
  if (paymentMethod === "cod" && (!Number.isFinite(Number(codAmount)) || Number(codAmount) < amount || Number(codAmount) > 49999)) throw shippingError("Cash on delivery is available only up to ₹49,999.");
  const result = await client.request("/data/v3/serviceability", { method: "POST", body: {
    pickupPincode: process.env.EKART_PICKUP_PINCODE, dropPincode: String(pincode),
    ...Object.fromEntries(Object.entries(measured).map(([key, value]) => [key, String(value)])),
    paymentType: paymentMethod === "cod" ? "COD" : "Prepaid", serviceType: ekartService(),
    codAmount: paymentMethod === "cod" ? Number(codAmount).toFixed(2) : "0", invoiceAmount: amount.toFixed(2),
  } });
  if (!Array.isArray(result)) throw shippingError("Ekart returned an unexpected serviceability response.", 502);
  if (!result.length) throw shippingError("Ekart delivery is unavailable for this PIN code and payment method. Try another address or store pickup.", 409);
  const quotes = result.filter(row => row.forwardDeliveredCharges?.totalForwardDeliveredEstimate != null && row.forwardDeliveredCharges.totalForwardDeliveredEstimate !== "" && Number.isFinite(Number(row.forwardDeliveredCharges.totalForwardDeliveredEstimate)) && Number(row.forwardDeliveredCharges.totalForwardDeliveredEstimate) >= 0);
  quotes.sort((a, b) => Number(a.forwardDeliveredCharges.totalForwardDeliveredEstimate) - Number(b.forwardDeliveredCharges.totalForwardDeliveredEstimate));
  const choice = quotes[0];
  if (!choice) throw shippingError("Ekart could not calculate a delivery price. Please contact the store.", 503);
  return { serviceable: true, estimate: Math.ceil(Number(choice.forwardDeliveredCharges.totalForwardDeliveredEstimate) * 100) / 100,
    estimatedDays: choice.tat || null, courier: choice.courierGroup || "Ekart", parcel: measured, service: ekartService() };
}
