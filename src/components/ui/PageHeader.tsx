import type { ReactNode } from "react";
import { useT } from "@/utils/i18n";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const tr = useT();
  return (
    <div className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{tr(eyebrow)}</p>}
        <h1>{tr(title)}</h1>
        {description && <p className="subtitle">{tr(description)}</p>}
      </div>
      {action}
    </div>
  );
}
