"""@Project / @Business / @Notebook quick capture: parsing is pure, execution happens once in the supervisor."""
import pytest
from langchain_core.messages import HumanMessage

from backend.modules.notebook import extras
from backend.modules.studio import store
from backend.orchestrator import studio_directives as sd
from backend.orchestrator.directive_parser import parse_directive
from backend.orchestrator.supervisor import build_karsa_supervisor_graph


def test_parsing_has_no_side_effects():
    before = len(store.list_projects())
    d = parse_directive("@Project Prediksi DO | student dropout prediction")
    assert d.is_directive and d.action == "studio_project_create" and d.details == {"name": "Prediksi DO", "topic": "student dropout prediction"}
    assert len(store.list_projects()) == before
    assert parse_directive("@Business").action == "studio_business_help"
    assert parse_directive("@business daftar").action == "studio_business_list"
    assert parse_directive("@Notebook https://a.test/x").details == {"url": "https://a.test/x"}


def test_project_and_business_capture_and_list():
    out = sd.execute("studio_project_create", {"name": "Deteksi Hoaks", "topic": "fake news detection"})
    assert "Deteksi Hoaks" in out and "Studio" in out
    assert [p["topic"] for p in store.list_projects("project")][0] == "fake news detection"
    out = sd.execute("studio_business_create", {"idea": "Kedai kopi murah untuk mahasiswa di dekat kampus"})
    assert "disimpan" in out
    biz = store.list_projects("business")[0]
    assert biz["data"]["idea"].startswith("Kedai kopi") and len(biz["name"]) <= 80
    assert "Deteksi Hoaks" in sd.execute("studio_project_list", {})
    assert "Belum ada" in sd.execute("studio_project_create", {"name": "", "topic": ""}) or "@Project" in sd.execute("studio_project_create", {"name": "", "topic": ""})


def test_notebook_url_uses_the_latest_notebook_or_creates_one(monkeypatch):
    seen = {}

    def fake_add(nid, url, **kw):
        seen["nid"], seen["url"] = nid, url
        return {"name": "Halaman Uji"}

    monkeypatch.setattr(extras, "add_url_source", fake_add)
    out = sd.execute("studio_notebook_url", {"url": "https://a.test/x"})
    assert "Halaman Uji" in out and "Catatan Karsa" in out and seen["url"] == "https://a.test/x"


def test_notebook_url_errors_are_shown_not_raised():
    out = sd.execute("studio_notebook_url", {"url": "http://localhost/x"})
    assert out.startswith("⚠️") and "lokal" in out


@pytest.mark.parametrize("text,expect", [("@Project Riset Baru | topik riset", "Riset Baru"), ("@Business bantuan", "Lean Canvas"), ("@Project", "@Project")])
def test_supervisor_executes_the_directive_without_a_model(text, expect):
    graph = build_karsa_supervisor_graph()
    out = graph.invoke({"messages": [HumanMessage(content=text)]}, {"configurable": {"thread_id": f"studio-{abs(hash(text))}"}})
    assert expect in out["messages"][-1].content
