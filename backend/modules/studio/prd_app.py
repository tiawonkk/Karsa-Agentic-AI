"""PRD-to-App engine: PRD -> plan -> (human approval) -> files -> build/test -> self-correction (max 3 fixes).

Safety, in order of importance:
1. Nothing is written or run before the user approved the exact plan (files + commands). The approval is recorded in the
   `hitl_approvals` audit table with a fingerprint of the plan; a changed plan needs a new approval.
2. Files go only inside the chosen target folder (relative paths, no `..`, no secrets, limited extensions and size).
3. Only a fixed set of verification commands can run (no shell): python -m pytest/py_compile/compileall/unittest,
   node --check, npm install/ci/test/run build/run lint.
Without a model the engine writes an honest static skeleton from the PRD headings instead of pretending to be smart.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable

from backend.core.config import settings
from backend.core.llm_helpers import LLMFn, parse_json_loose
from backend.core.state import ApprovalRequest
from backend.modules.studio import store
from backend.modules.studio.store import StudioError
from backend.orchestrator import hitl_gate

MARKER = ".karsa_build"
MAX_FILES = 40
MAX_FILE_BYTES = 200_000
MAX_FIX_ITERATIONS = 3
ALLOWED_EXTS = {".html", ".css", ".js", ".mjs", ".jsx", ".ts", ".tsx", ".json", ".md", ".txt", ".py", ".sql", ".yml", ".yaml", ".toml", ".svg", ".env.example"}
SECRET_NAMES = {".env", ".env.local", "id_rsa", "id_ed25519", "credentials.json", "secrets.json"}
_ARG_RE = re.compile(r"^[\w./\\:\-=@]+$")
FORBIDDEN_ROOTS = ("windows", "program files", "program files (x86)", "programdata", "system32")

Runner = Callable[[list[str], Path, int], dict[str, Any]]
_locks: dict[int, threading.Lock] = {}


# ---------------------------------------------------------------------------------------------------- validation
def validate_target(path: str) -> Path:
    """Where the app is built. Must be an absolute folder that is new, empty, or an earlier Karsa build."""
    if not path or not str(path).strip():
        raise StudioError("Folder tujuan belum diisi.")
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise StudioError("Folder tujuan harus berupa path lengkap (mis. D:\\Proyek\\TokoKu).")
    p = p.resolve()
    if p.parent == p:
        raise StudioError("Folder tujuan tidak boleh berupa root drive.")
    if len(p.parts) > 1 and p.parts[1].lower() in FORBIDDEN_ROOTS:  # first folder under the drive root, e.g. C:\Windows
        raise StudioError("Folder sistem tidak boleh dipakai sebagai tujuan.")
    repo_root = Path(__file__).resolve().parents[3]
    for protected in (repo_root, settings.data_dir.resolve()):
        if p == protected or protected in p.parents:
            raise StudioError("Pilih folder di luar proyek Karsa dan folder data Karsa.")
    if p.exists():
        if not p.is_dir():
            raise StudioError("Tujuan harus berupa folder.")
        if any(p.iterdir()) and not (p / MARKER).exists():
            raise StudioError("Folder tujuan sudah berisi file lain. Pilih folder kosong atau folder baru.")
    return p


def safe_rel_path(rel: str) -> str:
    r = str(rel or "").replace("\\", "/").strip()
    if r.startswith("./"):
        r = r[2:]
    parts = r.split("/")
    if not r or r.startswith("/") or re.match(r"^[A-Za-z]:", r) or ".." in parts or any(not x or x.startswith(".git") for x in parts):
        raise StudioError(f"Path file tidak aman: {rel!r}")
    name = parts[-1].lower()
    if name in SECRET_NAMES:
        raise StudioError(f"File rahasia tidak boleh dibuat: {rel}")
    suffix = Path(name).suffix
    if suffix not in ALLOWED_EXTS and not name.endswith(".env.example"):
        raise StudioError(f"Jenis file belum diizinkan: {rel}")
    return r


def validate_command(cmd: list[str]) -> list[str]:
    """One of the fixed verification command shapes, or an error. Returns the clean argument list."""
    if not isinstance(cmd, list) or not cmd or not all(isinstance(x, str) and _ARG_RE.match(x) for x in cmd):
        raise StudioError(f"Perintah tidak valid: {cmd!r}")
    prog, args = cmd[0].lower(), cmd[1:]
    ok = (
        (prog == "python" and len(args) >= 2 and args[0] == "-m" and args[1] in {"pytest", "py_compile", "compileall", "unittest"})
        or (prog == "node" and len(args) == 2 and args[0] == "--check")
        or (prog == "npm" and args in (["install"], ["ci"], ["test"], ["run", "build"], ["run", "lint"]))
    )
    if not ok:
        raise StudioError(f"Perintah tidak diizinkan: {' '.join(cmd)}")
    for a in args:
        if a.startswith("..") or a.startswith("/") or re.match(r"^[A-Za-z]:", a):
            raise StudioError(f"Argumen di luar folder proyek: {a}")
    return cmd


def sanitize_plan(raw: dict[str, Any]) -> dict[str, Any]:
    files, seen = [], set()
    for f in (raw.get("files") or [])[:MAX_FILES]:
        if not isinstance(f, dict):
            continue
        path = safe_rel_path(f.get("path"))
        if path not in seen:
            seen.add(path)
            files.append({"path": path, "purpose": str(f.get("purpose", ""))[:200]})
    if not files:
        raise StudioError("Rencana tidak berisi file.")
    verify = [validate_command([str(x) for x in c]) for c in ((raw.get("commands") or {}).get("verify") or [])][:6]
    tasks = []
    for i, t in enumerate(raw.get("tasks") or [], 1):
        if isinstance(t, dict):
            tasks.append({"id": i, "title": str(t.get("title", ""))[:160], "files": [str(x) for x in (t.get("files") or [])][:10]})
    return {
        "summary": str(raw.get("summary", ""))[:600],
        "stack": str(raw.get("stack", ""))[:160],
        "folders": sorted({"/".join(f["path"].split("/")[:-1]) for f in files if "/" in f["path"]}),
        "files": files,
        "tasks": tasks,
        "commands": {"verify": verify},
    }


def plan_fingerprint(plan: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(plan, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:24]


# ---------------------------------------------------------------------------------------------------- PRD parsing
def prd_title(prd: str, fallback: str) -> str:
    m = re.search(r"^#\s+(?:PRD:?\s*)?(.+)$", prd, re.M)
    return (m.group(1).strip() if m else fallback)[:80]


def prd_sections(prd: str) -> list[tuple[str, list[str]]]:
    """[(heading, [bullet or line, ...])] from a markdown-ish PRD."""
    out: list[tuple[str, list[str]]] = []
    for line in prd.splitlines():
        s = line.strip()
        if not s or re.match(r"^#\s", s):
            continue
        h = re.match(r"^#{2,4}\s+(.*)$", s)
        if h:
            out.append((h.group(1).strip(), []))
        elif out:
            out[-1][1].append(re.sub(r"^[-*]\s+", "", s))
    return out


def fallback_plan(prd: str, name: str) -> dict[str, Any]:
    return sanitize_plan(
        {
            "summary": f"Kerangka website statis untuk '{prd_title(prd, name)}' dari judul bagian PRD (tanpa AI, perlu dikembangkan).",
            "stack": "HTML + CSS + JavaScript statis",
            "files": [
                {"path": "index.html", "purpose": "Halaman utama dengan satu bagian per judul PRD"},
                {"path": "style.css", "purpose": "Tampilan"},
                {"path": "app.js", "purpose": "Interaksi dasar"},
                {"path": "README.md", "purpose": "Cara membuka dan langkah berikutnya"},
            ],
            "tasks": [{"title": "Buat kerangka halaman dari PRD", "files": ["index.html", "style.css", "app.js", "README.md"]}],
            "commands": {"verify": [["node", "--check", "app.js"]]},
        }
    )


def fallback_content(path: str, prd: str, name: str) -> str:
    title = html.escape(prd_title(prd, name))
    secs = prd_sections(prd)
    if path == "index.html":
        body = "\n".join(
            f'    <section id="s{i}">\n      <h2>{html.escape(h)}</h2>\n      <ul>\n'
            + "\n".join(f"        <li>{html.escape(x)}</li>" for x in items[:12])
            + "\n      </ul>\n    </section>"
            for i, (h, items) in enumerate(secs[:10])
        ) or "    <section><p>PRD belum memiliki bagian berjudul (##).</p></section>"
        return (
            f'<!doctype html>\n<html lang="id">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n'
            f'  <title>{title}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <header><h1>{title}</h1></header>\n  <main>\n{body}\n  </main>\n'
            f'  <script src="app.js"></script>\n</body>\n</html>\n'
        )
    if path == "style.css":
        return "body{font-family:system-ui,sans-serif;margin:0;color:#1f2937;background:#f9fafb}header{padding:2rem;background:#111827;color:#fff}main{max-width:720px;margin:0 auto;padding:1rem}section{background:#fff;border-radius:12px;padding:1rem 1.25rem;margin:1rem 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}h2{margin-top:0}\n"
    if path == "app.js":
        return "document.querySelectorAll('section').forEach((s) => s.addEventListener('click', () => s.classList.toggle('open')));\n"
    if path == "README.md":
        return f"# {title}\n\nKerangka dasar yang dibuat Karsa dari PRD (tanpa AI). Buka `index.html` di browser.\n\nLangkah berikutnya: hubungkan model AI di Karsa lalu bangun ulang untuk mendapatkan implementasi penuh.\n"
    return ""


# ---------------------------------------------------------------------------------------------------- planning
def make_plan(build_id: int, llm_fn: LLMFn | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    b = store.get_build(build_id, db_path)
    if b["status"] in ("approved", "building"):
        raise StudioError("Build sedang berjalan atau sudah disetujui; buat build baru untuk rencana baru.", "conflict")
    plan: dict[str, Any] | None = None
    note = ""
    if llm_fn:
        try:
            raw = llm_fn(
                "Kamu System Architect. Dari PRD, susun rencana implementasi aplikasi kecil yang bisa dibangun dan diverifikasi otomatis. "
                f"Balas HANYA JSON: {{summary, stack, files:[{{path,purpose}}] (maks {MAX_FILES}, path relatif), tasks:[{{title,files}}], "
                'commands:{verify:[[...],...]} }. Perintah verifikasi hanya boleh: ["python","-m","pytest"|"py_compile"|"compileall"|"unittest",...], '
                '["node","--check","<file.js>"], ["npm","install"|"ci"|"test"], ["npm","run","build"|"lint"]. Pilih tumpukan paling sederhana yang memenuhi PRD.',
                b["prd"],
            )
            plan = sanitize_plan(parse_json_loose(raw))
        except Exception as e:
            note = f"Rencana AI ditolak ({str(e)[:140]}); memakai kerangka dasar."
    if plan is None:
        plan = fallback_plan(b["prd"], b["name"])
        note = note or "Belum ada model AI: memakai kerangka dasar."
    plan["used_llm"] = bool(llm_fn) and not note
    plan["note"] = note
    plan["fingerprint"] = plan_fingerprint({k: v for k, v in plan.items() if k not in ("fingerprint", "note", "used_llm")})
    return store.save_build(build_id, status="planned", plan=plan, log_entry={"step": "plan", "ok": True, "detail": note or "Rencana dibuat oleh AI."}, db_path=db_path)


def _action_id(build_id: int, fp: str) -> str:
    return f"build-{build_id}-{fp}"


def approve_plan(build_id: int, reviewer: str = "pengguna", db_path: Path | str | None = None) -> dict[str, Any]:
    """The user approved the plan as shown: record it in the audit table. Returns the build with its action id."""
    b = store.get_build(build_id, db_path)
    if b["status"] != "planned":
        raise StudioError("Hanya rencana yang menunggu persetujuan yang bisa disetujui.", "conflict")
    target = validate_target(b["target_dir"])
    plan = b["plan"]
    fp = plan["fingerprint"]
    aid = _action_id(build_id, fp)
    req = ApprovalRequest(
        action_id=aid,
        module="datascience_code",
        action_name="build_app_from_prd",
        risk_level="high",
        summary=f"Membuat {len(plan['files'])} file di {target} dan menjalankan {len(plan['commands']['verify'])} perintah verifikasi",
        preview="\n".join(f["path"] for f in plan["files"]),
        proposed_args={"build_id": build_id, "target_dir": str(target), "files": [f["path"] for f in plan["files"]], "commands": plan["commands"]["verify"]},
        created_at=hitl_gate._iso(hitl_gate._utc_now()),
        evidence={"fingerprint": fp},
    )
    hitl_gate.log_pending_approval(req, f"studio-build-{build_id}", db_path, fingerprint=fp)
    hitl_gate.update_approval_decision(aid, "approve", db_path=db_path, reviewer_id=reviewer, reason="Rencana build disetujui di Studio")
    return store.save_build(build_id, status="approved", log_entry={"step": "approve", "ok": True, "detail": f"Disetujui oleh {reviewer} ({fp})"}, db_path=db_path)


def reject_plan(build_id: int, db_path: Path | str | None = None) -> dict[str, Any]:
    b = store.get_build(build_id, db_path)
    if b["status"] not in ("planned", "approved"):
        raise StudioError("Build ini tidak bisa dibatalkan.", "conflict")
    return store.save_build(build_id, status="draft", log_entry={"step": "reject", "ok": True, "detail": "Rencana ditolak pengguna; tidak ada file yang ditulis."}, db_path=db_path)


# ---------------------------------------------------------------------------------------------------- execution
def default_runner(cmd: list[str], cwd: Path, timeout: int = 180) -> dict[str, Any]:
    exe = shutil.which(cmd[0])
    if not exe:
        return {"returncode": 127, "output": f"'{cmd[0]}' tidak terpasang di komputer ini.", "missing": True}
    try:
        p = subprocess.run([exe, *cmd[1:]], cwd=str(cwd), capture_output=True, text=True, timeout=timeout, shell=False)
        return {"returncode": p.returncode, "output": ((p.stdout or "") + (p.stderr or ""))[-3000:]}
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "output": f"Dibatalkan: melebihi {timeout} detik."}


def _strip_fence(text: str) -> str:
    m = re.search(r"```[\w+-]*\n(.*?)```", text, re.DOTALL)
    return (m.group(1) if m else text).strip("\n") + "\n"


def write_file(root: Path, rel: str, content: str) -> None:
    rel = safe_rel_path(rel)
    data = content.encode("utf-8")
    if len(data) > MAX_FILE_BYTES:
        raise StudioError(f"File {rel} terlalu besar (maks 200 KB).")
    target = (root / rel).resolve()
    if root.resolve() not in target.parents:
        raise StudioError(f"Path keluar dari folder proyek: {rel}")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        bak = target.with_name(target.name + ".bak")
        if not bak.exists():
            bak.write_bytes(target.read_bytes())
    target.write_bytes(data)


def _generate_file(f: dict[str, Any], plan: dict[str, Any], b: dict[str, Any], written: dict[str, str], llm_fn: LLMFn | None) -> str:
    if not llm_fn:
        content = fallback_content(f["path"], b["prd"], b["name"])
        if not content:
            raise StudioError(f"Tanpa AI hanya kerangka dasar yang bisa dibuat; {f['path']} butuh model.")
        return content
    context = "\n".join(f"- {p}: {len(c)} karakter" for p, c in written.items()) or "(belum ada)"
    reply = llm_fn(
        "Kamu Software Engineer. Tulis ISI LENGKAP SATU file yang diminta, siap dijalankan, sesuai PRD dan rencana. Balas hanya isi file "
        "(boleh dalam satu blok kode), tanpa penjelasan. Jangan membuat placeholder TODO; jangan menaruh rahasia/kunci.",
        f"PRD:\n{b['prd'][:6000]}\n\nRencana: {plan.get('summary', '')} (tumpukan: {plan.get('stack', '')})\n"
        f"Semua file: {', '.join(x['path'] for x in plan['files'])}\nFile yang sudah ditulis:\n{context}\n\nTulis file: {f['path']}\nTujuan: {f['purpose']}",
    )
    return _strip_fence(reply)


def _fix(plan: dict[str, Any], failure: str, written: dict[str, str], llm_fn: LLMFn) -> dict[str, str]:
    allowed = {f["path"] for f in plan["files"]}
    snapshot = "\n\n".join(f"### {p}\n{c[:3500]}" for p, c in written.items())[:14000]
    raw = llm_fn(
        "Kamu Software Engineer. Build/tes gagal. Perbaiki penyebabnya. Balas HANYA JSON {\"files\":[{\"path\":...,\"content\":...}]} berisi file yang berubah "
        "(isi lengkap). Hanya ubah file yang sudah ada di daftar atau tambah file kecil yang benar-benar perlu.",
        f"Error:\n{failure[-2500:]}\n\nFile saat ini:\n{snapshot}",
    )
    data = parse_json_loose(raw)
    out: dict[str, str] = {}
    for item in (data.get("files") if isinstance(data, dict) else data) or []:
        if isinstance(item, dict) and item.get("path") and isinstance(item.get("content"), str):
            rel = safe_rel_path(item["path"])
            if rel in allowed or len(allowed) + len(out) < MAX_FILES:
                out[rel] = item["content"]
    return out


def run_build(build_id: int, llm_fn: LLMFn | None = None, runner: Runner | None = None, db_path: Path | str | None = None) -> dict[str, Any]:
    """Write the approved plan's files and verify them, fixing failures up to MAX_FIX_ITERATIONS times. Safe to call once per approval."""
    lock = _locks.setdefault(build_id, threading.Lock())
    if not lock.acquire(blocking=False):
        raise StudioError("Build ini sedang berjalan.", "conflict")
    try:
        b = store.get_build(build_id, db_path)
        if b["status"] != "approved":
            raise StudioError("Rencana belum disetujui.", "conflict")
        plan = b["plan"]
        root = validate_target(b["target_dir"])
        run = runner or default_runner

        def log(step: str, ok: bool, detail: str) -> None:
            store.save_build(build_id, log_entry={"step": step, "ok": ok, "detail": detail[:900]}, db_path=db_path)

        def work() -> dict[str, Any]:
            store.save_build(build_id, status="building", db_path=db_path)
            root.mkdir(parents=True, exist_ok=True)
            (root / MARKER).write_text(f"karsa build {build_id}\n", encoding="utf-8")
            written: dict[str, str] = {}
            for f in plan["files"]:
                content = _generate_file(f, plan, b, written, llm_fn)
                write_file(root, f["path"], content)
                written[f["path"]] = content
                log("write", True, f["path"])
            commands = plan["commands"]["verify"]
            last_fail = ""
            for attempt in range(MAX_FIX_ITERATIONS + 1):
                failures = []
                for cmd in commands:
                    res = run(validate_command(cmd), root, 180)
                    if res["returncode"] != 0:
                        failures.append(f"$ {' '.join(cmd)}\n{res['output']}")
                        if res.get("missing"):
                            break
                if not failures:
                    log("verify", True, f"Semua {len(commands)} perintah verifikasi lulus" + (f" setelah {attempt} perbaikan" if attempt else "") if commands else "Tidak ada perintah verifikasi pada rencana ini.")
                    return {"ok": True, "fixes": attempt}
                last_fail = "\n\n".join(failures)
                log("verify", False, last_fail)
                if attempt == MAX_FIX_ITERATIONS or not llm_fn:
                    break
                changed = _fix(plan, last_fail, written, llm_fn)
                if not changed:
                    log("fix", False, "AI tidak menghasilkan perbaikan.")
                    break
                for rel, content in changed.items():
                    write_file(root, rel, _strip_fence(content) if "```" in content else content)
                    written[rel] = content
                log("fix", True, f"Perbaikan {attempt + 1}: {', '.join(changed)}")
            return {"ok": False, "fixes": MAX_FIX_ITERATIONS, "error": last_fail}

        out = hitl_gate.execute_approved(_action_id(build_id, plan["fingerprint"]), work, current_fingerprint=plan["fingerprint"], db_path=db_path)
        if not out["ran"]:
            if out["reason"] == "failed":
                store.save_build(build_id, status="failed", log_entry={"step": "error", "ok": False, "detail": str(out["error"])[:600]}, db_path=db_path)
            else:
                raise StudioError(f"Build tidak dijalankan ({out['reason']}). Setujui rencana lagi bila perlu.", "conflict")
        else:
            res = out["result"]
            store.save_build(build_id, status="done" if res["ok"] else "failed", db_path=db_path)
        return store.get_build(build_id, db_path)
    finally:
        lock.release()
