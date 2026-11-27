from ..money import round_div, tax_part


def split_tax(taxable: int, rate_bp: int, intra: bool) -> tuple[int, int, int]:
    """(cgst, sgst, igst) in paise. Intra-state: each half-rate share rounded separately; inter-state: full IGST."""
    if intra:
        half = round_div(taxable * rate_bp, 20000)
        return half, half, 0
    return 0, 0, tax_part(taxable, rate_bp)


def round_to_rupee(total_paise: int) -> tuple[int, int]:
    rupees = (total_paise + 50) // 100
    return rupees * 100, rupees * 100 - total_paise
