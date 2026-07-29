from core import product_download_options
from routers.public import PRIVATE_PRODUCT_FIELDS, _public_product
from services.private_download_service import (
    create_private_download_url,
    decode_private_download_ticket,
)


def test_private_storage_is_available_without_public_url():
    product = {
        "windows_enabled": True,
        "windows_download_url": "",
        "windows_storage_key": "products/windows/private-file.zip",
        "macos_enabled": False,
    }

    assert product_download_options(product) == {
        "windows": "products/windows/private-file.zip",
    }


def test_single_product_download_uses_one_generic_option():
    product = {
        "download_mode": "single",
        "download_url": "",
        "product_storage_key": "products/product/sample-pack.zip",
        "windows_enabled": True,
        "macos_enabled": True,
    }

    assert product_download_options(product) == {
        "product": "products/product/sample-pack.zip",
    }


def test_public_product_never_exposes_download_references():
    product = {
        "id": "product-1",
        "windows_enabled": True,
        "windows_download_url": "https://example.com/permanent.zip",
        "windows_storage_key": "products/windows/private-file.zip",
        "windows_download_filename": "Installer.zip",
        "product_storage_key": "products/product/hidden.zip",
        "product_download_filename": "Hidden.zip",
        "macos_enabled": False,
    }

    public_product = _public_product(product)

    assert public_product["available_platforms"] == ["windows"]
    assert not PRIVATE_PRODUCT_FIELDS.intersection(public_product)


def test_private_download_ticket_round_trip():
    url = create_private_download_url(
        storage_key="products/windows/private-file.zip",
        filename="Installer.zip",
        customer_id="customer-1",
        product_id="product-1",
        platform="windows",
        access_type="purchase",
        access_id="transaction-1",
    )

    payload = decode_private_download_ticket(url.rsplit("/", 1)[-1])

    assert payload["purpose"] == "private_download"
    assert payload["storage_key"] == "products/windows/private-file.zip"
    assert payload["customer_id"] == "customer-1"
    assert payload["platform"] == "windows"
    assert payload["access_id"] == "transaction-1"
