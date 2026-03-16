"""
Email field extraction — one parser per email type.
Spec: Section 3.3.1 through 3.3.5

Each parser accepts the plain-text email body (str) and subject (str),
and returns a dict of extracted fields. Missing fields are omitted (not None).
"""

import re
import base64
import logging
from datetime import datetime, timezone
from email import message_from_bytes
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

logger = logging.getLogger(__name__)


# =============================================================================
# Gmail message utilities
# =============================================================================

def get_message_parts(gmail_message: dict) -> tuple[str, str, str, datetime | None]:
    """
    Extract (subject, sender, body, sent_at) from a Gmail API message resource.
    sent_at is the email's Date header parsed to a UTC-naive datetime, or None.
    """
    headers = gmail_message.get("payload", {}).get("headers", [])
    subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "")
    sender = next((h["value"] for h in headers if h["name"].lower() == "from"), "")
    date_str = next((h["value"] for h in headers if h["name"].lower() == "date"), "")

    sent_at = None
    if date_str:
        try:
            dt = parsedate_to_datetime(date_str)
            # Convert to UTC-naive datetime
            sent_at = dt.astimezone(timezone.utc).replace(tzinfo=None)
        except Exception:
            pass

    body = _extract_body(gmail_message.get("payload", {}))
    if not body:
        body = gmail_message.get("snippet", "")

    return subject, sender, body, sent_at


def _extract_body(payload: dict) -> str:
    """
    Recursively extract text body from a Gmail payload.
    Prefers text/plain; falls back to text/html (stripped of tags).
    """
    mime_type = payload.get("mimeType", "")

    if mime_type == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")

    if mime_type == "text/html":
        data = payload.get("body", {}).get("data", "")
        if data:
            html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace")
            return _strip_html(html)

    if mime_type.startswith("multipart/"):
        plain = ""
        html_fallback = ""
        for part in payload.get("parts", []):
            part_mime = part.get("mimeType", "")
            if part_mime == "text/plain":
                result = _extract_body(part)
                if result:
                    return result  # plain text wins immediately
            elif part_mime == "text/html" and not html_fallback:
                html_fallback = _extract_body(part)
            elif part_mime.startswith("multipart/"):
                result = _extract_body(part)
                if result:
                    plain = result
        return plain or html_fallback

    return ""


class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts = []
        self._skip_tags = {"style", "script"}
        self._in_skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._skip_tags:
            self._in_skip += 1
        if tag in ("br", "p", "tr", "div", "li"):
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._skip_tags:
            self._in_skip -= 1

    def handle_data(self, data):
        if not self._in_skip:
            self._parts.append(data)

    def get_text(self):
        return "".join(self._parts)


def _strip_html(html: str) -> str:
    """Strip HTML tags and return plain text suitable for regex parsing."""
    stripper = _HTMLStripper()
    stripper.feed(html)
    text = stripper.get_text()
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# =============================================================================
# 3.3.1 Sale Notification ("Just Sold")
# =============================================================================

def parse_sale_notification(subject: str, body: str) -> dict:
    """
    Spec 3.3.1 — Extract sale fields from a "Just Sold" email.
    Returns dict with: order_number, shoe_name, condition, box_condition,
                       size, sku, selling_price, amount_made
    """
    result = {}

    # Order number from subject or body: "Order #992603383"
    order_match = re.search(r'Order\s*#(\d+)', subject + " " + body, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Detect consignment sale (auto-confirmed, no separate Confirmation email)
    if re.search(r'\bconsigned\b', subject, re.IGNORECASE):
        result["is_consigned"] = True

    # Shoe name: line after "Name:" OR from subject
    name_match = re.search(r'Name:\s*(.+)', body, re.IGNORECASE)
    if name_match:
        result["shoe_name"] = name_match.group(1).strip()
    else:
        # "Your [Name] Just Sold" or "Your consigned [Name] Just Sold"
        subj_match = re.search(r'Your (?:consigned\s+)?(.+?) Just Sold', subject, re.IGNORECASE)
        if subj_match:
            result["shoe_name"] = subj_match.group(1).strip()
        else:
            # "You filled an offer for [Name] - Start Packaging"
            subj_match2 = re.search(
                r'(?:filled an offer for|You filled an offer for)\s+(.+?)\s*[-–]',
                subject, re.IGNORECASE
            )
            if subj_match2:
                result["shoe_name"] = subj_match2.group(1).strip()

    # Condition: line after "Condition:"
    cond_match = re.search(r'Condition:\s*(.+)', body, re.IGNORECASE)
    if cond_match:
        val = cond_match.group(1).strip()
        if val in ("New", "Used"):
            result["condition"] = val

    # Box condition: line after "Box:"
    box_match = re.search(r'Box:\s*(.+)', body, re.IGNORECASE)
    if box_match:
        val = box_match.group(1).strip()
        if val in ("Good Condition", "No Box", "Badly Damaged"):
            result["box_condition"] = val

    # Size: line after "Size:"
    size_match = re.search(r'Size:\s*([\d.]+)', body, re.IGNORECASE)
    if size_match:
        result["size"] = float(size_match.group(1))

    # SKU: line after "SKU:"
    sku_match = re.search(r'SKU:\s*(.+)', body, re.IGNORECASE)
    if sku_match:
        result["sku"] = sku_match.group(1).strip()

    # Selling price: line after "Price:" — "$72"
    price_match = re.search(r'Price:\s*\$?([\d,]+(?:\.\d+)?)', body, re.IGNORECASE)
    if price_match:
        result["selling_price"] = float(price_match.group(1).replace(",", ""))

    # Amount made: line after "Amount Made:" — "$53.07"
    made_match = re.search(r'Amount\s*Made:\s*\$?([\d,]+(?:\.\d+)?)', body, re.IGNORECASE)
    if made_match:
        result["amount_made"] = float(made_match.group(1).replace(",", ""))

    return result


# =============================================================================
# 3.3.2 Order Confirmation ("Shipping Label and Instructions")
# =============================================================================

def parse_confirmation(subject: str, body: str) -> dict:
    """
    Spec 3.3.2 — Extract confirmation fields.
    Returns dict with: order_number, shipment_deadline, pickup_address,
                       pickup_window, amount_made (earnings USD)
    """
    result = {}

    order_match = re.search(r'Order\s*#(\d+)', subject + " " + body, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Shipment deadline: "must be shipped by March 10, 2026 00:00 Asia/Manila"
    deadline_match = re.search(
        r'must be shipped by\s+(.+?)(?:\n|$)', body, re.IGNORECASE
    )
    if deadline_match:
        deadline_str = deadline_match.group(1).strip()
        parsed_dt = _parse_deadline(deadline_str)
        if parsed_dt:
            result["shipment_deadline"] = parsed_dt

    # Pickup address: lines after "ready for Janio collection at:"
    addr_match = re.search(
        r'ready for (?:Janio )?collection at:\s*\n(.+?)(?:\n\n|\Z)',
        body, re.IGNORECASE | re.DOTALL
    )
    if addr_match:
        result["pickup_address"] = addr_match.group(1).strip()

    # Pickup window: "on [DATE] between [TIME] and [TIME]"
    # Stop at period or newline to avoid capturing the full paragraph
    window_match = re.search(
        r'on\s+(\d{4}-\d{2}-\d{2}|\w+ \d+,? \d{4})\s+between\s+(.+?)\s+and\s+([^.\n]+)',
        body, re.IGNORECASE
    )
    if window_match:
        result["pickup_window"] = (
            f"{window_match.group(1).strip()} between "
            f"{window_match.group(2).strip()} and {window_match.group(3).strip()}"
        )

    # Earnings USD: "Your Earnings: $53.07"
    earnings_match = re.search(r'Your Earnings:\s*\$?([\d,]+(?:\.\d+)?)', body, re.IGNORECASE)
    if earnings_match:
        result["amount_made"] = float(earnings_match.group(1).replace(",", ""))

    return result


def _parse_deadline(deadline_str: str) -> datetime | None:
    """Try multiple date formats for the shipment deadline string."""
    # Strip trailing sentence after the timezone (e.g., "Asia/Manila. Failure to do so...")
    cleaned = re.sub(r'\s+[A-Za-z]+/[A-Za-z_]+.*$', '', deadline_str).strip()
    # Also handle a plain period with trailing text if no timezone was present
    cleaned = re.split(r'\.\s+[A-Z]', cleaned)[0].strip()
    formats = [
        "%B %d, %Y %H:%M",   # March 10, 2026 00:00
        "%B %d %Y %H:%M",    # March 10 2026 00:00
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%B %d, %Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    logger.warning(f"Could not parse deadline: '{deadline_str}'")
    return None


# =============================================================================
# 3.3.3 Bank Transfer Email
# =============================================================================

def parse_bank_transfer(subject: str, body: str) -> dict:
    """
    Spec 3.3.3 — Extract bank transfer fields.
    Returns dict with: amount_php, bank_name, account_last4, transfer_date
    """
    result = {}

    # Amount: "direct deposit of ₱45,417.60"
    # The ₱ character may be encoded differently, so also try P and PHP
    amount_match = re.search(
        r'direct deposit of\s+[₱P]?([\d,]+(?:\.\d+)?)',
        body, re.IGNORECASE
    )
    if amount_match:
        result["amount_php"] = float(amount_match.group(1).replace(",", ""))

    # Bank name + account last 4:
    # Pattern: "bank account ending in **BANCO DE ORO UNIVERSAL BANK 7425 has cleared"
    # or "bank account ending in **BANK_NAME\nXXXX has cleared"
    bank_match = re.search(
        r'bank account ending in\s+\*{0,2}([A-Z][A-Z\s]+?)\s+(\d{4})\s+has cleared',
        body, re.IGNORECASE
    )
    if bank_match:
        result["bank_name"] = bank_match.group(1).strip()
        result["account_last4"] = bank_match.group(2).strip()
    else:
        # Fallback: separate patterns
        bank_name_match = re.search(
            r'bank account ending in\s+\*{0,2}([A-Z][A-Z\s]+?)(?:\n|\d{4})',
            body, re.IGNORECASE
        )
        if bank_name_match:
            result["bank_name"] = bank_name_match.group(1).strip()

        last4_match = re.search(r'(\d{4})\s+has cleared', body, re.IGNORECASE)
        if last4_match:
            result["account_last4"] = last4_match.group(1)

    # Transfer date: "completed on March 06, 2026 18:52"
    date_match = re.search(
        r'completed on\s+(.+?)(?:\n|$)', body, re.IGNORECASE
    )
    if date_match:
        date_str = date_match.group(1).strip()
        parsed_dt = _parse_transfer_date(date_str)
        if parsed_dt:
            result["transfer_date"] = parsed_dt

    return result


def _parse_transfer_date(date_str: str) -> datetime | None:
    formats = [
        "%B %d, %Y %H:%M",
        "%B %d %Y %H:%M",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%B %d, %Y",
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    logger.warning(f"Could not parse transfer date: '{date_str}'")
    return None


# =============================================================================
# 3.3.4 Attention Needed Email
# =============================================================================

def parse_attention_needed(subject: str, body: str) -> dict:
    """
    Spec 3.3.4 — Extract attention needed fields.
    Returns dict with: order_number, issue_type
    """
    result = {}

    order_match = re.search(r'Order\s*#(\d+)', subject, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Issue type: text after "discovered the following issue(s):"
    issue_match = re.search(
        r'discovered the following issue(?:s)?:\s*\n?\s*(.+?)(?:\n|$)',
        body, re.IGNORECASE
    )
    if issue_match:
        result["issue_type"] = issue_match.group(1).strip()

    return result


# =============================================================================
# 3.3.5 Cancellation Email ("Has Been Canceled")
# =============================================================================

def parse_cancellation(subject: str, body: str) -> dict:
    """
    Spec 3.3.5 — Extract cancellation fields.
    Returns dict with: order_number, cancellation_type, fee_amount (if any)
    """
    result = {}

    order_match = re.search(r'Order\s*#(\d+)', subject, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Detect fee language: "you will be charged $10"
    fee_match = re.search(r'you will be charged\s+\$?([\d,]+(?:\.\d+)?)', body, re.IGNORECASE)
    if fee_match:
        result["cancellation_type"] = "Confirmed"
        result["fee_amount"] = float(fee_match.group(1).replace(",", ""))
    else:
        result["cancellation_type"] = "Unconfirmed"
        result["fee_amount"] = None

    return result


# =============================================================================
# Shipped / Completed / Buyer Accepted (simple order number extraction)
# =============================================================================

def parse_order_number_only(subject: str, body: str) -> dict:
    """Extract just the order number from subject. Used for Shipped, Completed, BuyerAccepted."""
    result = {}
    order_match = re.search(r'Order\s*#(\d+)', subject + " " + body, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Completed: grab amount from body "Amount Made: $XX" or "Earnings: $XX"
    made_match = re.search(
        r'(?:Amount Made|Earnings):\s*\$?([\d,]+(?:\.\d+)?)', body, re.IGNORECASE
    )
    if made_match:
        result["amount_made"] = float(made_match.group(1).replace(",", ""))

    # Completed subject: "Order #XXXXXX Completed: USD $68.84 Available for Cash Out"
    if not result.get("amount_made"):
        usd_match = re.search(r'USD\s*\$?([\d,]+(?:\.\d+)?)', subject, re.IGNORECASE)
        if usd_match:
            result["amount_made"] = float(usd_match.group(1).replace(",", ""))

    return result
