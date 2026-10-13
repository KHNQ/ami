export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-line bg-panel-2/50 px-6 py-14 text-center">
      {icon && <div className="text-4xl text-ink-3">{icon}</div>}
      <div className="text-md font-black text-ink">{title}</div>
      {description && <div className="max-w-[32ch] text-xs text-ink-2">{description}</div>}
      {action}
    </div>
  );
}
