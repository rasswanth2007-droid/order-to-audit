"""Unit conversion. All stock is stored as integers in a base unit: g, ml or pcs."""
from decimal import Decimal, InvalidOperation
from .errors import ValidationFailed

_TABLE = {"g": ("MASS", 1), "kg": ("MASS", 1000), "ml": ("VOLUME", 1), "l": ("VOLUME", 1000),
          "pcs": ("COUNT", 1), "packet": ("COUNT", 1)}
_ALIAS = {"litre": "l", "liter": "l", "litres": "l", "liters": "l", "ltr": "l", "gram": "g", "grams": "g",
          "kgs": "kg", "kilogram": "kg", "piece": "pcs", "pieces": "pcs", "pc": "pcs", "nos": "pcs",
          "packets": "packet", "pkt": "packet", "cartons": "carton", "ctn": "carton", "millilitre": "ml"}
BASE_LABEL = {"MASS": "g", "VOLUME": "ml", "COUNT": "pcs"}
DISPLAY_UNITS = {"kg", "g", "l", "ml", "pcs", "packet"}


def normalize(unit: str) -> str:
    u = (unit or "").strip().lower()
    return _ALIAS.get(u, u)


def _factor(item, unit: str) -> tuple[str, int]:
    u = normalize(unit)
    if u == "carton":
        if item.kind != "FINISHED" or not item.packets_per_carton:
            raise ValidationFailed(f"'carton' conversion is only defined for finished products with packets_per_carton ({item.name})")
        return "COUNT", item.packets_per_carton
    if u not in _TABLE:
        raise ValidationFailed(f"Unknown unit '{unit}'")
    return _TABLE[u]


def to_base(item, qty, unit: str | None = None) -> int:
    try:
        q = Decimal(str(qty))
    except InvalidOperation:
        raise ValidationFailed(f"Invalid quantity '{qty}'")
    dim, f = _factor(item, unit or item.display_unit)
    if dim != item.dimension:
        raise ValidationFailed(f"Unit '{unit}' ({dim.lower()}) cannot be used for {item.name} ({item.dimension.lower()})")
    base = q * f
    if base != base.to_integral_value():
        raise ValidationFailed(f"{qty} {unit} of {item.name} is finer than the smallest unit ({BASE_LABEL[item.dimension]})")
    return int(base)


def from_base(item, base: int, unit: str | None = None) -> Decimal:
    _, f = _factor(item, unit or item.display_unit)
    return Decimal(base) / Decimal(f)


def dec_str(d: Decimal) -> str:
    s = format(d.normalize(), "f")
    return s


def qty_view(item, base: int) -> dict:
    return {"qty_base": base, "qty": dec_str(from_base(item, base)), "unit": item.display_unit}
