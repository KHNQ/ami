import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { useParams } from "react-router-dom";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { TopBar } from "@shared/components/layout/TopBar.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { BottomSheet } from "@shared/components/ui/BottomSheet.jsx";
import { OrderDetailView } from "../components/OrderDetailView.jsx";
import { money } from "@shared/lib/format.js";

export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch } = useAsync(() => api.getOrder(id), [id]);
  const { data: product } = useAsync(() => (data ? api.getProduct(data.product_id) : Promise.resolve(null)), [data?.product_id]);
  const [sheetOpen, setSheetOpen] = useState(false);

  // What can still be handed back is what was COLLECTED, not what the order is
  // worth: a part-paid instalment order is worth more than has been paid.
  const remaining = data ? data.amount_received_cents - data.refunded_amount_cents : 0;

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <PageTitle title="Admin · Order" />
      <TopBar back title="Order detail" />
      <div className="flex-1 px-5 pb-16 pt-2">
        {loading && <Skeleton className="h-64" />}
        {error && <ErrorState error={error} onRetry={refetch} />}
        {data && (
          <OrderDetailView
            tx={data}
            productName={product?.name}
            ledgerEntries={data.ledger_entries}
            showInternals
            refundSlot={
              remaining > 0 && (
                <Button variant="danger" fullWidth onClick={() => setSheetOpen(true)}>
                  Refund order
                </Button>
              )
            }
          />
        )}
      </div>

      {data && (
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Refund this order">
          <RefundForm
            maxCents={remaining}
            onSubmit={async ({ amountCents, reason }) => {
              await api.refundOrder(id, { amount_cents: amountCents, reason });
              toast.success("Refund processed");
              setSheetOpen(false);
              refetch();
            }}
          />
        </BottomSheet>
      )}
    </div>
  );
}

function RefundForm({ maxCents, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handle() {
    setLoading(true);
    setError(null);
    try {
      const cents = amount ? Math.round(parseFloat(amount) * 100) : undefined;
      await onSubmit({ amountCents: cents, reason: reason || undefined });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input
        label={`Amount (blank = full ${money(maxCents)})`}
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder={(maxCents / 100).toFixed(2)}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Input label="Reason (optional)" placeholder="Customer request" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
      <Button variant="danger" size="lg" fullWidth loading={loading} onClick={handle}>
        Confirm refund
      </Button>
    </div>
  );
}
