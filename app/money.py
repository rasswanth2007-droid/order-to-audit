"""Integer money (paise) helpers. No floats anywhere in money maths."""
from decimal import Decimal


def round_div(n: int, d: int) -> int:
    """Integer n/d rounded half away from zero."""
    if d == 0:
        raise ZeroDivisionError
    if d < 0:
        n, d = -n, -d
    q, r = divmod(abs(n), d)
    if 2 * r >= d:
        q += 1
    return q if n >= 0 else -q


def mul_div(a: int, b: int, c: int) -> int:
    return round_div(a * b, c)


def pct_bp(actual: int, planned: int) -> int | None:
    """Variance in basis points (100 bp = 1%). None when planned is 0."""
    if planned == 0:
        return None
    return round_div((actual - planned) * 10000, planned)


def tax_part(taxable_paise: int, rate_bp: int) -> int:
    """Tax on a taxable value for a rate in basis points (500 = 5%)."""
    return round_div(taxable_paise * rate_bp, 10000)


def fmt_inr(paise: int) -> str:
    neg = paise < 0
    paise = abs(paise)
    rupees, p = divmod(paise, 100)
    s = str(rupees)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{'-' if neg else ''}{s}.{p:02d}"


def rupees_str(paise: int) -> str:
    sign = "-" if paise < 0 else ""
    r, p = divmod(abs(paise), 100)
    return f"{sign}{r}.{p:02d}"


def dec_rupees(paise: int) -> Decimal:
    return Decimal(paise) / Decimal(100)


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
         "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _below_1000(n: int) -> str:
    out = []
    if n >= 100:
        out.append(_ONES[n // 100] + " Hundred")
        n %= 100
    if n >= 20:
        out.append(_TENS[n // 10] + ((" " + _ONES[n % 10]) if n % 10 else ""))
    elif n > 0:
        out.append(_ONES[n])
    return " ".join(out)


def amount_in_words(paise: int) -> str:
    rupees, p = divmod(abs(paise), 100)
    if rupees == 0 and p == 0:
        return "Rupees Zero Only"
    parts = []
    for div, name in ((10**7, "Crore"), (10**5, "Lakh"), (1000, "Thousand")):
        if rupees >= div:
            parts.append(_below_1000(rupees // div) + " " + name)
            rupees %= div
    if rupees:
        parts.append(_below_1000(rupees))
    words = "Rupees " + " ".join(parts) if parts else "Rupees Zero"
    if p:
        words += " and " + _below_1000(p) + " Paise"
    return words + " Only"
