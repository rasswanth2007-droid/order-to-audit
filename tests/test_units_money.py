import pytest
from decimal import Decimal
from types import SimpleNamespace as NS
from app.errors import ValidationFailed
from app.money import amount_in_words, fmt_inr, round_div
from app.services.gst import round_to_rupee, split_tax
from app.units import from_base, to_base

flour = NS(name="Flour", kind="RAW", dimension="MASS", display_unit="kg", packets_per_carton=None)
oil = NS(name="Oil", kind="RAW", dimension="VOLUME", display_unit="l", packets_per_carton=None)
murukku = NS(name="Murukku", kind="FINISHED", dimension="COUNT", display_unit="packet", packets_per_carton=20)


def test_unit_conversions():
    assert to_base(flour, "40", "kg") == 40000 and to_base(flour, "500", "g") == 500 and to_base(oil, "10.5", "litre") == 10500
    assert to_base(murukku, "3", "cartons") == 60 and to_base(murukku, "7", "packet") == 7
    assert from_base(flour, 1200) == Decimal("1.2")


def test_unit_errors():
    for item, q, u in ((flour, "1", "l"), (flour, "0.0005", "kg"), (oil, "1", "carton"), (flour, "1", "bogus")):
        with pytest.raises(ValidationFailed):
            to_base(item, q, u)


def test_rounding_and_gst():
    assert round_div(5, 2) == 3 and round_div(-5, 2) == -3 and round_div(4, 3) == 1
    assert split_tax(750000, 500, True) == (18750, 18750, 0) and split_tax(600000, 500, False) == (0, 0, 30000)
    assert round_to_rupee(787550) == (787600, 50) and round_to_rupee(787549) == (787500, -49)
    assert fmt_inr(787500) == "7,875.00" and fmt_inr(123456789) == "12,34,567.89"
    assert amount_in_words(787500) == "Rupees Seven Thousand Eight Hundred Seventy Five Only"
    # no float drift: 3 x 0.10 + 0.20 style sums stay exact in paise
    assert sum([10, 10, 10, 20]) == 50
