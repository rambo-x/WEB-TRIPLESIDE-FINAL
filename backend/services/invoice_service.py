"""Invoice PDF generation using reportlab."""
import io
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas


BG_DARK = HexColor("#0a0a0c")
BG_BASE = HexColor("#050505")
BRAND = HexColor("#e11d48")
MUTED = HexColor("#a1a1aa")
BORDER = HexColor("#1f1f22")


def generate_invoice_pdf(
    invoice_no: str,
    customer_name: str,
    customer_email: str,
    customer_phone: str,
    product_name: str,
    amount: float,
    currency: str,
    paid_at: str,
    transaction_id: str,
    discount: float = 0.0,
    coupon_code: str = "",
) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4

    # Dark background
    c.setFillColor(BG_BASE)
    c.rect(0, 0, W, H, stroke=0, fill=1)

    # Brand header
    c.setFillColor(BRAND)
    c.rect(40 * mm, H - 35 * mm, 12 * mm, 12 * mm, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10)
    c.drawCentredString(46 * mm, H - 30 * mm, "3S")

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(56 * mm, H - 29 * mm, "TripleSide Studio")

    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(56 * mm, H - 34 * mm, "Sound that moves from three sides.")

    # Title
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 32)
    c.drawRightString(W - 20 * mm, H - 30 * mm, "INVOICE")

    c.setFillColor(BRAND)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(W - 20 * mm, H - 36 * mm, f"#{invoice_no}")

    # Bill To
    y = H - 55 * mm
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(20 * mm, y, "BILL TO")
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, y - 6 * mm, customer_name)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    if customer_email:
        c.drawString(20 * mm, y - 11 * mm, customer_email)
    if customer_phone:
        c.drawString(20 * mm, y - 16 * mm, customer_phone)

    # Meta
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(W - 20 * mm, y, "ISSUED")
    c.setFillColor(white)
    c.setFont("Helvetica", 9)
    c.drawRightString(W - 20 * mm, y - 5 * mm, paid_at[:10] if paid_at else datetime.utcnow().strftime("%Y-%m-%d"))

    c.setFillColor(MUTED)
    c.setFont("Helvetica-Bold", 8)
    c.drawRightString(W - 20 * mm, y - 12 * mm, "TRANSACTION ID")
    c.setFillColor(white)
    c.setFont("Helvetica", 8)
    c.drawRightString(W - 20 * mm, y - 17 * mm, transaction_id[:30])

    # Items table
    table_y = H - 95 * mm
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(20 * mm, table_y + 8 * mm, W - 20 * mm, table_y + 8 * mm)

    c.setFillColor(MUTED)
    c.setFont("Helvetica-Bold", 8)
    c.drawString(20 * mm, table_y + 3 * mm, "DESCRIPTION")
    c.drawRightString(W - 20 * mm, table_y + 3 * mm, "AMOUNT")

    c.line(20 * mm, table_y, W - 20 * mm, table_y)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(20 * mm, table_y - 8 * mm, product_name)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawString(20 * mm, table_y - 13 * mm, "Digital product · TripleSide Studio")

    subtotal = amount + discount
    c.setFillColor(white)
    c.setFont("Helvetica", 11)
    c.drawRightString(W - 20 * mm, table_y - 8 * mm, f"{currency.upper()} {subtotal:.2f}")

    c.line(20 * mm, table_y - 22 * mm, W - 20 * mm, table_y - 22 * mm)

    # Totals
    ty = table_y - 30 * mm
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 9)
    c.drawRightString(W - 55 * mm, ty, "Subtotal")
    c.setFillColor(white)
    c.drawRightString(W - 20 * mm, ty, f"{currency.upper()} {subtotal:.2f}")

    if discount > 0:
        ty -= 6 * mm
        c.setFillColor(MUTED)
        c.drawRightString(W - 55 * mm, ty, f"Discount{' (' + coupon_code + ')' if coupon_code else ''}")
        c.setFillColor(BRAND)
        c.drawRightString(W - 20 * mm, ty, f"-{currency.upper()} {discount:.2f}")

    ty -= 10 * mm
    c.setStrokeColor(BORDER)
    c.line(W - 80 * mm, ty + 5 * mm, W - 20 * mm, ty + 5 * mm)

    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(W - 55 * mm, ty, "TOTAL PAID")
    c.setFillColor(BRAND)
    c.setFont("Helvetica-Bold", 16)
    c.drawRightString(W - 20 * mm, ty, f"{currency.upper()} {amount:.2f}")

    # Footer
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawString(20 * mm, 20 * mm, "Thank you for supporting TripleSide Studio.")
    c.drawString(20 * mm, 16 * mm, "This is an electronic invoice — no signature required.")
    c.drawRightString(W - 20 * mm, 20 * mm, "TripleSide Studio")
    c.drawRightString(W - 20 * mm, 16 * mm, "hello@tripleside.studio")

    c.showPage()
    c.save()
    return buf.getvalue()
