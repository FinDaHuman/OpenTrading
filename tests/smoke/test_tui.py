import pytest

from opentrading.interfaces.tui.app import OpenTradingTui


@pytest.mark.asyncio
async def test_tui_opens_and_quits() -> None:
    app = OpenTradingTui()
    async with app.run_test() as pilot:
        assert "specified but not implemented" in app.screen.query_one("#status").renderable
        await pilot.press("q")
