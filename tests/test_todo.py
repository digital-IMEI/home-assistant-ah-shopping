import enum
from pathlib import Path
from types import ModuleType, SimpleNamespace

from custom_components.ah_shopping.models import ShoppingItem, ShoppingListData


class TodoItemStatus(enum.Enum):
    NEEDS_ACTION = "needs_action"
    COMPLETED = "completed"


class TodoItem:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class Entity:
    def __init__(self, coordinator):
        self.coordinator = coordinator


def load_todo(monkeypatch):
    modules = {
        "homeassistant.components.todo": {
            "TodoItem": TodoItem,
            "TodoItemStatus": TodoItemStatus,
            "TodoListEntity": object,
        },
        "homeassistant.core": {"HomeAssistant": object},
        "homeassistant.helpers.entity_platform": {"AddConfigEntryEntitiesCallback": object},
        "custom_components.ah_shopping.entity": {"AhShoppingEntity": Entity},
    }
    sys_modules = __import__("sys").modules
    for name, values in modules.items():
        module = ModuleType(name)
        module.__dict__.update(values)
        monkeypatch.setitem(sys_modules, name, module)
    monkeypatch.setattr(
        sys_modules["custom_components.ah_shopping"], "AhShoppingConfigEntry", object, raising=False
    )
    path = Path(__file__).parent.parent / "custom_components/ah_shopping/todo.py"
    scope = {"__name__": "custom_components.ah_shopping.todo", "__package__": "custom_components.ah_shopping", "__file__": str(path)}
    exec(compile(path.read_text(), str(path), "exec"), scope)
    return scope["AhShoppingTodo"]


def test_struck_through_items_are_completed(monkeypatch):
    todo_cls = load_todo(monkeypatch)
    data = ShoppingListData(
        "abc",
        "Boodschappen",
        (
            ShoppingItem("i1", 0, 1, "Melk", None, checked=True),
            ShoppingItem("i2", 0, 2, "Brood", None),
        ),
    )
    coordinator = SimpleNamespace(data=data, config_entry=SimpleNamespace(entry_id="entry"))
    items = todo_cls(coordinator).todo_items
    assert [(i.summary, i.status) for i in items] == [
        ("Melk", TodoItemStatus.COMPLETED),
        ("Brood", TodoItemStatus.NEEDS_ACTION),
    ]
