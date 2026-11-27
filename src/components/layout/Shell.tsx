import { useEffect, useState, type ReactNode } from "react";
import { Brand, Icon } from "../ui";
import { navByRole } from "@/config/navigation";
import type { Role, View } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { defaultViewForRole } from "@/utils/helpers";
import { initials } from "@/utils/format";
import { syncQueuedOrders } from "@/utils/offlineQueue";
import { t } from "@/utils/i18n";

export function Shell({
  role,
  setRole,
  view,
  setView,
  signOut,
  children,
}: {
  role: Role;
  setRole: (r: Role) => void;
  view: View;
  setView: (v: View) => void;
  signOut: () => void;
  children: ReactNode;
}) {
  const { user, lang, setLang, notify } = useAuth();
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const isMobile = role === "SALESMAN";
  const displayName = user?.full_name || "Factory User";
  const avatarText = initials(displayName);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      if (isMobile) {
        syncQueuedOrders()
          .then((res) => {
            if (res.sent > 0) notify(`Synced ${res.sent} offline order(s)`);
          })
          .catch(() => {});
      }
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [isMobile, notify]);

  if (isMobile) {
    return (
      <div className="sales-shell">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="sales-header">
          <Brand />
          <button
            type="button"
            className="px-2 py-1 text-xs rounded border border-[var(--border)] bg-white font-semibold"
            onClick={() => setLang(lang === "en" ? "ta" : "en")}
          >
            {lang === "en" ? "தமிழ்" : "EN"}
          </button>
          <div
            className="online"
            style={online ? undefined : { background: "#fde7e5", color: "#b3261e" }}
          >
            <Icon name="wifi" size={15} />
            {t(online ? "Online" : "Offline", lang)}
          </div>
          <button aria-label={t("Sign out", lang)} title={t("Sign out", lang)} onClick={signOut}>
            <Icon name="close" />
          </button>
        </header>
        {!online && (
          <div className="px-4 py-2 text-xs bg-[var(--warning-soft)] text-[var(--warning)] font-medium text-center">
            Offline mode — new orders will be saved on this device and sent automatically when
            online.
          </div>
        )}
        <main id="main">{children}</main>
        <nav className="bottom-nav" aria-label="Main navigation">
          {navByRole.SALESMAN.map((n) => (
            <button
              className={view === n.view ? "active" : ""}
              key={n.label}
              onClick={() => setView(n.view)}
            >
              <Icon name={n.icon} />
              <span>{t(n.label, lang)}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }

  const currentLabel =
    view === "change-password"
      ? "Change password"
      : navByRole[role].find((n) => n.view === view)?.label || "Overview";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="sidebar-brand">
          <Brand light />
          <button aria-label="Close menu" onClick={() => setMenu(false)}>
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Main navigation">
          {navByRole[role].map((n) => (
            <button
              className={view === n.view ? "active" : ""}
              key={n.label}
              onClick={() => {
                setView(n.view);
                setMenu(false);
              }}
            >
              <Icon name={n.icon} />
              <span>{t(n.label, lang)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button
            onClick={() => {
              setView("change-password");
              setMenu(false);
            }}
          >
            <span className="avatar">{avatarText}</span>
            <span>
              <strong>{displayName}</strong>
              <small>{role[0] + role.slice(1).toLowerCase()}</small>
            </span>
            <Icon name="chevron" />
          </button>
          <button onClick={signOut}>
            <Icon name="close" />
            {t("Sign out", lang)}
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="Open menu" onClick={() => setMenu(true)}>
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>Annam Foods</span>
            <Icon name="chevron" size={14} />
            <strong>{t(currentLabel, lang)}</strong>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className="px-3 py-1.5 text-xs rounded border border-[var(--border)] bg-white font-semibold"
              onClick={() => setLang(lang === "en" ? "ta" : "en")}
            >
              {lang === "en" ? "தமிழ்" : "English"}
            </button>
            {user?.role === "ADMIN" && (
              <div className="role-preview">
                <span>Preview as</span>
                <select
                  value={role}
                  onChange={(e) => {
                    const next = e.target.value as Role;
                    setRole(next);
                    setView(defaultViewForRole(next));
                  }}
                >
                  <option>ADMIN</option>
                  <option>PRODUCTION</option>
                  <option>ACCOUNTANT</option>
                  <option>OWNER</option>
                  <option>SALESMAN</option>
                </select>
              </div>
            )}
            <button
              className="profile"
              onClick={() => setView("change-password")}
              title="Change password"
            >
              <span className="avatar">{avatarText}</span>
              <span>
                <strong>{displayName}</strong>
                <small>{role}</small>
              </span>
            </button>
          </div>
        </header>
        <main id="main" className="content">
          {children}
        </main>
      </div>
    </div>
  );
}
