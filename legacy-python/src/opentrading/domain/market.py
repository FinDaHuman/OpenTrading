"""Canonical, source-preserving Vietnamese market research models."""

from decimal import Decimal
from enum import StrEnum

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", frozen=True, allow_inf_nan=False)


class AssetClass(StrEnum):
    EQUITY = "equity"
    INDEX = "index"
    FUTURE = "future"


class Venue(StrEnum):
    HOSE = "HOSE"
    HNX = "HNX"
    UPCOM = "UPCOM"
    VNX = "VNX"


class Currency(StrEnum):
    VND = "VND"
    USD = "USD"


class PriceUnit(StrEnum):
    VND = "VND"
    THOUSAND_VND = "THOUSAND_VND"
    INDEX_POINT = "INDEX_POINT"


class DataAvailability(StrEnum):
    AVAILABLE = "available"
    EMPTY = "empty"
    STALE = "stale"
    PARTIAL = "partial"
    UNAVAILABLE = "unavailable"


class EvidenceKind(StrEnum):
    MARKET_DATA = "market_data"
    NEWS = "news"
    MODEL_SIGNAL = "model_signal"
    CALCULATION = "calculation"


class ClaimKind(StrEnum):
    FACT = "fact"
    INTERPRETATION = "interpretation"


class Instrument(StrictModel):
    symbol: str = Field(pattern=r"^[A-Z0-9]{2,20}$")
    asset_class: AssetClass
    venue: Venue
    display_name: str = Field(min_length=1)
    currency: Currency
    contract_code: str | None = Field(default=None, min_length=1)
    continuous_series: bool = False

    @model_validator(mode="after")
    def validate_future_identity(self) -> "Instrument":
        if self.asset_class is not AssetClass.FUTURE:
            if self.contract_code is not None or self.continuous_series:
                raise ValueError("contract identity is valid only for futures")
        elif (self.contract_code is None) == (not self.continuous_series):
            raise ValueError("a future must be either a specific contract or a continuous series")
        return self


class Candle(StrictModel):
    observed_at: AwareDatetime
    open: Decimal = Field(gt=0)
    high: Decimal = Field(gt=0)
    low: Decimal = Field(gt=0)
    close: Decimal = Field(gt=0)
    volume: Decimal = Field(ge=0)

    @model_validator(mode="after")
    def validate_range(self) -> "Candle":
        if self.high < max(self.open, self.low, self.close):
            raise ValueError("high must be at least open, low, and close")
        if self.low > min(self.open, self.high, self.close):
            raise ValueError("low must be at most open, high, and close")
        return self


class Provenance(StrictModel):
    source_id: str = Field(min_length=1)
    source_uri: HttpUrl | None = None
    retrieved_at: AwareDatetime
    source_timestamp: AwareDatetime | None = None


class DataPage[ItemT](StrictModel):
    availability: DataAvailability
    items: tuple[ItemT, ...] = ()
    provenance: Provenance
    warnings: tuple[str, ...] = ()
    next_cursor: str | None = None

    @model_validator(mode="after")
    def validate_availability(self) -> "DataPage[ItemT]":
        has_items = bool(self.items)
        if (
            self.availability in {DataAvailability.EMPTY, DataAvailability.UNAVAILABLE}
            and has_items
        ):
            raise ValueError(f"{self.availability.value} data cannot contain items")
        if (
            self.availability
            in {
                DataAvailability.AVAILABLE,
                DataAvailability.STALE,
                DataAvailability.PARTIAL,
            }
            and not has_items
        ):
            raise ValueError(f"{self.availability.value} data must contain items")
        return self


class CandleSeries(StrictModel):
    instrument: Instrument
    interval: str = Field(min_length=1)
    price_unit: PriceUnit
    availability: DataAvailability
    candles: tuple[Candle, ...] = ()
    provenance: Provenance
    warnings: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_availability(self) -> "CandleSeries":
        has_candles = bool(self.candles)
        if (
            self.availability in {DataAvailability.EMPTY, DataAvailability.UNAVAILABLE}
            and has_candles
        ):
            raise ValueError(f"{self.availability.value} series cannot contain candles")
        if (
            self.availability
            in {
                DataAvailability.AVAILABLE,
                DataAvailability.STALE,
                DataAvailability.PARTIAL,
            }
            and not has_candles
        ):
            raise ValueError(f"{self.availability.value} series must contain candles")
        return self


class MarketQuote(StrictModel):
    instrument: Instrument
    observed_at: AwareDatetime
    last_price: Decimal = Field(gt=0)
    price_unit: PriceUnit
    absolute_change: Decimal | None = None
    percent_change: Decimal | None = None
    volume: Decimal | None = Field(default=None, ge=0)


class MarketSnapshot(StrictModel):
    as_of: AwareDatetime
    availability: DataAvailability
    quotes: tuple[MarketQuote, ...] = ()
    provenance: Provenance
    warnings: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_availability(self) -> "MarketSnapshot":
        has_quotes = bool(self.quotes)
        if (
            self.availability in {DataAvailability.EMPTY, DataAvailability.UNAVAILABLE}
            and has_quotes
        ):
            raise ValueError(f"{self.availability.value} snapshot cannot contain quotes")
        if (
            self.availability
            in {
                DataAvailability.AVAILABLE,
                DataAvailability.STALE,
                DataAvailability.PARTIAL,
            }
            and not has_quotes
        ):
            raise ValueError(f"{self.availability.value} snapshot must contain quotes")
        return self


class NewsItem(StrictModel):
    item_id: str = Field(min_length=1)
    headline: str = Field(min_length=1)
    summary: str | None = None
    published_at: AwareDatetime
    tickers: tuple[str, ...] = ()
    provenance: Provenance


class ModelSignal(StrictModel):
    signal_id: str = Field(min_length=1)
    instrument: Instrument
    generated_at: AwareDatetime
    horizon: str | None = None
    model_version: str | None = None
    label: str = Field(min_length=1)
    score: Decimal | None = None
    score_semantics: str | None = None
    provenance: Provenance

    @model_validator(mode="after")
    def require_score_semantics(self) -> "ModelSignal":
        if self.score is not None and not self.score_semantics:
            raise ValueError("score_semantics is required when score is present")
        return self


class EvidenceItem(StrictModel):
    evidence_id: str = Field(min_length=1)
    kind: EvidenceKind
    title: str = Field(min_length=1)
    observed_at: AwareDatetime
    provenance: Provenance
    content: str = Field(min_length=1)


class ReportClaim(StrictModel):
    claim_id: str = Field(min_length=1)
    kind: ClaimKind
    content: str = Field(min_length=1)
    evidence_ids: tuple[str, ...] = Field(min_length=1)


class CalculationInput(StrictModel):
    name: str = Field(min_length=1)
    value: str = Field(min_length=1)
    unit: str | None = None
    evidence_id: str | None = None


class ReportCalculation(StrictModel):
    calculation_id: str = Field(min_length=1)
    method: str = Field(min_length=1)
    method_version: str = Field(min_length=1)
    inputs: tuple[CalculationInput, ...] = Field(min_length=1)
    result: str = Field(min_length=1)
    result_unit: str | None = None
    evidence_ids: tuple[str, ...] = Field(min_length=1)


class ResearchReport(StrictModel):
    report_id: str = Field(min_length=1)
    question: str = Field(min_length=1)
    generated_at: AwareDatetime
    evidence: tuple[EvidenceItem, ...] = Field(min_length=1)
    claims: tuple[ReportClaim, ...] = Field(min_length=1)
    calculations: tuple[ReportCalculation, ...] = ()
    limitations: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_evidence_graph(self) -> "ResearchReport":
        evidence_ids = [item.evidence_id for item in self.evidence]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError("evidence_id values must be unique")
        claim_ids = [claim.claim_id for claim in self.claims]
        if len(claim_ids) != len(set(claim_ids)):
            raise ValueError("claim_id values must be unique")
        calculation_ids = [calculation.calculation_id for calculation in self.calculations]
        if len(calculation_ids) != len(set(calculation_ids)):
            raise ValueError("calculation_id values must be unique")
        known = set(evidence_ids)
        references = {
            evidence_id for claim in self.claims for evidence_id in claim.evidence_ids
        } | {
            evidence_id
            for calculation in self.calculations
            for evidence_id in calculation.evidence_ids
        }
        references |= {
            item.evidence_id
            for calculation in self.calculations
            for item in calculation.inputs
            if item.evidence_id is not None
        }
        unknown = sorted(references - known)
        if unknown:
            raise ValueError(f"unknown evidence references: {', '.join(unknown)}")
        return self
