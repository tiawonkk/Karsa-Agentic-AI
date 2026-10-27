"""Bluetooth OSD data is what Windows reports: adapters are dropped and a missing battery is None, never an estimate."""
import json

from backend.core.os_bridge import parse_bluetooth_json


def test_real_battery_is_kept_and_adapters_are_dropped():
    out = json.dumps(
        [
            {"FriendlyName": "AirBuds Pro", "Battery": 82},
            {"FriendlyName": "Microsoft Bluetooth Enumerator", "Battery": None},
            {"FriendlyName": "Intel(R) Wireless Bluetooth(R)", "Battery": None},
            {"FriendlyName": "AirBuds Pro", "Battery": 82},  # duplicate PnP entry
        ]
    )
    devices = parse_bluetooth_json(out)
    assert devices == [{"name": "AirBuds Pro", "connected": True, "battery_percent": 82}]


def test_missing_or_invalid_battery_is_none_not_a_made_up_number():
    devices = parse_bluetooth_json(json.dumps({"FriendlyName": "Speaker X", "Battery": None}))
    assert devices[0]["battery_percent"] is None
    assert parse_bluetooth_json(json.dumps({"FriendlyName": "Speaker X", "Battery": 250}))[0]["battery_percent"] is None


def test_garbage_and_empty_output():
    assert parse_bluetooth_json("") == []
    assert parse_bluetooth_json("not json") == []
