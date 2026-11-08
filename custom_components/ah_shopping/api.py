"""Async client for the unofficial Albert Heijn mobile API."""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
import json
import logging
import time
from typing import Any
from urllib.parse import parse_qs, quote, urlencode, urlparse

from aiohttp import ClientError, ClientResponse, ClientSession

from .const import (
    ORDER_DISCOUNT_QUERY,
    ORDER_TRACK_TRACE_QUERY,
    ORDER_VALUE_LIMITS_QUERY,
    API_BASE_URL, APPLICATION, BASE_FULFILLMENTS_QUERY, CLIENT_ID,
    CLIENT_VERSION, LOGIN_BASE_URL, NEXT_ORDER_FULFILLMENTS_QUERY,
    SHOPPINGLIST_ITEMS_PATH, SHOPPINGLIST_ITEMS_READ_PATH,
    TOKEN_REFRESH_MARGIN, USER_AGENT,
)
from .exceptions import AhAuthError, AhNotFoundError, AhRequestError, AhTransientError
from .models import AH_TIMEZONE, NextOrderData, NextOrderItem, Product, ShoppingItem, ShoppingListData, _float, _int

_LOGGER = logging.getLogger(__name__)

TOTAL_PRICE_QUERY = (
    "query FetchTotalPrice($products: [PriceLineItem!]!) { totalPrice(products: $products) "
    "{ withoutDiscount { amount } discount { amount } } }"
)

FAVOURITE_STORE_QUERY = "query { storesFavouriteStore { id name } }"
_STORE_CACHE_SECONDS = 6 * 3600

TokenUpdateCallback = Callable[[dict[str, Any]], Awaitable[None]]


class AhShoppingApiClient:
    """Minimal authenticated AH shopping client."""

    def __init__(
        self,
        session: ClientSession,
        *,
        access_token: str = "",
        refresh_token: str = "",
        expires_at: float = 0,
        member_id: str = "",
        token_update_callback: TokenUpdateCallback | None = None,
        base_url: str = API_BASE_URL,
    ) -> None:
        self._session = session
        self._favourite_store: tuple[int, str, float] | None = None
        self._access_token = access_token
        self._refresh_token = refresh_token
        self._expires_at = expires_at
        self._member_id = member_id
        self._token_update_callback = token_update_callback
        self._base_url = base_url.rstrip("/")
        self._refresh_lock = asyncio.Lock()

    @staticmethod
    def login_url() -> str:
        return (
            f"{LOGIN_BASE_URL}/login?client_id={CLIENT_ID}"
            "&response_type=code&redirect_uri=appie%3A%2F%2Flogin-exit"
        )

    @staticmethod
    def extract_authorization_code(value: str) -> str:
        raw = value.strip()
        if not raw:
            raise ValueError("Authorization code is empty")
        if "code=" not in raw:
            return raw
        parsed = urlparse(raw)
        code = parse_qs(parsed.query).get("code", [""])[0]
        if not code:
            raise ValueError("No authorization code found in URL")
        return code

    def token_data(self) -> dict[str, Any]:
        return {
            "access_token": self._access_token,
            "refresh_token": self._refresh_token,
            "expires_at": self._expires_at,
            "member_id": self._member_id,
        }

    def _headers(self, authenticated: bool = True) -> dict[str, str]:
        headers = {
            "User-Agent": USER_AGENT,
            "x-client-name": CLIENT_ID,
            "x-client-version": CLIENT_VERSION,
            "x-application": APPLICATION,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }
        if authenticated and self._access_token:
            headers["Authorization"] = f"Bearer {self._access_token}"
        return headers

    def _token_is_fresh(self) -> bool:
        if not self._access_token:
            return False
        if not self._expires_at:
            return True
        return (
            datetime.now(timezone.utc).timestamp()
            + TOKEN_REFRESH_MARGIN.total_seconds()
            < self._expires_at
        )

    async def _accept_token_payload(self, payload: dict[str, Any]) -> None:
        access = payload.get("access_token") or payload.get("accessToken")
        refresh = payload.get("refresh_token") or payload.get("refreshToken")
        if not access or not refresh:
            raise AhAuthError("AH token response did not contain usable tokens")
        expires = payload.get("expires_in") or payload.get("expiresIn") or 0
        try:
            seconds = max(0, int(expires))
        except (TypeError, ValueError):
            seconds = 0
        self._access_token = str(access)
        self._refresh_token = str(refresh)
        self._expires_at = datetime.now(timezone.utc).timestamp() + seconds if seconds else 0
        member = payload.get("member_id") or payload.get("memberId")
        if member:
            self._member_id = str(member)
        if self._token_update_callback:
            await self._token_update_callback(self.token_data())

    async def exchange_authorization_code(self, value: str) -> dict[str, Any]:
        code = self.extract_authorization_code(value)
        try:
            payload = await self._raw_request(
                "POST", "/mobile-auth/v1/auth/token",
                json_body={"clientId": CLIENT_ID, "code": code},
                authenticated=False,
            )
        except AhRequestError as err:
            raise AhAuthError(
                f"Albert Heijn rejected the authorization code: {err}"
            ) from err
        if not isinstance(payload, dict):
            raise AhAuthError("Unexpected token response")
        await self._accept_token_payload(payload)
        return self.token_data()

    async def async_refresh_access_token(self) -> None:
        if not self._refresh_token:
            raise AhAuthError("No refresh token is available")
        async with self._refresh_lock:
            if self._token_is_fresh():
                return
            try:
                payload = await self._raw_request(
                    "POST", "/mobile-auth/v1/auth/token/refresh",
                    json_body={"clientId": CLIENT_ID, "refreshToken": self._refresh_token},
                    authenticated=False,
                    allow_refresh=False,
                )
            except AhRequestError as err:
                raise AhAuthError(
                    f"Albert Heijn rejected the refresh token: {err}"
                ) from err
            if not isinstance(payload, dict):
                raise AhAuthError("Unexpected refresh response")
            await self._accept_token_payload(payload)

    async def _ensure_token(self) -> None:
        if self._token_is_fresh():
            return
        await self.async_refresh_access_token()

    async def _raw_request(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        authenticated: bool = True,
        allow_refresh: bool = True,
    ) -> Any:
        if authenticated:
            await self._ensure_token()
        try:
            response = await self._session.request(
                method,
                f"{self._base_url}{path}",
                headers=self._headers(authenticated),
                json=json_body,
                timeout=20,
            )
        except (ClientError, TimeoutError, asyncio.TimeoutError) as err:
            raise AhTransientError(f"Could not reach Albert Heijn: {err}") from err
        if response.status == 401 and authenticated and allow_refresh and self._refresh_token:
            response.release()
            self._expires_at = 1
            await self.async_refresh_access_token()
            return await self._raw_request(
                method, path, json_body=json_body, authenticated=True, allow_refresh=False
            )
        return await self._decode_response(response)

    async def _decode_response(self, response: ClientResponse) -> Any:
        try:
            text = await response.text()
        finally:
            response.release()
        if response.status in (401, 403):
            raise AhAuthError(f"Albert Heijn rejected authentication (HTTP {response.status})")
        if response.status == 404:
            raise AhNotFoundError("Albert Heijn resource not found")
        if response.status == 429 or response.status >= 500:
            raise AhTransientError(f"Albert Heijn temporarily unavailable (HTTP {response.status})")
        if response.status >= 400:
            raise AhRequestError(f"Albert Heijn rejected the request (HTTP {response.status})", response.status)
        if not text:
            return {}
        try:
            return json.loads(text)
        except json.JSONDecodeError as err:
            raise AhTransientError("Albert Heijn returned invalid JSON") from err

    async def _graphql(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = await self._raw_request(
            "POST", "/graphql", json_body={"query": query, "variables": variables or {}}
        )
        if not isinstance(payload, dict):
            raise AhTransientError("Unexpected GraphQL response")
        if payload.get("errors"):
            message = "; ".join(
                str(e.get("message", e)) if isinstance(e, dict) else str(e)
                for e in payload["errors"]
            )
            raise AhRequestError(message)
        data = payload.get("data")
        if not isinstance(data, dict):
            raise AhTransientError("GraphQL response has no data object")
        return data

    async def async_validate_connection(self) -> None:
        # Deliberately identical to Albert Heijn Delivery's login validation.
        await self._graphql(BASE_FULFILLMENTS_QUERY)

    async def async_get_next_order(self) -> NextOrderData:
        """Return the earliest open scheduled AH order and its product lines."""
        data = await self._graphql(NEXT_ORDER_FULFILLMENTS_QUERY)
        fulfillments = (data.get("orderFulfillments") or {}).get("result") or []
        if not isinstance(fulfillments, list):
            return NextOrderData()

        candidates = [
            item for item in fulfillments
            if isinstance(item, dict) and int(item.get("orderId") or 0) > 0
        ]
        if not candidates:
            return NextOrderData()

        def order_key(item: dict[str, Any]) -> tuple[str, str, int]:
            slot = ((item.get("delivery") or {}).get("slot") or {})
            return (
                str(slot.get("date") or "9999-12-31"),
                str(slot.get("startTime") or "99:99"),
                int(item.get("orderId") or 0),
            )

        fulfillment = min(candidates, key=order_key)
        order_id = int(fulfillment.get("orderId") or 0)
        detail = await self._raw_request(
            "GET", f"/mobile-services/order/v1/{order_id}/details-grouped-by-taxonomy"
        )
        if not isinstance(detail, dict):
            raise AhTransientError("Unexpected AH order details response")

        def money(value: Any) -> float:
            while isinstance(value, dict):
                value = value.get("amount")
            try:
                return float(value) if value is not None else 0.0
            except (TypeError, ValueError):
                return 0.0

        items: list[NextOrderItem] = []
        groups = detail.get("groupedProductsInTaxonomy") or []
        if isinstance(groups, list):
            for group in groups:
                if not isinstance(group, dict):
                    continue
                taxonomy = str(group.get("taxonomyName") or "")
                ordered = group.get("orderedProducts") or []
                if not isinstance(ordered, list):
                    continue
                for raw in ordered:
                    if not isinstance(raw, dict):
                        continue
                    product = raw.get("product") or {}
                    if not isinstance(product, dict):
                        continue

                    before = money(product.get("priceBeforeBonus"))
                    current = money(product.get("currentPrice"))
                    if current <= 0:
                        current = before
                    quantity = max(0, int(raw.get("quantity") or raw.get("amount") or 0))
                    parsed_product = Product.from_api(product)
                    items.append(
                        NextOrderItem(
                            product_id=int(product.get("webshopId") or product.get("id") or 0),
                            title=str(product.get("title") or product.get("description") or ""),
                            quantity=quantity,
                            brand=str(product.get("brand") or ""),
                            unit_size=str(product.get("salesUnitSize") or ""),
                            price_now=current,
                            price_was=before,
                            is_bonus=parsed_product.is_bonus,
                            bonus_mechanism=str(product.get("bonusMechanism") or ""),
                            taxonomy=taxonomy,
                            image_url=parsed_product.image_url,
                        )
                    )

        delivery = fulfillment.get("delivery") or {}
        slot = delivery.get("slot") or {}
        total_price = money(
            ((fulfillment.get("totalPrice") or {}).get("totalPrice") or {}).get("amount")
        )
        period = detail.get("deliveryTimePeriod") or {}
        if not isinstance(period, dict):
            period = {}
        extras = await self._async_next_order_extras(order_id, str(slot.get("date") or ""))
        return NextOrderData(
            order_id=order_id,
            status=str(fulfillment.get("statusDescription") or delivery.get("status") or ""),
            shopping_type=str(fulfillment.get("shoppingType") or ""),
            transaction_completed=bool(fulfillment.get("transactionCompleted")),
            reopenable=bool(fulfillment.get("reopenable")),
            modifiable=bool(fulfillment.get("modifiable")),
            is_after_cut_off=bool(fulfillment.get("isAfterCutOff")),
            closing_date_time=str(fulfillment.get("closingDateTime") or ""),
            delivery_method=str(delivery.get("method") or ""),
            delivery_date=str(slot.get("date") or ""),
            delivery_date_display=str(slot.get("dateDisplay") or ""),
            delivery_time_display=str(slot.get("timeDisplay") or ""),
            delivery_start_time=str(slot.get("startTime") or ""),
            delivery_end_time=str(slot.get("endTime") or ""),
            total_price=total_price,
            items=tuple(items),
            order_state=str(detail.get("orderState") or ""),
            order_method=str(detail.get("orderMethod") or ""),
            window_start=str(period.get("startDateTime") or ""),
            window_end=str(period.get("endDateTime") or ""),
            **extras,
        )

    async def _async_next_order_extras(self, order_id: int, delivery_date: str) -> dict[str, Any]:
        """AH's discount, live ETA and order limits; each optional and best effort."""
        extras: dict[str, Any] = {}

        async def optional(name: str, query: str, variables: dict[str, Any] | None = None):
            try:
                return await self._graphql(query, variables)
            except AhAuthError:
                raise
            except (AhNotFoundError, AhRequestError, AhTransientError) as err:
                _LOGGER.debug("AH %s unavailable: %s", name, err)
                return None

        async def skipped():
            return None

        # The live ETA only exists around delivery day (AH's dates are Dutch); skip the call otherwise.
        today = datetime.now(AH_TIMEZONE).date().isoformat()
        track = not delivery_date or delivery_date <= today
        # The three requests are independent, so run them together.
        discount_data, tracking_data, limits_data = await asyncio.gather(
            optional("order discount", ORDER_DISCOUNT_QUERY),
            optional("track and trace", ORDER_TRACK_TRACE_QUERY, {"orderId": order_id}) if track else skipped(),
            optional("order value limits", ORDER_VALUE_LIMITS_QUERY, {"orderId": order_id}),
        )

        for row in ((discount_data or {}).get("orderFulfillments") or {}).get("result") or []:
            if isinstance(row, dict) and _int(row.get("orderId")) == order_id:
                amount = (((row.get("totalPrice") or {}).get("discount") or {}).get("amount"))
                if amount is not None:
                    extras["ah_discount"] = _float(amount)

        if track:
            tracking = ((((tracking_data or {}).get("order") or {}).get("delivery") or {}).get("trackAndTraceV2")) or {}
            if isinstance(tracking, dict):
                eta = ((tracking.get("etaBlock") or {}).get("range")) or {}
                extras["tracking_type"] = str(tracking.get("type") or "")
                extras["tracking_message"] = str(tracking.get("message") or "")
                if isinstance(eta, dict):
                    extras["eta_start"] = str(eta.get("start") or "")
                    extras["eta_end"] = str(eta.get("end") or "")

        limits = (limits_data or {}).get("orderValueLimits")
        if isinstance(limits, dict):
            extras["minimum_order_value"] = _float(limits.get("minimumOrderValue"))
            if limits.get("submittable") is not None:
                extras["submittable"] = bool(limits.get("submittable"))
        return extras

    async def async_get_list_payload(self) -> dict[str, Any]:
        data = await self._raw_request("GET", SHOPPINGLIST_ITEMS_READ_PATH)
        if not isinstance(data, dict):
            raise AhTransientError("Unexpected AH shopping-list response")
        return data

    async def async_get_list_items(self, list_id: str = "") -> list[dict[str, Any]]:
        del list_id
        data = await self.async_get_list_payload()
        items = data.get("items") or []
        return items if isinstance(items, list) else []

    async def async_get_total_price(self, lines: list[tuple[int, int]]) -> tuple[float, float]:
        """Return AH's price before discount and its Bonus discount for these lines.

        AH applies every promotion itself, including offers that combine
        different products of one Bonus segment, so this matches the Appie app.
        """
        data = await self._graphql(
            TOTAL_PRICE_QUERY,
            {"products": [{"id": int(pid), "quantity": int(qty)} for pid, qty in lines]},
        )
        total = data.get("totalPrice")
        if not isinstance(total, dict):
            raise AhTransientError("AH returned no total price")
        return _float(total.get("withoutDiscount")), _float(total.get("discount"))

    async def async_get_products(self, product_ids: list[int]) -> list[Product]:
        if not product_ids:
            return []
        params = [("ids", str(i)) for i in product_ids]
        params.append(("sortOn", "INPUT_PRODUCT_IDS"))
        raw = await self._raw_request(
            "GET", f"/mobile-services/product/search/v2/products?{urlencode(params)}"
        )
        if not isinstance(raw, list):
            return []
        return [Product.from_api(p) for p in raw if isinstance(p, dict)]

    async def async_get_product_detail(self, product_id: int) -> Product:
        raw = await self._raw_request(
            "GET", f"/mobile-services/product/detail/v4/fir/{int(product_id)}"
        )
        if not isinstance(raw, dict):
            raise AhNotFoundError("No AH product details found")
        product = Product.from_api(raw)
        if product.id <= 0:
            raise AhNotFoundError("No AH product details found")
        return product

    async def async_search_products(self, query: str, limit: int = 8) -> list[Product]:
        params = urlencode({"query": query, "page": 0, "size": max(1, min(limit, 20)), "sortOn": "RELEVANCE"})
        raw = await self._raw_request("GET", f"/mobile-services/product/search/v2?{params}")
        if isinstance(raw, list):
            products = raw
        elif isinstance(raw, dict):
            products = raw.get("products") or raw.get("data") or []
        else:
            return []
        if isinstance(products, dict):
            products = products.get("products") or products.get("items") or []
        if not isinstance(products, list):
            return []
        return [Product.from_api(p) for p in products if isinstance(p, dict)]

    async def async_lookup_barcode(self, barcode: str) -> Product:
        code = "".join(ch for ch in barcode if ch.isdigit())
        if len(code) not in (8, 12, 13, 14):
            raise AhRequestError("Barcode must be EAN-8, UPC-A, EAN-13 or GTIN-14")
        try:
            raw = await self._raw_request(
                "GET", f"/mobile-services/product/search/v1/gtin/{quote(code, safe='')}"
            )
        except AhNotFoundError as err:
            raise AhNotFoundError(
                f"Barcode {code} was read correctly, but no product was found at Albert Heijn"
            ) from err
        if not isinstance(raw, dict):
            raise AhNotFoundError(
                f"Barcode {code} was read correctly, but no product was found at Albert Heijn"
            )
        product = Product.from_api(raw)
        if product.id <= 0:
            raise AhNotFoundError(
                f"Barcode {code} was read correctly, but no product was found at Albert Heijn"
            )
        return product

    async def async_write_list_item(
        self,
        *,
        description: str,
        quantity: int,
        checked: bool,
        product_id: int = 0,
    ) -> None:
        item: dict[str, Any] = {
            "description": description,
            "quantity": max(0, int(quantity)),
            "type": "SHOPPABLE",
            "originCode": "PRD",
            "strikeThrough": bool(checked),
        }
        if product_id > 0:
            item["productId"] = int(product_id)
        await self._raw_request(
            "PATCH", SHOPPINGLIST_ITEMS_PATH, json_body={"items": [item]}
        )

    async def async_set_product_quantity(
        self,
        list_id: str,
        product_id: int,
        quantity: int,
        *,
        description: str = "",
        checked: bool = False,
    ) -> None:
        del list_id
        await self.async_write_list_item(
            description=description,
            quantity=quantity,
            checked=checked,
            product_id=product_id,
        )

    async def async_set_item_checked(self, item: ShoppingItem, checked: bool) -> None:
        await self.async_write_list_item(
            description=item.description,
            quantity=item.quantity,
            checked=checked,
            product_id=item.product_id,
        )

    async def async_add_free_text_item(self, description: str, quantity: int = 1) -> None:
        await self.async_write_list_item(
            description=description.strip(),
            quantity=quantity,
            checked=False,
        )

    async def async_delete_list_item(self, item: ShoppingItem) -> None:
        await self.async_write_list_item(
            description=item.description,
            quantity=0,
            checked=item.checked,
            product_id=item.product_id,
        )

    async def async_get_favourite_store(self) -> tuple[int, str]:
        """Return the favourite store chosen in the Appie app (id 0 when none)."""
        cached = self._favourite_store
        if cached and time.monotonic() - cached[2] < _STORE_CACHE_SECONDS:
            return cached[0], cached[1]
        data = await self._graphql(FAVOURITE_STORE_QUERY)
        store = data.get("storesFavouriteStore")
        store_id = int(store.get("id") or 0) if isinstance(store, dict) else 0
        name = str(store.get("name") or "") if isinstance(store, dict) else ""
        self._favourite_store = (store_id, name, time.monotonic())
        return store_id, name

    async def async_get_store_route(self) -> tuple[str, dict[str, int]]:
        """Return the favourite store's name and each list item's route position.

        AH sorts Mijn lijst along the store's walking route with orderBy=store.
        Call this before the regular read so that read keeps the list sorted by
        entry, as before.
        """
        store_id, name = await self.async_get_favourite_store()
        if store_id <= 0:
            return "", {}
        data = await self._raw_request(
            "GET", f"{SHOPPINGLIST_ITEMS_PATH}?{urlencode({'orderBy': 'store', 'orderByParam': store_id})}"
        )
        raw_items = data.get("items") if isinstance(data, dict) else None
        positions: dict[str, int] = {}
        for index, raw in enumerate(raw_items if isinstance(raw_items, list) else [], start=1):
            if not isinstance(raw, dict):
                continue
            sorting = raw.get("sorting")
            position = int(sorting.get("position") or index) if isinstance(sorting, dict) else index
            positions.setdefault(_route_key(raw), position)
        return name, positions

    async def async_get_shopping_data(self) -> ShoppingListData:
        store_name, route = "", {}
        try:
            store_name, route = await self.async_get_store_route()
        except AhAuthError:
            raise
        except (AhNotFoundError, AhRequestError, AhTransientError) as err:
            _LOGGER.debug("AH store route unavailable: %s", err)
        data = await self.async_get_list_payload()
        raw_items = data.get("items") or []
        if not isinstance(raw_items, list):
            raw_items = []

        def product_id_from_item(raw: dict[str, Any]) -> int:
            direct = int(raw.get("productId") or 0)
            if direct > 0:
                return direct
            details = raw.get("productDetails")
            if not isinstance(details, dict):
                return 0
            nested = details.get("product")
            if not isinstance(nested, dict):
                return 0
            return int(nested.get("webshopId") or nested.get("id") or 0)

        def description_from_item(raw: dict[str, Any]) -> str:
            description = str(raw.get("description") or "").strip()
            if description:
                return description
            details = raw.get("productDetails")
            if isinstance(details, dict):
                nested = details.get("product")
                if isinstance(nested, dict):
                    return str(nested.get("title") or "").strip()
            return ""

        product_ids = [
            product_id_from_item(item)
            for item in raw_items
            if isinstance(item, dict) and product_id_from_item(item) > 0
        ]
        products = {
            product.id: product
            for product in await self.async_get_products(
                list(dict.fromkeys(product_ids))
            )
        }

        def product_from_list_item(
            raw: dict[str, Any], product_id: int
        ) -> Product | None:
            details = raw.get("productDetails")
            if not isinstance(details, dict):
                return None
            nested = details.get("product")
            if not isinstance(nested, dict):
                return None
            fallback = Product.from_api(nested)
            return fallback if fallback.id == product_id and fallback.id > 0 else None

        parsed_items: list[ShoppingItem] = []
        for position, raw in enumerate(raw_items):
            if not isinstance(raw, dict):
                continue
            product_id = product_id_from_item(raw)
            description = description_from_item(raw)
            quantity = max(1, int(raw.get("quantity") or 1))
            raw_id = raw.get("listItemId")
            if raw_id not in (None, 0, "0"):
                item_id = str(raw_id)
            elif product_id > 0:
                item_id = f"product-{product_id}"
            else:
                item_id = f"text-{raw.get('position', position)}-{description}"

            product = products.get(product_id)
            if product_id > 0 and (product is None or product.price_now <= 0):
                # Products that are no longer orderable can be omitted from the
                # bulk endpoint. First use the data embedded in the user's list.
                list_product = product_from_list_item(raw, product_id)
                if list_product is not None and list_product.price_now > 0:
                    product = list_product
                else:
                    # As a final fallback, ask the product-detail endpoint. This
                    # keeps discontinued/unorderable list items from becoming €0.
                    try:
                        detail_product = await self.async_get_product_detail(product_id)
                    except (AhNotFoundError, AhRequestError, AhTransientError):
                        detail_product = None
                    if detail_product is not None and detail_product.price_now > 0:
                        product = detail_product
                    elif product is None:
                        product = list_product

            parsed_items.append(
                ShoppingItem(
                    item_id=item_id,
                    product_id=product_id,
                    quantity=quantity,
                    description=description,
                    checked=bool(raw.get("strikedthrough") or raw.get("strikeThrough")),
                    product=product,
                    store_position=route.get(_route_key(raw), 0),
                )
            )

        items = tuple(parsed_items)

        result = ShoppingListData(
            list_id=str(data.get("id") or "my-list"),
            name="Winkelmandje",
            items=items,
            store_name=store_name,
        )
        signature = result.price_signature()
        if signature:
            try:
                before, discount = await self.async_get_total_price(list(signature))
            except AhAuthError:
                raise
            except (AhNotFoundError, AhRequestError, AhTransientError) as err:
                # Keep the local estimate when AH cannot price the list.
                _LOGGER.debug("AH total price unavailable: %s", err)
            else:
                if before > 0:
                    result = result.priced(before, discount)
        return result


def _route_key(raw: dict[str, Any]) -> str:
    """Match an item between the store-sorted and the entry-sorted list."""
    details = raw.get("productDetails")
    product = details.get("product") if isinstance(details, dict) else None
    product_id = int(raw.get("productId") or 0)
    if not product_id and isinstance(product, dict):
        product_id = int(product.get("webshopId") or product.get("id") or 0)
    if product_id > 0:
        return f"p:{product_id}"
    return f"t:{str(raw.get('description') or '').strip().casefold()}"
