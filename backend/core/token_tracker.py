from __future__ import annotations

import time
from pathlib import Path
from typing import Any
from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

from backend.core.config import settings
from backend.core.database import get_db_cursor

# Approximate Pricing per 1 Million Tokens (USD)
# (Local Ollama is always 0.0 USD)
MODEL_PRICING_USD_PER_1M: dict[str, tuple[float, float]] = {
    "gemini-3.8-flash": (0.10, 0.40),
    "gemini-2.0-flash": (0.10, 0.40),
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini-2.0-pro": (1.25, 5.00),
    "gemini-1.5-pro": (1.25, 5.00),
    "claude-3-5-sonnet": (3.00, 15.00),
    "claude-3-5-haiku": (0.80, 4.00),
    "gpt-4o": (2.50, 10.00),
    "gpt-4o-mini": (0.15, 0.60),
    "groq": (0.05, 0.08),
}


def calculate_cost_idr(
    provider: str,
    model_name: str,
    tokens_in: int,
    tokens_out: int,
    usd_to_idr_rate: float | None = None,
) -> float:
    """Calculate estimated cost in Indonesian Rupiah (IDR).
    
    Local models (Ollama) always incur Rp0 cost.
    """
    if provider.lower() == "ollama":
        return 0.0

    rate = usd_to_idr_rate or settings.usd_to_idr_rate
    matched_pricing = (0.10, 0.40)  # Default fallback pricing

    model_lower = model_name.lower()
    for pattern, prices in MODEL_PRICING_USD_PER_1M.items():
        if pattern in model_lower:
            matched_pricing = prices
            break

    in_price_usd = (tokens_in / 1_000_000.0) * matched_pricing[0]
    out_price_usd = (tokens_out / 1_000_000.0) * matched_pricing[1]
    total_usd = in_price_usd + out_price_usd
    return round(total_usd * rate, 4)


def record_token_log(
    module: str,
    provider: str,
    model_used: str,
    tokens_in: int,
    tokens_out: int,
    hardware_mode: str = "eco_cpu",
    session_thread_id: str | None = None,
    latency_ms: int | None = None,
    cost_idr: float | None = None,
    db_path: Path | str | None = None,
) -> int:
    """Insert a record into the token_logs table and return the inserted row id."""
    calculated_cost = (
        cost_idr
        if cost_idr is not None
        else calculate_cost_idr(provider, model_used, tokens_in, tokens_out)
    )

    with get_db_cursor(db_path) as cursor:
        cursor.execute(
            """
            INSERT INTO token_logs (
                session_thread_id, module, provider, model_used, hardware_mode,
                tokens_in, tokens_out, latency_ms, estimated_cost_idr
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            (
                session_thread_id,
                module,
                provider,
                model_used,
                hardware_mode,
                tokens_in,
                tokens_out,
                latency_ms,
                calculated_cost,
            ),
        )
        return int(cursor.lastrowid or 0)


def get_token_usage_summary(
    start_date: str | None = None,
    end_date: str | None = None,
    module: str | None = None,
    db_path: Path | str | None = None,
) -> dict[str, Any]:
    """Query aggregated token usage and IDR cost from database."""
    query = """
        SELECT
            COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
            COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
            COALESCE(SUM(tokens_in + tokens_out), 0) AS grand_total_tokens,
            COALESCE(SUM(estimated_cost_idr), 0.0) AS total_cost_idr,
            COUNT(id) AS call_count
        FROM token_logs
        WHERE 1=1
    """
    params: list[Any] = []

    if start_date:
        query += " AND timestamp >= ?"
        params.append(start_date)
    if end_date:
        query += " AND timestamp <= ?"
        params.append(end_date)
    if module:
        query += " AND module = ?"
        params.append(module)

    with get_db_cursor(db_path) as cursor:
        cursor.execute(query, params)
        row = cursor.fetchone()
        if not row:
            return {
                "total_tokens_in": 0,
                "total_tokens_out": 0,
                "grand_total_tokens": 0,
                "total_cost_idr": 0.0,
                "call_count": 0,
            }
        return {
            "total_tokens_in": int(row["total_tokens_in"]),
            "total_tokens_out": int(row["total_tokens_out"]),
            "grand_total_tokens": int(row["grand_total_tokens"]),
            "total_cost_idr": round(float(row["total_cost_idr"]), 2),
            "call_count": int(row["call_count"]),
        }


class TokenTrackerCallbackHandler(BaseCallbackHandler):
    """LangChain CallbackHandler to intercept LLM usage metadata and log to token_logs."""

    def __init__(
        self,
        module_name: str,
        provider: str,
        model_name: str,
        hardware_mode: str = "eco_cpu",
        session_thread_id: str | None = None,
        db_path: Path | str | None = None,
    ):
        super().__init__()
        self.module_name = module_name
        self.provider = provider
        self.model_name = model_name
        self.hardware_mode = hardware_mode
        self.session_thread_id = session_thread_id
        self.db_path = db_path
        self._start_time: float = 0.0

    def on_llm_start(
        self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any
    ) -> None:
        self._start_time = time.perf_counter()

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        latency_ms = int((time.perf_counter() - self._start_time) * 1000)
        tokens_in = 0
        tokens_out = 0

        # Try to extract usage from llm_output or generation message
        if response.llm_output and "token_usage" in response.llm_output:
            usage = response.llm_output["token_usage"]
            tokens_in = usage.get("prompt_tokens", 0)
            tokens_out = usage.get("completion_tokens", 0)
        elif response.generations:
            for gen_list in response.generations:
                for gen in gen_list:
                    msg = getattr(gen, "message", None)
                    if msg and hasattr(msg, "usage_metadata") and msg.usage_metadata:
                        tokens_in += msg.usage_metadata.get("input_tokens", 0)
                        tokens_out += msg.usage_metadata.get("output_tokens", 0)

        record_token_log(
            module=self.module_name,
            provider=self.provider,
            model_used=self.model_name,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            hardware_mode=self.hardware_mode,
            session_thread_id=self.session_thread_id,
            latency_ms=latency_ms,
            db_path=self.db_path,
        )
