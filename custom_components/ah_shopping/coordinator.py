"""Coordinator for AH Shopping."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import time

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import AhShoppingApiClient
from .const import (
    CONF_UPDATE_INTERVAL_MINUTES,
    DEFAULT_UPDATE_INTERVAL_MINUTES,
    NAME,
)
from .exceptions import AhAuthError, AhShoppingError
from .models import NextOrderData, Product, ShoppingItem, ShoppingListData

_LOGGER = logging.getLogger(__name__)
_PENDING_TTL = 20.0
_RECONCILE_DELAY = 1.0


class AhShoppingCoordinator(DataUpdateCoordinator[ShoppingListData]):
    """Keep AH shopping data fresh and protect recent local writes."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, client: AhShoppingApiClient
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=NAME,
            update_interval=timedelta(
                minutes=int(
                    entry.options.get(
                        CONF_UPDATE_INTERVAL_MINUTES,
                        DEFAULT_UPDATE_INTERVAL_MINUTES,
                    )
                )
            ),
            config_entry=entry,
        )
        self.client = client
        self._pending_quantities: dict[int, tuple[int, float]] = {}
        self._pending_checked: dict[str, tuple[bool, float]] = {}
        self._write_locks: dict[str, asyncio.Lock] = {}
        self._reconcile_task: asyncio.Task | None = None
        self._reprice_task: asyncio.Task | None = None
        self.last_synced_at: str | None = None

    @staticmethod
    def _item_key(item: ShoppingItem) -> str:
        if item.product_id > 0:
            return f"p:{item.product_id}"
        return f"t:{item.description.strip().casefold()}"

    def product_lock(self, key: int | str) -> asyncio.Lock:
        text = str(key)
        lock = self._write_locks.get(text)
        if lock is None:
            lock = self._write_locks[text] = asyncio.Lock()
        return lock

    @property
    def pending_change_count(self) -> int:
        return len(self._pending_quantities) + len(self._pending_checked)

    def note_quantity(
        self, product_id: int, quantity: int, product: Product | None = None
    ) -> None:
        """Apply a confirmed AH write locally and reconcile shortly after."""
        self._pending_quantities[int(product_id)] = (
            max(0, int(quantity)),
            time.monotonic(),
        )
        if product is not None:
            data = self.data.with_product(product, quantity)
        else:
            data = self.data.with_product_quantity(product_id, quantity)
        self.async_set_updated_data(data)
        self._schedule_reprice()
        self._schedule_reconcile()

    def note_checked(self, item: ShoppingItem, checked: bool) -> None:
        """Apply a confirmed checked-state write locally."""
        self._pending_checked[self._item_key(item)] = (
            bool(checked),
            time.monotonic(),
        )
        self.async_set_updated_data(
            self.data.with_item_checked(item.product_id, item.description, checked)
        )
        self._schedule_reconcile()

    async def _async_priced(self, data: ShoppingListData) -> ShoppingListData:
        """Ask AH to price these quantities; keep the data unchanged on failure."""
        if data.price_source != "ah_adjusted":
            return data
        try:
            before, discount = await self.client.async_get_total_price(
                list(data.price_signature())
            )
        except AhShoppingError as err:
            _LOGGER.debug("AH total price unavailable: %s", err)
            return data
        return data.priced(before, discount) if before > 0 else data

    def _schedule_reprice(self) -> None:
        """Price a local edit right away instead of waiting for the next refresh."""
        if self._reprice_task and not self._reprice_task.done():
            self._reprice_task.cancel()
        self._reprice_task = self.hass.async_create_task(self._reprice())

    async def _reprice(self) -> None:
        try:
            current = self.data
            priced = await self._async_priced(current)
        except asyncio.CancelledError:
            return
        # Drop the answer when another edit arrived while AH was pricing.
        if priced is not current and self.data is current:
            self.async_set_updated_data(priced)

    def _schedule_reconcile(self) -> None:
        if self._reconcile_task and not self._reconcile_task.done():
            self._reconcile_task.cancel()
        self._reconcile_task = self.hass.async_create_task(self._delayed_reconcile())

    async def _delayed_reconcile(self) -> None:
        try:
            await asyncio.sleep(_RECONCILE_DELAY)
            await self.async_request_refresh()
        except asyncio.CancelledError:
            return

    def _merge_pending(self, remote: ShoppingListData) -> ShoppingListData:
        now = time.monotonic()
        merged = remote

        remaining_quantities: dict[int, tuple[int, float]] = {}
        for product_id, (desired, created) in self._pending_quantities.items():
            remote_qty = remote.quantity_for_product(product_id)
            if remote_qty == desired:
                continue
            if now - created >= _PENDING_TTL:
                continue
            local_item = self.data.item_for_product(product_id)
            if desired <= 0:
                merged = merged.with_product_quantity(product_id, 0)
            elif local_item and local_item.product:
                merged = merged.with_product(local_item.product, desired)
            else:
                merged = merged.with_product_quantity(product_id, desired)
            remaining_quantities[product_id] = (desired, created)
        self._pending_quantities = remaining_quantities

        remaining_checked: dict[str, tuple[bool, float]] = {}
        for key, (desired, created) in self._pending_checked.items():
            remote_item = next(
                (item for item in remote.items if self._item_key(item) == key), None
            )
            if remote_item is not None and remote_item.checked == desired:
                continue
            if now - created >= _PENDING_TTL:
                continue
            local_item = next(
                (item for item in self.data.items if self._item_key(item) == key), None
            )
            if local_item is not None:
                merged = merged.with_item_checked(
                    local_item.product_id, local_item.description, desired
                )
                remaining_checked[key] = (desired, created)
        self._pending_checked = remaining_checked
        return merged

    async def _async_update_data(self) -> ShoppingListData:
        try:
            remote = await self.client.async_get_shopping_data()
            self.last_synced_at = datetime.now(timezone.utc).isoformat()
            # Pending local writes can differ from what AH priced with the list.
            return await self._async_priced(self._merge_pending(remote))
        except AhAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except AhShoppingError as err:
            raise UpdateFailed(str(err)) from err



class AhNextOrderCoordinator(DataUpdateCoordinator[NextOrderData]):
    """Poll the next scheduled AH order without blocking shopping-list setup."""

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, client: AhShoppingApiClient
    ) -> None:
        super().__init__(
            hass,
            _LOGGER,
            name=f"{NAME} next order",
            update_interval=timedelta(
                minutes=int(
                    entry.options.get(
                        CONF_UPDATE_INTERVAL_MINUTES,
                        DEFAULT_UPDATE_INTERVAL_MINUTES,
                    )
                )
            ),
            config_entry=entry,
        )
        self.client = client

    async def _async_update_data(self) -> NextOrderData:
        try:
            return await self.client.async_get_next_order()
        except AhAuthError as err:
            raise ConfigEntryAuthFailed(str(err)) from err
        except AhShoppingError as err:
            _LOGGER.warning("Could not update AH next order: %s", err)
            return self.data if self.data is not None else NextOrderData()


