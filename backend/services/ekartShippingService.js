import { sequelize } from "../config/database.js";
import { Order, OrderItem } from "../models/index.js";
import { recordOrderEvent } from "./orderService.js";
import { ekart, requireEkart, shippingError, validateParcel, getEkartQuote, ekartService } from "./ekartClient.js";

export const shippingDetails = order => typeof order.shippingDetails === "string" ? JSON.parse(order.shippingDetails) : order.shippingDetails || {};
const requireOrder = order => { if (!order) throw shippingError("Order not found.", 404); return order; };
export function buildShipment(order, items, input) {
  if (order.deliveryMode !== "Delivery" || !["Confirmed", "Processing"].includes(order.orderStatus)) throw shippingError("Confirm the delivery order before booking a shipment.", 409);
  if (order.trackingNumber || order.shipmentState) throw shippingError("This order already has a shipment or an unresolved booking. Check Ekart before retrying.", 409);
  if (order.paymentMethod !== "cod" && order.paymentStatus !== "Paid") throw shippingError("Online payment must be verified before shipment booking.", 409);
  if (!["cod", "upi"].includes(order.paymentMethod) || order.paymentStatus === "Refunded") throw shippingError("This order cannot be shipped.", 409);
  const parcel = validateParcel(input);
  let address;
  try { address = JSON.parse(order.shippingAddress); } catch { throw shippingError("A structured delivery address is required."); }
  const phone = String(order.phone || "").replace(/^\+91/, "");
  if (!/^[6-9]\d{9}$/.test(phone)) throw shippingError("Ekart requires a valid 10-digit Indian mobile number.");
  const tax = Number(input.taxAmount || 0), total = Number(order.totalAmount);
  if (!Number.isFinite(tax) || tax < 0 || tax >= total) throw shippingError("Enter the actual invoice tax amount, less than the invoice total.");
  return { parcel, payload: {
    order_number: order.orderNumber, invoice_number: order.orderNumber, invoice_date: new Date(order.createdAt).toISOString().slice(0, 10),
    seller_name: process.env.EKART_SELLER_NAME, seller_address: process.env.EKART_SELLER_ADDRESS,
    seller_gst_tin: process.env.EKART_SELLER_GSTIN || "", consignee_gst_amount: 0, seller_gst_amount: 0,
    consignee_name: order.customerName, consignee_alternate_phone: phone,
    payment_mode: order.paymentMethod === "cod" && order.paymentStatus !== "Paid" ? "COD" : "Prepaid",
    category_of_goods: "Cosmetics", products_desc: items.map(i => i.productName).join(", ").slice(0, 500),
    total_amount: total, taxable_amount: Number((total - tax).toFixed(2)), tax_value: tax, commodity_value: (total - tax).toFixed(2),
    cod_amount: order.paymentMethod === "cod" && order.paymentStatus !== "Paid" ? total : 0,
    quantity: items.reduce((sum, i) => sum + i.quantity, 0), ...parcel,
    drop_location: { name: order.customerName, phone: Number(phone), address: address.street, city: address.city, state: address.state, country: "India", pin: Number(address.pincode) },
    pickup_location: { name: process.env.EKART_PICKUP_ALIAS },
    return_location: { name: process.env.EKART_RETURN_ALIAS || process.env.EKART_PICKUP_ALIAS },
    return_reason: "", service: ekartService(),
  }, address };
}

export async function bookEkartShipment(id, input) {
  requireEkart();
  const order = requireOrder(await Order.findByPk(id));
  const items = await OrderItem.findAll({ where: { orderId: id } });
  const { parcel, payload, address } = buildShipment(order, items, input);
  // Validate the measured parcel and payment service before the irreversible booking call.
  const quote = await getEkartQuote({ pincode: address.pincode, paymentMethod: payload.payment_mode === "COD" ? "cod" : "upi", invoiceAmount: Number(order.totalAmount), codAmount: payload.cod_amount, parcel });
  await sequelize.transaction(async transaction => {
    const current = requireOrder(await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }));
    const latest = buildShipment(current, items, input);
    if (current.updatedAt.getTime() !== order.updatedAt.getTime() || JSON.stringify(latest.payload) !== JSON.stringify(payload)) throw shippingError("Order changed. Refresh it before booking.", 409);
    await current.update({ shippingProvider: "Ekart", shipmentState: "Booking", shippingDetails: { parcel, estimate: quote.estimate, bookedAt: new Date().toISOString() } }, { transaction });
  });
  let result;
  try {
    result = await ekart.request("/api/v1/package/create", { method: "PUT", body: payload });
    if (result.status !== true || typeof result.tracking_id !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(result.tracking_id)) throw shippingError("Ekart did not return a confirmed AWB. Check its dashboard before taking further action.", 502);
  } catch (error) {
    // Never retry an ambiguous create automatically: Ekart may already have booked it.
    await Order.update({ shipmentState: "Needs review" }, { where: { id, shipmentState: "Booking" } });
    throw error;
  }
  await sequelize.transaction(async transaction => {
    const current = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    await current.update({ shipmentState: "Booked", courierName: "Ekart", trackingNumber: result.tracking_id,
      trackingUrl: `https://app.elite.ekartlogistics.in/track/${encodeURIComponent(result.tracking_id)}`,
      shippingDetails: { ...shippingDetails(current), lastStatus: "Order Placed", vendor: result.vendor || "Ekart" },
    }, { transaction });
    await recordOrderEvent(current, `Ekart shipment booked. AWB: ${result.tracking_id}. Awaiting courier pickup.`, transaction);
  });
  return Order.findByPk(id);
}

export function mappedEkartStatus(status, current) {
  if (["Cancelled", "Delivered"].includes(current)) return current;
  const ranks = { Pending: 0, Confirmed: 1, Processing: 2, Shipped: 3, "Out for delivery": 4, Delivered: 5 };
  const target = { "Picked Up": "Shipped", "In Transit": "Shipped", "Out for Delivery": "Out for delivery", Delivered: "Delivered" }[status];
  return target && ranks[target] > ranks[current] ? target : current;
}
export async function syncEkartTracking(id, { force = false } = {}) {
  requireEkart();
  const order = requireOrder(await Order.findByPk(id));
  if (order.shippingProvider !== "Ekart" || !order.trackingNumber) throw shippingError("No Ekart shipment is attached to this order.", 409);
  const details = shippingDetails(order);
  if (!force && details.checkedAt && Date.now() - new Date(details.checkedAt).getTime() < 60_000) return order;
  const result = await ekart.request(`/api/v1/track/${encodeURIComponent(order.trackingNumber)}`);
  if (!result.track?.status || !Number.isSafeInteger(result.track.ctime) || result.track.ctime > Date.now() + 300000) throw shippingError("Ekart returned an unexpected tracking response.", 502);
  if (result.order_number && result.order_number !== order.orderNumber) throw shippingError("Ekart returned tracking for a different order.", 502);
  return sequelize.transaction(async transaction => {
    const current = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    const previous = shippingDetails(current);
    if (previous.scanTime && result.track.ctime <= previous.scanTime) {
      await current.update({ shippingDetails: { ...previous, checkedAt: new Date().toISOString() } }, { transaction });
      return current;
    }
    const status = mappedEkartStatus(result.track.status, current.orderStatus);
    const paymentStatus = status === "Delivered" && current.paymentMethod === "cod" && current.paymentStatus === "Awaiting collection" ? "Paid" : current.paymentStatus;
    // Never mark an unpaid/refunded online order delivered based only on a courier scan.
    const orderStatus = status === "Delivered" && paymentStatus !== "Paid" ? current.orderStatus : status;
    const changed = previous.lastStatus !== result.track.status || current.orderStatus !== orderStatus || current.paymentStatus !== paymentStatus;
    await current.update({ orderStatus, paymentStatus, shippingDetails: { ...previous, lastStatus: String(result.track.status).slice(0, 100),
      location: String(result.track.location || "").slice(0, 200), description: String(result.track.desc || "").slice(0, 500),
      scanTime: result.track.ctime, estimatedDelivery: Number.isSafeInteger(result.edd) ? result.edd : null, checkedAt: new Date().toISOString(),
    } }, { transaction });
    if (changed) await recordOrderEvent(current, `Ekart: ${String(result.track.status).slice(0, 100)}.${paymentStatus === "Paid" && current.paymentMethod === "cod" ? " COD collected by courier; bank settlement is separate." : ""}`, transaction);
    return current;
  });
}

export async function reconcileEkartShipment(id, awb) {
  requireEkart();
  if (typeof awb !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(awb)) throw shippingError("Enter the AWB shown in Ekart.");
  const result = await ekart.request(`/api/v1/track/${encodeURIComponent(awb)}`);
  const order = requireOrder(await Order.findByPk(id));
  if (result.order_number !== order.orderNumber) throw shippingError("This AWB could not be verified against the order number.", 409);
  await sequelize.transaction(async transaction => {
    const current = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (current.shipmentState !== "Needs review" || current.trackingNumber || ["Cancelled", "Delivered"].includes(current.orderStatus)) throw shippingError("This order does not need shipment reconciliation.", 409);
    await current.update({ shipmentState: "Booked", courierName: "Ekart", trackingNumber: awb, trackingUrl: `https://app.elite.ekartlogistics.in/track/${encodeURIComponent(awb)}` }, { transaction });
    await recordOrderEvent(current, "Ekart booking reconciled against its verified order number.", transaction);
  });
  return syncEkartTracking(id, { force: true });
}

export async function cancelEkartShipment(id) {
  requireEkart();
  const order = requireOrder(await Order.findByPk(id));
  if (order.shippingProvider !== "Ekart" || !order.trackingNumber || order.shipmentState !== "Booked" || !["Confirmed", "Processing"].includes(order.orderStatus)) throw shippingError("Only a booked shipment awaiting pickup can be cancelled here. Contact Ekart for shipped parcels.", 409);
  const [claimed] = await Order.update({ shipmentState: "Cancelling" }, { where: { id, shipmentState: "Booked", orderStatus: order.orderStatus } });
  if (!claimed) throw shippingError("Shipment is already being updated.", 409);
  try {
    const response = await ekart.request(`/api/v1/package/cancel?tracking_id=${encodeURIComponent(order.trackingNumber)}`, { method: "DELETE" });
    const entries = Array.isArray(response.data) ? response.data : [response];
    if (!entries.some(row => row.status === true && row.tracking_id === order.trackingNumber)) throw shippingError("Ekart cancellation is not confirmed. Check its dashboard before cancelling this order.", 502);
    await Order.update({ shipmentState: "Cancelled" }, { where: { id, shipmentState: "Cancelling" } });
    return Order.findByPk(id);
  } catch (error) {
    await Order.update({ shipmentState: "Cancellation review" }, { where: { id, shipmentState: "Cancelling" } });
    throw error;
  }
}

export async function reconcileEkartCancellation(id) {
  requireEkart();
  const order = requireOrder(await Order.findByPk(id));
  if (order.shippingProvider !== "Ekart" || !order.trackingNumber || order.shipmentState !== "Cancellation review") throw shippingError("This shipment does not need cancellation review.", 409);
  const result = await ekart.request(`/api/v1/track/${encodeURIComponent(order.trackingNumber)}`);
  if (result.order_number !== order.orderNumber || !["Cancelled", "Seller Cancelled"].includes(result.track?.status)) throw shippingError("Ekart has not confirmed cancellation. Contact Ekart support before releasing stock.", 409);
  await sequelize.transaction(async transaction => {
    const current = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (current.shipmentState !== "Cancellation review") throw shippingError("Shipment was already updated. Refresh the order.", 409);
    await current.update({ shipmentState: "Cancelled", shippingDetails: { ...shippingDetails(current), lastStatus: result.track.status } }, { transaction });
    await recordOrderEvent(current, "Ekart shipment cancellation verified. The customer order remains open.", transaction);
  });
  return Order.findByPk(id);
}

export async function ekartLabel(id) {
  requireEkart();
  const order = requireOrder(await Order.findByPk(id));
  if (order.shippingProvider !== "Ekart" || !order.trackingNumber || order.shipmentState !== "Booked") throw shippingError("Book an Ekart shipment before downloading its label.", 409);
  return ekart.request("/api/v1/package/label?json_only=false", { method: "POST", body: { ids: [order.trackingNumber] }, binary: true });
}
