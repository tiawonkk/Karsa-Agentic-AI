import pytest
from typing import ClassVar
from langchain_core.tools import BaseTool
from langgraph.graph.state import CompiledStateGraph
from langgraph.graph import StateGraph, START, END

from backend.modules.base_module import (
    BaseKarsaModule,
    ModuleContext,
    ModuleManifest,
    ModuleRegistry,
)


class DummyTestModule(BaseKarsaModule):
    manifest: ClassVar[ModuleManifest] = ModuleManifest(
        module_id="test_dummy",
        display_name="Test Dummy Module",
        description="A dummy module for testing the registry",
        intent_patterns=[r"dummy test pattern"],
        model_tier="tier1_utility",
        high_risk_actions=["dummy_risky_action"],
    )

    def get_tools(self) -> list[BaseTool]:
        return []

    def build_graph(self, ctx: ModuleContext) -> CompiledStateGraph:
        g = StateGraph(dict)
        g.add_node("noop", lambda s: {"result": "ok"})
        g.add_edge(START, "noop")
        g.add_edge("noop", END)
        return g.compile()


def test_module_registry():
    reg = ModuleRegistry()
    mod = DummyTestModule()

    # Register
    reg.register(mod)
    assert reg.get_module("test_dummy") is not None
    assert len(reg.list_modules()) == 1

    # Duplicate registration should raise ValueError
    with pytest.raises(ValueError, match="already registered"):
        reg.register(mod)

    # Unregister
    reg.unregister("test_dummy")
    assert reg.get_module("test_dummy") is None
