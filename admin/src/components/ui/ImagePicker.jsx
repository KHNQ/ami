import { ImagePlus } from "lucide-react";
import { fileToDataUrl } from "@shared/lib/fileToDataUrl.js";

export function ImagePicker({ imageDataUrl, onChange }) {
  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange(await fileToDataUrl(file));
  }

  return (
    <label className="flex items-center gap-3 rounded-2xl border border-dashed border-surface/15 bg-surface/5 p-3">
      {imageDataUrl ? (
        <img src={imageDataUrl} alt="Preview" className="h-14 w-14 shrink-0 rounded-xl bg-white object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-surface/8 text-fg/40">
          <ImagePlus size={20} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-fg">{imageDataUrl ? "Change image" : "Add a product image"}</div>
        <div className="text-[11.5px] text-fg/40">JPG, PNG, or WebP</div>
      </div>
      <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </label>
  );
}
