import asyncio
from datetime import date

from custom_components.ah_shopping.api import AhShoppingApiClient
from custom_components.ah_shopping.exceptions import AhAuthError, AhRequestError
from custom_components.ah_shopping.models import NextOrderData, NextOrderItem

TODAY = date.today().isoformat()


def _client(answers, delivery_date=TODAY, period=None):
    """A client whose GraphQL answers come from `answers` by query name."""
    class OrderClient(AhShoppingApiClient):
        queries = []

        async def _graphql(self, query, variables=None):
            name = next(n for n in ("OrderDiscounts", "FetchOrderTrackTrace", "OrderValueLimits", "OrderFulfillments") if n in query)
            self.queries.append((name, variables))
            answer = answers.get(name)
            if isinstance(answer, Exception):
                raise answer
            if name == "OrderFulfillments":
                return {"orderFulfillments": {"result": [{
                    "orderId": 300, "statusDescription": "Onderweg", "totalPrice": {"totalPrice": {"amount": 104.83}},
                    "delivery": {"method": "DELIVERY", "slot": {"date": delivery_date, "timeDisplay": "16:00 - 18:00", "startTime": "16:00", "endTime": "18:00"}},
                }]}}
            return answer or {}

        async def _raw_request(self, method, path, **kwargs):
            return {
                "orderState": "SUBMITTED_WITH_SIMACAN_ETA", "orderMethod": "PLANSERVICE",
                "deliveryTimePeriod": period or {"startDateTime": f"{delivery_date}T16:00:00", "endDateTime": f"{delivery_date}T18:00:00"},
                "groupedProductsInTaxonomy": [{"taxonomyName": "Kaas", "orderedProducts": [
                    {"quantity": 2, "product": {"webshopId": 7, "title": "Jonge kaas", "priceBeforeBonus": 3.25, "currentPrice": 3.25, "isBonus": True, "bonusMechanism": "2 voor 5.50"}}]}],
            }

    OrderClient.queries = []
    return OrderClient(None, access_token="token")


EXTRAS = {
    "OrderDiscounts": {"orderFulfillments": {"result": [{"orderId": 999, "totalPrice": {"discount": {"amount": 1.0}}}, {"orderId": 300, "totalPrice": {"discount": {"amount": 21.47}}}]}},
    "FetchOrderTrackTrace": {"order": {"delivery": {"trackAndTraceV2": {"type": "IN_TRANSIT", "message": "Je bezorger is onderweg", "etaBlock": {"range": {"start": f"{TODAY}T15:55:00Z", "end": f"{TODAY}T16:55:00Z"}}}}}},
    "OrderValueLimits": {"orderValueLimits": {"minimumOrderValue": {"amount": 50}, "submittable": True}},
}


def test_next_order_uses_ah_discount_eta_and_limits():
    client = _client(EXTRAS)
    order = asyncio.run(client.async_get_next_order())
    data = order.as_dict()
    assert order.price_source == "ah" and data["bonus_savings"] == 21.47 and data["bonus_savings_estimated"] is False
    assert data["estimated_product_total"] is None and data["total_price"] == 104.83 and data["total_price_difference"] == 0.0
    assert data["expected_time_display"] == "16:55 - 17:55" and data["delivery_time_display"] == "16:00 - 18:00"
    assert (data["tracking_type"], data["order_state"], data["order_method"]) == ("IN_TRANSIT", "SUBMITTED_WITH_SIMACAN_ETA", "PLANSERVICE")
    assert (data["minimum_order_value"], data["remaining_to_minimum"], data["submittable"]) == (50.0, 0.0, True)
    assert ("FetchOrderTrackTrace", {"orderId": 300}) in client.queries


def test_failing_extras_keep_the_order_and_its_estimate():
    failing = {name: AhRequestError("Cannot query field") for name in EXTRAS}
    order = asyncio.run(_client(failing).async_get_next_order())
    data = order.as_dict()
    assert order.order_id == 300 and order.total_quantity == 2
    assert order.price_source == "estimate" and data["bonus_savings_estimated"] is True
    assert data["expected_time_display"] == "" and data["submittable"] is None


def test_auth_errors_in_extras_are_not_swallowed():
    try:
        asyncio.run(_client({"OrderDiscounts": AhAuthError("expired")}).async_get_next_order())
    except AhAuthError:
        return
    raise AssertionError("auth error was swallowed")


def test_track_and_trace_is_skipped_before_delivery_day():
    client = _client(EXTRAS, delivery_date="2999-01-01")
    asyncio.run(client.async_get_next_order())
    assert "FetchOrderTrackTrace" not in [name for name, _ in client.queries]


def test_narrowed_delivery_period_is_the_fallback_eta():
    period = {"startDateTime": f"{TODAY}T17:00:00", "endDateTime": f"{TODAY}T17:30:00"}
    order = asyncio.run(_client({}, period=period).async_get_next_order())
    assert order.as_dict()["expected_time_display"] == "17:00 - 17:30"


def test_unchanged_slot_is_not_shown_as_expected_time():
    order = NextOrderData(order_id=1, delivery_start_time="16:00", delivery_end_time="18:00",
                          window_start="2026-11-08T16:00:00", window_end="2026-11-08T18:00:00",
                          items=(NextOrderItem(1, "Melk", 1, price_now=1.0),))
    assert order.expected_time == ("", "")
    assert order.as_dict()["remaining_to_minimum"] == 0.0


def test_track_and_trace_utc_times_are_shown_in_dutch_time():
    from custom_components.ah_shopping.models import _clock
    assert _clock("2026-11-08T15:55:00Z") == "16:55"      # winter time, UTC+1
    assert _clock("2026-07-08T15:55:00Z") == "17:55"      # summer time, UTC+2
    assert _clock("2026-11-08T16:00:00+01:00") == "16:00"
    assert _clock("2026-11-08T16:00:00") == "16:00"       # order periods are already local
    assert _clock("16:00") == "16:00" and _clock("") == ""
