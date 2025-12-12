#!/usr/bin/env python3
"""
Invoice PDF generator (ReportLab).
Reads invoice JSON from stdin and writes a single PDF provided via --output.
"""
import argparse
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def parse_args():
    parser = argparse.ArgumentParser(description="Generate a PDF invoice from JSON input (stdin)")
    parser.add_argument("--output", required=True, help="Path to the PDF file to create")
    return parser.parse_args()


def fmt_money(value):
    try:
        return f"{float(value):.2f}"
    except Exception:
        return "0.00"


def money_cell(value, currency):
    amount = fmt_money(value)
    return f"{amount} {currency}".strip()


def register_font():
    # Try to load a font with extended glyph coverage; fall back to Helvetica.
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            pdfmetrics.registerFont(TTFont("CounterFont", path))
            return "CounterFont"
    return "Helvetica"


def build_items(inv):
    vat_percent = float(inv.get("vatPercent") or 0)
    vat_label = f"{vat_percent:.0f}%"
    currency = inv.get("currency") or ""
    qty = float(inv.get("hours") or 0)
    unit = inv.get("item", {}).get("unit") or "h"
    desc = inv.get("item", {}).get("desc") or "Services"
    rate = float(inv.get("rate") or 0)
    net_value = float(inv.get("net") or 0)
    total_net = float(inv.get("totalNet") or net_value)

    rows = [
        [
            "1",
            desc,
            f"{qty:.2f} {unit}",
            money_cell(rate, currency),
            money_cell(net_value, currency),
            vat_label,
            money_cell(net_value * vat_percent / 100, currency),
            money_cell(net_value * (1 + vat_percent / 100), currency),
        ]
    ]

    extra = inv.get("extra")
    if extra and extra.get("desc"):
        extra_net = float(extra.get("net") or 0)
        rows.append(
            [
                str(len(rows) + 1),
                extra.get("desc"),
                "1 item",
                money_cell(extra_net, currency),
                money_cell(extra_net, currency),
                vat_label,
                money_cell(extra_net * vat_percent / 100, currency),
                money_cell(extra_net * (1 + vat_percent / 100), currency),
            ]
        )

    gross_amount = float(inv.get("gross") or (total_net * (1 + vat_percent / 100)))
    vat_amount = float(inv.get("vatAmount") or (total_net * vat_percent / 100))
    return rows, vat_label, currency, total_net, vat_amount, gross_amount


def build_pdf(inv, output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )

    font_name = register_font()
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="Body", parent=styles["Normal"], fontName=font_name, fontSize=11, leading=14))
    styles.add(ParagraphStyle(name="Heading", parent=styles["Heading4"], fontName=font_name, fontSize=12, leading=15))
    styles.add(ParagraphStyle(name="CounterTitle", parent=styles["Title"], fontName=font_name, fontSize=16, leading=20))
    story = []

    invoice_no = inv.get("invoiceNumber") or "Invoice"
    story.append(Paragraph(f"<b>INVOICE</b> {invoice_no}", styles["CounterTitle"]))
    story.append(Spacer(1, 6))

    issue_date = inv.get("issueDate") or ""
    sale_date = inv.get("saleDate") or ""
    due_date = inv.get("dueDate") or ""
    place = inv.get("place") or ""
    meta = f"Issued: {issue_date} &nbsp;&nbsp; Sale date: {sale_date} &nbsp;&nbsp; Due: {due_date} &nbsp;&nbsp; Place: {place}"
    story.append(Paragraph(meta, styles["Body"]))
    story.append(Spacer(1, 10))

    seller = inv.get("seller") or {}
    buyer = inv.get("buyer") or {}
    parties = [
        [Paragraph("<b>Seller</b>", styles["Heading"]), Paragraph("<b>Buyer</b>", styles["Heading"])],
        [
            Paragraph(
                "<br/>".join(
                    filter(
                        None,
                        [
                            seller.get("name", ""),
                            seller.get("address", ""),
                            seller.get("city", ""),
                            f"Tax ID: {seller.get('taxId', '')}" if seller.get("taxId") else "",
                            f"Account: {seller.get('account', '')}" if seller.get("account") else "",
                            f"Bank: {seller.get('bank', '')}" if seller.get("bank") else "",
                        ],
                    )
                ),
                styles["Body"],
            ),
            Paragraph(
                "<br/>".join(
                    filter(
                        None,
                        [
                            buyer.get("name", ""),
                            buyer.get("address", ""),
                            buyer.get("city", ""),
                            f"Tax ID: {buyer.get('taxId', '')}" if buyer.get("taxId") else "",
                        ],
                    )
                ),
                styles["Body"],
            ),
        ],
    ]
    parties_table = Table(parties, colWidths=[90 * mm, 90 * mm])
    parties_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(parties_table)
    story.append(Spacer(1, 12))

    items, vat_label, currency, total_net, vat_amount, gross_amount = build_items(inv)
    headers = ["#", "Item", "Quantity", "Unit price", "Net", "VAT %", "VAT", "Gross"]
    table_data = [headers] + items
    items_table = Table(
        table_data,
        colWidths=[12 * mm, 55 * mm, 28 * mm, 28 * mm, 25 * mm, 18 * mm, 25 * mm, 28 * mm],
    )
    items_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(items_table)
    story.append(Spacer(1, 10))

    totals_table = Table(
        [
            ["Net total:", money_cell(total_net, currency)],
            [f"VAT {vat_label}:", money_cell(vat_amount, currency)],
            ["Amount due:", money_cell(gross_amount, currency)],
        ],
        colWidths=[60 * mm, 40 * mm],
        hAlign="RIGHT",
    )
    totals_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, -1), font_name),
                ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                ("FONTSIZE", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(totals_table)

    doc.build(story)


def main():
    args = parse_args()
    try:
        invoice = json.load(sys.stdin)
    except Exception as exc:
        sys.stderr.write(f"Could not read JSON from stdin: {exc}\n")
        sys.exit(1)

    try:
        build_pdf(invoice, args.output)
    except Exception as exc:
        sys.stderr.write(f"Failed to generate PDF: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
