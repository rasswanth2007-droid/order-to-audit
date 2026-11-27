import type { ReactNode } from "react";
import { Icon } from "./Icon";

type BadgeTone = "neutral" | "info" | "primary" | "success" | "warning" | "danger";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`badge badge-${tone}`}>
      {tone === "success" && <Icon name="check" size={14} />}
      {tone === "warning" && <Icon name="warning" size={14} />}
      {children}
    </span>
  );
}
