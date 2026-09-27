from datetime import UTC, datetime
from decimal import Decimal

import pytest
from pydantic import ValidationError

from opentrading.domain.market import (
    AssetClass,
    Candle,
    Currency,
    DataAvailability,
    DataPage,
    Instrument,
    PriceUnit,
    Provenance,
    Venue,
)


def test_candle_rejects_impossible_price_range() -> None:
    with pytest.raises(ValidationError, match="high must be at least"):
        Candle(
            observed_at=datetime.now(UTC),
            open=Decimal("10"),
            high=Decimal("9"),
            low=Decimal("8"),
            close=Decimal("9"),
            volume=Decimal("100"),
        )


def test_instrument_rejects_ambiguous_lowercase_symbol() -> None:
    with pytest.raises(ValidationError):
        Instrument(
            symbol="fpt",
            asset_class=AssetClass.EQUITY,
            venue=Venue.HOSE,
            display_name="Synthetic FPT fixture",
            currency=Currency.VND,
        )


def test_strict_models_do_not_coerce_financial_numbers() -> None:
    with pytest.raises(ValidationError):
        Candle(
            observed_at=datetime.now(UTC),
            open="10",  # type: ignore[arg-type]
            high=Decimal("11"),
            low=Decimal("9"),
            close=Decimal("10"),
            volume=Decimal("100"),
        )


def test_candle_requires_timezone_aware_observation() -> None:
    with pytest.raises(ValidationError, match="timezone info"):
        Candle(
            observed_at=datetime(2026, 1, 5, 15, 0),
            open=Decimal("10"),
            high=Decimal("11"),
            low=Decimal("9"),
            close=Decimal("10"),
            volume=Decimal("100"),
        )


def test_continuous_series_is_valid_only_for_futures() -> None:
    with pytest.raises(ValidationError, match="only for futures"):
        Instrument(
            symbol="FPT",
            asset_class=AssetClass.EQUITY,
            venue=Venue.HOSE,
            display_name="Synthetic FPT fixture",
            currency=Currency.VND,
            continuous_series=True,
        )


def test_data_page_rejects_available_without_items() -> None:
    timestamp = datetime.now(UTC)
    with pytest.raises(ValidationError, match="available data must contain items"):
        DataPage[str](
            availability=DataAvailability.AVAILABLE,
            items=(),
            provenance=Provenance(source_id="synthetic", retrieved_at=timestamp),
        )


def test_empty_candle_series_cannot_contain_candles() -> None:
    timestamp = datetime.now(UTC)
    instrument = Instrument(
        symbol="FPT",
        asset_class=AssetClass.EQUITY,
        venue=Venue.HOSE,
        display_name="Synthetic FPT fixture",
        currency=Currency.VND,
    )
    candle = Candle(
        observed_at=timestamp,
        open=Decimal("10"),
        high=Decimal("11"),
        low=Decimal("9"),
        close=Decimal("10"),
        volume=Decimal("100"),
    )
    from opentrading.domain import CandleSeries

    with pytest.raises(ValidationError, match="empty series cannot contain candles"):
        CandleSeries(
            instrument=instrument,
            interval="1d",
            price_unit=PriceUnit.THOUSAND_VND,
            availability=DataAvailability.EMPTY,
            candles=(candle,),
            provenance=Provenance(source_id="synthetic", retrieved_at=timestamp),
        )
