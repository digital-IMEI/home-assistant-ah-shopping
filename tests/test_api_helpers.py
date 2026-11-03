import asyncio

import pytest

from custom_components.ah_shopping.api import AhShoppingApiClient
from custom_components.ah_shopping.const import (
    SHOPPINGLIST_ITEMS_PATH,
    SHOPPINGLIST_ITEMS_READ_PATH,
)
from custom_components.ah_shopping.exceptions import AhAuthError, AhRequestError


def test_extract_code_plain():
    assert AhShoppingApiClient.extract_authorization_code("abc") == "abc"


def test_extract_code_callback():
    assert AhShoppingApiClient.extract_authorization_code(
        "appie://login-exit?code=hello%201"
    ) == "hello 1"


def test_rejected_authorization_code_is_auth_error():
    class RejectingClient(AhShoppingApiClient):
        async def _raw_request(self, *args, **kwargs):
            raise AhRequestError("rejected", 400)

    client = RejectingClient(None)
    with pytest.raises(AhAuthError):
        asyncio.run(client.exchange_authorization_code("one-time-code"))


def test_connection_validation_matches_delivery_graphql_path():
    class ValidationClient(AhShoppingApiClient):
        query = None

        async def _graphql(self, query, variables=None):
            self.query = query
            return {"orderFulfillments": {"result": []}}

        async def async_get_list_payload(self):
            raise AssertionError("login validation must not call shopping-list API")

    client = ValidationClient(None, access_token="token")
    asyncio.run(client.async_validate_connection())
    assert "orderFulfillments(status: OPEN)" in client.query


def test_shopping_list_reads_current_v2_items_endpoint():
    class ListClient(AhShoppingApiClient):
        request = None

        async def _raw_request(self, method, path, **kwargs):
            self.request = (method, path, kwargs)
            return {"id": "list-1", "items": []}

    client = ListClient(None, access_token="token")
    data = asyncio.run(client.async_get_list_payload())
    assert data["id"] == "list-1"
    assert client.request[0:2] == ("GET", SHOPPINGLIST_ITEMS_READ_PATH)


def test_quantity_update_uses_v2_patch_and_zero_deletes():
    class ListClient(AhShoppingApiClient):
        request = None

        async def _raw_request(self, method, path, **kwargs):
            self.request = (method, path, kwargs)
            return {}

    client = ListClient(None, access_token="token")
    asyncio.run(client.async_set_product_quantity("ignored", 12345, 0))
    method, path, kwargs = client.request
    assert method == "PATCH"
    assert path == SHOPPINGLIST_ITEMS_PATH
    item = kwargs["json_body"]["items"][0]
    assert item["productId"] == 12345
    assert item["quantity"] == 0
    assert item["type"] == "SHOPPABLE"
    assert item["originCode"] == "PRD"


def test_current_list_shape_reads_nested_product_and_text_item():
    class ListClient(AhShoppingApiClient):
        async def async_get_store_route(self):
            return "", {}

        async def async_get_list_payload(self):
            return {
                "id": "my-list",
                "items": [
                    {
                        "listItemId": 41,
                        "quantity": 2,
                        "description": "",
                        "productDetails": {
                            "product": {"webshopId": 482500, "title": "AH Woksaus"}
                        },
                    },
                    {
                        "listItemId": 0,
                        "quantity": 1,
                        "description": "bananen",
                        "position": 9,
                    },
                ],
            }

        async def async_get_products(self, product_ids):
            assert product_ids == [482500]
            return []

        async def async_get_product_detail(self, product_id):
            from custom_components.ah_shopping.models import Product
            assert product_id == 482500
            return Product(id=482500, title="AH Woksaus")

    data = asyncio.run(ListClient(None, access_token="token").async_get_shopping_data())
    assert len(data.items) == 2
    assert data.total_quantity == 3
    assert data.items[0].product_id == 482500
    assert data.items[0].title == "AH Woksaus"
    assert data.items[1].product_id == 0
    assert data.items[1].title == "bananen"


def test_missing_bulk_product_uses_detail_price_fallback():
    class ListClient(AhShoppingApiClient):
        async def async_get_store_route(self):
            return "", {}

        async def async_get_list_payload(self):
            return {
                "id": "my-list",
                "items": [
                    {
                        "quantity": 1,
                        "productDetails": {
                            "product": {
                                "webshopId": 575439,
                                "title": "MIMO Cookie dough classic chocolate chip",
                            }
                        },
                    }
                ],
            }

        async def async_get_products(self, product_ids):
            assert product_ids == [575439]
            return []

        async def async_get_product_detail(self, product_id):
            assert product_id == 575439
            from custom_components.ah_shopping.models import Product
            return Product(
                id=575439,
                title="MIMO Cookie dough classic chocolate chip",
                price_now=3.99,
            )

    data = asyncio.run(ListClient(None, access_token="token").async_get_shopping_data())
    assert data.items[0].product.price_now == 3.99
    assert data.items[0].line_total == 3.99


def test_search_products_accepts_data_key():
    class SearchClient(AhShoppingApiClient):
        async def _raw_request(self, method, path, **kwargs):
            assert method == "GET"
            assert "/mobile-services/product/search/v2?" in path
            return {
                "data": [
                    {
                        "id": 42,
                        "description": "Zoekproduct",
                        "price": {"amount": 2.49},
                        "unitSize": "500 g",
                        "imageUrl": "https://example.invalid/product.jpg",
                    }
                ]
            }

    products = asyncio.run(
        SearchClient(None, access_token="token").async_search_products("zoek", 8)
    )
    assert len(products) == 1
    assert products[0].id == 42
    assert products[0].title == "Zoekproduct"
    assert products[0].price_now == 2.49
    assert products[0].unit_size == "500 g"
    assert products[0].image_url.endswith("product.jpg")


def test_quantity_write_preserves_description_and_checked_state():
    class ListClient(AhShoppingApiClient):
        request = None

        async def _raw_request(self, method, path, **kwargs):
            self.request = (method, path, kwargs)
            return {}

    client = ListClient(None, access_token="token")
    asyncio.run(
        client.async_set_product_quantity(
            "ignored",
            12345,
            3,
            description="Productnaam",
            checked=True,
        )
    )
    _, _, kwargs = client.request
    item = kwargs["json_body"]["items"][0]
    assert item["description"] == "Productnaam"
    assert item["quantity"] == 3
    assert item["strikeThrough"] is True
    assert item["productId"] == 12345


def test_free_text_write_has_no_product_id():
    class ListClient(AhShoppingApiClient):
        request = None

        async def _raw_request(self, method, path, **kwargs):
            self.request = (method, path, kwargs)
            return {}

    client = ListClient(None, access_token="token")
    asyncio.run(client.async_add_free_text_item("bananen", 2))
    item = client.request[2]["json_body"]["items"][0]
    assert item["description"] == "bananen"
    assert item["quantity"] == 2
    assert item["strikeThrough"] is False
    assert "productId" not in item


def test_next_order_reads_earliest_fulfillment_products():
    class OrderClient(AhShoppingApiClient):
        async def _graphql(self, query, variables=None):
            return {
                "orderFulfillments": {
                    "result": [
                        {
                            "orderId": 200,
                            "statusDescription": "Open",
                            "modifiable": True,
                            "shoppingType": "DELIVERY",
                            "totalPrice": {"totalPrice": {"amount": 18.75}},
                            "delivery": {
                                "method": "DELIVERY",
                                "slot": {
                                    "date": "2026-10-08",
                                    "dateDisplay": "8 oktober",
                                    "timeDisplay": "18:00 - 20:00",
                                    "startTime": "18:00",
                                    "endTime": "20:00",
                                },
                            },
                        },
                        {
                            "orderId": 100,
                            "statusDescription": "Open",
                            "modifiable": False,
                            "shoppingType": "DELIVERY",
                            "totalPrice": {"totalPrice": {"amount": 12.34}},
                            "delivery": {
                                "method": "DELIVERY",
                                "slot": {
                                    "date": "2026-10-07",
                                    "dateDisplay": "7 oktober",
                                    "timeDisplay": "10:00 - 12:00",
                                    "startTime": "10:00",
                                    "endTime": "12:00",
                                },
                            },
                        },
                    ]
                }
            }

        async def _raw_request(self, method, path, **kwargs):
            assert method == "GET"
            assert path == "/mobile-services/order/v1/100/details-grouped-by-taxonomy"
            return {
                "groupedProductsInTaxonomy": [
                    {
                        "taxonomyName": "Zuivel",
                        "orderedProducts": [
                            {
                                "quantity": 2,
                                "product": {
                                    "webshopId": 42,
                                    "title": "Melk",
                                    "brand": "AH",
                                    "salesUnitSize": "1 l",
                                    "priceBeforeBonus": 1.50,
                                    "currentPrice": 1.25,
                                    "isBonus": True,
                                    "bonusMechanism": "Bonus",
                                },
                            }
                        ],
                    },
                    {
                        "taxonomyName": "Fruit",
                        "orderedProducts": [
                            {
                                "quantity": 3,
                                "product": {
                                    "webshopId": 43,
                                    "title": "Appels",
                                    "priceBeforeBonus": 2.00,
                                    "currentPrice": None,
                                },
                            }
                        ],
                    },
                ]
            }

    order = asyncio.run(
        OrderClient(None, access_token="token").async_get_next_order()
    )
    assert order.order_id == 100
    assert order.delivery_date == "2026-10-07"
    assert order.total_price == 12.34
    assert order.unique_items == 2
    assert order.total_quantity == 5
    assert order.items[0].title == "Melk"
    assert order.items[0].quantity == 2
    assert order.items[0].price_now == 1.25
    assert order.items[1].price_now == 2.00


def test_next_order_without_fulfillment_is_empty():
    class OrderClient(AhShoppingApiClient):
        async def _graphql(self, query, variables=None):
            return {"orderFulfillments": {"result": []}}

    order = asyncio.run(
        OrderClient(None, access_token="token").async_get_next_order()
    )
    assert order.order_id == 0
    assert order.total_quantity == 0
    assert order.items == ()



def test_store_route_positions_are_matched_to_list_items():
    class RouteClient(AhShoppingApiClient):
        paths = []

        async def _graphql(self, query, variables=None):
            assert "storesFavouriteStore" in query
            return {"storesFavouriteStore": {"id": 1501, "name": "Teststad Centrum"}}

        async def _raw_request(self, method, path, **kwargs):
            self.paths.append(path)
            store_sorted = "orderBy=store" in path
            return {"id": "my-list", "items": [
                {"quantity": 1, "sorting": {"position": 2 if store_sorted else 1},
                 "productDetails": {"product": {"webshopId": 7, "title": "Yoghurt"}}},
                {"quantity": 1, "description": "Iets lekkers", "sorting": {"position": 1 if store_sorted else 2}},
            ]}

        async def async_get_products(self, product_ids):
            return []

    client = RouteClient(None)
    data = asyncio.run(client.async_get_shopping_data())
    assert client.paths[0].endswith("orderBy=store&orderByParam=1501")
    assert client.paths[1] == SHOPPINGLIST_ITEMS_READ_PATH
    assert data.store_name == "Teststad Centrum"
    assert {i.title: i.store_position for i in data.items} == {"Yoghurt": 2, "Iets lekkers": 1}
    assert data.as_dict()["items"][0]["store_position"] == 2
    asyncio.run(client.async_get_shopping_data())
    assert sum("orderBy=store" in path for path in client.paths) == 2


def test_list_still_loads_when_store_route_fails():
    class NoStoreClient(AhShoppingApiClient):
        async def async_get_store_route(self):
            raise AhRequestError("no store")

        async def async_get_list_payload(self):
            return {"id": "my-list", "items": [{"quantity": 1, "description": "Brood"}]}

        async def async_get_products(self, product_ids):
            return []

    data = asyncio.run(NoStoreClient(None).async_get_shopping_data())
    assert [i.store_position for i in data.items] == [0]
    assert data.store_name == ""
