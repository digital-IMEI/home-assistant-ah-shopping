from datetime import datetime, timedelta, timezone

from custom_components.ah_shopping.models import NextOrderData, NextOrderItem

from test_coordinator_pricing import load_coordinator

NOW = datetime(2026, 11, 22, 20, 15, tzinfo=timezone(timedelta(hours=1)))


def _order(order_id=300, delivery_date="2026-11-22"):
    return NextOrderData(
        order_id=order_id, delivery_date=delivery_date, status="Onderweg", tracking_type="IN_TRANSIT",
        tracking_message="Je bent de eerstvolgende", modifiable=True,
        items=(NextOrderItem(product_id=7, title="Jonge kaas", quantity=2),),
    )


def _coordinator(monkeypatch, previous):
    # The pricing test's loader stubs Home Assistant; its module scope also holds the next-order coordinator.
    scope = load_coordinator(monkeypatch).__init__.__globals__
    coordinator = object.__new__(scope["AhNextOrderCoordinator"])
    coordinator.data = previous
    coordinator._delivered = None
    return coordinator, scope["DELIVERED_ORDER_RETENTION"]


def test_delivered_order_stays_for_two_hours_then_hides(monkeypatch):
    coordinator, retention = _coordinator(monkeypatch, _order())
    shown = coordinator._keep_delivered(NextOrderData(), NOW)
    data = shown.as_dict()
    assert retention == timedelta(hours=2)
    assert shown.order_id == 300 and data["delivered"] is True and data["delivered_at"] == "2026-11-22T20:15:00+01:00"
    assert (data["status"], data["tracking_type"], data["tracking_message"], data["customers_ahead"]) == ("Bezorgd", "DELIVERED", "", None)
    assert data["total_quantity"] == 2 and data["modifiable"] is False

    coordinator.data = shown
    assert coordinator._keep_delivered(NextOrderData(), NOW + timedelta(minutes=119)).order_id == 300
    hidden = coordinator._keep_delivered(NextOrderData(), NOW + timedelta(hours=2))
    assert hidden.order_id == 0 and hidden.as_dict()["delivered"] is False


def test_next_order_waits_until_the_delivered_one_hides(monkeypatch):
    coordinator, _ = _coordinator(monkeypatch, _order())
    later = _order(order_id=301, delivery_date="2026-11-29")
    assert coordinator._keep_delivered(later, NOW).order_id == 300
    coordinator.data = coordinator._keep_delivered(later, NOW)
    assert coordinator._keep_delivered(later, NOW + timedelta(hours=2, minutes=1)).order_id == 301


def test_cancelled_before_delivery_day_is_not_kept(monkeypatch):
    coordinator, _ = _coordinator(monkeypatch, _order(delivery_date="2026-11-24"))
    assert coordinator._keep_delivered(NextOrderData(), NOW).order_id == 0


def test_same_open_order_is_not_marked_delivered(monkeypatch):
    coordinator, _ = _coordinator(monkeypatch, _order())
    fresh = _order()
    assert coordinator._keep_delivered(fresh, NOW) is fresh and not fresh.delivered_at
