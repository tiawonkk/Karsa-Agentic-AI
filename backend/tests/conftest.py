"""Every test runs against its own throw-away data directory.

Without this, tests that touch the default database (task roadmaps, token logs, ...) write into the developer's
real ~/.karsa/storage/karsa_master.db, which is how a user's Todo list ended up with dozens of duplicate rows.
Tests that need a specific location still override `settings.data_dir` themselves.
"""
import pytest

from backend.core.config import settings
from backend.core.database import initialize_master_database


@pytest.fixture(autouse=True)
def isolated_data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path / "karsa_data")
    initialize_master_database(settings.master_db_path)
