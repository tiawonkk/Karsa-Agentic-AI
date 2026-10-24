"""Supervisor routing quality gate: labelled Indonesian utterances -> expected module, measured offline (0 tokens).

Covers Tier 0 (@Directive) and Tier A (regex). Anything that falls through to the LLM triage (None) counts as a miss
here, so the accuracy below is a lower bound of the real routing accuracy.
"""
import time

from backend.orchestrator.directive_parser import parse_directive
from backend.orchestrator.supervisor import match_deterministic_intent

ENABLED = ["finance", "study_daily", "research", "writer", "datascience_code"]

CASES = [
    # directives (Tier 0)
    ("@Money -25k makan siang", "finance"),
    ("@Todo laporan kimia besok", "study_daily"),
    ("@Study rangkum catatan.pdf", "study_daily"),
    ("@Course python dasar", "study_daily"),
    ("@Search transformer untuk klasifikasi teks", "research"),
    ("@Write draft imrad klasifikasi sentimen", "writer"),
    ("@Data profil dataset nilai.csv", "datascience_code"),
    ("@Code periksa file main.py", "datascience_code"),
    # natural language (Tier A)
    ("jajan kopi 15rb", "finance"),
    ("beli buku 85 ribu", "finance"),
    ("cek saldo uang saya", "finance"),
    ("boleh invest reksadana gak", "finance"),
    ("ubah modal bulanan jadi 2jt", "finance"),
    ("daily safe spend hari ini berapa", "finance"),
    ("tugas fisika deadline besok", "study_daily"),
    ("ada ujian uts minggu depan", "study_daily"),
    ("buatkan roadmap belajar data science", "study_daily"),
    ("rangkum materi kuliah ini", "study_daily"),
    ("cari paper arxiv tentang graph neural network", "research"),
    ("tinjauan pustaka metodologi penelitian", "research"),
    ("jurnal ilmiah terbaru soal federated learning", "research"),
    ("susun draft paper imrad tentang agentic ai", "writer"),
    ("kompilasi ke docx dokumen word", "writer"),
    ("bantu karya ilmiah kerangka skripsi", "writer"),
    ("profil dataset csv pandas", "datascience_code"),
    ("cek kolom kosong di file xlsx", "datascience_code"),
    ("perbaiki bug python di script ini", "datascience_code"),
    ("terapkan patch kode di file ini", "datascience_code"),
]


def route(text: str) -> str | None:
    d = parse_directive(text)
    if d.is_directive and d.target_module in ENABLED:
        return d.target_module
    return match_deterministic_intent(text, ENABLED)


def test_routing_accuracy_and_latency():
    t0 = time.perf_counter()
    wrong = [(t, want, route(t)) for t, want in CASES if route(t) != want]
    avg_ms = (time.perf_counter() - t0) * 1000 / (2 * len(CASES))
    accuracy = 1 - len(wrong) / len(CASES)
    assert accuracy >= 0.95, f"routing accuracy {accuracy:.0%}; misroutes: {wrong}"
    assert avg_ms < 2000
