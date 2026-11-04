import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { Op } from "sequelize";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { Order } from "../models/index.js";
import { ekart, ekartEnabled, ekartReadiness } from "../services/ekartClient.js";
import { bookEkartShipment, cancelEkartShipment, ekartLabel, reconcileEkartShipment, reconcileEkartCancellation, syncEkartTracking } from "../services/ekartShippingService.js";

export const shippingRoutes = Router();
// The spec does not define a signature header/algorithm. Authenticate a secret URL,
// then fetch authoritative tracking from Ekart; never apply the untrusted callback status.
shippingRoutes.post("/ekart/webhook/:token", async (req, res, next) => {
  try {
    const expected = Buffer.from(process.env.EKART_WEBHOOK_SECRET || "");
    const supplied = Buffer.from(String(req.params.token || ""));
    if (!ekartEnabled() || expected.length < 24 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return res.sendStatus(404);
    const awb = req.body?.id;
    if (typeof awb !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(awb)) return res.status(400).json({ message: "Invalid shipment reference." });
    const order = await Order.findOne({ where: { shippingProvider: "Ekart", trackingNumber: awb } });
    if (order) await syncEkartTracking(order.id);
    res.json({ success: true });
  } catch (error) { next(error); }
});
shippingRoutes.use(requireAuth, requireAdmin);
shippingRoutes.get("/ekart/status", (_req, res) => res.json({ data: ekartReadiness() }));
shippingRoutes.post("/ekart/check-connection", async (_req, res, next) => {
  try { await ekart.accessToken(); res.json({ success: true, message: "Ekart API authentication succeeded." }); } catch (error) { next(error); }
});
shippingRoutes.post("/ekart/orders/:id/book", async (req, res, next) => {
  try { res.json({ data: await bookEkartShipment(req.params.id, req.body) }); } catch (error) { next(error); }
});
shippingRoutes.post("/ekart/orders/:id/sync", async (req, res, next) => {
  try { res.json({ data: await syncEkartTracking(req.params.id) }); } catch (error) { next(error); }
});
shippingRoutes.post("/ekart/orders/:id/reconcile", async (req, res, next) => {
  try { res.json({ data: await reconcileEkartShipment(req.params.id, req.body.awb) }); } catch (error) { next(error); }
});
shippingRoutes.post("/ekart/orders/:id/cancel", async (req, res, next) => {
  try { res.json({ data: await cancelEkartShipment(req.params.id) }); } catch (error) { next(error); }
});
shippingRoutes.post("/ekart/orders/:id/verify-cancellation", async (req, res, next) => {
  try { res.json({ data: await reconcileEkartCancellation(req.params.id) }); } catch (error) { next(error); }
});
shippingRoutes.get("/ekart/orders/:id/label", async (req, res, next) => {
  try { const pdf = await ekartLabel(req.params.id); res.set({ "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="ekart-label.pdf"', "Cache-Control": "no-store" }).send(pdf); }
  catch (error) { next(error); }
});

export function startEkartTrackingWorker() {
  let working = false;
  const run = async () => {
    if (working || !ekartEnabled() || ekartReadiness().missing.length) return;
    working = true;
    try {
      // A server restart during a booking must never silently permit a second booking.
      await Order.update({ shipmentState: "Needs review" }, { where: { shipmentState: "Booking", updatedAt: { [Op.lt]: new Date(Date.now() - 5 * 60_000) } } });
      await Order.update({ shipmentState: "Cancellation review" }, { where: { shipmentState: "Cancelling", updatedAt: { [Op.lt]: new Date(Date.now() - 5 * 60_000) } } });
      const orders = await Order.findAll({ where: { shippingProvider: "Ekart", shipmentState: "Booked", orderStatus: { [Op.notIn]: ["Delivered", "Cancelled"] } }, limit: 20, order: [["updatedAt", "ASC"]] });
      for (const order of orders) {
        try { await syncEkartTracking(order.id); } catch { console.warn(`Ekart tracking refresh failed for order ${order.id}; it will retry later.`); }
      }
    } catch { console.warn("Ekart tracking worker could not read pending shipments."); }
    finally { working = false; }
  };
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
}
