export function statusTone(status: string): "info" | "primary" | "success" | "danger" | "neutral" {
  if (status === "SUBMITTED") return "info";
  if (status === "APPROVED" || status === "INVOICED") return "primary";
  if (status === "DISPATCHED" || status === "ISSUED") return "success";
  if (status === "REJECTED" || status === "CANCELLED") return "danger";
  return "neutral";
}

export function defaultViewForRole(role: string) {
  if (role === "SALESMAN") return "new-order" as const;
  if (role === "PRODUCTION") return "run" as const;
  if (role === "OWNER") return "dashboard" as const;
  if (role === "ACCOUNTANT") return "reports" as const;
  return "orders" as const;
}
