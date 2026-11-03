import asyncio
from pathlib import Path
from types import ModuleType

from custom_components.ah_shopping.exceptions import AhTransientError
from custom_components.ah_shopping.models import Product, ShoppingItem, ShoppingListData


class _Coordinator:
    def __class_getitem__(cls, item):
        return cls

    def async_set_updated_data(self, data):
        self.data = data


def load_coordinator(monkeypatch):
    modules = {
        "homeassistant.config_entries": {"ConfigEntry": object},
        "homeassistant.core": {"HomeAssistant": object},
        "homeassistant.exceptions": {"ConfigEntryAuthFailed": type("ConfigEntryAuthFailed", (Exception,), {})},
        "homeassistant.helpers": {},
        "homeassistant.helpers.update_coordinator": {
            "DataUpdateCoordinator": _Coordinator,
            "UpdateFailed": type("UpdateFailed", (Exception,), {}),
        },
    }
    sys_modules = __import__("sys").modules
    for name, values in modules.items():
        module = ModuleType(name)
        module.__dict__.update(values)
        monkeypatch.setitem(sys_modules, name, module)
    path = Path(__file__).parent.parent / "custom_components/ah_shopping/coordinator.py"
    scope = {"__name__": "custom_components.ah_shopping.coordinator", "__package__": "custom_components.ah_shopping", "__file__": str(path)}
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), scope)
    return scope["AhShoppingCoordinator"]


class PricingClient:
    def __init__(self, answers):
        self.answers = list(answers)
        self.asked = []

    async def async_get_total_price(self, lines):
        self.asked.append(lines)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def _list(quantity_b=1):
    a = Product(id=11, title="Plantaardig A", price_now=2.89, is_bonus=True, bonus_mechanism="2e gratis")
    b = Product(id=12, title="Plantaardig B", price_now=2.99, is_bonus=True, bonus_mechanism="2e gratis")
    return ShoppingListData("abc", "Boodschappen", (
        ShoppingItem("1", 11, 3, "Plantaardig A", a),
        ShoppingItem("2", 12, quantity_b, "Plantaardig B", b),
    ))


def _coordinator(cls, client, data):
    coordinator = object.__new__(cls)
    coordinator.client = client
    coordinator.data = data
    return coordinator


def test_local_edit_is_priced_by_ah_right_away(monkeypatch):
    cls = load_coordinator(monkeypatch)
    client = PricingClient([(14.65, 8.78)])
    edited = _list().priced(11.66, 5.78).with_product_quantity(12, 2)
    coordinator = _coordinator(cls, client, edited)
    asyncio.run(coordinator._reprice())
    assert client.asked == [[(11, 3), (12, 2)]]
    assert coordinator.data.price_source == "ah"
    assert (coordinator.data.estimated_total, coordinator.data.bonus_savings) == (5.87, 8.78)


def test_reprice_answer_is_dropped_after_another_edit(monkeypatch):
    cls = load_coordinator(monkeypatch)
    edited = _list().priced(11.66, 5.78).with_product_quantity(12, 2)
    newer = edited.with_product_quantity(12, 3)

    class SlowClient(PricingClient):
        async def async_get_total_price(self, lines):
            coordinator.data = newer  # another edit lands while AH is pricing
            return 14.65, 8.78

    coordinator = _coordinator(cls, SlowClient([]), edited)
    asyncio.run(coordinator._reprice())
    assert coordinator.data is newer


def test_exact_price_is_not_requested_again(monkeypatch):
    cls = load_coordinator(monkeypatch)
    client = PricingClient([])
    priced = _list().priced(11.66, 5.78)
    coordinator = _coordinator(cls, client, priced)
    assert asyncio.run(coordinator._async_priced(priced)) is priced
    assert client.asked == []


def test_failed_reprice_keeps_adjusted_ah_total(monkeypatch):
    cls = load_coordinator(monkeypatch)
    edited = _list().priced(11.66, 5.78).with_product_quantity(12, 2)
    coordinator = _coordinator(cls, PricingClient([AhTransientError("down")]), edited)
    asyncio.run(coordinator._reprice())
    assert coordinator.data is edited and edited.price_source == "ah_adjusted"


def test_pending_edit_keeps_last_ah_price_until_ah_answers(monkeypatch):
    from dataclasses import replace

    cls = load_coordinator(monkeypatch)
    priced = _list().priced(11.66, 5.78)
    pending = replace(priced.with_product_quantity(12, 2), reprice_pending=True)
    # No intermediate jump: the last exact AH amounts stay until AH answers.
    assert pending.price_source == "ah_pending"
    assert (pending.subtotal, pending.bonus_savings, pending.estimated_total) == (11.66, 5.78, 5.88)
    coordinator = _coordinator(cls, PricingClient([(14.65, 8.78)]), pending)
    asyncio.run(coordinator._reprice())
    assert coordinator.data.price_source == "ah"
    assert (coordinator.data.subtotal, coordinator.data.estimated_total) == (14.65, 5.87)
    assert coordinator.data.reprice_pending is False


def test_failed_pending_reprice_falls_back_to_adjusted_total(monkeypatch):
    from dataclasses import replace

    cls = load_coordinator(monkeypatch)
    pending = replace(_list().priced(11.66, 5.78).with_product_quantity(12, 2), reprice_pending=True)
    coordinator = _coordinator(cls, PricingClient([AhTransientError("down")]), pending)
    asyncio.run(coordinator._reprice())
    assert coordinator.data.price_source == "ah_adjusted"
    assert coordinator.data.subtotal == 14.65
