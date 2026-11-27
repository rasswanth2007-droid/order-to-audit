import { useT } from "@/utils/i18n";

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  const tr = useT();
  return (
    <div className="stat">
      <span>{tr(label)}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
