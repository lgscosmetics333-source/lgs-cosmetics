import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ADMIN_API_BASE } from "@/lib/admin-api";
import { getAdminToken } from "@/lib/admin-session";
import type { CustomerOrder } from "@/lib/customer-api";
import { formatINR } from "@/data/site";

const headers = () => ({ Authorization: `Bearer ${getAdminToken()}`, "Content-Type": "application/json" });
async function shippingRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${ADMIN_API_BASE}/api/shipping/ekart${path}`, { headers: headers(), cache: "no-store", ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Unable to complete the Ekart request.");
  return result;
}
export function EkartSettingsStatus() {
  const [message, setMessage] = useState(""), [checking, setChecking] = useState(false);
  const status = useQuery({ queryKey: ["ekart-status"], queryFn: () => shippingRequest<{ data: { enabled: boolean; rateMode: string; missing: string[] } }>("/status") });
  return <section className="space-y-3 rounded-xl border bg-white p-5 text-sm"><h2 className="font-semibold">Ekart shipping</h2>
    {status.isPending ? <p>Checking settings...</p> : status.isError ? <p role="alert">{status.error.message}</p> : <>
      <p>{status.data?.data.enabled ? "Enabled" : "Not activated"} · {status.data?.data.rateMode === "live" ? "Ekart estimate at checkout" : "₹40 delivery, free from ₹900"}</p>
      {Boolean(status.data?.data.missing.length) && <p className="break-words text-amber-800">Backend settings still required: {status.data?.data.missing.join(", ")}</p>}
      <button type="button" disabled={checking} className="min-h-11 rounded border px-4 disabled:opacity-50" onClick={async () => {
        setChecking(true); setMessage("");
        try { const result = await shippingRequest<{ message: string }>("/check-connection", {}); setMessage(result.message); }
        catch (error) { setMessage(error instanceof Error ? error.message : "Connection check failed."); }
        finally { setChecking(false); }
      }}>{checking ? "Checking..." : "Check API connection"}</button>
    </>}{message && <p role="status">{message}</p>}
  </section>;
}

export function EkartOrderShipping({ order, onUpdated }: { order: CustomerOrder; onUpdated: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [awb, setAwb] = useState("");
  const state = order.shipmentState;
  async function action(name: string, body: unknown = {}) {
    if (busy) return;
    setBusy(true); setError("");
    try { await shippingRequest(`/orders/${order.id}/${name}`, body); await onUpdated(); }
    catch (error) { setError(error instanceof Error ? error.message : "Ekart request failed."); try { await onUpdated(); } catch { /* Preserve the original shipping error. */ } }
    finally { setBusy(false); }
  }
  async function label() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${ADMIN_API_BASE}/api/shipping/ekart/orders/${order.id}/label`, { headers: headers() });
      if (!response.ok) { const result = await response.json(); throw new Error(result.message); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `${order.orderNumber}-ekart-label.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) { setError(error instanceof Error ? error.message : "Label download failed."); }
    finally { setBusy(false); }
  }
  if (order.deliveryMode !== "Delivery") return null;
  return <section className="space-y-4 rounded-lg border p-5"><h3 className="font-semibold">Ekart shipment {state ? `· ${state}` : ""}</h3>
    {order.shippingDetails?.lastStatus && <p className="text-sm">Courier status: <b>{order.shippingDetails.lastStatus}</b>{order.shippingDetails.location ? ` · ${order.shippingDetails.location}` : ""}</p>}
    {!state && !order.trackingNumber && ["Confirmed", "Processing"].includes(order.orderStatus) && <form key={order.id} onSubmit={event => {
      event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
      if (window.confirm("Book this parcel with Ekart? This creates a real shipment and may incur courier charges.")) void action("book", values);
    }} className="grid gap-4 sm:grid-cols-2">
      <p className="text-xs leading-6 sm:col-span-2">Confirm the actual packed parcel measurements. The courier charge may differ from the amount charged at checkout. This button books a real shipment.</p>
      {([['weight', 'Packed weight (grams)'], ['length', 'Length (cm)'], ['width', 'Width (cm)'], ['height', 'Height (cm)']] as const).map(([field, title]) => <label key={field} className="grid gap-2 text-sm">{title}<input type="number" name={field} required min={1} max={field === "weight" ? 500000 : 500} step={1} defaultValue={order.shippingDetails?.parcel?.[field] || ""} className="h-11 min-w-0 rounded border px-3" /></label>)}
      <label className="grid gap-2 text-sm">Tax included in invoice (₹)<input type="number" name="taxAmount" min={0} max={Number(order.totalAmount) - 0.01} step="0.01" defaultValue="0" className="h-11 rounded border px-3" /></label>
      <p className="text-xs leading-6">Use the actual invoice tax. Do not enter GST if your business is not GST registered.{order.shippingDetails?.estimate != null ? ` Checkout courier estimate: ${formatINR(order.shippingDetails.estimate)}.` : ""}</p>
      <button disabled={busy || (order.paymentMethod === "upi" && order.paymentStatus !== "Paid")} className="min-h-11 rounded bg-red-900 px-4 text-white disabled:opacity-50">{busy ? "Booking..." : "Book Ekart shipment"}</button>
    </form>}
    {!state && !["Confirmed", "Processing"].includes(order.orderStatus) && <p className="text-sm">Confirm the order before booking an Ekart shipment.</p>}
    {state === "Booked" && <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void action("sync")} className="min-h-11 rounded border px-4 disabled:opacity-50">Refresh courier status</button><button type="button" disabled={busy} onClick={() => void label()} className="min-h-11 rounded border px-4 disabled:opacity-50">Download label</button>{["Confirmed", "Processing"].includes(order.orderStatus) && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Cancel this Ekart shipment? The customer order will remain open until you cancel it separately.")) void action("cancel"); }} className="min-h-11 rounded border border-red-300 px-4 disabled:opacity-50">Cancel shipment</button>}</div>}
    {state === "Needs review" && <div className="space-y-3"><p className="text-sm leading-6">Booking was not confirmed. Check the Ekart dashboard for this order number before doing anything else. If booked, enter its AWB to verify and attach it.</p><label className="grid gap-2 text-sm">AWB from Ekart<input value={awb} onChange={event => setAwb(event.target.value.trim())} className="h-11 rounded border px-3" /></label><button disabled={busy || !awb} onClick={() => void action("reconcile", { awb })} className="min-h-11 rounded border px-4 disabled:opacity-50">Verify and attach AWB</button></div>}
    {state === "Booking" && <p className="text-sm">Booking is in progress. Refresh the order shortly. Do not create another shipment.</p>}
    {["Cancelling", "Cancellation review"].includes(state || "") && <p className="text-sm">Cancellation needs confirmation from Ekart. Check its dashboard before releasing order stock.</p>}
    {state === "Cancellation review" && <button type="button" disabled={busy} onClick={() => void action("verify-cancellation")} className="min-h-11 rounded border px-4 disabled:opacity-50">Verify cancellation with Ekart</button>}
    {state === "Cancelled" && <p className="text-sm">Shipment cancelled. You can now cancel the customer order to return its reserved stock.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
