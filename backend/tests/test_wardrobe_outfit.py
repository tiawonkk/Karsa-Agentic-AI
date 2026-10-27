from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)
PNG = "data:image/png;base64,iVBORw0KGgo="


def item(kind="crown", **kw):
    base = {"id": "a1", "kind": kind, "x": 0, "y": -0.9, "s": 1, "rot": 0, "color": "#FFC93C"}
    base.update(kw)
    return base


def test_empty_outfit_by_default_and_roundtrip():
    first = client.get("/api/v1/wardrobe/outfit").json()
    assert first["items"] == [] and "crown" in first["presets"]
    items = [item("crown"), item("glasses", id="a2", y=-0.02), item("custom", id="a3", src=PNG)]
    assert client.put("/api/v1/wardrobe/outfit", json={"items": items}).status_code == 200
    assert client.get("/api/v1/wardrobe/outfit").json()["items"][1]["kind"] == "glasses"
    assert client.put("/api/v1/wardrobe/outfit", json={"items": []}).json()["items"] == []  # take everything off


def test_bad_outfits_are_rejected():
    put = lambda items: client.put("/api/v1/wardrobe/outfit", json={"items": items}).status_code
    assert put([item("laser_cannon")]) == 422  # unknown kind
    assert put([item("custom")]) == 422  # drawing without an image
    assert put([item("custom", src="data:text/html;base64,PHNjcmlwdD4=")]) == 422  # only PNG
    assert put([item("crown", src=PNG)]) == 422  # presets carry no image
    assert put([item("crown", s=9)]) == 422 and put([item("crown", x=99)]) == 422
    assert put([item("crown", color="red")]) == 422
    assert put([item("crown", id=str(i)) for i in range(9)]) == 422  # at most 8
    assert put([item("custom", id=str(i), src=PNG) for i in range(4)]) == 422  # at most 3 drawings
