from custom_components.ah_shopping.models import Product, ShoppingItem, ShoppingListData


def test_product_parse_and_total():
    p = Product.from_api({
        "webshopId": 123,
        "title": "Melk",
        "currentPrice": 1.49,
        "priceBeforeBonus": 1.79,
        "isBonus": True,
        "bonusMechanism": "25% korting",
        "images": [{"url": "small", "width": 80}, {"url": "large", "width": 400}],
    })
    assert p.id == 123 and p.image_url == "large" and p.is_bonus
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("i1", 123, 2, "Melk", p),),
    )
    assert data.total_quantity == 2
    assert data.estimated_total == 2.98
    assert data.quantity_for_product(123) == 2


def test_missing_price_is_safe():
    p = Product.from_api({"webshopId": 5, "title": "X"})
    assert p.price_now == 0


def test_free_text_item_keeps_description():
    item = ShoppingItem("text-1-bananen", 0, 2, "bananen", None)
    assert item.title == "bananen"
    assert item.is_product is False
    assert item.line_total == 0
    assert item.as_dict()["description"] == "bananen"


def test_nested_money_amount_is_parsed():
    p = Product.from_api({
        "webshopId": 110,
        "title": "Testproduct",
        "currentPrice": {"amount": 1.10},
        "priceBeforeBonus": {"amount": {"amount": 1.39}},
    })
    assert p.price_now == 1.10
    assert p.price_was == 1.39


def test_nested_money_amount_contributes_to_list_total():
    p = Product.from_api({
        "webshopId": 110,
        "title": "Testproduct",
        "currentPrice": {"amount": 1.10},
    })
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("i1", 110, 1, "Testproduct", p),),
    )
    assert data.estimated_total == 1.10


def test_second_half_price_bonus_four_items():
    p = Product(
        id=602290,
        title="AH Zaanlander Belegen 48+ plakken",
        price_now=2.89,
        price_was=2.89,
        is_bonus=True,
        bonus_mechanism="2e HALVE PRIJS",
    )
    item = ShoppingItem("x", p.id, 4, p.title, p)
    assert item.line_total == 11.56
    assert item.bonus_savings == 2.90
    assert item.line_total_after_bonus == 8.66


def test_user_example_total_matches_ah_app():
    mimo = Product(id=575439, title="MIMO Cookie dough", price_now=3.99)
    cheese = Product(
        id=602290,
        title="AH Zaanlander",
        price_now=2.89,
        price_was=2.89,
        is_bonus=True,
        bonus_mechanism="2e HALVE PRIJS",
    )
    other = Product(id=999999, title="Other items", price_now=16.47)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (
            ShoppingItem("mimo", mimo.id, 1, mimo.title, mimo),
            ShoppingItem("cheese", cheese.id, 4, cheese.title, cheese),
            ShoppingItem("other", other.id, 1, other.title, other),
        ),
    )
    assert data.subtotal == 32.02
    assert data.bonus_savings == 2.90
    assert data.estimated_total == 29.12


def test_optimistic_quantity_update():
    p = Product(id=10, title="Melk", price_now=2.0)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("x", 10, 1, "Melk", p),),
    )
    changed = data.with_product_quantity(10, 4)
    assert data.items[0].quantity == 1
    assert changed.items[0].quantity == 4
    assert changed.estimated_total == 8.0


def test_optimistic_quantity_zero_removes_product():
    p = Product(id=10, title="Melk", price_now=2.0)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("x", 10, 1, "Melk", p),),
    )
    changed = data.with_product_quantity(10, 0)
    assert changed.items == ()
    assert changed.total_quantity == 0


def test_optimistic_insert_scanned_product():
    p = Product(id=123, title="Scanproduct", price_now=2.49)
    data = ShoppingListData("abc", "Boodschappen", ())
    changed = data.with_product(p, 1)
    assert len(changed.items) == 1
    assert changed.items[0].product_id == 123
    assert changed.items[0].quantity == 1
    assert changed.items[0].product == p
    assert changed.estimated_total == 2.49


def test_optimistic_scanned_product_updates_existing_item():
    old = Product(id=123, title="Oud", price_now=2.00)
    new = Product(id=123, title="Nieuw", price_now=2.49)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("product-123", 123, 1, "Oud", old),),
    )
    changed = data.with_product(new, 3)
    assert len(changed.items) == 1
    assert changed.items[0].quantity == 3
    assert changed.items[0].title == "Nieuw"
    assert changed.estimated_total == 7.47


def test_checked_item_serializes():
    p = Product(id=1, title="Kaas", price_now=2.5)
    item = ShoppingItem("x", 1, 1, "Kaas", p, True)
    assert item.as_dict()["checked"] is True


def test_checked_state_update_keeps_quantity_and_product():
    p = Product(id=1, title="Kaas", price_now=2.5)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (ShoppingItem("x", 1, 3, "Kaas", p, False),),
    )
    changed = data.with_item_checked(1, "Kaas", True)
    assert changed.items[0].checked is True
    assert changed.items[0].quantity == 3
    assert changed.items[0].product == p


def test_next_order_totals():
    from custom_components.ah_shopping.models import NextOrderData, NextOrderItem

    order = NextOrderData(
        order_id=1,
        items=(
            NextOrderItem(10, "A", 2, price_now=1.50),
            NextOrderItem(11, "B", 3, price_now=2.00),
        ),
    )
    assert order.unique_items == 2
    assert order.total_quantity == 5
    assert order.as_dict()["items"][0]["line_total"] == 3.00


def test_next_order_cutoff_metadata_serializes():
    from custom_components.ah_shopping.models import NextOrderData

    order = NextOrderData(
        order_id=42,
        transaction_completed=False,
        reopenable=False,
        modifiable=False,
        is_after_cut_off=True,
        closing_date_time="2026-10-06T09:00:00+02:00",
    )
    payload = order.as_dict()
    assert payload["order_id"] == 42
    assert payload["reopenable"] is False
    assert payload["modifiable"] is False
    assert payload["is_after_cut_off"] is True
    assert payload["closing_date_time"] == "2026-10-06T09:00:00+02:00"



def test_order_bonus_estimate_does_not_reduce_ah_total():
    from custom_components.ah_shopping.models import NextOrderItem, NextOrderData
    pair = NextOrderItem(1, "Pair", 4, price_now=2.89, is_bonus=True, bonus_mechanism="2e HALVE PRIJS")
    reduced = NextOrderItem(2, "Reduced", 3, price_now=2, price_was=3, is_bonus=True)
    order = NextOrderData(total_price=14.67, items=(pair, reduced))
    assert pair.bonus_savings == 2.90
    assert reduced.bonus_savings == 3
    assert order.as_dict()["bonus_savings"] == 5.90
    assert order.as_dict()["total_price"] == 14.67
    assert order.as_dict()["bonus_savings_estimated"] is True


def test_order_exact_user_bonus_example():
    from custom_components.ah_shopping.models import NextOrderItem, NextOrderData
    order = NextOrderData(total_price=60.03, items=(
        NextOrderItem(1, "Cheese", 4, price_now=2.89, price_was=2.89, is_bonus=True, bonus_mechanism="2e HALVE PRIJS"),
        NextOrderItem(2, "Kwark", 2, price_now=1.99, price_was=1.99, is_bonus=True, bonus_mechanism="1 + 1 gratis"),
        NextOrderItem(3, "Dr. Oetker Big Americans pizza Texas", 2, brand="Dr. Oetker", price_now=4.99, price_was=4.99, is_bonus=True, bonus_mechanism="2 voor 5.99"),
        NextOrderItem(4, "Dr. Oetker Big americans pizza Supreme", 1, brand="Dr. Oetker", price_now=4.99, price_was=4.99, is_bonus=True, bonus_mechanism="2 voor 5.99"),
        NextOrderItem(5, "Dr. Oetker Big Americans pizza BBQ pulled pork", 1, brand="Dr. Oetker", price_now=4.99, price_was=4.99, is_bonus=True, bonus_mechanism="2 voor 5.99"),
        NextOrderItem(6, "Slimpie", 6, price_now=1.99, price_was=3.49, is_bonus=True),
        NextOrderItem(7, "Other non-bonus products", 1, price_now=25.21),
    ))
    assert order.bonus_savings == 21.87
    assert order.estimated_product_total == 59.78
    assert order.as_dict()["total_price_difference"] == 0.25
    assert order.total_price == 60.03


def test_unrelated_products_with_same_deal_are_not_grouped():
    products = [Product(id=i, title="Different product", brand="AH", price_now=4.99, price_was=4.99, is_bonus=True, bonus_mechanism="2 voor 5.99") for i in [1, 2]]
    data = ShoppingListData("abc", "List", tuple(ShoppingItem("", p.id, 1, product=p) for p in products))
    assert data.bonus_savings == 0
    assert data.estimated_total == 9.98


def test_embedded_discount_is_reported_without_double_subtraction():
    product = Product(1, "Slimpie", price_now=1.99, price_was=3.49, is_bonus=True, bonus_mechanism="VOOR 1.99")
    data = ShoppingListData("x", "List", (ShoppingItem("", 1, 2, product=product),))
    assert data.bonus_savings == 3.00
    assert data.estimated_total == 3.98


def _bonus_item(mechanism, quantity, price=3.19):
    product = Product.from_api({
        "webshopId": 900,
        "title": "Testproduct",
        "currentPrice": price,
        "priceBeforeBonus": price,
        "isBonus": True,
        "bonusMechanism": mechanism,
    })
    return ShoppingItem("i1", 900, quantity, "Testproduct", product)


def test_n_plus_m_free_promotions():
    assert _bonus_item("1 + 1 gratis", 2).bonus_savings == 3.19
    assert _bonus_item("1+1 GRATIS", 3).bonus_savings == 3.19
    assert _bonus_item("2 + 1 gratis", 2).bonus_savings == 0
    assert _bonus_item("2 + 1 gratis", 3).bonus_savings == 3.19
    assert _bonus_item("2 + 1 gratis", 7).bonus_savings == 6.38
    assert _bonus_item("2e gratis", 2).bonus_savings == 3.19
