"""Monthly finance report + exports, and the RSS news reader (no network: feeds are injected)."""
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.modules.finance import news, reports
from backend.modules.finance.ledger import add_expense, add_income

client = TestClient(app)
PERIOD = "2026-03"


def seed():
    from backend.modules.finance.tools import get_or_create_monthly_budget

    get_or_create_monthly_budget(period=PERIOD)  # default capital: Rp 2.000.000
    add_expense(25_000, "makanan", description="makan siang", merchant="Warung", txn_date=f"{PERIOD}-02")
    add_expense(300_000, "pelajaran", description="buku", merchant="Toko Buku", txn_date=f"{PERIOD}-05")
    add_expense(80_000, "kesenangan", description="film", merchant="Bioskop", txn_date=f"{PERIOD}-05")
    add_income(500_000, "Uang saku", txn_date=f"{PERIOD}-01")


def test_report_numbers_come_from_the_ledger():
    seed()
    r = reports.monthly_report(PERIOD)
    assert r["total_spent_idr"] == 405_000 and r["total_income_idr"] == 500_000
    assert r["saved_idr"] == 2_000_000 + 500_000 - 405_000
    assert r["saving_rate_pct"] == round((2_500_000 - 405_000) / 2_500_000 * 100, 1)
    cats = {c["category"]: c for c in r["categories"]}
    assert cats["pelajaran"]["spent"] == 300_000 and cats["pelajaran"]["share_pct"] == round(300_000 / 405_000 * 100, 1)
    assert [m["type"] for m in r["mutations"]][0] == "masuk"  # sorted by date: income on the 1st
    assert r["top_expenses"][0]["amount_idr"] == 300_000
    assert any("terbesar" in n for n in r["notes"])


def test_empty_month_is_honest_and_has_no_rate_division_error():
    r = reports.monthly_report("2030-01")
    assert r["total_spent_idr"] == 0 and r["mutations"] == []
    assert "Belum ada transaksi" in r["notes"][0]


def test_bad_period_is_rejected():
    assert client.get("/api/v1/finance/monthly-report?period=2026-13").status_code == 422
    assert client.get("/api/v1/finance/monthly-report?period=bulan-ini").status_code == 422


def test_exports_create_real_files_and_download():
    seed()
    for fmt in ("csv", "docx"):
        r = client.post("/api/v1/finance/monthly-report/export", json={"period": PERIOD, "format": fmt})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["rows"] == 4
        got = client.get(d["download_url"])
        assert got.status_code == 200 and len(got.content) > 50
        if fmt == "csv":
            text = got.content.decode("utf-8-sig")
            assert "tanggal,jenis,kategori" in text and "-300000" in text and "500000" in text
    assert client.post("/api/v1/finance/monthly-report/export", json={"format": "pdf"}).status_code == 422


RSS = """<?xml version="1.0"?><rss><channel>
<item><title>IHSG naik 1%</title><link>https://a.test/1</link><description>&lt;p&gt;Ringkas&lt;/p&gt;</description><pubDate>Mon</pubDate></item>
<item><title>Rupiah menguat</title><link>https://a.test/2</link><description>x</description></item>
<item><title>Tanpa link</title><link>javascript:alert(1)</link></item>
</channel></rss>"""


def test_rss_parsing_drops_unsafe_links_and_strips_html():
    items = news.parse_rss(RSS, "Tes")
    assert [i["title"] for i in items] == ["IHSG naik 1%", "Rupiah menguat"]
    assert items[0]["summary"] == "Ringkas"


def test_fetch_news_survives_one_broken_feed_and_reports_it():
    feeds = [{"source": "A", "url": "ok"}, {"source": "B", "url": "bad"}]

    def fetch(url):
        if url == "bad":
            raise RuntimeError("timeout")
        return RSS

    r = news.fetch_news(fetch=fetch, feeds=feeds)
    assert len(r["items"]) == 2 and r["errors"] == [{"source": "B", "error": "timeout"}]


def test_all_feeds_down_is_an_honest_error_not_invented_news():
    def fetch(url):
        raise RuntimeError("offline")

    try:
        news.fetch_news(fetch=fetch, feeds=[{"source": "A", "url": "x"}])
        assert False, "should raise"
    except news.NewsError as e:
        assert "offline" in str(e)


def test_summary_falls_back_to_headlines_without_a_model():
    items = news.parse_rss(RSS, "Tes")
    s = news.summarize_news(items, llm_fn=None)
    assert s["used_llm"] is False and "IHSG naik 1%" in s["summary"]
    s2 = news.summarize_news(items, llm_fn=lambda sys, usr: "- Pasar naik")
    assert s2["used_llm"] is True and s2["summary"] == "- Pasar naik"
    s3 = news.summarize_news(items, llm_fn=lambda sys, usr: (_ for _ in ()).throw(RuntimeError("x")))
    assert s3["used_llm"] is False
