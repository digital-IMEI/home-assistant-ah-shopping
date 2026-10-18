import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace

from custom_components.ah_shopping.exceptions import AhShoppingError
from custom_components.ah_shopping.models import ShoppingItem, ShoppingListData


class HomeAssistantError(Exception):
    pass


def load_services(monkeypatch):
    vol = ModuleType("voluptuous")
    vol.Schema = lambda *args, **kwargs: None
    vol.Required = vol.Optional = lambda key, **kwargs: key
    vol.All = vol.Coerce = vol.Range = lambda *args, **kwargs: None
    modules = {
        "voluptuous": vol.__dict__,
        "homeassistant.core": {"HomeAssistant": object, "ServiceCall": object, "ServiceResponse": dict, "SupportsResponse": SimpleNamespace(ONLY="only", OPTIONAL="optional")},
        "homeassistant.exceptions": {"HomeAssistantError": HomeAssistantError},
        "homeassistant.helpers": {},
        "homeassistant.helpers.config_validation": {"string": str},
    }
    sys_modules = __import__("sys").modules
    for name, values in modules.items():
        module = ModuleType(name)
        module.__dict__.update(values)
        monkeypatch.setitem(sys_modules, name, module)
    sys_modules["homeassistant.helpers"].config_validation = sys_modules["homeassistant.helpers.config_validation"]
    path = Path(__file__).parent.parent / "custom_components/ah_shopping/services.py"
    scope = {"__name__": "custom_components.ah_shopping.services", "__package__": "custom_components.ah_shopping", "__file__": str(path)}
    exec(compile(path.read_text(encoding="utf-8"), str(path), "exec"), scope)
    return scope


class FakeClient:
    def __init__(self, fail_on=None):
        self.checked_writes = []
        self.deleted = []
        self.fail_on = fail_on

    async def async_set_item_checked(self, item, checked):
        if item.description == self.fail_on:
            raise AhShoppingError("AH rejected the request")
        self.checked_writes.append((item.description, checked))

    async def async_delete_list_item(self, item):
        self.deleted.append(item.description)


class FakeCoordinator:
    def __init__(self, items):
        self.data = ShoppingListData("abc", "Boodschappen", tuple(items))
        self.noted_checked = []
        self.noted_quantity = []
        self.refreshes = 0

    @asynccontextmanager
    async def _lock(self):
        yield

    def product_lock(self, key):
        return self._lock()

    def note_checked(self, item, checked):
        self.noted_checked.append((item.description, checked))

    def note_quantity(self, product_id, quantity, product=None):
        self.noted_quantity.append((product_id, quantity))

    async def async_request_refresh(self):
        self.refreshes += 1


def make_hass(items, client):
    coordinator = FakeCoordinator(items)
    runtime = SimpleNamespace(client=client, coordinator=coordinator)
    entry = SimpleNamespace(runtime_data=runtime)
    hass = SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda domain: [entry]))
    return hass, coordinator


ITEMS = [
    ShoppingItem("i1", 11, 1, "Melk", None, checked=True),
    ShoppingItem("i2", 12, 2, "Brood", None),
    ShoppingItem("i3", 0, 1, "bosui", None, checked=True),
]


def test_restore_checked_unstrikes_only_struck_items(monkeypatch):
    services = load_services(monkeypatch)
    client = FakeClient()
    hass, coordinator = make_hass(ITEMS, client)
    result = asyncio.run(services["_restore_checked"](hass, None))
    assert result == {"success": True, "count": 2}
    assert client.checked_writes == [("Melk", False), ("bosui", False)]
    assert coordinator.noted_checked == [("Melk", False), ("bosui", False)]


def test_remove_checked_removes_products_and_free_text(monkeypatch):
    services = load_services(monkeypatch)
    client = FakeClient()
    hass, coordinator = make_hass(ITEMS, client)
    result = asyncio.run(services["_remove_checked"](hass, None))
    assert result == {"success": True, "count": 2}
    assert client.deleted == ["Melk", "bosui"]
    assert coordinator.noted_quantity == [(11, 0)]
    assert coordinator.refreshes == 1  # free-text items are reconciled by a refresh


def test_restore_checked_reports_ah_errors(monkeypatch):
    services = load_services(monkeypatch)
    hass, _ = make_hass(ITEMS, FakeClient(fail_on="bosui"))
    try:
        asyncio.run(services["_restore_checked"](hass, None))
    except HomeAssistantError as err:
        assert "rejected" in str(err)
    else:
        raise AssertionError("expected HomeAssistantError")
