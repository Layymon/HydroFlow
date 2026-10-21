from datetime import date, timedelta

import pytest

from app.services import live_features


@pytest.mark.asyncio
async def test_historical_timeline_uses_catalog_without_reanalysis(monkeypatch) -> None:
    calls = {"reanalysis": 0}

    async def fail_reanalysis(*_args, **_kwargs):
        calls["reanalysis"] += 1
        raise AssertionError("reanalysis should not run when catalog covers the window")

    monkeypatch.setattr(live_features, "_fetch_reanalysis_window", fail_reanalysis)
    window_start = date(2023, 8, 1)
    window_end = date(2023, 8, 14)
    rows = await live_features.observations_for_timeline(
        "bago",
        17.335,
        96.481,
        window_start,
        window_end,
        catalog_township_id="bago",
    )
    assert calls["reanalysis"] == 0
    assert rows
    context_start = window_start - timedelta(days=live_features.CONTEXT_DAYS)
    assert min(row["date"] for row in rows) <= context_start
