"""Domain services used by automations and the AH Shopping dashboard card."""
from __future__ import annotations
from typing import Any
import voluptuous as vol
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from .const import DOMAIN
from .exceptions import AhShoppingError

SERVICE_SEARCH = "search_products"
SERVICE_LOOKUP = "lookup_barcode"
SERVICE_ADD_PRODUCT = "add_product"
SERVICE_ADD_BARCODE = "add_barcode"
SERVICE_SET_QUANTITY = "set_quantity"
SERVICE_REMOVE = "remove_product"
SERVICE_REFRESH = "refresh"
SERVICE_RESTORE_CHECKED = "restore_checked"
SERVICE_REMOVE_CHECKED = "remove_checked"


def _runtime(hass: HomeAssistant):
    entries = [e for e in hass.config_entries.async_entries(DOMAIN) if getattr(e, "runtime_data", None)]
    if not entries:
        raise HomeAssistantError("No loaded AH Shopping config entry found")
    return entries[0].runtime_data

async def _refresh(runtime) -> None:
    await runtime.coordinator.async_request_refresh()

async def _search(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass)
    try:
        products=await rt.client.async_search_products(call.data["query"], call.data.get("limit", 8))
        return {"products":[p.as_dict() for p in products]}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _lookup(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass)
    try:
        p=await rt.client.async_lookup_barcode(call.data["barcode"])
        d=p.as_dict(); d["quantity_on_list"]=rt.coordinator.data.quantity_for_product(p.id)
        return {"product": d}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _add_product(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass); pid=call.data["product_id"]; increment=call.data.get("quantity", 1)
    try:
        async with rt.coordinator.product_lock(pid):
            current=rt.coordinator.data.quantity_for_product(pid)
            new=max(1, current+increment)
            item=rt.coordinator.data.item_for_product(pid)
            product=item.product if item else None
            if product is None:
                try:
                    product=await rt.client.async_get_product_detail(pid)
                except AhShoppingError:
                    product=None
            await rt.client.async_set_product_quantity(
                rt.coordinator.data.list_id,
                pid,
                new,
                description=item.description if item else (product.title if product else ""),
                checked=item.checked if item else False,
            )
            rt.coordinator.note_quantity(pid,new,product)
        return {"success":True, "product_id":pid, "quantity":new}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _add_barcode(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass)
    try:
        p=await rt.client.async_lookup_barcode(call.data["barcode"])
        async with rt.coordinator.product_lock(p.id):
            current=rt.coordinator.data.quantity_for_product(p.id)
            new=max(1, current+call.data.get("quantity", 1))
            item=rt.coordinator.data.item_for_product(p.id)
            await rt.client.async_set_product_quantity(
                rt.coordinator.data.list_id,
                p.id,
                new,
                description=item.description if item else p.title,
                checked=item.checked if item else False,
            )
            rt.coordinator.note_quantity(p.id,new,p)
        d=p.as_dict(); d["quantity_on_list"]=new
        return {"success":True, "product":d}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _set_quantity(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass); pid=call.data["product_id"]; qty=call.data["quantity"]
    try:
        async with rt.coordinator.product_lock(pid):
            item=rt.coordinator.data.item_for_product(pid)
            product=item.product if item else None
            if item is None and qty > 0:
                try:
                    product=await rt.client.async_get_product_detail(pid)
                except AhShoppingError:
                    product=None
            await rt.client.async_set_product_quantity(
                rt.coordinator.data.list_id,
                pid,
                qty,
                description=item.description if item else (product.title if product else ""),
                checked=item.checked if item else False,
            )
            rt.coordinator.note_quantity(pid,qty,product)
        return {"success":True, "product_id":pid, "quantity":qty}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _remove(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass); pid=call.data["product_id"]
    try:
        async with rt.coordinator.product_lock(pid):
            item=rt.coordinator.data.item_for_product(pid)
            if item:
                await rt.client.async_delete_list_item(item)
                rt.coordinator.note_quantity(pid,0,item.product)
        return {"success":True, "product_id":pid}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err


def _checked_items(runtime):
    return [item for item in runtime.coordinator.data.items if item.checked]

def _item_lock_key(item) -> int | str:
    return item.product_id if item.product_id > 0 else f"t:{item.description.strip().casefold()}"

async def _restore_checked(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Un-strike every struck-through item, like the Appie app."""
    rt=_runtime(hass); count=0
    try:
        for item in _checked_items(rt):
            async with rt.coordinator.product_lock(_item_lock_key(item)):
                await rt.client.async_set_item_checked(item, False)
                rt.coordinator.note_checked(item, False)
            count+=1
        return {"success":True, "count":count}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err

async def _remove_checked(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    """Remove every struck-through item from Mijn lijst, like the Appie app."""
    rt=_runtime(hass); count=0; free_text_removed=False
    try:
        for item in _checked_items(rt):
            async with rt.coordinator.product_lock(_item_lock_key(item)):
                await rt.client.async_delete_list_item(item)
                if item.product_id > 0:
                    rt.coordinator.note_quantity(item.product_id,0,item.product)
                else:
                    free_text_removed=True
            count+=1
        return {"success":True, "count":count}
    except AhShoppingError as err:
        raise HomeAssistantError(str(err)) from err
    finally:
        if free_text_removed:
            await _refresh(rt)


async def _do_refresh(hass: HomeAssistant, call: ServiceCall) -> ServiceResponse:
    rt=_runtime(hass); await _refresh(rt); return {"success":True}

async def async_setup_services(hass: HomeAssistant) -> None:
    if hass.data.setdefault(DOMAIN, {}).get("services_registered"):
        return
    response_services={
        SERVICE_SEARCH: (_search, vol.Schema({vol.Required("query"): cv.string, vol.Optional("limit", default=8): vol.All(vol.Coerce(int), vol.Range(min=1,max=20))})),
        SERVICE_LOOKUP: (_lookup, vol.Schema({vol.Required("barcode"): cv.string})),
        SERVICE_ADD_PRODUCT: (_add_product, vol.Schema({vol.Required("product_id"): vol.Coerce(int), vol.Optional("quantity", default=1): vol.All(vol.Coerce(int), vol.Range(min=1,max=99))})),
        SERVICE_ADD_BARCODE: (_add_barcode, vol.Schema({vol.Required("barcode"): cv.string, vol.Optional("quantity", default=1): vol.All(vol.Coerce(int), vol.Range(min=1,max=99))})),
        SERVICE_SET_QUANTITY: (_set_quantity, vol.Schema({vol.Required("product_id"): vol.Coerce(int), vol.Required("quantity"): vol.All(vol.Coerce(int), vol.Range(min=0,max=99))})),
        SERVICE_REMOVE: (_remove, vol.Schema({vol.Required("product_id"): vol.Coerce(int)})),
        SERVICE_REFRESH: (_do_refresh, vol.Schema({})),
        SERVICE_RESTORE_CHECKED: (_restore_checked, vol.Schema({})),
        SERVICE_REMOVE_CHECKED: (_remove_checked, vol.Schema({})),
    }
    read_only = {SERVICE_SEARCH, SERVICE_LOOKUP}
    for name,(handler,schema) in response_services.items():
        async def wrapped(call: ServiceCall, _handler=handler):
            return await _handler(hass, call)
        hass.services.async_register(
            DOMAIN, name, wrapped, schema=schema,
            supports_response=SupportsResponse.ONLY if name in read_only else SupportsResponse.OPTIONAL,
        )
    hass.data[DOMAIN]["services_registered"] = True

async def async_unload_services(hass: HomeAssistant) -> None:
    data=hass.data.get(DOMAIN,{})
    if not data.get("services_registered"):
        return
    for name in (SERVICE_SEARCH,SERVICE_LOOKUP,SERVICE_ADD_PRODUCT,SERVICE_ADD_BARCODE,SERVICE_SET_QUANTITY,SERVICE_REMOVE,SERVICE_REFRESH,SERVICE_RESTORE_CHECKED,SERVICE_REMOVE_CHECKED):
        hass.services.async_remove(DOMAIN,name)
    data["services_registered"] = False
