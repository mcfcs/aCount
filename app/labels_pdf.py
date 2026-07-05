"""Shipping-label PDF assembly.

Downloads the prepaid label PDFs referenced by Alias confirmation emails and
combines them into a single print-ready file. Each source label PDF has two
pages (the shipping label + a QR code); those two pages are laid out
side-by-side on one landscape A4 sheet, each scaled to fit its half of the
printable area ("2 pages per sheet" + "fit to printable area"). Every source
PDF starts on its own sheet, so one order never shares a sheet with another.
"""

import io
import logging
import re
import urllib.request

from pypdf import PdfReader, PdfWriter, Transformation

from app.utils import assert_safe_public_url

logger = logging.getLogger(__name__)

# JANIO tracking number, e.g. "JAN6118431092786803" — printed on the label.
_TRACKING_RE = re.compile(r'JAN\d{8,}')

MAX_PDF_BYTES = 25 * 1024 * 1024      # per-label download cap (25 MB)
DOWNLOAD_TIMEOUT = 20                 # seconds

# A4 landscape, in PostScript points (1/72"). Portrait A4 = 595.28 x 841.89.
SHEET_W = 841.89
SHEET_H = 595.28
MARGIN = 14.0                          # printable-area inset (~0.2")
GUTTER = 12.0                          # gap between the two half-cells


class LabelPdfError(Exception):
    """A label PDF could not be downloaded or is not a valid PDF."""


def download_pdf(url: str) -> bytes:
    """Fetch a label PDF over http(s), guarding against SSRF and oversize files."""
    assert_safe_public_url(url)  # http(s) + resolves to a public address only
    req = urllib.request.Request(url, headers={"User-Agent": "aCount-LabelFetcher/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT) as response:
            content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            raw = response.read(MAX_PDF_BYTES + 1)  # +1 so we can detect oversize
    except LabelPdfError:
        raise
    except Exception as exc:
        raise LabelPdfError(f"Could not download label PDF: {exc}") from exc

    if len(raw) > MAX_PDF_BYTES:
        raise LabelPdfError(f"Label PDF exceeds the {MAX_PDF_BYTES // (1024 * 1024)} MB limit.")
    if not raw:
        raise LabelPdfError("Label PDF response was empty.")
    if not raw.startswith(b"%PDF"):
        raise LabelPdfError(f"URL did not return a PDF (content-type: {content_type or 'unknown'}).")
    return raw


def extract_tracking_number(pdf_bytes: bytes) -> str | None:
    """Read the JANIO tracking number (JAN…) printed on a label PDF.

    The QR page line-wraps the number, so we scan every page and return the
    longest match — the complete, unwrapped value on the label page.
    """
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception:
        return None

    matches = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            continue
        matches.extend(_TRACKING_RE.findall(text))

    return max(matches, key=len) if matches else None


def fetch_tracking_number(url: str) -> str | None:
    """Best-effort: download a label PDF and read its JANIO tracking number."""
    try:
        return extract_tracking_number(download_pdf(url))
    except Exception as exc:
        logger.warning(f"Could not read tracking number from {url}: {exc}")
        return None


def _place_page(dest, src, cell_x, cell_y, cell_w, cell_h):
    """Scale `src` to fit a `cell_w` x `cell_h` box, centre it, and stamp onto `dest`."""
    try:
        # Bake any /Rotate into the content so width/height reflect what's visible.
        src.transfer_rotation_to_content()
    except Exception:
        pass

    box = src.mediabox
    x0, y0 = float(box.left), float(box.bottom)
    sw, sh = float(box.width), float(box.height)
    if sw <= 0 or sh <= 0:
        return

    scale = min(cell_w / sw, cell_h / sh)
    tx = cell_x + (cell_w - sw * scale) / 2.0
    ty = cell_y + (cell_h - sh * scale) / 2.0

    # Normalise origin to (0,0), scale to fit, then translate into the cell.
    #
    # Use merge_transformed_page (not add_transformation + merge_page): the
    # transform is applied to the page's Form XObject *via the Do operator*,
    # so the form's BBox clips in the page's own coordinate space and only
    # then is the whole thing scaled into the cell. Baking the scale inside
    # the form instead leaves its BBox at the original (unscaled) size, which
    # clips any page we scale UP (e.g. a small 300x420 label) — cropping it.
    transform = Transformation().translate(-x0, -y0).scale(scale).translate(tx, ty)
    dest.merge_transformed_page(src, transform)


def build_two_up_pdf(pdf_bytes_list) -> bytes:
    """Combine label PDFs into one file — two source pages per landscape sheet."""
    writer = PdfWriter()

    cell_w = (SHEET_W - 2 * MARGIN - GUTTER) / 2.0
    cell_h = SHEET_H - 2 * MARGIN
    left_x = MARGIN
    right_x = MARGIN + cell_w + GUTTER
    cell_y = MARGIN

    produced = 0
    for raw in pdf_bytes_list:
        try:
            reader = PdfReader(io.BytesIO(raw))
            pages = list(reader.pages)
        except Exception as exc:
            logger.warning(f"Skipping unreadable label PDF: {exc}")
            continue

        # Two source pages per output sheet, left then right.
        for i in range(0, len(pages), 2):
            sheet = writer.add_blank_page(width=SHEET_W, height=SHEET_H)
            _place_page(sheet, pages[i], left_x, cell_y, cell_w, cell_h)
            if i + 1 < len(pages):
                _place_page(sheet, pages[i + 1], right_x, cell_y, cell_w, cell_h)
            produced += 1

    if produced == 0:
        raise LabelPdfError("No printable label pages were produced.")

    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
