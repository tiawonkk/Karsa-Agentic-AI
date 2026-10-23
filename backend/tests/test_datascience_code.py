import sys
from pathlib import Path
import pandas as pd
import pytest
from langchain_core.messages import HumanMessage

from backend.core.database import initialize_master_database
from backend.core.config import settings
from backend.modules.base_module import ModuleContext
from backend.modules.datascience_code.tools import (
    profile_dataset_locally,
    clean_dataset_locally,
    execute_sandboxed_command,
)
from backend.modules.datascience_code.module import DataScienceCodeModule


def test_profile_dataset_locally(tmp_path: Path):
    # Create sample CSV dataset
    csv_file = tmp_path / "students.csv"
    data = {
        "id": [1, 2, 3, 3, 5],
        "nama": ["Budi", "Siti", "Andi", "Andi", "Dewi"],
        "nilai": [85.0, 92.5, 78.0, 78.0, 88.0],
        "catatan": ["hadir", "hadir", None, None, "hadir"],
    }
    df = pd.DataFrame(data)
    df.to_csv(csv_file, index=False)

    profile = profile_dataset_locally(csv_file)
    assert profile["rows"] == 5
    assert profile["columns_count"] == 4
    assert profile["total_missing_cells"] == 2
    assert profile["duplicate_rows"] == 1
    assert "nilai" in profile["numerical_statistics"]
    assert profile["numerical_statistics"]["nilai"]["count"] == 5.0


def test_clean_dataset_locally(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    csv_file = tmp_path / "dirty_data.csv"
    df = pd.DataFrame({
        "x": [10.0, 20.0, None, 10.0],
        "y": ["a", "b", "c", "a"],
    })
    df.to_csv(csv_file, index=False)

    res = clean_dataset_locally(csv_file, drop_duplicates=True, fill_na_strategy="mean")
    assert res["status"] == "success"
    assert res["duplicates_removed"] == 1
    assert res["initial_rows"] == 4
    assert res["final_rows"] == 3
    assert Path(res["cleaned_file"]).exists()


def test_execute_sandboxed_command():
    # Allowed command
    res = execute_sandboxed_command([sys.executable, "--version"])
    assert res["status"] == "success"
    assert res["returncode"] == 0

    # Disallowed command
    with pytest.raises(PermissionError):
        execute_sandboxed_command(["cmd.exe", "/c", "dir"])


def test_datascience_code_subgraph_flow(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    (tmp_path / "storage").mkdir(parents=True, exist_ok=True)
    initialize_master_database(settings.master_db_path)

    # Prepare dummy CSV
    csv_file = tmp_path / "research_data.csv"
    df = pd.DataFrame({"metric": [1, 2, 3], "value": [10.5, 20.1, 30.2]})
    df.to_csv(csv_file, index=False)

    mod = DataScienceCodeModule()
    ctx = ModuleContext(session_thread_id="test_ds_thread")
    graph = mod.build_graph(ctx)

    # 1. Profile dataset
    res1 = graph.invoke({
        "messages": [HumanMessage(content=f"profiling dataset '{csv_file}'")]
    })
    assert len(res1["messages"]) > 0
    content1 = str(res1["messages"][-1].content)
    assert "Hasil Profiling Dataset Lokal" in content1
    assert "Pandas Sandbox" in content1
    assert "3 baris" in content1

    # 2. Clean dataset
    res2 = graph.invoke({
        "messages": [HumanMessage(content=f"bersihkan dataset '{csv_file}'")]
    })
    content2 = str(res2["messages"][-1].content)
    assert "Dataset Berhasil Dibersihkan" in content2
    assert "Pandas" in content2

    # 3. Sandboxed terminal
    res3 = graph.invoke({
        "messages": [HumanMessage(content="jalankan pytest")]
    })
    content3 = str(res3["messages"][-1].content)
    assert "Hasil Eksekusi Sandbox Terminal" in content3
