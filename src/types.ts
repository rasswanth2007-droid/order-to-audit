export type Role = "ADMIN" | "SALESMAN" | "PRODUCTION" | "ACCOUNTANT" | "OWNER";

export type View =
  | "orders"
  | "order"
  | "run"
  | "reports"
  | "dashboard"
  | "new-order"
  | "my-sales"
  | "invoices"
  | "payments"
  | "customers"
  | "products"
  | "suppliers"
  | "purchases"
  | "bom"
  | "stock"
  | "audit"
  | "users"
  | "settings"
  | "change-password";

export type UserInfo = {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  is_active: boolean;
};
