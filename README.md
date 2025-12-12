# Counter (time + invoices)

Minimal, local-first time tracker and invoice generator with a flat UI. Everything ships blank and in English; add your own data when you run it.

## Highlights
- Time logging by day with month filter, per-month totals, and quick month cleanup.
- Auto-filled invoice hours: takes the sum of logged hours for the invoice month.
- Progress bars for “hours vs. plan” (8h per working day, Polish holidays incl. Christmas Eve) and “month progress”.
- Invoice builder with VAT, manual net override, extra line, and PDF export via Python/ReportLab.
- Client address book and defaults panel (seller identity, VAT, rate, currency, etc.).
- Local JSON storage in `data/store.json`; PDFs in `data/pdfs/` (both git-ignored).

## Stack
- Frontend: static HTML/CSS/vanilla JS (no bundler).
- Backend: Node.js built-in `http` serving API + static files.
- PDF: Python ReportLab (`generate_invoice_pdf.py`).

## Requirements
- Node.js 18+
- Python 3.11+ (or newer) for PDF generation

## Quick start
```bash
cd ~/counter
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
node server.js
```
Open `http://localhost:9898`. Data files are created on first run.

## Data & safety
- Runtime data: `data/store.json`; PDFs: `data/pdfs/`; both are git-ignored.
- No personal defaults are bundled. Fill your own seller info, clients, rates, and invoice numbers locally.

## Scripts
- `node server.js` — start static UI and API.

## Deploying
- Set `PORT` if needed (default `9898`).
- Keep `data/` writable so JSON and PDFs can be saved.
