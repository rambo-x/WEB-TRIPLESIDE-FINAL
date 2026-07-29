import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


BASE_DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIRECTORY))
os.chdir(BASE_DIRECTORY)

from core import db, mongo_client


LOCAL_TIMEZONE = ZoneInfo("Asia/Bangkok")


def utc_day_range():
    local_now = datetime.now(LOCAL_TIMEZONE)
    local_start = local_now.replace(
        hour=0,
        minute=0,
        second=0,
        microsecond=0,
    )
    local_end = local_start + timedelta(days=1)
    return (
        local_start.astimezone(timezone.utc).isoformat(),
        local_end.astimezone(timezone.utc).isoformat(),
        local_start.date().isoformat(),
    )


async def sales_today():
    start, end, local_date = utc_day_range()
    transactions = await db.payment_transactions.find(
        {
            "payment_status": "paid",
            "created_at": {
                "$gte": start,
                "$lt": end,
            },
        },
        {
            "_id": 0,
            "amount": 1,
            "currency": 1,
            "product_id": 1,
            "product_name": 1,
        },
    ).to_list(5000)

    totals = {}
    products = {}

    for transaction in transactions:
        amount = float(transaction.get("amount") or 0)
        currency = str(transaction.get("currency") or "unknown").upper()
        totals[currency] = totals.get(currency, 0) + amount
        product = (
            transaction.get("product_name")
            or transaction.get("product_id")
            or "Unknown product"
        )
        products[product] = products.get(product, 0) + 1

    return {
        "ok": True,
        "date": local_date,
        "timezone": "Asia/Bangkok",
        "transactions": len(transactions),
        "totals": totals,
        "products": products,
    }


async def active_licenses(product=None):
    query = {"status": "active"}

    if product:
        safe_product = re.escape(product[:100])
        query["$or"] = [
            {"product_id": {"$regex": safe_product, "$options": "i"}},
            {"product_name": {"$regex": safe_product, "$options": "i"}},
        ]

    licenses = await db.licenses.find(
        query,
        {
            "_id": 0,
            "product_id": 1,
            "product_name": 1,
            "activations": 1,
        },
    ).to_list(10000)

    products = {}
    activations = 0

    for license_item in licenses:
        name = (
            license_item.get("product_name")
            or license_item.get("product_id")
            or "Unknown product"
        )
        products[name] = products.get(name, 0) + 1
        activations += len(license_item.get("activations") or [])

    return {
        "ok": True,
        "query": product or "",
        "active_licenses": len(licenses),
        "active_devices": activations,
        "products": products,
    }


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=("sales-today", "active-licenses"),
    )
    parser.add_argument("--product", default="")
    arguments = parser.parse_args()

    if arguments.command == "sales-today":
        result = await sales_today()
    else:
        result = await active_licenses(arguments.product.strip() or None)

    print(json.dumps(result, ensure_ascii=False))
    mongo_client.close()


if __name__ == "__main__":
    asyncio.run(main())
