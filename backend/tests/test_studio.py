"""@Business calculators, @Project literature analysis, and the PRD-to-App engine (plan -> approval -> build -> self-correction)."""
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.modules.studio import business, literature, prd_app, store
from backend.modules.studio.store import StudioError

client = TestClient(app)


@pytest.fixture(autouse=True)
def no_real_models(monkeypatch):
    """A local Ollama or a saved key must never answer tests: every automation takes its no-model path."""
    monkeypatch.setattr("backend.api.automation.llm_available", lambda: False)

PRD = "# PRD: Toko Kopi\n\n## Tujuan\n- Menjual kopi online\n\n## Fitur\n- Daftar menu\n- Formulir pesanan\n"


# ----------------------------------------------------------------------------------------------- business numbers
def plan_inputs(**over):
    base = {
        "start_items": [{"name": "Mesin kopi", "cost_idr": 5_000_000}, {"name": "Etalase", "cost_idr": 1_000_000}],
        "monthly_fixed": [{"name": "Sewa", "cost_idr": 1_000_000}, {"name": "Internet", "cost_idr": 200_000}],
        "unit_costs": [{"name": "Biji kopi", "cost_idr": 6_000}, {"name": "Gelas", "cost_idr": 1_000}],
        "price_idr": 20_000,
        "units_per_month": 300,
        "buffer_months": 3,
        "contingency_pct": 10,
    }
    base.update(over)
    return base


def test_capital_plan_arithmetic():
    p = business.capital_plan(plan_inputs())
    assert p["capex_idr"] == 6_000_000 and p["contingency_idr"] == 600_000
    assert p["monthly_fixed_idr"] == 1_200_000 and p["cogs_per_unit_idr"] == 7_000
    assert p["margin_per_unit_idr"] == 13_000 and p["margin_pct"] == 65.0
    assert p["bep_units"] == 93  # ceil(1_200_000 / 13_000)
    assert p["bep_revenue_idr"] == 93 * 20_000
    assert p["revenue_month_idr"] == 6_000_000 and p["profit_month_idr"] == 6_000_000 - 2_100_000 - 1_200_000
    assert p["working_capital_idr"] == 1_200_000 * 3 + 2_100_000
    assert p["total_capital_needed_idr"] == 6_000_000 + 600_000 + 5_700_000
    assert p["payback_months"] == round(12_300_000 / 2_700_000, 1)
    assert p["roi_12m_pct"] == round((2_700_000 * 12 - 12_300_000) / 12_300_000 * 100, 1)


def test_loss_making_price_is_called_out_not_hidden():
    p = business.capital_plan(plan_inputs(price_idr=5_000))
    assert p["margin_per_unit_idr"] < 0 and p["bep_units"] is None and p["payback_months"] is None
    assert any("merugi" in n for n in p["notes"])


def test_target_below_break_even_warns():
    p = business.capital_plan(plan_inputs(units_per_month=50))
    assert any("belum mencapai BEP" in n for n in p["notes"]) and p["profit_month_idr"] < 0


def test_bad_numbers_are_rejected_with_clear_messages():
    for bad in (plan_inputs(price_idr=-1), plan_inputs(price_idr="abc"), plan_inputs(price_idr=10**18)):
        with pytest.raises(StudioError):
            business.capital_plan(bad)
    with pytest.raises(StudioError):
        business.capital_plan(plan_inputs(start_items=[{"name": "", "cost_idr": 5}]))


def test_empty_inputs_do_not_divide_by_zero():
    p = business.capital_plan({})
    assert p["total_capital_needed_idr"] == 0 and p["roi_12m_pct"] is None and p["notes"]


def test_canvas_without_a_model_is_an_honest_empty_template():
    c = business.lean_canvas("Kedai kopi untuk mahasiswa di dekat kampus", None)
    assert c["used_llm"] is False and all(v == "" for v in c["canvas"].values()) and "belum diisi AI" in c["note"]
    with pytest.raises(StudioError):
        business.lean_canvas("kopi", None)


def test_canvas_with_a_model_and_a_model_that_returns_garbage():
    good = json.dumps({**{k: f"isi {k}" for k, _ in business.CANVAS_BLOCKS}, "market_notes": "perlu riset", "competitor_notes": "kedai lain", "assumptions": ["harga stabil"]})
    c = business.lean_canvas("Kedai kopi untuk mahasiswa", lambda s, u: f"```json\n{good}\n```")
    assert c["used_llm"] and c["canvas"]["problem"] == "isi problem" and c["assumptions"] == ["harga stabil"]
    bad = business.lean_canvas("Kedai kopi untuk mahasiswa", lambda s, u: "maaf saya tidak bisa")
    assert bad["used_llm"] is False and "note" in bad


def test_business_prd_is_built_from_the_numbers():
    plan = business.capital_plan(plan_inputs())
    prd = business.business_to_prd("Kedai Kopi", "Kopi untuk mahasiswa", {"problem": "Kopi mahal"}, plan)
    assert prd.startswith("# PRD: Kedai Kopi") and "Kopi mahal" in prd and "Break-even: 93 unit" in prd and "Fitur utama" in prd


# ----------------------------------------------------------------------------------------------- literature
PAPERS = [
    {"source": "arxiv", "title": "Student dropout prediction with random forest", "publication_year": 2024, "url": "http://x/1",
     "abstract": "We evaluate a random forest on the OULAD dataset and reach accuracy 91.2%. However, small samples limit generalisation."},
    {"source": "crossref", "title": "Student dropout prediction with Random Forest", "publication_year": 2023, "abstract": "dup"},
    {"source": "semantic_scholar", "title": "Early warning with LSTM", "publication_year": 2022, "abstract": "An LSTM model on a Kaggle dataset improves F1 0.83."},
]


def test_matrix_extracts_only_what_the_abstract_says():
    rows = {r["title"]: r for r in literature.literature_matrix(PAPERS)}
    r1 = rows["Student dropout prediction with random forest"]
    assert "random forest" in r1["methods"] and "OULAD" in r1["datasets"] and any("ACCURACY 91.2" in m for m in r1["metrics"])
    assert "However" in r1["gap"]
    r3 = rows["Early warning with LSTM"]
    assert "lstm" in r3["methods"] and "Kaggle" in r3["datasets"] and r3["gap"] == ""
    empty = literature.matrix_row({"title": "Tanpa abstrak", "abstract": ""})
    assert empty["methods"] == [] and empty["has_abstract"] is False


def test_search_all_merges_duplicates_and_reports_failed_sources():
    def ok(q, n):
        return PAPERS[:2]

    def boom(q, n):
        raise RuntimeError("HTTP 429")

    r = literature.search_all("dropout", sources={"arxiv": ok, "semantic_scholar": boom})
    assert len(r["papers"]) == 1 and r["errors"] == [{"source": "semantic_scholar", "error": "HTTP 429"}]


def test_analysis_without_a_model_gives_facts_and_says_gaps_were_not_judged():
    out = literature.analyze_topic("Prediksi DO", "student dropout", search_fn=lambda q, n: {"papers": PAPERS, "errors": []}, llm_fn=None)
    assert out["used_llm"] is False and out["facts"]["papers_found"] == 3
    assert "random forest" in out["novelty"]["summary"] and "butuh AI" in out["novelty"]["summary"]
    assert out["novelty"]["ideas"] == []


def test_analysis_with_a_model_and_with_no_papers():
    reply = json.dumps({"summary": "Belum terlihat studi di kampus lokal.", "gaps": ["data lokal"], "ideas": [{"title": "Model lokal", "why_new": "data baru", "first_step": "kumpulkan data"}]})
    out = literature.analyze_topic("P", "student dropout", search_fn=lambda q, n: {"papers": PAPERS, "errors": []}, llm_fn=lambda s, u: reply)
    assert out["used_llm"] and out["novelty"]["ideas"][0]["title"] == "Model lokal"
    none = literature.analyze_topic("P", "xyzzy", search_fn=lambda q, n: {"papers": [], "errors": []}, llm_fn=lambda s, u: "x")
    assert none["papers"] == [] and "belum bisa dinilai" in none["novelty"]["summary"]
    with pytest.raises(ValueError):
        literature.analyze_topic("P", "", search_fn=None)


# ----------------------------------------------------------------------------------------------- PRD-to-App safety
def test_target_dir_validation(tmp_path):
    good = prd_app.validate_target(str(tmp_path / "toko"))
    assert good.name == "toko"
    for bad in ("", "relatif/folder", str(Path(__file__).resolve().parents[2]), str(Path("C:/Windows/Temp/x"))):
        with pytest.raises(StudioError):
            prd_app.validate_target(bad)
    full = tmp_path / "penuh"
    full.mkdir()
    (full / "milik_orang.txt").write_text("x")
    with pytest.raises(StudioError):
        prd_app.validate_target(str(full))  # never build into someone's existing folder


def test_paths_and_commands_are_whitelisted():
    for ok in ("index.html", "src/app.js", "tests/test_a.py"):
        assert prd_app.safe_rel_path(ok) == ok
    for bad in ("../x.py", "/etc/x.py", "C:/x.py", ".env", "a/.git/config", "run.exe", ""):
        with pytest.raises(StudioError):
            prd_app.safe_rel_path(bad)
    for ok in (["python", "-m", "pytest", "-q"], ["node", "--check", "app.js"], ["npm", "run", "build"], ["npm", "install"]):
        prd_app.validate_command(ok)
    for bad in (["rm", "-rf", "/"], ["powershell", "-c", "x"], ["npm", "run", "evil"], ["python", "-c", "print(1)"], ["node", "x.js"], ["node", "--check", "../x.js"], ["python", "-m", "pytest", "a b"]):
        with pytest.raises(StudioError):
            prd_app.validate_command(bad)


def new_build(tmp_path, name="tokokopi"):
    return store.create_build("Toko Kopi", PRD, str(prd_app.validate_target(str(tmp_path / name))))


def test_full_flow_without_a_model_writes_an_honest_skeleton(tmp_path):
    b = new_build(tmp_path)
    b = prd_app.make_plan(b["id"], None)
    assert b["status"] == "planned" and b["plan"]["used_llm"] is False and "tanpa AI" in b["plan"]["summary"]
    with pytest.raises(StudioError):  # no write before approval
        prd_app.run_build(b["id"], None, runner=lambda c, d, t: {"returncode": 0, "output": ""})
    assert not (tmp_path / "tokokopi").exists()
    prd_app.approve_plan(b["id"])
    calls = []
    out = prd_app.run_build(b["id"], None, runner=lambda c, d, t: calls.append(c) or {"returncode": 0, "output": ""})
    assert out["status"] == "done" and calls == [["node", "--check", "app.js"]]
    root = tmp_path / "tokokopi"
    html = (root / "index.html").read_text(encoding="utf-8")
    assert "Toko Kopi" in html and "Formulir pesanan" in html and (root / prd_app.MARKER).exists()
    assert any(e["step"] == "write" for e in out["log"])


def test_a_build_runs_only_once_per_approval(tmp_path):
    b = prd_app.make_plan(new_build(tmp_path)["id"], None)
    prd_app.approve_plan(b["id"])
    ok = lambda c, d, t: {"returncode": 0, "output": ""}  # noqa: E731
    assert prd_app.run_build(b["id"], None, runner=ok)["status"] == "done"
    with pytest.raises(StudioError):
        prd_app.run_build(b["id"], None, runner=ok)


def test_ai_plan_is_sanitised_and_unsafe_plans_fall_back(tmp_path):
    unsafe = json.dumps({"summary": "x", "files": [{"path": "../../evil.py", "purpose": "x"}], "commands": {"verify": []}})
    b = prd_app.make_plan(new_build(tmp_path)["id"], lambda s, u: unsafe)
    assert b["plan"]["used_llm"] is False and "ditolak" in b["plan"]["note"] and all(".." not in f["path"] for f in b["plan"]["files"])
    cmd = json.dumps({"files": [{"path": "a.py", "purpose": "x"}], "commands": {"verify": [["rm", "-rf", "/"]]}})
    b2 = prd_app.make_plan(new_build(tmp_path, "b2")["id"], lambda s, u: cmd)
    assert b2["plan"]["used_llm"] is False


def test_self_correction_loop_fixes_a_failing_build(tmp_path):
    plan = json.dumps({"summary": "kalkulator", "stack": "python", "files": [{"path": "calc.py", "purpose": "fungsi tambah"}], "commands": {"verify": [["python", "-m", "py_compile", "calc.py"]]}})
    state = {"fixed": False}

    def llm(system, user):
        if "System Architect" in system:
            return plan
        if "Build/tes gagal" in system:
            state["fixed"] = True
            return json.dumps({"files": [{"path": "calc.py", "content": "def tambah(a, b):\n    return a + b\n"}]})
        return "def tambah(a, b)\n    return a + b\n"  # first draft has a syntax error

    def runner(cmd, cwd, timeout):
        src = (cwd / "calc.py").read_text()
        return {"returncode": 0 if "def tambah(a, b):" in src else 1, "output": "SyntaxError: expected ':'"}

    b = prd_app.make_plan(new_build(tmp_path)["id"], llm)
    prd_app.approve_plan(b["id"])
    out = prd_app.run_build(b["id"], llm, runner=runner)
    assert out["status"] == "done" and state["fixed"]
    assert (tmp_path / "tokokopi" / "calc.py").read_text().startswith("def tambah(a, b):")
    steps = [e["step"] for e in out["log"]]
    assert "fix" in steps and steps[-1] == "verify"


def test_gives_up_after_three_fixes_and_reports_the_last_error(tmp_path):
    plan = json.dumps({"files": [{"path": "a.py", "purpose": "x"}], "commands": {"verify": [["python", "-m", "pytest"]]}})
    fixes = []

    def llm(system, user):
        if "System Architect" in system:
            return plan
        if "Build/tes gagal" in system:
            fixes.append(1)
            return json.dumps({"files": [{"path": "a.py", "content": "x = 1\n"}]})
        return "x = 0\n"

    b = prd_app.make_plan(new_build(tmp_path)["id"], llm)
    prd_app.approve_plan(b["id"])
    out = prd_app.run_build(b["id"], llm, runner=lambda c, d, t: {"returncode": 1, "output": "AssertionError: salah terus"})
    assert out["status"] == "failed" and len(fixes) == prd_app.MAX_FIX_ITERATIONS
    assert "salah terus" in out["log"][-1]["detail"] or any("salah terus" in e["detail"] for e in out["log"])


def test_a_missing_tool_stops_with_a_clear_message(tmp_path):
    b = prd_app.make_plan(new_build(tmp_path)["id"], None)
    prd_app.approve_plan(b["id"])
    out = prd_app.run_build(b["id"], None, runner=lambda c, d, t: {"returncode": 127, "output": "'node' tidak terpasang di komputer ini.", "missing": True})
    assert out["status"] == "failed" and any("tidak terpasang" in e["detail"] for e in out["log"])


def test_changed_plan_needs_a_new_approval(tmp_path):
    b = prd_app.make_plan(new_build(tmp_path)["id"], None)
    prd_app.approve_plan(b["id"])
    tampered = dict(b["plan"], fingerprint="deadbeef")
    store.save_build(b["id"], plan=tampered)
    with pytest.raises(StudioError):
        prd_app.run_build(b["id"], None, runner=lambda c, d, t: {"returncode": 0, "output": ""})
    assert not (tmp_path / "tokokopi" / "index.html").exists()


def test_reject_leaves_nothing_on_disk(tmp_path):
    b = prd_app.make_plan(new_build(tmp_path)["id"], None)
    assert prd_app.reject_plan(b["id"])["status"] == "draft"
    assert not (tmp_path / "tokokopi").exists()


def test_approval_is_in_the_audit_trail(tmp_path):
    b = prd_app.make_plan(new_build(tmp_path)["id"], None)
    prd_app.approve_plan(b["id"])
    audit = client.get("/api/v1/approvals/audit").json()
    rows = audit["audit"]
    mine = [r for r in rows if r.get("action_name") == "build_app_from_prd"]
    assert mine and mine[0]["decision"] == "approve"


# ----------------------------------------------------------------------------------------------- API
def test_api_business_flow_to_a_planned_build(tmp_path):
    p = client.post("/api/v1/studio/projects", json={"kind": "business", "name": "Kedai Kopi", "topic": "kopi mahasiswa"}).json()
    pid = p["id"]
    cap = client.post(f"/api/v1/studio/business/{pid}/capital", json=plan_inputs()).json()
    assert cap["bep_units"] == 93
    assert client.post(f"/api/v1/studio/business/{pid}/capital", json=plan_inputs(price_idr=-5)).status_code == 400
    canvas = client.post(f"/api/v1/studio/business/{pid}/canvas", json={"idea": "Kedai kopi murah di dekat kampus"}).json()
    assert "canvas" in canvas
    dev = client.post(f"/api/v1/studio/business/{pid}/develop", json={"target_dir": str(tmp_path / "kopi")})
    assert dev.status_code == 200, dev.text
    bid = dev.json()["id"]
    assert client.post(f"/api/v1/app-builds/{bid}/run").status_code == 409  # not approved yet
    planned = client.post(f"/api/v1/app-builds/{bid}/plan").json()
    assert planned["status"] == "planned" and planned["plan"]["files"]
    assert client.get(f"/api/v1/studio/projects/{pid}").json()["data"]["capital"]["bep_units"] == 93
    assert client.get("/api/v1/studio/projects/99999").status_code == 404
    assert client.delete(f"/api/v1/studio/projects/{pid}").status_code == 200


def test_api_build_runs_in_background_after_approval(tmp_path, monkeypatch):
    monkeypatch.setattr(prd_app, "default_runner", lambda c, d, t=180: {"returncode": 0, "output": ""})
    b = client.post("/api/v1/app-builds", json={"name": "Toko", "prd": PRD, "target_dir": str(tmp_path / "t")}).json()
    client.post(f"/api/v1/app-builds/{b['id']}/plan")
    assert client.post(f"/api/v1/app-builds/{b['id']}/approve").json()["status"] == "approved"
    assert client.post(f"/api/v1/app-builds/{b['id']}/run").json()["status"] == "started"
    for _ in range(50):
        cur = client.get(f"/api/v1/app-builds/{b['id']}").json()
        if cur["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    assert cur["status"] == "done" and (tmp_path / "t" / "index.html").exists()


def test_api_rejects_unsafe_build_requests(tmp_path):
    assert client.post("/api/v1/app-builds", json={"name": "x", "prd": PRD, "target_dir": "relatif"}).status_code == 400
    assert client.post("/api/v1/app-builds", json={"name": "x", "prd": "pendek", "target_dir": str(tmp_path / "a")}).status_code == 400
    assert client.get("/api/v1/app-builds/99999").status_code == 404


def test_api_project_analysis_uses_real_search_function(monkeypatch):
    monkeypatch.setattr(literature, "search_all", lambda q, n: {"papers": PAPERS, "errors": []})
    pid = client.post("/api/v1/studio/projects", json={"kind": "project", "name": "Prediksi DO", "topic": "student dropout"}).json()["id"]
    a = client.post(f"/api/v1/studio/projects/{pid}/analyze").json()
    assert a["facts"]["papers_found"] == 3 and a["matrix"]
    assert client.get(f"/api/v1/studio/projects/{pid}").json()["data"]["analysis"]["facts"]["papers_found"] == 3
