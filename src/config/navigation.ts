import type { Role, View } from "../types";
import type { IconName } from "../components/ui";

export type NavItem = { label: string; icon: IconName; view: View };

export const navByRole: Record<Role, NavItem[]> = {
  ADMIN: [
    { label: "Orders", icon: "bag", view: "orders" },
    { label: "Invoices", icon: "file", view: "invoices" },
    { label: "Payments & receivables", icon: "trend", view: "payments" },
    { label: "Customers", icon: "users", view: "customers" },
    { label: "Products", icon: "box", view: "products" },
    { label: "Suppliers", icon: "factory", view: "suppliers" },
    { label: "Purchases", icon: "bag", view: "purchases" },
    { label: "Bill of materials", icon: "file", view: "bom" },
    { label: "Stock", icon: "box", view: "stock" },
    { label: "Production", icon: "factory", view: "run" },
    { label: "Reports", icon: "trend", view: "reports" },
    { label: "Audit log", icon: "shield", view: "audit" },
    { label: "Users", icon: "users", view: "users" },
    { label: "Settings", icon: "menu", view: "settings" },
  ],
  PRODUCTION: [
    { label: "Production runs", icon: "factory", view: "run" },
    { label: "Stock", icon: "box", view: "stock" },
    { label: "Purchases", icon: "bag", view: "purchases" },
    { label: "Materials", icon: "file", view: "products" },
    { label: "Reports", icon: "trend", view: "reports" },
  ],
  ACCOUNTANT: [
    { label: "Reports", icon: "trend", view: "reports" },
    { label: "Stock", icon: "box", view: "stock" },
    { label: "Invoices", icon: "file", view: "invoices" },
    { label: "Payments", icon: "bag", view: "payments" },
    { label: "Audit log", icon: "shield", view: "audit" },
    { label: "Dashboard", icon: "home", view: "dashboard" },
  ],
  OWNER: [
    { label: "Dashboard", icon: "home", view: "dashboard" },
    { label: "Orders", icon: "bag", view: "orders" },
    { label: "Stock", icon: "box", view: "stock" },
    { label: "Production", icon: "factory", view: "run" },
    { label: "Reports", icon: "trend", view: "reports" },
  ],
  SALESMAN: [
    { label: "New order", icon: "plus", view: "new-order" },
    { label: "My orders", icon: "bag", view: "orders" },
    { label: "My sales", icon: "trend", view: "my-sales" },
  ],
};
