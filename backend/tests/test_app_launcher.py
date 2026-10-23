"""
Unit tests for Native Windows App Indexer & Launcher.
"""

from unittest.mock import patch, MagicMock
from backend.core.app_launcher import WindowsAppIndexer


def test_app_indexer_search():
    indexer = WindowsAppIndexer()
    indexer._apps = [
        {"name": "Visual Studio Code", "target_path": "code.exe", "category": "development"},
        {"name": "Google Chrome", "target_path": "chrome.exe", "category": "browser"},
        {"name": "Spotify", "target_path": "spotify.exe", "category": "media"},
    ]
    indexer._indexed = True

    results = indexer.search("code")
    assert len(results) >= 1
    assert results[0]["name"] == "Visual Studio Code"

    results_empty = indexer.search("")
    assert len(results_empty) == 3


def test_app_indexer_launch_mocked():
    indexer = WindowsAppIndexer()
    with patch("os.startfile", create=True) as mock_start:
        with patch("os.path.exists", return_value=True):
            res = indexer.launch("C:/Program Files/test.lnk")
            assert res["status"] == "launched"
