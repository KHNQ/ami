import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Trash2, Search, Receipt, FileText, Link2, AlertTriangle } from "lucide-react";
import { adminApi } from "../lib/adminApi.js";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { useAdminAuth } from "../context/AdminAuthContext.jsx";
import { money } from "@shared/lib/format.js";
import { fileToDataUrl } from "@shared/lib/fileToDataUrl.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { Badge } from "@shared/components/ui/Badge.jsx";
import { Avatar } from "@shared/components/ui/Avatar.jsx";

// Recording a sale made at the counter. Written to be usable with the
// customer standing there: the running balance updates as cheques are added,
// and anything the API refuses comes back named rather than as a generic
// failure.

const dollarsToCents = (v) => Math.round(parseFloat(v || "0") * 100);
const emptyCheque = () => ({ amount: "", due_date: "", cheque_number: "", bank_name: "", image_data_url: null });

export default function ManualOrderPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAdminAuth();
  // Arriving from "Register now" on a proforma: ?quote=<id>. The proforma is
  // what the customer was promised, so it fills in the customer, the device,
  // the price and the referrer -- and the order is priced from it, not from
  // the catalogue row (see manualOrderService).
  const [params] = useSearchParams();
  const quoteId = params.get("quote");

  const [search, setSearch] = useState("");
  const [customer, setCustomer] = useState(null);
  const [productId, setProductId] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [received, setReceived] = useState("");
  const [terms, setTerms] = useState("full");
  const [cheques, setCheques] = useState([]);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  const { data: users } = useAsync(() => adminApi.listUsers({ limit: 200 }), []);
  const { data: products } = useAsync(() => adminApi.listProducts({ status: "active", limit: 200 }), []);

  const { data: quote, error: quoteError } = useAsync(
    () => (quoteId ? adminApi.getQuote(quoteId) : Promise.resolve(null)),
    [quoteId]
  );
  const quoteClosed = Boolean(quote && ["converted", "declined"].includes(quote.status));
  // The proforma's own price wins. Falls back to the catalogue price for a
  // proforma with no amount (price on request), which is also what the server
  // charges in that case.
  const quotedCents = quote?.amount_cents ?? null;

  const prefilledFor = useRef(null);
  useEffect(() => {
    if (!quote || prefilledFor.current === quote.id) return;
    prefilledFor.current = quote.id;
    setProductId(quote.product_id || "");
    setRedeemCode(quote.referral_code || "");
    setNote(`Registered from proforma ${quote.reference}`);
    if (quote.customer_account) {
      setCustomer(quote.customer_account);
    } else {
      // No account holds this email: put what we know into the search box so
      // an account created under a different email (or just a phone number)
      // is one click away.
      setCustomer(null);
      setSearch(quote.contact_phone || quote.contact_email || quote.contact_name || "");
    }
  }, [quote]);

  const product = (products || []).find((p) => p.id === productId);
  // The device this order is for shows the price it will actually be charged,
  // so the dropdown never contradicts the proforma beside it.
  const optionLabel = (p) => {
    const isOrderDevice = p.id === productId;
    const price = money(isOrderDevice ? orderCents : p.list_price_y_cents);
    const placeholder = p.specs?.placeholder_pricing && !(quote && isOrderDevice) ? " (placeholder price)" : "";
    return `${p.name} — ${price}${placeholder} (${p.stock_count} in stock)`;
  };
  const listCents = product?.list_price_y_cents ?? 0;
  const orderCents = quotedCents ?? listCents;
  const receivedCents = dollarsToCents(received);
  const chequesCents = cheques.reduce((sum, c) => sum + dollarsToCents(c.amount), 0);
  const outstanding = orderCents - receivedCents - chequesCents;

  const matches = (users || [])
    .filter((u) => u.role !== "admin")
    .filter((u) => {
      if (!search.trim()) return false;
      const q = search.toLowerCase();
      return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.phone?.includes(q);
    })
    .slice(0, 6);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await adminApi.createManualOrder({
        user_id: customer.id,
        product_id: productId,
        quote_id: quote?.id,
        // From a proforma the code is always sent, even empty: an empty string
        // is how the desk says "no referrer", whereas leaving it out would let
        // the proforma's own code be applied after they had removed it.
        redeem_code: quote ? redeemCode.trim() : redeemCode.trim() || undefined,
        amount_received_cents: receivedCents,
        payment_terms: terms,
        note: note.trim() || undefined,
        override_down_payment: override || undefined,
        cheques: cheques
          .filter((c) => c.amount && c.due_date)
          .map((c) => ({
            amount_cents: dollarsToCents(c.amount),
            due_date: c.due_date,
            cheque_number: c.cheque_number || undefined,
            bank_name: c.bank_name || undefined,
            image_data_url: c.image_data_url || undefined,
          })),
      });
      setResult(res);
      if (res.rejected_cheques?.length) {
        toast.error(`${res.rejected_cheques.length} cheque(s) were not recorded — see below`);
      } else {
        toast.success("Order recorded");
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-gradient">
              <Receipt size={20} className="text-white" />
            </div>
            <div>
              <div className="text-[17px] font-extrabold text-fg">Order recorded</div>
              <div className="text-[12.5px] text-fg/45">{result.transaction.id}</div>
            </div>
          </div>

          <dl className="grid gap-2 text-[13.5px]">
            {[
              ...(quote ? [["Proforma", `${quote.reference} · sold`]] : []),
              ["Order value", money(result.balance.order_value_cents)],
              ["Collected now", money(result.balance.amount_received_cents)],
              ["Cheques registered", `${result.cheques.length} · ${money(result.balance.cheques_total_cents)}`],
              ["Outstanding", money(result.balance.outstanding_cents)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-surface/6 pb-1.5">
                <dt className="text-fg/45">{k}</dt>
                <dd className="font-semibold text-fg">{v}</dd>
              </div>
            ))}
          </dl>

          {result.rejected_cheques?.length > 0 && (
            <div className="mt-4 rounded-xl border border-red-400/25 bg-red-400/5 p-3">
              <div className="mb-1.5 text-[13px] font-bold text-red-400">
                {result.rejected_cheques.length} cheque(s) not recorded
              </div>
              <ul className="flex flex-col gap-1 text-[12.5px] text-fg/60">
                {result.rejected_cheques.map((r, i) => (
                  <li key={i}>• {r.message}</li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-fg/40">
                The order itself is recorded. Add the missing cheques from the order page.
              </p>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <Button onClick={() => navigate(`/orders/${result.transaction.id}`)}>Open order</Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (quoteId) navigate("/orders/manual", { replace: true });
                setResult(null);
                setCustomer(null);
                setSearch("");
                setProductId("");
                setRedeemCode("");
                setReceived("");
                setCheques([]);
                setNote("");
                setOverride(false);
              }}
            >
              Record another
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h2 className="text-[20px] font-extrabold text-fg">Record a walk-in sale</h2>
        <p className="text-[13px] text-fg/45">
          The customer needs an account first — the network position is keyed to it.
        </p>
      </div>

      {quoteError && (
        <Card className="border-red-400/25 bg-red-400/5 p-4 text-[13px] text-red-400">
          Could not load that proforma: {quoteError.message}
        </Card>
      )}

      {quote && (
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-gradient">
              <FileText size={16} className="text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-fg">
                From proforma <span className="font-mono">{quote.reference}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-fg/55">
                {quote.contact_name} · {quote.subject}
                {quotedCents != null ? ` · quoted ${money(quotedCents)}` : ""}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[12px] text-fg/40">
                {quote.contact_phone && <span dir="ltr">{quote.contact_phone}</span>}
                {quote.contact_email && <span>{quote.contact_email}</span>}
              </div>
              {quote.referrer && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-green/10 px-2.5 py-1 text-[12px] text-fg/70">
                  <Link2 size={12} className="text-brand-green" />
                  Invited by <b className="text-fg">{quote.referrer.name || "a member"}</b>
                  <span className="font-mono text-fg/45">{quote.referrer.code}</span>
                </div>
              )}
              {quoteClosed && (
                <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-red-400">
                  <AlertTriangle size={13} /> This proforma is already {quote.status}, so it cannot be recorded again.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 1. Customer */}
      <Card className="p-4">
        <div className="mb-2 text-[13px] font-bold text-fg/70">1 · Customer</div>
        {customer ? (
          <div className="flex items-center gap-3 rounded-xl border border-surface/10 bg-surface/5 p-3">
            <Avatar name={customer.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold text-fg">{customer.name}</div>
              <div className="truncate text-[12px] text-fg/45">
                {customer.email}
                {customer.phone ? ` · ${customer.phone}` : ""}
              </div>
            </div>
            <Button variant="ghost" onClick={() => setCustomer(null)}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
              <Input
                className="pl-9"
                placeholder="Search by name, email or phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {matches.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {matches.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setCustomer(u)}
                    className="flex items-center gap-3 rounded-lg p-2 text-start hover:bg-surface/6"
                  >
                    <Avatar name={u.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold text-fg">{u.name}</div>
                      <div className="truncate text-[12px] text-fg/40">{u.email}</div>
                    </div>
                    {u.status !== "active" && <Badge tone="danger">{u.status}</Badge>}
                  </button>
                ))}
              </div>
            )}
            {search.trim() && matches.length === 0 && (
              <p className="mt-2 text-[12.5px] text-fg/40">
                {quote
                  ? `No account matches ${quote.contact_name}'s details yet. They need to register on the site first — then search again by their email or phone.`
                  : "No match. The customer needs to register on the site before their order can be recorded."}
              </p>
            )}
          </>
        )}
      </Card>

      {/* 2. Product */}
      <Card className="p-4">
        <div className="mb-2 text-[13px] font-bold text-fg/70">2 · Device</div>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          disabled={Boolean(quote?.product_id)}
          className="h-11 w-full rounded-xl border border-surface/10 bg-surface/5 px-3 text-[14px] text-fg disabled:opacity-70"
        >
          <option value="">Select a device…</option>
          {(products || []).map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p)}
            </option>
          ))}
        </select>
        {quote && product && quotedCents != null && quotedCents !== listCents && (
          <p className="mt-2 text-[12px] text-fg/45">
            Priced at the proforma's <b className="text-fg">{money(quotedCents)}</b>. The catalogue row says{" "}
            {money(listCents)}; the customer is charged what their proforma says.
          </p>
        )}
        {!quote && product?.specs?.placeholder_pricing && (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-500">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              This device still has a placeholder price, so it can differ from what the storefront and proformas
              show. Set the real price on its{" "}
              <Link to={`/products/${product.id}`} className="font-semibold underline">
                product page
              </Link>
              , or register the sale from the customer's proforma.
            </span>
          </p>
        )}
        <Input
          containerClassName="mt-3"
          label="Referrer's redeem code (optional)"
          placeholder="Attaches the buyer under an existing member"
          value={redeemCode}
          onChange={(e) => setRedeemCode(e.target.value)}
        />
        {quote?.referral_code && (
          <p className="mt-1.5 text-[12px] text-fg/45">
            Filled in from the referral link this customer arrived through. Clear it to record no referrer.
          </p>
        )}
      </Card>

      {/* 3. Payment */}
      <Card className="p-4">
        <div className="mb-2 text-[13px] font-bold text-fg/70">3 · Payment</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input label="Collected now (USD)" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />
            {orderCents > 0 && (
              <button
                type="button"
                onClick={() => setReceived((orderCents / 100).toFixed(2))}
                className="mt-1 text-[12px] font-semibold text-brand-blue hover:underline"
              >
                Full price · {money(orderCents)}
              </button>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-fg/55">Terms</label>
            <select
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="h-11 w-full rounded-xl border border-surface/10 bg-surface/5 px-3 text-[14px] text-fg"
            >
              <option value="full">Paid in full</option>
              <option value="installment">Instalments (cheques)</option>
            </select>
          </div>
        </div>

        {product && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-surface/5 p-3 text-[13px]">
            <span className="text-fg/45">
              Order <b className="text-fg">{money(orderCents)}</b>
            </span>
            <span className="text-fg/45">
              Collected <b className="text-fg">{money(receivedCents)}</b>
            </span>
            <span className="text-fg/45">
              Cheques <b className="text-fg">{money(chequesCents)}</b>
            </span>
            <span className={outstanding === 0 ? "text-brand-green" : outstanding < 0 ? "text-red-400" : "text-fg/45"}>
              Outstanding <b>{money(outstanding)}</b>
            </span>
          </div>
        )}
      </Card>

      {/* 4. Cheques */}
      {terms === "installment" && (
        <Card className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex-1 text-[13px] font-bold text-fg/70">4 · Cheques</span>
            <Button variant="ghost" onClick={() => setCheques((c) => [...c, emptyCheque()])}>
              <Plus size={14} /> Add
            </Button>
          </div>
          {cheques.length === 0 && <p className="text-[12.5px] text-fg/40">No cheques added yet.</p>}
          <div className="flex flex-col gap-3">
            {cheques.map((c, i) => (
              <div key={i} className="rounded-xl border border-surface/10 p-3">
                <div className="mb-2 flex items-center">
                  <span className="flex-1 text-[12px] font-semibold uppercase tracking-wide text-fg/35">
                    Cheque {i + 1}
                  </span>
                  <button
                    onClick={() => setCheques((list) => list.filter((_, j) => j !== i))}
                    className="text-fg/30 hover:text-red-400"
                    aria-label={`Remove cheque ${i + 1}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Input
                    label="Amount (USD)"
                    inputMode="decimal"
                    value={c.amount}
                    onChange={(e) => setCheques((l) => l.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                  />
                  <Input
                    label="Due date"
                    type="date"
                    value={c.due_date}
                    onChange={(e) => setCheques((l) => l.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))}
                  />
                  <Input
                    label="Cheque no."
                    value={c.cheque_number}
                    onChange={(e) => setCheques((l) => l.map((x, j) => (j === i ? { ...x, cheque_number: e.target.value } : x)))}
                  />
                  <Input
                    label="Bank"
                    value={c.bank_name}
                    onChange={(e) => setCheques((l) => l.map((x, j) => (j === i ? { ...x, bank_name: e.target.value } : x)))}
                  />
                </div>
                <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-fg/50">
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await fileToDataUrl(file);
                      setCheques((l) => l.map((x, j) => (j === i ? { ...x, image_data_url: dataUrl } : x)));
                    }}
                  />
                  <span className="rounded-lg border border-surface/10 bg-surface/5 px-2.5 py-1.5">
                    {c.image_data_url ? "Scan attached ✓" : "Attach scan"}
                  </span>
                </label>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 5. Submit */}
      <Card className="p-4">
        <Input label="Note (internal)" value={note} onChange={(e) => setNote(e.target.value)} />
        {can("users.write") && (
          <label className="mt-3 flex items-start gap-2.5 text-[12.5px] text-fg/55">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
            <span>
              Override the down-payment requirement.{" "}
              <span className="text-fg/35">
                Only root admins, and only with a note — commission books on the full price at signing, so this
                lets the business pay out more than it has collected.
              </span>
            </span>
          </label>
        )}
        <Button
          className="mt-4"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!customer || !productId || received === "" || quoteClosed}
          onClick={submit}
        >
          Record order
        </Button>
      </Card>
    </div>
  );
}
