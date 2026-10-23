import os
import tempfile
from pathlib import Path
import pytest

from backend.orchestrator.directive_parser import (
    parse_directive,
    scan_workspace_comments,
    ParsedDirective,
)
from backend.core.database import initialize_master_database


@pytest.fixture(autouse=True)
def setup_test_db():
    initialize_master_database()


def test_parse_money_expense_directive():
    d = parse_directive("@Money -35k makan siang nasi padang")
    assert d.is_directive is True
    assert d.command == "money"
    assert d.action == "log_expense"
    assert d.target_module == "finance"
    assert "Pengeluaran Dicatat" in (d.execution_result or "")
    assert "35.000" in (d.execution_result or "")


def test_parse_money_report_directive():
    d = parse_directive("@Money laporan")
    assert d.is_directive is True
    assert d.command == "money"
    assert d.action == "report"
    assert "Daily Safe Spend" in (d.execution_result or "")


def test_parse_todo_directive():
    d = parse_directive("@Todo kumpul laporan praktikum fisika besok sore")
    assert d.is_directive is True
    assert d.command == "todo"
    assert d.action == "create_task"
    assert d.target_module == "study_daily"
    assert "Eisenhower Matrix" in (d.execution_result or "")


def test_parse_course_directive():
    d = parse_directive("@Course belajar prompt engineering")
    assert d.is_directive is True
    assert d.command == "course"
    assert d.action == "skill_roadmap"
    assert "Roadmap Belajar 4 Minggu" in (d.execution_result or "")


def test_parse_search_directive():
    d = parse_directive("@Search paper agentic workflow langgraph")
    assert d.is_directive is True
    assert d.command == "search"
    assert d.action == "search_academic"
    assert d.target_module == "research"


def test_scan_workspace_comments():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "sample_code.py"
        test_file.write_text(
            "# @Search carikan optimasi sorting ini\n"
            "def bubble_sort(arr):\n"
            "    return sorted(arr)\n",
            encoding="utf-8",
        )

        findings = scan_workspace_comments(tmpdir)
        assert len(findings) == 1
        assert findings[0]["command"] == "@Search"
        assert findings[0]["target_module"] == "research"
        assert "carikan optimasi sorting ini" in findings[0]["argument"]
