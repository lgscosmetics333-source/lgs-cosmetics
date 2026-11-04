import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { createEkartClient, getEkartQuote, parcelForItems, validateParcel, ekart } from "../services/ekartClient.js";
import { fixedDelivery, quoteFingerprint, signShippingQuote, verifyShippingQuote, quoteCustomerShipping } from "../services/shippingQuoteService.js";
import { buildShipment, mappedEkartStatus, bookEkartShipment, syncEkartTracking, reconcileEkartShipment, cancelEkartShipment } from "../services/ekartShippingService.js";
import { createCustomerOrder, updateOrder } from "../services/orderService.js";
import { sequelize } from "../config/database.js";
import { Admin, Product, ProductCategory, Order, OrderItem, OrderEvent, OrderEmail, syncModels } from "../models/index.js";
import { shippingRoutes } from "../routes/shippingRoutes.js";
import { syncDatabaseSchema, removeGeneratedDuplicateIndexes } from "../config/schema.js";

// All provider calls are mocked. No real shipment is created by these tests.
Object.assign(process.env, { EKART_ENABLED: "true", EKART_PICKUP_PINCODE: "415501", EKART_PICKUP_ALIAS: "Test warehouse",
  EKART_SELLER_NAME: "Test seller", EKART_SELLER_ADDRESS: "Test address", EKART_QUOTE_SECRET: "test-only-quote-signing-secret-32-chars", EKART_RATE_MODE: "fixed", EKART_SERVICE: "SURFACE", EKART_PACKAGING_WEIGHT_GRAMS: "0", EKART_BOX_PADDING_CM: "0" });
const parcel = { weight: 500, length: 20, width: 15, height: 10 };
const fakeEnv = { EKART_CLIENT_ID: "fixture-client", EKART_USERNAME: "fixture-user", EKART_PASSWORD: "fixture-secret" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const fixtureOrder = { orderNumber: "TEST-ORDER", orderStatus: "Processing", deliveryMode: "Delivery", paymentMethod: "cod", paymentStatus: "Awaiting collection", totalAmount: 179, phone: "9000000000", customerName: "Test", createdAt: new Date(), shippingAddress: JSON.stringify({ street: "Test street", city: "Test city", state: "Maharashtra", pincode: "415501" }) };

test("Ekart auth is single-flight, cached, and not leaked in errors", async () => {
  let calls = 0;
  const client = createEkartClient({ env: fakeEnv, fetchImpl: async (_url, request) => {
    calls++; assert.equal(JSON.parse(request.body).password, fakeEnv.EKART_PASSWORD);
    return json({ access_token: "mock-token", expires_in: 86400 });
  } });
  assert.deepEqual(await Promise.all([client.accessToken(), client.accessToken()]), ["mock-token", "mock-token"]);
  await client.accessToken(); assert.equal(calls, 1);
  const bad = createEkartClient({ env: fakeEnv, fetchImpl: async () => json({ message: fakeEnv.EKART_PASSWORD }, 403) });
  await assert.rejects(bad.accessToken(), error => !error.message.includes(fakeEnv.EKART_PASSWORD) && error.status === 503);
});
test("401 refresh happens once; timed-out writes are never automatically retried", async () => {
  let authCalls = 0, requestCalls = 0;
  const client = createEkartClient({ env: fakeEnv, fetchImpl: async url => {
    if (url.includes("/auth/token/")) { authCalls++; return json({ access_token: "mock", expires_in: 86400 }); }
    requestCalls++; return requestCalls === 1 ? json({}, 401) : json({ status: true });
  } });
  await client.request("/fixture"); assert.equal(authCalls, 2); assert.equal(requestCalls, 2);
  let writes = 0;
  const uncertain = createEkartClient({ env: fakeEnv, fetchImpl: async url => {
    if (url.includes("/auth/token/")) return json({ access_token: "mock", expires_in: 86400 });
    writes++; throw new Error("timeout");
  } });
  await assert.rejects(uncertain.request("/create", { method: "PUT", body: {} }), /dashboard/); assert.equal(writes, 1);
});
test("V3 quote uses units, payment mode, tax-inclusive estimate and fails closed", async () => {
  let sent;
  const client = { request: async (_path, options) => { sent = options.body; return [{ courierGroup: "Ekart", tat: { min: 2, max: 5 }, forwardDeliveredCharges: { totalForwardDeliveredEstimate: "81.001" } }]; } };
  const result = await getEkartQuote({ pincode: "415501", paymentMethod: "cod", invoiceAmount: 100, codAmount: 179, parcel }, client);
  assert.equal(result.estimate, 81.01); assert.equal(sent.weight, "500"); assert.equal(sent.codAmount, "179.00"); assert.equal(sent.paymentType, "COD");
  await assert.rejects(getEkartQuote({ pincode: "415501", paymentMethod: "cod", invoiceAmount: 100, parcel }, { request: async () => [] }), /unavailable/);
  await assert.rejects(getEkartQuote({ pincode: "415501", paymentMethod: "cod", invoiceAmount: 100, parcel }, { request: async () => [{}] }), /calculate/);
  await assert.rejects(getEkartQuote({ pincode: "invalid", paymentMethod: "cod", invoiceAmount: 100, parcel }, client), /PIN/);
});
test("Quotes bind customer, contents, PIN and price; reject tampering and expiration", () => {
  const input = { customerId: "test", pincode: "415501", paymentMethod: "cod", items: [{ productId: 1, quantity: 1 }], subtotal: 100, discount: 0, parcel };
  const fingerprint = quoteFingerprint(input);
  const token = signShippingQuote(fingerprint, { shippingCharge: 79 });
  assert.equal(verifyShippingQuote(token, fingerprint).shippingCharge, 79);
  for (const changed of [{ customerId: "other" }, { pincode: "400001" }, { subtotal: 1 }, { paymentMethod: "upi" }]) assert.throws(() => verifyShippingQuote(token, quoteFingerprint({ ...input, ...changed })), /changed/);
  assert.throws(() => verifyShippingQuote(token + "x", fingerprint), /invalid/);
  const savedNow = Date.now;
  try { Date.now = () => savedNow() + 11 * 60_000; assert.throws(() => verifyShippingQuote(token, fingerprint), /expired/); } finally { Date.now = savedNow; }
});
test("Parcel calculation requires measurements and scales all quantities", () => {
  const product = { id: 1, name: "Fixture", shippingWeightGrams: 200, shippingLengthCm: 10, shippingWidthCm: 8, shippingHeightCm: 4 };
  assert.deepEqual(parcelForItems([{ productId: 1, quantity: 3 }], [product]), { weight: 600, length: 10, width: 8, height: 12 });
  assert.throws(() => parcelForItems([{ productId: 1, quantity: 1 }], [{ ...product, shippingWeightGrams: null }]), /measurements/);
  assert.throws(() => validateParcel({ ...parcel, weight: -1 }), /measured/);
});
test("Shipment payload protects payment and booking rules; tracking never regresses", () => {
  const shipment = buildShipment(fixtureOrder, [{ productName: "Test", quantity: 1 }], parcel);
  assert.equal(shipment.payload.cod_amount, 179); assert.equal(shipment.payload.pickup_location.name, "Test warehouse");
  assert.throws(() => buildShipment({ ...fixtureOrder, paymentMethod: "upi" }, [], parcel), /verified/);
  assert.throws(() => buildShipment({ ...fixtureOrder, shipmentState: "Booking" }, [], parcel), /already/);
  assert.throws(() => buildShipment({ ...fixtureOrder, deliveryMode: "Pickup" }, [], parcel), /delivery/);
  assert.equal(mappedEkartStatus("In Transit", "Out for delivery"), "Out for delivery");
  assert.equal(mappedEkartStatus("Out for Delivery", "Delivered"), "Delivered");
  assert.equal(mappedEkartStatus("RTO Delivered", "Shipped"), "Shipped");
  assert.equal(mappedEkartStatus("Delivered", "Cancelled"), "Cancelled");
});
test("Shipping policy charges Rs40 below Rs900, including the exact boundary", () => {
  assert.equal(fixedDelivery(899.99), 40); assert.equal(fixedDelivery(900), 0); assert.equal(fixedDelivery(1000), 0);
});
test("Schema repair drops only equivalent generated unique indexes", async () => {
  const index = (name, attribute, extra = {}) => ({ name, unique: true, type: "BTREE", fields: [{ attribute, collate: "A" }], ...extra });
  const dropped = [];
  const count = await removeGeneratedDuplicateIndexes({ models: { Order: { getTableName: () => "orders" } }, getQueryInterface: () => ({
    showAllTables: async () => ["orders", "unmanaged_table"],
    showIndex: async () => [index("PRIMARY", "id"), index("order_number", "order_number"), index("order_number_2", "order_number"), index("custom_unique_email", "email"), index("email_2", "email"), index("keep_nonunique", "email", { unique: false }), index("keep_prefix", "email", { fields: [{ attribute: "email", length: 10 }] })],
    removeIndex: async (table, name) => dropped.push([table, name]),
  }) });
  assert.equal(count, 2); assert.deepEqual(dropped, [["orders", "order_number_2"], ["orders", "email_2"]]);
});

test("Database flow: quote → checkout → concurrent booking → scan → COD; ambiguous booking recovery and cancellation", { skip: process.env.EKART_INTEGRATION_TEST !== "1" }, async () => {
  assert(["localhost", "127.0.0.1", "::1"].includes(process.env.DB_HOST || "localhost") && process.env.NODE_ENV !== "production", "Run fixture integration only against a local/test MySQL database.");
  const originalRequest = ekart.request;
  let product, category, admin, server; const orderIds = [];
  let createCalls = 0, scanTime = Date.now(), scanStatus = "In Transit", activeOrderNumber, rejectBooking = false;
  ekart.request = async (path, options) => {
    if (path === "/data/v3/serviceability") return [{ courierGroup: "Ekart", forwardDeliveredCharges: { totalForwardDeliveredEstimate: "60" }, tat: { min: 2, max: 5 } }];
    if (path === "/api/v1/package/create") {
      createCalls++; activeOrderNumber = options.body.order_number;
      await new Promise(resolve => setTimeout(resolve, 50));
      if (rejectBooking) throw Object.assign(new Error("Uncertain mock booking"), { status: 502 });
      return { status: true, tracking_id: `TEST${createCalls}`, vendor: "Fixture" };
    }
    if (path.startsWith("/api/v1/track/")) return { order_number: activeOrderNumber, track: { status: scanStatus, ctime: scanTime, desc: "Fixture scan" } };
    if (path.startsWith("/api/v1/package/cancel")) return { data: [{ status: true, tracking_id: new URL(`https://fixture${path}`).searchParams.get("tracking_id") }] };
    if (path.startsWith("/api/v1/package/label")) return Buffer.from("%PDF-1.4 fixture");
    throw new Error("Unexpected mocked endpoint");
  };
  try {
    syncModels(); await sequelize.authenticate(); await syncDatabaseSchema(sequelize);
    category = await ProductCategory.create({ name: "Ekart test fixture", slug: `ekart-test-${randomUUID()}`, status: "Active" });
    admin = await Admin.create({ name: "Ekart test fixture", email: `ekart-test-${randomUUID()}@example.invalid`, passwordHash: "not-a-login-hash", role: "Admin" });
    const token = jwt.sign({ id: admin.id, version: admin.tokenVersion }, process.env.JWT_SECRET || "change_this_to_a_strong_secret", { expiresIn: "2m" });
    const app = express(); app.use(express.json()); app.use("/api/shipping", shippingRoutes);
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.message }));
    server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/shipping/ekart`;
    assert.equal((await fetch(`${base}/status`)).status, 401);
    const authorized = { headers: { Authorization: `Bearer ${token}` } };
    const status = await fetch(`${base}/status`, authorized); assert.equal(status.status, 200);
    assert(!JSON.stringify(await status.json()).includes(process.env.EKART_PASSWORD));
    await admin.update({ role: "Viewer" }); assert.equal((await fetch(`${base}/status`, authorized)).status, 403); await admin.update({ role: "Admin" });
    process.env.EKART_WEBHOOK_SECRET = "fixture-webhook-secret-30-chars";
    assert.equal((await fetch(`${base}/webhook/incorrect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{}' })).status, 404);
    product = await Product.create({ name: "Ekart test fixture", slug: `ekart-test-${randomUUID()}`, categoryId: category.id, price: 100, stock: 10, status: "Active", shippingWeightGrams: 500, shippingLengthCm: 20, shippingWidthCm: 15, shippingHeightCm: 10 });
    const customer = { id: `ekart-test-${randomUUID()}`, email: null };
    const body = { name: "Ekart fixture", phone: "9000000000", paymentMethod: "cod", deliveryMode: "Delivery", address: { street: "Fixture only", city: "Koregaon", district: "Satara", state: "Maharashtra", pincode: "415501" }, items: [{ productId: product.id, quantity: 1 }] };
    async function place() {
      const quote = await quoteCustomerShipping(customer, { ...body, pincode: body.address.pincode });
      assert.equal(quote.shippingCharge, 40);
      const order = await createCustomerOrder(customer, { ...body, checkoutKey: randomUUID(), shippingQuoteToken: quote.quoteToken });
      orderIds.push(order.id); await updateOrder(order.id, { orderStatus: "Confirmed" }); return order;
    }
    await assert.rejects(createCustomerOrder(customer, { ...body, checkoutKey: randomUUID() }), /delivery again/);
    const order = await place();
    const results = await Promise.allSettled([bookEkartShipment(order.id, parcel), bookEkartShipment(order.id, parcel)]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(createCalls, 1);
    await order.reload(); assert.equal(order.trackingNumber, "TEST1"); assert.equal(order.orderStatus, "Confirmed");
    await assert.rejects(updateOrder(order.id, { orderStatus: "Cancelled" }), /Cancel the Ekart/);
    await syncEkartTracking(order.id, { force: true }); await order.reload(); assert.equal(order.orderStatus, "Shipped");
    const label = await fetch(`${base}/orders/${order.id}/label`, authorized); assert.equal(label.status, 200); assert.equal(label.headers.get("content-type"), "application/pdf");
    assert.equal(await label.text(), "%PDF-1.4 fixture");
    const webhook = await fetch(`${base}/webhook/${process.env.EKART_WEBHOOK_SECRET}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "TEST1", status: "Delivered" }) });
    assert.equal(webhook.status, 200); await order.reload(); assert.equal(order.orderStatus, "Shipped", "Never trust the webhook's claimed status");
    const eventCount = await OrderEvent.count({ where: { orderId: order.id } });
    await syncEkartTracking(order.id, { force: true }); assert.equal(await OrderEvent.count({ where: { orderId: order.id } }), eventCount);
    scanTime += 1000; scanStatus = "Delivered";
    await syncEkartTracking(order.id, { force: true }); await order.reload(); assert.equal(order.orderStatus, "Delivered"); assert.equal(order.paymentStatus, "Paid");
    const second = await place(); rejectBooking = true;
    await assert.rejects(bookEkartShipment(second.id, parcel), /Uncertain/); await second.reload(); assert.equal(second.shipmentState, "Needs review");
    await assert.rejects(bookEkartShipment(second.id, parcel), /already/); assert.equal(createCalls, 2);
    scanStatus = "Order Placed";
    await reconcileEkartShipment(second.id, "TEST2"); await second.reload(); assert.equal(second.shipmentState, "Booked");
    await cancelEkartShipment(second.id); await second.reload(); assert.equal(second.shipmentState, "Cancelled");
    await updateOrder(second.id, { orderStatus: "Cancelled" }); await product.reload(); assert.equal(product.stock, 9);
    process.env.EKART_RATE_MODE = "live";
    const live = await quoteCustomerShipping(customer, { ...body, pincode: body.address.pincode }); assert.equal(live.shippingCharge, 60);
    const liveOrder = await createCustomerOrder(customer, { ...body, checkoutKey: randomUUID(), shippingQuoteToken: live.quoteToken }); orderIds.push(liveOrder.id);
    assert.equal(Number(liveOrder.shippingCharge), 60); assert.equal(Number(liveOrder.totalAmount), 160);
  } finally {
    ekart.request = originalRequest;
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of orderIds) {
      await OrderEmail.destroy({ where: { orderId: id } }); await OrderEvent.destroy({ where: { orderId: id } }); await OrderItem.destroy({ where: { orderId: id } }); await Order.destroy({ where: { id } });
    }
    if (product) await product.destroy(); if (category) await category.destroy(); if (admin) await admin.destroy(); await sequelize.close();
  }
});
