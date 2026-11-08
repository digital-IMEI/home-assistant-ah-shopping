"""Replay a delivery day through the API parsing, with synthetic AH responses.

The shapes follow AH's real responses on a delivery day: the order is packed
after its cut-off, goes out for delivery, the track & trace message counts down
the stops before ours while the window narrows, and the order disappears from
the open fulfillments once delivered. Times from track & trace are UTC.
"""
import asyncio

from custom_components.ah_shopping.api import AhShoppingApiClient

# A fixed past winter day: track & trace is queried (not a future order) and UTC+1 applies.
TODAY = "2026-11-08"

# Synthetic order: ids, amounts and texts are made up; the structure is AH's.
PHASES = [
    # (state, track & trace type, ETA start/end UTC, message, AH total, AH discount)
    ("PLANNED_FOR_DELIVERY", "PLANNED", ("15:55", "16:55"),
     "Onze bezorger verwacht vandaag tussen 16:55 en 17:55 uur bij je te zijn.", 104.83, 22.36),
    ("OUT_FOR_DELIVERY", "UNDERWAY", ("15:55", "16:55"),
     "Onze bezorger verwacht tussen 16:55 en 17:55 uur bij je te zijn.", 120.58, 22.36),
    ("OUT_FOR_DELIVERY", "UNDERWAY", ("15:55", "16:55"),
     "Er zijn nog 5 klanten voor je. Onze bezorger verwacht tussen 16:55 en 17:55 uur bij je te zijn.", 120.58, 22.36),
    ("OUT_FOR_DELIVERY", "UNDERWAY", ("15:40", "16:10"),
     "Er zijn nog 3 klanten voor je. Onze bezorger verwacht tussen 16:40 en 17:10 uur bij je te zijn.", 120.58, 22.36),
    ("OUT_FOR_DELIVERY", "UNDERWAY", ("15:40", "16:10"),
     "Er is nog 1 klant voor je. Onze bezorger verwacht tussen 16:40 en 17:10 uur bij je te zijn.", 120.58, 22.36),
    ("OUT_FOR_DELIVERY", "UNDERWAY", ("15:40", "16:10"),
     "Je bent de eerstvolgende. Onze bezorger verwacht tussen 16:40 en 17:10 uur bij je te zijn.", 120.58, 22.36),
    None,  # delivered: no open fulfillment any more
]


class TimelineClient(AhShoppingApiClient):
    phase = None

    async def _graphql(self, query, variables=None):
        if self.phase is None:
            return {"orderFulfillments": {"result": []}}
        state, kind, (eta_start, eta_end), message, total, discount = self.phase
        if "OrderDiscounts" in query:
            return {"orderFulfillments": {"result": [{"orderId": 5001, "totalPrice": {"discount": {"amount": discount}}}]}}
        if "FetchOrderTrackTrace" in query:
            return {"order": {"delivery": {"trackAndTraceV2": {
                "type": kind, "message": message,
                "etaBlock": {"range": {"start": f"{TODAY}T{eta_start}:00Z", "end": f"{TODAY}T{eta_end}:00Z"}}}}}}
        if "OrderValueLimits" in query:
            return {"orderValueLimits": {"minimumOrderValue": {"amount": 45}, "submittable": True}}
        return {"orderFulfillments": {"result": [{
            "orderId": 5001, "statusDescription": "Order verzonden naar Logistieke partner",
            "isAfterCutOff": True, "totalPrice": {"totalPrice": {"amount": total}},
            "delivery": {"method": "DELIVERY", "slot": {"date": TODAY, "timeDisplay": "16:00 - 18:00", "startTime": "16:00", "endTime": "18:00"}},
        }]}}

    async def _raw_request(self, method, path, **kwargs):
        state = self.phase[0]
        return {
            "orderState": state, "orderMethod": "APPIE_WEB_OLD",
            "deliveryTimePeriod": {"startDateTime": f"{TODAY}T16:00:00", "endDateTime": f"{TODAY}T18:00:00"},
            "groupedProductsInTaxonomy": [{"taxonomyName": "Zuivel", "orderedProducts": [
                {"quantity": 2, "product": {"webshopId": 11, "title": "Halfvolle melk", "priceBeforeBonus": 1.29, "currentPrice": 1.29}}]}],
        }


def test_delivery_day_timeline():
    client = TimelineClient(None, access_token="token")
    seen = []
    for phase in PHASES:
        client.phase = phase
        data = asyncio.run(client.async_get_next_order()).as_dict()
        seen.append((data["order_id"], data.get("order_state"), data.get("expected_time_display"),
                     data.get("customers_ahead"), data["total_price"], data["bonus_savings"], data["price_source"]))
    assert seen == [
        (5001, "PLANNED_FOR_DELIVERY", "16:55 - 17:55", None, 104.83, 22.36, "ah"),
        (5001, "OUT_FOR_DELIVERY", "16:55 - 17:55", None, 120.58, 22.36, "ah"),
        (5001, "OUT_FOR_DELIVERY", "16:55 - 17:55", 5, 120.58, 22.36, "ah"),
        (5001, "OUT_FOR_DELIVERY", "16:40 - 17:10", 3, 120.58, 22.36, "ah"),
        (5001, "OUT_FOR_DELIVERY", "16:40 - 17:10", 1, 120.58, 22.36, "ah"),
        (5001, "OUT_FOR_DELIVERY", "16:40 - 17:10", 0, 120.58, 22.36, "ah"),
        (0, "", "", None, 0.0, 0.0, "estimate"),
    ]


def test_timeline_keeps_booked_slot_separate_from_expected_window():
    client = TimelineClient(None, access_token="token")
    client.phase = PHASES[3]
    data = asyncio.run(client.async_get_next_order()).as_dict()
    assert data["delivery_time_display"] == "16:00 - 18:00"
    assert (data["expected_start_time"], data["expected_end_time"]) == ("16:40", "17:10")
    assert (data["minimum_order_value"], data["remaining_to_minimum"], data["submittable"]) == (45.0, 0.0, True)
