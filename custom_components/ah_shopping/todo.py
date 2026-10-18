"""Read-only native Home Assistant To-do representation of the AH shopping list.

Items that are struck through in the Appie app are reported as completed.
"""
from __future__ import annotations

from homeassistant.components.todo import TodoItem, TodoItemStatus, TodoListEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import AhShoppingConfigEntry
from .entity import AhShoppingEntity


async def async_setup_entry(
    hass: HomeAssistant,
    entry: AhShoppingConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    async_add_entities([AhShoppingTodo(entry.runtime_data.coordinator)])


class AhShoppingTodo(AhShoppingEntity, TodoListEntity):
    """Expose AH Mijn lijst (Winkelmandje) as a read-only Home Assistant To-do list."""

    _attr_name = "Albert Heijn Shopping Cart"
    _attr_icon = "mdi:cart-check"

    def __init__(self, coordinator):
        super().__init__(coordinator)
        self._attr_unique_id = f"{coordinator.config_entry.entry_id}_todo"

    @property
    def todo_items(self) -> list[TodoItem]:
        result = []
        for item in self.coordinator.data.items:
            product = item.product
            details = [f"Aantal: {item.quantity}"]
            if product and product.price_now:
                details.append(f"Prijs: €{product.price_now:.2f}")
            if product and product.is_bonus:
                details.append(f"Bonus: {product.bonus_mechanism or 'ja'}")
            result.append(
                TodoItem(
                    uid=item.item_id,
                    summary=item.title,
                    description=" · ".join(details),
                    status=(
                        TodoItemStatus.COMPLETED
                        if item.checked
                        else TodoItemStatus.NEEDS_ACTION
                    ),
                )
            )
        return result
