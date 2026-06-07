import mimetypes
import os
import urllib.request
from urllib.parse import urlparse
from uuid import uuid4

from flask import current_app
from werkzeug.utils import secure_filename

from app.utils import assert_safe_public_url


ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "webp", "gif"}
CONTENT_TYPE_EXTENSION_MAP = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


def get_shoe_image_upload_dir() -> str:
    configured_dir = current_app.config.get("SHOES_IMAGE_UPLOAD_DIR")
    if configured_dir:
        return configured_dir
    return os.path.join(current_app.root_path, "uploads", "shoes")


def is_allowed_image_filename(filename: str) -> bool:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return extension in ALLOWED_IMAGE_EXTENSIONS


def _infer_extension(filename: str | None = None, content_type: str | None = None) -> str | None:
    if filename and "." in filename:
        candidate = filename.rsplit(".", 1)[-1].lower()
        if candidate in ALLOWED_IMAGE_EXTENSIONS:
            return candidate
    if content_type:
        mapped = CONTENT_TYPE_EXTENSION_MAP.get(content_type.lower())
        if mapped:
            return mapped
        guessed = mimetypes.guess_extension(content_type.lower()) or ""
        guessed = guessed.lstrip(".").lower()
        if guessed == "jpe":
            guessed = "jpg"
        if guessed in ALLOWED_IMAGE_EXTENSIONS:
            return guessed
    return None


def save_uploaded_shoe_image(file_storage) -> str:
    filename = secure_filename(file_storage.filename or "")
    if not filename:
        raise ValueError("Image filename is required.")
    if not is_allowed_image_filename(filename):
        raise ValueError("Unsupported image format. Use PNG, JPG, JPEG, WEBP, or GIF.")

    extension = filename.rsplit(".", 1)[-1].lower()
    stored_name = f"{uuid4().hex}.{extension}"
    upload_dir = get_shoe_image_upload_dir()
    os.makedirs(upload_dir, exist_ok=True)
    file_storage.save(os.path.join(upload_dir, stored_name))
    return stored_name


def save_shoe_image_bytes(data: bytes, filename: str | None = None, content_type: str | None = None) -> str:
    if not data:
        raise ValueError("Image data is required.")

    extension = _infer_extension(filename=filename, content_type=content_type)
    if not extension:
        raise ValueError("Unsupported image format. Use PNG, JPG, JPEG, WEBP, or GIF.")

    stored_name = f"{uuid4().hex}.{extension}"
    upload_dir = get_shoe_image_upload_dir()
    os.makedirs(upload_dir, exist_ok=True)
    with open(os.path.join(upload_dir, stored_name), "wb") as f:
        f.write(data)
    return stored_name


def _extract_google_proxy_original_url(url: str) -> str:
    if "#" not in url:
        return url
    fragment = url.split("#", 1)[1].strip()
    if fragment.startswith("http://") or fragment.startswith("https://"):
        return fragment
    return url


def save_shoe_image_from_url(url: str) -> str:
    if not url:
        raise ValueError("Image URL is required.")

    candidate_url = _extract_google_proxy_original_url(str(url).strip())
    # Validates scheme AND blocks internal/SSRF targets (localhost, RFC1918, metadata IP).
    parsed = assert_safe_public_url(candidate_url)

    request = urllib.request.Request(candidate_url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=20) as response:
        content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if not content_type.startswith("image/"):
            raise ValueError("The provided URL did not return an image.")
        data = response.read()
        if not data:
            raise ValueError("The provided image URL returned no data.")

    filename = parsed.path.rsplit("/", 1)[-1] if parsed.path else ""
    return save_shoe_image_bytes(data, filename=filename, content_type=content_type)
