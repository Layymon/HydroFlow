"""Seed non-zero demo stock for Bago east / Pyay west warehouses."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy.orm import Session

from app.db import INVENTORY_DATABASE_URL, Base, inventory_engine
from app.services.inventory import add_region_stock, region_snapshot, seed_regions

DEMO_STOCK = {
    "east": [
        ("foods", "rice", 100),
        ("foods", "oil", 500),
        ("foods", "can", 200),
        ("clothes", "tshirt", 3500),
        ("utility", "blanket", 800),
        ("utility", "cup", 1200),
    ],
    "west": [
        ("foods", "rice", 80),
        ("foods", "oil", 120),
        ("clothes", "tshirt", 600),
        ("utility", "blanket", 150),
    ],
}


def main() -> int:
    Base.metadata.create_all(inventory_engine)
    with Session(inventory_engine) as session:
        seed_regions(session)
        for region, lines in DEMO_STOCK.items():
            snapshot = region_snapshot(session, region)
            total = sum(
                item["quantity"]
                for klass in snapshot.get("classes", [])
                for item in klass.get("items", [])
            )
            if total > 0:
                continue
            for category_code, item_code, quantity in lines:
                add_region_stock(
                    session,
                    region=region,
                    category_code=category_code,
                    item_code=item_code,
                    quantity=quantity,
                    entry_mode="manual",
                    direction="in",
                    note="Demo seed stock",
                )
        session.commit()
    print("Demo inventory seed complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
