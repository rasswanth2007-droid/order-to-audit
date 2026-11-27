import { useEffect, useMemo, useState } from "react";
import { setUnauthorizedHandler } from "./services/api";
import type { View } from "./types";
import { defaultViewForRole } from "./utils/helpers";
import { AuthProvider, useAuth } from "./context/AuthContext";

import { ChangePassword, Login } from "./components/auth";
import { Shell } from "./components/layout";
import { OrdersInbox, OrderReview } from "./components/orders";
import { ProductionRun } from "./components/production";
import { Reports } from "./components/reports";
import { Dashboard } from "./components/dashboard";
import { MySales, NewOrder } from "./components/salesman";
import { Invoices } from "./components/invoices/Invoices";
import { Payments } from "./components/payments/Payments";
import { Customers } from "./components/customers/Customers";
import { Products } from "./components/products/Products";
import { Suppliers } from "./components/suppliers/Suppliers";
import { Purchases } from "./components/purchases/Purchases";
import { BomEditor } from "./components/bom/BomEditor";
import { Stock } from "./components/stock/Stock";
import { AuditLog } from "./components/audit/AuditLog";
import { Users } from "./components/users/Users";
import { Settings } from "./components/settings/Settings";

function AppContent() {
  const { role, setUser, setPreviewRole, signOut } = useAuth();
  const [view, setView] = useState<View>("orders");
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const content = useMemo(() => {
    if (selectedOrderId !== null) {
      return <OrderReview orderId={selectedOrderId} onBack={() => setSelectedOrderId(null)} />;
    }
    switch (view) {
      case "orders":
        return <OrdersInbox onOpen={(id) => setSelectedOrderId(id)} mobile={role === "SALESMAN"} />;
      case "run":
        return <ProductionRun />;
      case "reports":
        return <Reports />;
      case "dashboard":
        return <Dashboard onOrders={() => setView("orders")} onNavigate={setView} />;
      case "new-order":
        return <NewOrder onViewOrders={() => setView("orders")} />;
      case "my-sales":
        return <MySales />;
      case "invoices":
        return <Invoices />;
      case "payments":
        return <Payments />;
      case "customers":
        return <Customers />;
      case "products":
        return <Products />;
      case "suppliers":
        return <Suppliers />;
      case "purchases":
        return <Purchases />;
      case "bom":
        return <BomEditor />;
      case "stock":
        return <Stock />;
      case "audit":
        return <AuditLog />;
      case "users":
        return <Users />;
      case "settings":
        return <Settings />;
      case "change-password":
        return <ChangePassword />;
      default:
        return <OrdersInbox onOpen={(id) => setSelectedOrderId(id)} mobile={role === "SALESMAN"} />;
    }
  }, [view, selectedOrderId, role]);

  if (!role) {
    return (
      <Login
        onLogin={(u) => {
          setUser(u);
          setView(defaultViewForRole(u.role));
          setSelectedOrderId(null);
        }}
      />
    );
  }

  return (
    <Shell
      role={role}
      setRole={(r) => {
        setPreviewRole(r);
        setSelectedOrderId(null);
      }}
      view={view}
      setView={(v) => {
        setView(v);
        setSelectedOrderId(null);
      }}
      signOut={signOut}
    >
      {content}
    </Shell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
