import { ApiError } from "@/services/api";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const reqId = error instanceof ApiError ? error.requestId : null;
  return (
    <div className="error-banner flex items-center justify-between gap-3 my-3" role="alert">
      <div>
        <strong>{msg}</strong>
        {reqId && <div className="text-xs opacity-80 mt-0.5">Ref: {reqId}</div>}
      </div>
      {onRetry && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="card p-8 text-center text-[var(--muted)] my-4" role="status">
      <div className="inline-block w-6 h-6 border-2 border-[var(--border)] border-t-[var(--primary)] rounded-full animate-spin mb-2" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({
  icon = "file",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card p-10 text-center my-4 flex flex-col items-center gap-2">
      <div className="w-12 h-12 rounded-full bg-[var(--primary-soft)] text-[var(--primary)] flex items-center justify-center mb-1">
        <Icon name={icon} size={22} />
      </div>
      <h3 className="font-semibold text-base">{title}</h3>
      {description && <p className="text-sm text-[var(--muted)] max-w-md">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 bg-[#123f3f] text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-sm"
    >
      <Icon name="check" size={18} />
      <span className="text-sm font-medium flex-1">{message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="opacity-80 hover:opacity-100"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
