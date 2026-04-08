"""
Email field extraction — one parser per email type.
Spec: Section 3.3.1 through 3.3.5

Each parser accepts the plain-text email body (str) and subject (str),
and returns a dict of extracted fields. Missing fields are omitted (not None).
"""

import re
import base64
import logging
import urllib.request
from urllib.parse import urlparse
from datetime import datetime
from email import message_from_bytes
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from app.time_utils import PH_TIMEZONE

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
            # Convert to Manila-local naive datetime
            sent_at = dt.astimezone(PH_TIMEZONE).replace(tzinfo=None)
        except Exception:
            pass

    body = _extract_body(gmail_message.get("payload", {}))
    if not body:
        body = gmail_message.get("snippet", "")

    return subject, sender, body, sent_at


def extract_largest_image_part(service, gmail_message: dict) -> dict | None:
    """
    Return the best shoe image candidate from a Gmail API message resource.
    Supports:
      - image/* MIME parts and attachments
      - cid: inline images referenced by HTML
      - remote/data URL images referenced by HTML
    Result shape: {filename, content_type, data, size}
    """
    payload = gmail_message.get("payload", {}) or {}
    candidates = []
    cid_images = {}
    html_bodies = []

    def walk(part: dict):
        mime_type = str(part.get("mimeType") or "").lower()
        filename = part.get("filename") or ""
        body = part.get("body", {}) or {}
        attachment_id = body.get("attachmentId")
        encoded_data = body.get("data")
        part_size = int(body.get("size") or 0)
        headers = part.get("headers", []) or []

        if mime_type.startswith("image/"):
            raw_bytes = None
            if encoded_data:
                try:
                    raw_bytes = _decode_gmail_base64(encoded_data)
                except Exception:
                    raw_bytes = None
            elif attachment_id:
                try:
                    attachment = service.users().messages().attachments().get(
                        userId="me",
                        messageId=gmail_message["id"],
                        id=attachment_id,
                    ).execute()
                    attachment_data = attachment.get("data", "")
                    if attachment_data:
                        raw_bytes = _decode_gmail_base64(attachment_data)
                        part_size = max(part_size, int(attachment.get("size") or 0), len(raw_bytes))
                except Exception as exc:
                    logger.warning(f"Could not download Gmail attachment for message {gmail_message.get('id')}: {exc}")

            if raw_bytes:
                candidate = {
                    "filename": filename,
                    "content_type": mime_type,
                    "data": raw_bytes,
                    "size": max(part_size, len(raw_bytes)),
                }
                candidates.append(candidate)
                content_id = next((h.get("value") for h in headers if str(h.get("name", "")).lower() == "content-id"), "")
                if content_id:
                    cid_images[content_id.strip().strip("<>").lower()] = candidate

        if mime_type == "text/html":
            if encoded_data:
                try:
                    html_bodies.append(_decode_gmail_base64(encoded_data).decode("utf-8", errors="replace"))
                except Exception:
                    pass

        for child in part.get("parts", []) or []:
            walk(child)

    walk(payload)
    for html in html_bodies:
        for image_info in _extract_html_images(html):
            candidate = _candidate_from_html_image_src(image_info.get("src", ""), cid_images)
            if candidate:
                candidate["priority"] = _html_image_priority(image_info, candidate)
                candidates.append(candidate)

    if not candidates:
        return None
    return max(candidates, key=lambda item: (item.get("priority", 0), item.get("size", 0)))


def _decode_gmail_base64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "===")


class _HTMLImageCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() != "img":
            return
        attrs_dict = dict(attrs)
        src = attrs_dict.get("src")
        if src:
            self.images.append({
                "src": src.strip(),
                "alt": str(attrs_dict.get("alt") or "").strip(),
                "class": str(attrs_dict.get("class") or "").strip(),
                "width": str(attrs_dict.get("width") or "").strip(),
                "height": str(attrs_dict.get("height") or "").strip(),
            })


def _extract_html_images(html: str) -> list[dict]:
    parser = _HTMLImageCollector()
    try:
        parser.feed(html)
    except Exception:
        return []
    return parser.images


def _extract_google_proxy_original_url(src: str) -> str | None:
    if "#" not in src:
        return None
    fragment = src.split("#", 1)[1].strip()
    if fragment.startswith("http://") or fragment.startswith("https://"):
        return fragment
    return None


def _html_image_priority(image_info: dict, candidate: dict) -> int:
    score = 0
    src = str(image_info.get("src") or "").lower()
    alt = str(image_info.get("alt") or "").lower()
    class_name = str(image_info.get("class") or "").lower()
    filename = str(candidate.get("filename") or "").lower()
    content_type = str(candidate.get("content_type") or "").lower()

    if "product image" in alt:
        score += 1000
    elif "product" in alt or "shoe" in alt or "sneaker" in alt:
        score += 500

    if "product_template_pictures" in src or "image.goat.com" in src:
        score += 900
    if "product" in src:
        score += 250
    if "logo" in src or "icon" in src or "banner" in src:
        score -= 400

    if "ctowud" in class_name or "a6t" in class_name:
        score += 25

    if "png" in filename or content_type == "image/png":
        score += 25

    try:
        width = int(float(image_info.get("width") or 0))
    except ValueError:
        width = 0
    try:
        height = int(float(image_info.get("height") or 0))
    except ValueError:
        height = 0

    if width >= 120 or height >= 120:
        score += 150
    elif width and width < 64:
        score -= 150

    score += min(int(candidate.get("size") or 0) // 1024, 250)
    return score


def _candidate_from_html_image_src(src: str, cid_images: dict[str, dict]) -> dict | None:
    lowered = src.lower()
    if lowered.startswith("cid:"):
        return cid_images.get(src[4:].strip().strip("<>").lower())

    if lowered.startswith("data:image/"):
        try:
            header, encoded = src.split(",", 1)
            mime_match = re.match(r"data:(image/[^;]+);base64$", header, re.IGNORECASE)
            if not mime_match:
                return None
            raw = base64.b64decode(encoded)
            return {
                "filename": "",
                "content_type": mime_match.group(1).lower(),
                "data": raw,
                "size": len(raw),
            }
        except Exception:
            return None

    if lowered.startswith("http://") or lowered.startswith("https://"):
        candidate_urls = []
        original_url = _extract_google_proxy_original_url(src)
        if original_url:
            candidate_urls.append(original_url)
        candidate_urls.append(src)

        parsed = urlparse(src)
        if "googleusercontent.com" in parsed.netloc and original_url:
            candidate_urls = [original_url, src]

        for candidate_url in candidate_urls:
            try:
                request = urllib.request.Request(candidate_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=15) as response:
                    content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                    if not content_type.startswith("image/"):
                        continue
                    raw = response.read()
                    if not raw:
                        continue
                    return {
                        "filename": candidate_url.rsplit("/", 1)[-1],
                        "content_type": content_type,
                        "data": raw,
                        "size": len(raw),
                    }
            except Exception as exc:
                logger.warning(f"Could not download remote HTML image {candidate_url}: {exc}")
        return None

    return None


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

    # Determine sale type: Regular | FilledOffer | Consignment
    subject_lower = subject.lower()
    if "consigned" in subject_lower:
        result["sale_type"] = "Consignment"
    elif "filled an offer" in subject_lower or "start packaging" in subject_lower:
        result["sale_type"] = "FilledOffer"
    else:
        result["sale_type"] = "Regular"

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

    name_match = re.search(r'Name:\s*(.+)', body, re.IGNORECASE)
    if name_match:
        result["shoe_name"] = name_match.group(1).strip()

    sku_match = re.search(r'SKU:\s*(.+)', body, re.IGNORECASE)
    if sku_match:
        result["sku"] = sku_match.group(1).strip()

    size_match = re.search(r'Size:\s*([\d.]+)', body, re.IGNORECASE)
    if size_match:
        result["size"] = float(size_match.group(1))

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
    Returns dict with: order_number, issue_type, buyer_declined

    Two variants:
      - Standard: item issue discovered, discount offered to buyer (48hr timer)
      - Buyer declined: buyer rejected discount, order cancelled, seller chooses Consign/Return
    """
    result = {}

    order_match = re.search(r'Order\s*#(\d+)', subject, re.IGNORECASE)
    if order_match:
        result["order_number"] = int(order_match.group(1))

    # Buyer-declined variant: "the buyer declined the discount"
    body_lower = body.lower()
    if "buyer declined" in body_lower or "buyer declined the discount" in body_lower:
        result["buyer_declined"] = True
        return result

    # Standard variant: issue discovered, discount offered
    result["buyer_declined"] = False
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
