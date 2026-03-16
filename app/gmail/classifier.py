"""
Email classification — maps sender + subject + body patterns to EmailType.
Spec: Section 3.2 (Email Classification Rules table)

Returns one of the EmailType enum values used in EmailProcessingLog:
  Sale | Confirmation | Shipped | Completed | Cancelled |
  Attention | BuyerAccepted | BankTransfer | Purchase | Subscription | Receipt | Other
"""

import re

ALIAS_SENDER = "info@alias.org"

# Known subscription service sender domains/keywords
SUBSCRIPTION_KEYWORDS = [
    "netflix", "spotify", "grab", "youtube premium", "adobe",
    "microsoft", "apple", "google one", "canva", "notion",
]

# Known purchase/e-commerce senders
PURCHASE_KEYWORDS = [
    "shopee", "lazada", "nike", "adidas", "zalora",
    "order confirmation", "your order", "payment confirmed",
]


def classify_email(sender: str, subject: str, body: str) -> str:
    """
    Classify an email into one of the defined EmailType values.
    Returns the type string.
    """
    sender_lower = sender.lower()
    subject_lower = subject.lower()
    body_lower = body.lower()

    # ---- Alias emails (info@alias.org) ------------------------------------
    if ALIAS_SENDER in sender_lower:
        return _classify_alias(subject_lower, body_lower)

    # ---- Non-Alias: subscription charges ----------------------------------
    if _matches_any(sender_lower + " " + subject_lower, SUBSCRIPTION_KEYWORDS):
        return "Subscription"

    # ---- Non-Alias: purchase / e-receipt ----------------------------------
    if _matches_any(sender_lower + " " + subject_lower, PURCHASE_KEYWORDS):
        # Distinguish sneaker purchase confirmations from personal orders
        if any(kw in subject_lower for kw in ["order confirmation", "your order", "purchase"]):
            return "Purchase"
        return "Receipt"

    return "Other"


def _classify_alias(subject: str, body: str) -> str:
    """Classify emails from info@alias.org by subject + body patterns."""

    # "Your [Shoe] Just Sold" — sale notification
    if "just sold" in subject:
        return "Sale"

    # "Order #XXXXXX - Shipping Label and Instructions" — confirmed
    if "shipping label" in subject and "instructions" in subject:
        return "Confirmation"

    # "Order #XXXXXX - Shipped to alias for Verification"
    if "shipped to alias" in subject or ("shipped" in subject and "verification" in subject):
        return "Shipped"

    # "Order #XXXXXX Completed" + "Available for Cash Out" in body
    if "completed" in subject and "available for cash out" in body:
        return "Completed"

    # "Order #XXXXXX - Attention Needed"
    if "attention needed" in subject:
        return "Attention"

    # "Order #XXXXXX - Buyer Accepted"
    if "buyer accepted" in subject:
        return "BuyerAccepted"

    # "Order #XXXXXX Has Been Canceled"
    # Distinguish by body: presence of "you will be charged" → Confirmed fee
    if "has been canceled" in subject or "has been cancelled" in subject:
        return "Cancelled"

    # "Bank Transfer Completed"
    if "bank transfer completed" in subject:
        return "BankTransfer"

    return "Other"


def get_cancellation_type(body: str):
    """
    Spec 3.3.5: Distinguish Unconfirmed vs Confirmed cancellation by body content.
    Returns (cancellation_type: str, fee_amount: float | None)
    """
    body_lower = body.lower()
    match = re.search(r'you will be charged \$(\d+(?:\.\d+)?)', body_lower)
    if match:
        return "Confirmed", float(match.group(1))
    return "Unconfirmed", None


def _matches_any(text: str, keywords: list) -> bool:
    return any(kw in text for kw in keywords)
