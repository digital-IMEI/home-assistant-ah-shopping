"""Sensors for Albert Heijn Shopping."""
from __future__ import annotations
from typing import Any
from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.const import CURRENCY_EURO
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from . import AhShoppingConfigEntry
from .entity import AhShoppingEntity

async def async_setup_entry(hass: HomeAssistant, entry: AhShoppingConfigEntry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = entry.runtime_data.coordinator
    order_coordinator = entry.runtime_data.order_coordinator
    async_add_entities([
        AhShoppingListSensor(coordinator),
        AhShoppingTotalSensor(coordinator),
        AhShoppingBonusSavingsSensor(coordinator),
        AhNextOrderSensor(order_coordinator),
        AhNextOrderBonusSavingsSensor(order_coordinator),
    ])

class AhShoppingListSensor(AhShoppingEntity, SensorEntity):
    _attr_name = "Albert Heijn Shopping Cart"
    _attr_icon = "mdi:cart-outline"
    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_shopping_list"
    @property
    def native_value(self) -> int:
        return self.coordinator.data.total_quantity
    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data.as_dict()
        data["ah_shopping_list"] = True
        data["last_synced"] = self.coordinator.last_synced_at
        data["pending_changes"] = self.coordinator.pending_change_count
        data["update_interval_seconds"] = int(self.coordinator.update_interval.total_seconds())
        data["total_note"] = (
            "Total and Bonus as calculated by Albert Heijn"
            if self.coordinator.data.price_source == "ah"
            else "Total includes supported multi-buy Bonus calculations"
        )
        return data

class AhShoppingTotalSensor(AhShoppingEntity, SensorEntity):
    _attr_name = "Albert Heijn Shopping Estimated Total"
    _attr_icon = "mdi:currency-eur"
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO
    _attr_suggested_display_precision = 2
    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_estimated_total"
    @property
    def native_value(self) -> float:
        return self.coordinator.data.estimated_total


class AhShoppingBonusSavingsSensor(AhShoppingEntity, SensorEntity):
    _attr_name = "Albert Heijn Shopping Bonus Savings"
    _attr_icon = "mdi:tag-outline"
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_bonus_savings"

    @property
    def native_value(self) -> float:
        return self.coordinator.data.bonus_savings



class AhNextOrderSensor(AhShoppingEntity, SensorEntity):
    _attr_name = "Albert Heijn Next Order"
    _attr_icon = "mdi:truck-delivery-outline"

    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_next_order"

    @property
    def native_value(self) -> int:
        return self.coordinator.data.total_quantity

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        data = self.coordinator.data.as_dict()
        data["ah_next_order"] = True
        return data




class AhNextOrderBonusSavingsSensor(AhShoppingEntity, SensorEntity):
    """Bonus savings belonging to the scheduled order, separate from the cart."""
    _attr_name = "Albert Heijn Next Order Bonus Savings"
    _attr_icon = "mdi:tag-outline"
    _attr_device_class = SensorDeviceClass.MONETARY
    _attr_native_unit_of_measurement = CURRENCY_EURO
    _attr_suggested_display_precision = 2

    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_next_order_bonus_savings"

    @property
    def native_value(self) -> float:
        return self.coordinator.data.bonus_savings
