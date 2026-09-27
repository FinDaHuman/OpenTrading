"""Read-only market-data gateway contract."""

from datetime import datetime
from typing import Protocol

from opentrading.domain import (
    CandleSeries,
    DataPage,
    MarketSnapshot,
    ModelSignal,
    NewsItem,
)


class MarketDataGateway(Protocol):
    async def market_snapshot(self, *, as_of: datetime | None = None) -> MarketSnapshot: ...

    async def candles(self, *, symbol: str, interval: str, limit: int) -> CandleSeries: ...

    async def news(self, *, symbol: str | None, limit: int) -> DataPage[NewsItem]: ...

    async def model_signals(self, *, symbol: str | None) -> DataPage[ModelSignal]: ...
