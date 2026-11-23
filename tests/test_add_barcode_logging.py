import asyncio
import logging
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from custom_components.ah_shopping.exceptions import AhShoppingError
from tests.test_services_checked import load_services


class FakeClient:
    def __init__(self, found=True):
        self.found = found
        self.writes = []

    async def async_lookup_barcode(self, barcode):
        if not self.found:
            raise AhShoppingError(f"Barcode {barcode} was read correctly, but no product was found at Albert Heijn")
        return SimpleNamespace(id=42, title="Testproduct", as_dict=lambda: {"id": 42, "title": "Testproduct"})

    async def async_set_product_quantity(self, list_id, product_id, quantity, **kwargs):
        self.writes.append((product_id, quantity))


class FakeCoordinator:
    def __init__(self):
        self.data = SimpleNamespace(
            list_id="abc",
            quantity_for_product=lambda pid: 1,
            item_for_product=lambda pid: None,
        )

    @asynccontextmanager
    async def product_lock(self, product_id):
        yield

    def note_quantity(self, product_id, quantity, product):
        pass


def make_hass(client):
    runtime = SimpleNamespace(client=client, coordinator=FakeCoordinator())
    entry = SimpleNamespace(runtime_data=runtime)
    return SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda domain: [entry]))


def test_added_barcode_is_logged_with_product_and_timing(monkeypatch, caplog):
    services = load_services(monkeypatch)
    client = FakeClient()
    call = SimpleNamespace(data={"barcode": "4006381333931", "quantity": 1})
    with caplog.at_level(logging.DEBUG, logger="custom_components.ah_shopping.services"):
        result = asyncio.run(services["_add_barcode"](make_hass(client), call))
    assert result["product"]["quantity_on_list"] == 2
    assert client.writes == [(42, 2)]
    message = caplog.records[-1].getMessage()
    assert "4006381333931" in message and "Testproduct" in message
    assert "lookup" in message and "total" in message


def test_unknown_barcode_is_logged_and_still_raises(monkeypatch, caplog):
    services = load_services(monkeypatch)
    call = SimpleNamespace(data={"barcode": "8710400015727", "quantity": 1})
    with caplog.at_level(logging.DEBUG, logger="custom_components.ah_shopping.services"):
        with pytest.raises(Exception, match="no product was found"):
            asyncio.run(services["_add_barcode"](make_hass(FakeClient(found=False)), call))
    message = caplog.records[-1].getMessage()
    assert "8710400015727" in message and "not added" in message
