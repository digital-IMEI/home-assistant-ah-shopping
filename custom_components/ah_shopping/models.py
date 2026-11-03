"""Data models for Albert Heijn Shopping."""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


def _float(value: Any, default: float = 0.0) -> float:
    """Normalise AH money values."""
    while isinstance(value, dict):
        if "amount" not in value:
            return default
        value = value.get("amount")
    try:
        return float(value) if value is not None else default
    except (TypeError, ValueError):
        return default


@dataclass(slots=True, frozen=True)
class Product:
    id: int
    title: str
    brand: str = ""
    unit_size: str = ""
    price_now: float = 0.0
    price_was: float = 0.0
    is_bonus: bool = False
    bonus_mechanism: str = ""
    image_url: str = ""
    category: str = ""

    @classmethod
    def from_api(cls, payload: dict[str, Any]) -> "Product":
        data = payload.get("productCard") if isinstance(payload.get("productCard"), dict) else payload
        images = data.get("images") or []
        best_image = ""
        if isinstance(images, list):
            valid = [i for i in images if isinstance(i, dict) and i.get("url")]
            if valid:
                best = max(valid, key=lambda i: _int(i.get("width")))
                best_image = str(best.get("url", ""))
        price_now = _float(data.get("currentPrice") or data.get("price"))
        price_was = _float(data.get("priceBeforeBonus"))
        if price_now <= 0:
            price_now = price_was
        if not best_image:
            best_image = str(data.get("imageUrl") or "")
        return cls(
            id=_int(data.get("webshopId") or data.get("id") or payload.get("productId")),
            title=str(data.get("title") or data.get("description") or ""),
            brand=str(data.get("brand") or ""),
            unit_size=str(
                data.get("salesUnitSize")
                or data.get("unitSize")
                or data.get("unitPriceDescription")
                or ""
            ),
            price_now=price_now,
            price_was=price_was,
            is_bonus=bool(
                data.get("isBonus")
                or data.get("isBonusPrice")
                or data.get("bonusMechanism")
            ),
            bonus_mechanism=str(data.get("bonusMechanism") or ""),
            image_url=best_image,
            category=str(data.get("mainCategory") or ""),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "brand": self.brand,
            "unit_size": self.unit_size,
            "price_now": round(self.price_now, 2),
            "price_was": round(self.price_was, 2),
            "is_bonus": self.is_bonus,
            "bonus_mechanism": self.bonus_mechanism,
            "image_url": self.image_url,
            "category": self.category,
        }


@dataclass(slots=True, frozen=True)
class ShoppingItem:
    item_id: str
    product_id: int
    quantity: int
    description: str = ""
    product: Product | None = None
    checked: bool = False

    @property
    def is_product(self) -> bool:
        return self.product_id > 0

    @property
    def title(self) -> str:
        if self.product and self.product.title:
            return self.product.title
        if self.description:
            return self.description
        return f"Product {self.product_id}" if self.product_id else "Boodschap"

    @property
    def line_total(self) -> float:
        return round((self.product.price_now if self.product else 0.0) * self.quantity, 2)

    @property
    def bonus_savings(self) -> float:
        """Return savings for multi-buy promotions we can calculate exactly."""
        if not self.product or not self.product.is_bonus or self.product.price_now <= 0:
            return 0.0

        mechanism = re.sub(r"\s+", " ", (self.product.bonus_mechanism or "").upper()).strip()
        quantity = max(0, self.quantity)
        unit = self.product.price_now

        # Simple discounted unit prices are already reflected in currentPrice.
        if self.product.price_was > unit:
            return 0.0

        if "2E HALVE PRIJS" in mechanism:
            return (quantity // 2) * _cents(unit / 2) / 100

        if "1+1GRATIS" in mechanism.replace(" ", "") or "2EGRATIS" in mechanism.replace(" ", ""):
            return round((quantity // 2) * unit, 2)

        match = re.search(r"(\d+)\s+HALEN\s+(\d+)\s+BETALEN", mechanism)
        if match:
            take, pay = int(match.group(1)), int(match.group(2))
            if take > pay > 0:
                return round((quantity // take) * (take - pay) * unit, 2)

        match = re.search(r"(\d+)\s+VOOR\s+€?\s*([0-9]+(?:[\.,][0-9]{1,2})?)", mechanism)
        if match:
            take = int(match.group(1))
            deal = float(match.group(2).replace(",", "."))
            if take > 0:
                groups = quantity // take
                return round(groups * max(0.0, take * unit - deal), 2)

        return 0.0

    @property
    def line_total_after_bonus(self) -> float:
        return round(max(0.0, self.line_total - self.bonus_savings), 2)

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "item_id": self.item_id,
            "product_id": self.product_id,
            "quantity": self.quantity,
            "title": self.title,
            "description": self.description,
            "checked": self.checked,
            "is_product": self.is_product,
            "line_total": self.line_total,
            "bonus_savings": self.bonus_savings,
            "line_total_after_bonus": self.line_total_after_bonus,
        }
        if self.product:
            result.update(self.product.as_dict())
            result["product_id"] = self.product_id
            result["is_product"] = True
        return result


def _cents(value: float) -> int:
    return int((Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _promotion_totals(items: tuple[ShoppingItem, ...]) -> tuple[float, float]:
    """Embedded unit savings and additional multibuy savings in cents.

    Group different products only for the verified Big Americans pizza family.
    Identical mechanism labels alone do not prove a shared promotion.
    """
    embedded = 0
    groups: dict[tuple, list[ShoppingItem]] = {}
    for item in items:
        product = item.product
        if not product or not product.is_bonus:
            continue
        embedded += max(0, _cents(product.price_was) - _cents(product.price_now)) * max(0, item.quantity)
        mechanism = re.sub(r"\s+", " ", product.bonus_mechanism.upper()).strip()
        family = product.id
        if (product.brand.casefold() == "dr. oetker"
                and product.title.casefold().startswith("dr. oetker big americans pizza")
                and re.fullmatch(r"2 VOOR €?\s*5[.,]99", mechanism)):
            family = "big-americans-pizza"
        key = (family, mechanism, _cents(product.price_now), _cents(product.price_was))
        groups.setdefault(key, []).append(item)
    additional = 0
    for rows in groups.values():
        first = rows[0]
        merged = replace(first, quantity=sum(max(0, row.quantity) for row in rows))
        additional += _cents(merged.bonus_savings)
    return embedded / 100, additional / 100


@dataclass(slots=True, frozen=True)
class ShoppingListData:
    list_id: str
    name: str
    items: tuple[ShoppingItem, ...] = field(default_factory=tuple)

    @property
    def total_quantity(self) -> int:
        return sum(max(item.quantity, 0) for item in self.items)

    @property
    def subtotal(self) -> float:
        return round(sum(item.line_total for item in self.items), 2)

    @property
    def bonus_savings(self) -> float:
        return round(sum(_promotion_totals(self.items)), 2)

    @property
    def estimated_total(self) -> float:
        return round(self.subtotal - _promotion_totals(self.items)[1], 2)

    def quantity_for_product(self, product_id: int) -> int:
        item = self.item_for_product(product_id)
        return item.quantity if item else 0

    def item_for_product(self, product_id: int) -> ShoppingItem | None:
        return next((item for item in self.items if item.product_id == product_id), None)

    def with_product_quantity(self, product_id: int, quantity: int) -> "ShoppingListData":
        """Return a copy with one product quantity changed immediately."""
        quantity = max(0, int(quantity))
        updated: list[ShoppingItem] = []
        for item in self.items:
            if item.product_id != product_id:
                updated.append(item)
                continue
            if quantity > 0:
                updated.append(replace(item, quantity=quantity))
        return replace(self, items=tuple(updated))

    def with_product(self, product: Product, quantity: int) -> "ShoppingListData":
        """Insert or update a complete product immediately after a scan."""
        quantity = max(0, int(quantity))
        existing = self.item_for_product(product.id)
        if existing is not None:
            updated = tuple(
                replace(
                    item,
                    quantity=quantity,
                    description=product.title or item.description,
                    product=product,
                )
                if item.product_id == product.id and quantity > 0
                else item
                for item in self.items
                if item.product_id != product.id or quantity > 0
            )
            return replace(self, items=updated)
        if quantity <= 0:
            return self
        item = ShoppingItem(
            item_id=f"product-{product.id}",
            product_id=product.id,
            quantity=quantity,
            description=product.title,
            checked=False,
            product=product,
        )
        return replace(self, items=(*self.items, item))

    def with_item_checked(
        self, product_id: int, description: str, checked: bool
    ) -> "ShoppingListData":
        """Return a copy with one matching item checked/unchecked."""
        description_key = description.strip().casefold()
        updated = tuple(
            replace(item, checked=checked)
            if (
                (product_id > 0 and item.product_id == product_id)
                or (
                    product_id <= 0
                    and item.product_id <= 0
                    and item.description.strip().casefold() == description_key
                )
            )
            else item
            for item in self.items
        )
        return replace(self, items=updated)

    def as_dict(self) -> dict[str, Any]:
        return {
            "list_id": self.list_id,
            "name": self.name,
            "total_quantity": self.total_quantity,
            "unique_items": len(self.items),
            "subtotal": self.subtotal,
            "bonus_savings": self.bonus_savings,
            "estimated_total": self.estimated_total,
            "items": [item.as_dict() for item in self.items],
        }



@dataclass(slots=True, frozen=True)
class NextOrderItem:
    product_id: int
    title: str
    quantity: int
    brand: str = ""
    unit_size: str = ""
    price_now: float = 0.0
    price_was: float = 0.0
    is_bonus: bool = False
    bonus_mechanism: str = ""
    taxonomy: str = ""
    image_url: str = ""

    @property
    def line_total(self) -> float:
        return round(self.price_now * self.quantity, 2)

    @property
    def bonus_savings(self) -> float:
        """Estimate savings from order product metadata, never alter AH's total."""
        product = Product(
            id=self.product_id, title=self.title, price_now=self.price_now,
            price_was=self.price_was, is_bonus=self.is_bonus,
            bonus_mechanism=self.bonus_mechanism,
        )
        embedded = max(0.0, self.price_was - self.price_now) * max(0, self.quantity)
        multibuy = ShoppingItem("", self.product_id, self.quantity, product=product).bonus_savings
        return round(embedded + multibuy, 2)

    def as_dict(self) -> dict[str, Any]:
        return {
            "product_id": self.product_id,
            "title": self.title,
            "quantity": self.quantity,
            "brand": self.brand,
            "unit_size": self.unit_size,
            "price_now": round(self.price_now, 2),
            "price_was": round(self.price_was, 2),
            "is_bonus": self.is_bonus,
            "bonus_mechanism": self.bonus_mechanism,
            "taxonomy": self.taxonomy,
            "image_url": self.image_url,
            "line_total": self.line_total,
            "bonus_savings": self.bonus_savings,
        }


@dataclass(slots=True, frozen=True)
class NextOrderData:
    order_id: int = 0
    status: str = ""
    shopping_type: str = ""
    transaction_completed: bool = False
    reopenable: bool = False
    modifiable: bool = False
    is_after_cut_off: bool = False
    closing_date_time: str = ""
    delivery_method: str = ""
    delivery_date: str = ""
    delivery_date_display: str = ""
    delivery_time_display: str = ""
    delivery_start_time: str = ""
    delivery_end_time: str = ""
    total_price: float = 0.0
    items: tuple[NextOrderItem, ...] = field(default_factory=tuple)

    @property
    def total_quantity(self) -> int:
        return sum(max(item.quantity, 0) for item in self.items)

    @property
    def unique_items(self) -> int:
        return len(self.items)

    @property
    def bonus_savings(self) -> float:
        return self._pricing()[0]

    def _pricing(self) -> tuple[float, float]:
        lines = tuple(ShoppingItem("", item.product_id, item.quantity, product=Product(
            id=item.product_id, title=item.title, brand=item.brand,
            price_now=item.price_now, price_was=item.price_was,
            is_bonus=item.is_bonus, bonus_mechanism=item.bonus_mechanism,
        )) for item in self.items)
        embedded, additional = _promotion_totals(lines)
        subtotal = sum(_cents(item.line_total) for item in self.items) / 100
        return round(embedded + additional, 2), round(subtotal - additional, 2)

    @property
    def estimated_product_total(self) -> float:
        return self._pricing()[1]

    def as_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order_id,
            "status": self.status,
            "shopping_type": self.shopping_type,
            "transaction_completed": self.transaction_completed,
            "reopenable": self.reopenable,
            "modifiable": self.modifiable,
            "is_after_cut_off": self.is_after_cut_off,
            "closing_date_time": self.closing_date_time,
            "delivery_method": self.delivery_method,
            "delivery_date": self.delivery_date,
            "delivery_date_display": self.delivery_date_display,
            "delivery_time_display": self.delivery_time_display,
            "delivery_start_time": self.delivery_start_time,
            "delivery_end_time": self.delivery_end_time,
            "total_price": round(self.total_price, 2),
            "estimated_product_total": self.estimated_product_total,
            "total_price_difference": round(self.total_price - self.estimated_product_total, 2),
            "bonus_savings": self.bonus_savings,
            "bonus_savings_estimated": True,
            "total_quantity": self.total_quantity,
            "unique_items": self.unique_items,
            "items": [item.as_dict() for item in self.items],
        }


