export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs text-text-dim">{label}</p>
      <p className="font-display mt-2 text-2xl font-semibold text-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-text-faint">{hint}</p>}
    </div>
  )
}
