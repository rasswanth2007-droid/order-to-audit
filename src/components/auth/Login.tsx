import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, setAccessToken } from "@/services/api";
import { Badge, Brand, Button, Icon } from "../ui";
import type { UserInfo } from "@/types";

export function Login({ onLogin }: { onLogin: (user: UserInfo) => void }) {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function doLogin(username: string, password: string) {
    if (cooldown > 0) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ access_token: string; user: UserInfo }>("/auth/login", {
        method: "POST",
        body: { username, password },
      });
      setAccessToken(result.data.access_token);
      onLogin(result.data.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setCooldown(30);
      }
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await doLogin(String(data.get("username") || ""), String(data.get("password") || ""));
  }

  return (
    <main className="login-shell">
      <div className="brand-panel">
        <Brand light />
        <div>
          <Badge tone="warning">FACTORY OPERATIONS</Badge>
          <h1>
            From ingredients
            <br />
            to invoice,
            <br />
            <em>in one place.</em>
          </h1>
          <p>Orders, stock, production and accounts for your snack factory.</p>
        </div>
        <small>Secure access · Activity recorded</small>
      </div>
      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand">
            <Brand />
          </div>
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to your account</h2>
          <p>Use your factory username and password.</p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <label>
            <span>
              Username <b>*</b>
            </span>
            <input
              name="username"
              autoComplete="username"
              required
              placeholder="Enter your username"
            />
          </label>
          <label>
            <span>
              Password <b>*</b>
            </span>
            <div className="password">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Enter your password"
              />
              <button type="button" onClick={() => setShow(!show)}>
                {show ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <Button type="submit" disabled={busy || cooldown > 0}>
            {cooldown > 0 ? `Try again in ${cooldown}s` : busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="login-divider">
            <span>or quick demo sign-in</span>
          </div>
          <div className="preview-roles">
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("admin", "Demo@12345")}
            >
              Admin desktop
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("salesman_a", "Demo@12345")}
            >
              Salesman A (mobile)
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("salesman_b", "Demo@12345")}
            >
              Salesman B (mobile)
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("production", "Demo@12345")}
            >
              Production
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("accountant", "Demo@12345")}
            >
              Accountant
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => doLogin("owner", "Demo@12345")}
            >
              Owner
            </button>
          </div>
          <p className="privacy">
            <Icon name="shield" size={16} /> Your session stays only in this browser tab.
          </p>
        </form>
      </div>
    </main>
  );
}
