"""Modular plugins architecture for Project Karsa."""

from backend.modules.finance import finance_module
from backend.modules.study_daily import study_daily_module
from backend.modules.research_writer import research_module, writer_module
from backend.modules.datascience_code import datascience_code_module

__all__ = [
    "finance_module",
    "study_daily_module",
    "research_module",
    "writer_module",
    "datascience_code_module",
]
