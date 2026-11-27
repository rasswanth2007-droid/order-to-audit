export function formatMoney(paise: string | number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  const raw = String(paise).trim();
  const negative = raw.startsWith("-");
  const digits = raw.replace(/\D/g, "").padStart(3, "0");
  const rupees = digits.slice(0, -2).replace(/^0+(?=\d)/, "") || "0";
  const decimals = digits.slice(-2);
  const lastThree = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${negative ? "−" : ""}₹${grouped}.${decimals}`;
}

export function rupeesToPaise(input: string): number {
  const clean = input.trim().replace(/,/g, "");
  if (!clean) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    throw new Error("Enter a valid amount with up to 2 decimal places");
  }
  const [whole, frac = ""] = clean.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function paiseToRupeesInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const whole = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${dec}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${String(day).padStart(2, "0")}-${months[month - 1]}-${year}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const datePart = formatDate(value);
  const timePart = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return `${datePart}, ${timePart}`;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
