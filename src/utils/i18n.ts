export type Lang = "en" | "ta";

const TA_LABELS: Record<string, string> = {
  Orders: "ஆர்டர்கள்",
  Invoices: "விலைப்பட்டியல்கள்",
  "Payments & receivables": "பணம் & நிலுவை",
  Payments: "பணம்",
  Customers: "வாடிக்கையாளர்கள்",
  Products: "பொருட்கள்",
  Suppliers: "சப்ளையர்கள்",
  Purchases: "கொள்முதல்",
  "Bill of materials": "செய்முறை (BOM)",
  Stock: "இருப்பு (Stock)",
  Production: "உற்பத்தி",
  "Production runs": "உற்பத்தி ஓட்டங்கள்",
  Materials: "மூலப்பொருட்கள்",
  Reports: "அறிக்கைகள்",
  "Audit log": "தணிக்கை பதிவு",
  Users: "பயனர்கள்",
  Settings: "அமைப்புகள்",
  Dashboard: "முகப்பு",
  "New order": "புதிய ஆர்டர்",
  "My orders": "என் ஆர்டர்கள்",
  "My sales": "என் விற்பனை",
  "Sign out": "வெளியேறு",
  "Change password": "கடவுச்சொல் மாற்று",
  Online: "ஆன்லைன்",
  Offline: "ஆஃப்லைன்",
};

export function t(label: string, lang: Lang): string {
  if (lang === "en") return label;
  return TA_LABELS[label] || label;
}
