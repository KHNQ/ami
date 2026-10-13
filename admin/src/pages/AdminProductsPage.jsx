import { useState } from "react";
import { PageTitle } from "@shared/components/layout/PageTitle.jsx";
import { PageHeader, PageBody } from "../components/AdminLayout.jsx";
import { Link } from "react-router-dom";
import { Plus, Package } from "lucide-react";
import { useAsync } from "@shared/hooks/useAsync.js";
import { useToast } from "@shared/context/ToastContext.jsx";
import { adminApi as api } from "../lib/adminApi.js";
import { Card } from "@shared/components/ui/Card.jsx";
import { Skeleton } from "@shared/components/ui/Skeleton.jsx";
import { ErrorState } from "@shared/components/ui/ErrorState.jsx";
import { StatusBadge } from "@shared/components/ui/Badge.jsx";
import { Button } from "@shared/components/ui/Button.jsx";
import { Input } from "@shared/components/ui/Input.jsx";
import { BottomSheet } from "@shared/components/ui/BottomSheet.jsx";
import { ImagePicker } from "../components/ui/ImagePicker.jsx";
import { LeaseRulesEditor, formToRules, rulesToForm } from "../components/LeaseRulesEditor.jsx";
import { money } from "@shared/lib/format.js";

const CATEGORIES = [
  ["hair", "Hair removal"],
  ["skin", "Skin rejuvenation"],
  ["slim", "Slimming & fitness"],
  ["tattoo", "Tattoo removal"],
  ["body", "Body analysis"],
  ["vascular", "Vascular · ENT"],
];

export default function AdminProductsPage() {
  const { data, loading, error, refetch } = useAsync(() => api.listProducts({ limit: 100 }), []);
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <PageHeader title="Stock" description="The catalogue: pricing, availability and metadata." />
      <PageBody>
      <PageTitle title="Admin · Products" />
      <Button fullWidth onClick={() => setSheetOpen(true)}>
        <Plus size={16} /> New product
      </Button>

      <div className="mt-4">
        {loading && (
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {error && <ErrorState error={error} onRetry={refetch} />}
        <div className="flex flex-col gap-2.5">
          {data?.map((p) => (
            <Link to={`/products/${p.id}`} key={p.id}>
              <Card className="flex items-center gap-3 p-4">
                {api.productImageUrl(p) ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white">
                    <img src={api.productImageUrl(p)} alt={p.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface/6">
                    <Package size={17} className="text-fg/60" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-fg">{p.name}</div>
                  <div className="text-[11.5px] text-fg/40">
                    x {money(p.current_x_cents)} → y {money(p.list_price_y_cents)} · {p.stock_count} in stock
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="New product">
        <NewProductForm
          onCreated={() => {
            toast.success("Product created");
            setSheetOpen(false);
            refetch();
          }}
        />
      </BottomSheet>
    </PageBody>
    </>
  );
}

function NewProductForm({ onCreated }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [xCents, setXCents] = useState("");
  const [yCents, setYCents] = useState("");
  const [stock, setStock] = useState("100");
  const [imageDataUrl, setImageDataUrl] = useState(null);
  // Storefront listing: how the product appears in the public catalogue.
  const [cat, setCat] = useState("skin");
  const [manufacturer, setManufacturer] = useState("");
  const [country, setCountry] = useState("");
  const [sessionPrice, setSessionPrice] = useState("");
  const [lease, setLease] = useState(() => rulesToForm(null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    const x = Math.round(parseFloat(xCents) * 100);
    const y = Math.round(parseFloat(yCents) * 100);
    if (!name || !x || !y) {
      setError("Name, warehouse cost, and price are required");
      return;
    }
    let leaseRules;
    try {
      leaseRules = formToRules(lease);
    } catch (err) {
      setError(err.message);
      return;
    }
    setLoading(true);
    try {
      await api.createProduct({
        name,
        description,
        xCents: x,
        yCents: y,
        stockCount: Number(stock) || 0,
        lease_rules: leaseRules,
        specs: {
          cat,
          ...(manufacturer.trim() ? { manufacturer: manufacturer.trim() } : {}),
          ...(country.trim() ? { country: country.trim() } : {}),
          ...(Number(sessionPrice) > 0 ? { session_price: Number(sessionPrice) } : {}),
          ...(imageDataUrl ? { image_data_url: imageDataUrl } : {}),
        },
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex gap-3">
        <Input label="Warehouse cost (x)" prefix="$" type="number" step="0.01" value={xCents} onChange={(e) => setXCents(e.target.value)} />
        <Input label="List price (y)" prefix="$" type="number" step="0.01" value={yCents} onChange={(e) => setYCents(e.target.value)} />
      </div>
      <Input label="Initial stock" type="number" value={stock} onChange={(e) => setStock(e.target.value)} />
      <ImagePicker imageDataUrl={imageDataUrl} onChange={setImageDataUrl} />

      <fieldset className="flex flex-col gap-3 rounded-2xl border border-surface/10 p-3.5">
        <legend className="px-1 text-[12px] font-bold uppercase tracking-wide text-fg/40">
          Public listing
        </legend>
        <p className="-mt-1 text-[12px] text-fg/40">
          A new product appears in the public catalogue automatically. These fields shape how.
        </p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-bold text-ink-2">Category</span>
          <select
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            className="h-12 w-full rounded-2xl border border-line bg-panel px-4 text-md text-ink outline-none"
          >
            {CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-3">
          <Input label="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <Input
          label="Typical session price (for the ROI model)"
          prefix="$"
          type="number"
          step="1"
          hint="Leave empty to use a neutral default."
          value={sessionPrice}
          onChange={(e) => setSessionPrice(e.target.value)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-2xl border border-surface/10 p-3.5">
        <legend className="px-1 text-[12px] font-bold uppercase tracking-wide text-fg/40">Lease terms</legend>
        <LeaseRulesEditor value={lease} onChange={setLease} />
      </fieldset>
      {error && <p className="text-[13px] font-medium text-red-400">{error}</p>}
      <Button size="lg" fullWidth loading={loading} onClick={submit}>
        Create product
      </Button>
    </div>
  );
}
