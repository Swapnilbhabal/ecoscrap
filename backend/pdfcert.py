"""
One-page A4 portrait PDF of the recycling certificate, drawn with ReportLab.
Used by GET /api/certificates/{id}/pdf so the download is always exactly one page,
whatever browser or printer settings the customer has.
"""
import io
import math
from datetime import datetime
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONTS = Path(__file__).resolve().parent / "fonts"
pdfmetrics.registerFont(TTFont("Text", str(FONTS / "Instrument-400.ttf")))
pdfmetrics.registerFont(TTFont("TextBold", str(FONTS / "Instrument-700.ttf")))
pdfmetrics.registerFont(TTFont("Display", str(FONTS / "Bricolage-Bold.ttf")))

FR4 = HexColor("#0e3b2e")
FR4_DEEP = HexColor("#061a13")
COPPER = HexColor("#d2793a")
GOLD = HexColor("#e9b949")
INK = HexColor("#10201a")
INK2 = HexColor("#3d5249")
INK3 = HexColor("#6b7f76")
MINT = HexColor("#eef3ee")
LINE = HexColor("#d5e0d8")

W, H = A4          # 595 x 842 points
M = 42             # page margin


def _date(iso_str):
    if not iso_str:
        return "-"
    return datetime.fromisoformat(iso_str).strftime("%d %B %Y").lstrip("0")


def _logo(c, x, y, s=30):
    """EcoScrap mark: rounded square, copper loop arrow, gold solder pad."""
    c.setFillColor(HexColor("#165040"))
    c.roundRect(x, y, s, s, s * 0.28, stroke=0, fill=1)
    k = s / 40
    c.setStrokeColor(COPPER)
    c.setLineWidth(3.2 * k)
    c.setLineCap(1)
    cx, cy, r = x + 20 * k, y + 20 * k, 9 * k
    p = c.beginPath()
    p.arc(cx - r, cy - r, cx + r, cy + r, startAng=215, extent=-290)
    c.drawPath(p, stroke=1, fill=0)
    c.setFillColor(GOLD)
    c.circle(x + 12.5 * k, y + 13.5 * k, 3.2 * k, stroke=0, fill=1)


def _seal(c, cx, cy, r=46):
    c.setStrokeColor(FR4)
    c.setLineWidth(1.4)
    c.circle(cx, cy, r, stroke=1, fill=0)
    c.setFillColor(FR4)
    c.circle(cx, cy, r * 0.56, stroke=0, fill=1)
    text = "RECYCLED RESPONSIBLY  ·  ECOSCRAP  ·  MUMBAI  ·  "
    c.setFont("TextBold", 6.6)
    n = len(text)
    for i, ch in enumerate(text):
        ang = math.pi / 2 - (i / n) * 2 * math.pi
        tx, ty = cx + math.cos(ang) * r * 0.8, cy + math.sin(ang) * r * 0.8
        c.saveState()
        c.translate(tx, ty)
        c.rotate(math.degrees(ang) - 90)
        c.drawCentredString(0, -2.2, ch)
        c.restoreState()
    _logo(c, cx - 13, cy - 13, 26)


def _wrap(c, text, font, size, x, y, width, leading, color=INK2):
    c.setFont(font, size)
    c.setFillColor(color)
    for line in simpleSplit(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def build(cert, verify_url):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle(f"EcoScrap certificate {cert['certificate_id']}")
    c.setAuthor("EcoScrap")

    # ---------- header band ----------
    band = 104
    c.setFillColor(FR4_DEEP)
    c.rect(0, H - band, W, band, stroke=0, fill=1)
    c.setFillColor(COPPER)
    c.rect(0, H - band - 4, W, 4, stroke=0, fill=1)
    _logo(c, M, H - 66, 32)
    c.setFillColor(white)
    c.setFont("Display", 21)
    c.drawString(M + 42, H - 57, "EcoScrap")
    c.setFont("Text", 8.5)
    c.setFillColor(HexColor("#c7d2cc"))
    c.drawString(M + 42, H - 72, "Doorstep e-waste pickup · Mumbai, Thane, Navi Mumbai")
    c.setFont("Text", 8)
    c.drawRightString(W - M, H - 45, "CERTIFICATE NO.")
    c.setFont("TextBold", 13)
    c.setFillColor(GOLD)
    c.drawRightString(W - M, H - 62, cert["certificate_id"])
    c.setFont("Text", 8.5)
    c.setFillColor(HexColor("#c7d2cc"))
    c.drawRightString(W - M, H - 77, f"Booking {cert['booking_id']}")

    # ---------- demo watermark ----------
    if cert.get("is_demo"):
        c.saveState()
        c.setFillColor(HexColor("#fbf0e7"))
        c.setFont("Display", 120)
        c.translate(W / 2, H / 2 - 30)
        c.rotate(32)
        c.drawCentredString(0, 0, "DEMO")
        c.restoreState()

    # ---------- title + statement ----------
    y = H - band - 58
    c.setFillColor(INK)
    c.setFont("Display", 30)
    c.drawString(M, y, "Certificate of responsible")
    c.drawString(M, y - 34, "e-waste recycling")
    y -= 66
    statement = (f"This certifies that {cert['name']} handed over the electronics listed below for recycling, "
                 f"and that they were received by an authorised recycler on {_date(cert['recycled_at'])}.")
    y = _wrap(c, statement, "Text", 11, M, y, W - 2 * M, 15.5, INK2)

    # ---------- four figures ----------
    y -= 16
    box_h, gap = 62, 10
    box_w = (W - 2 * M - 3 * gap) / 4
    figs = [("Verified weight", f"{cert['verified_kg']:g} kg"),
            ("CO2e avoided (estimate)", f"{cert['co2_kg']:.1f} kg"),
            ("Like not driving a car", f"{cert['car_km']:,} km"),
            ("Green Points earned", f"{cert['points']:,}")]
    for i, (label, value) in enumerate(figs):
        x = M + i * (box_w + gap)
        c.setFillColor(MINT)
        c.roundRect(x, y - box_h, box_w, box_h, 8, stroke=0, fill=1)
        c.setFillColor(INK3)
        c.setFont("Text", 7.6)
        c.drawString(x + 10, y - 17, label)
        c.setFillColor(COPPER if i == 3 else INK)
        c.setFont("Display", 19)
        c.drawString(x + 10, y - 45, value)
    y -= box_h + 30

    # ---------- items ----------
    c.setFillColor(INK)
    c.setFont("TextBold", 10)
    c.drawString(M, y, "Items recycled")
    y -= 8
    c.setStrokeColor(INK)
    c.setLineWidth(1.2)
    c.line(M, y, W - M, y)
    items = cert["items"]
    shown = items[:9]
    for it in shown:
        y -= 19
        c.setFont("Text", 10)
        c.setFillColor(INK)
        c.drawString(M, y, f"{it['qty']} × {it['name']}")
        c.setFillColor(INK3)
        c.drawRightString(W - M, y, it["condition_label"])
        c.setStrokeColor(LINE)
        c.setLineWidth(0.6)
        c.line(M, y - 7, W - M, y - 7)
    if len(items) > len(shown):
        y -= 18
        c.setFont("Text", 9)
        c.setFillColor(INK3)
        c.drawString(M, y, f"+ {len(items) - len(shown)} more item types")
    y -= 22
    c.setFont("Text", 9)
    c.setFillColor(INK2)
    c.drawString(M, y, "A data-wipe request was recorded with this pickup." if cert["wipe"]
                 else "No data-wipe request was recorded with this pickup.")

    # ---------- recycler + collector ----------
    y -= 34
    col_w = (W - 2 * M - 24) / 2
    rec = cert["recycler"]
    left_x, right_x = M, M + col_w + 24
    c.setFont("TextBold", 8)
    c.setFillColor(INK3)
    c.drawString(left_x, y, "RECEIVED BY (AUTHORISED RECYCLER)")
    c.drawString(right_x, y, "COLLECTED BY")
    c.setFillColor(INK)
    c.setFont("Display", 14)
    c.drawString(left_x, y - 19, rec["name"])
    ly = _wrap(c, f"{rec['type']}, {rec['area']}", "Text", 9.5, left_x, y - 34, col_w, 12.5, INK2)
    ly = _wrap(c, rec["address"], "Text", 8.5, left_x, ly - 1, col_w, 11.5, INK3)
    c.setFont("TextBold", 8.5)
    c.setFillColor(COPPER)
    c.drawString(left_x, ly - 4, rec["auth"])
    c.setFont("Text", 8.5)
    c.setFillColor(INK3)
    c.drawString(left_x, ly - 17, f"MPCB authorisation, valid to {_date(rec['valid_to'])}")

    col = cert.get("collector") or {}
    c.setFillColor(INK)
    c.setFont("Display", 14)
    c.drawString(right_x, y - 19, col.get("name", "-"))
    _wrap(c, f"EcoScrap pickup partner, {col.get('hub', '')} hub", "Text", 9.5, right_x, y - 34, col_w, 12.5, INK2)
    c.setFont("Text", 9.5)
    c.setFillColor(INK2)
    c.drawString(right_x, y - 52, f"Pickup pincode {cert.get('pincode', '')}")

    # ---------- footer: QR + seal ----------
    qr_size = 92
    base_y = 74
    widget = QrCodeWidget(verify_url)
    b = widget.getBounds()
    d = Drawing(qr_size, qr_size, transform=[qr_size / (b[2] - b[0]), 0, 0, qr_size / (b[3] - b[1]), 0, 0])
    d.add(widget)
    renderPDF.draw(d, c, M - 6, base_y)
    c.setFont("TextBold", 10)
    c.setFillColor(INK)
    c.drawString(M + qr_size + 6, base_y + 66, "Scan to verify")
    _wrap(c, "Anyone can check this certificate online by scanning the code or opening:", "Text", 8.5,
          M + qr_size + 6, base_y + 52, 230, 11, INK3)
    _wrap(c, verify_url, "TextBold", 7.5, M + qr_size + 6, base_y + 28, 230, 10, INK2)
    _seal(c, W - M - 48, base_y + 46)

    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    c.line(M, 52, W - M, 52)
    c.setFont("Text", 7)
    c.setFillColor(INK3)
    c.drawString(M, 38, "Issued by EcoScrap, a student project for E-waste and Environment Management. Recycler authorisation "
                        "from the MPCB list.")
    c.drawString(M, 28, "CO2e is an estimate based on illustrative factors explained on the EcoScrap Learn page. "
                        f"Generated {datetime.now().strftime('%d %b %Y, %H:%M')}.")

    c.showPage()
    c.save()
    return buf.getvalue()
