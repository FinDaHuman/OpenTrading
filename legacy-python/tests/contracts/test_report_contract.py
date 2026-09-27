from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from opentrading.domain import (
    CalculationInput,
    ClaimKind,
    EvidenceItem,
    EvidenceKind,
    ReportCalculation,
    ReportClaim,
    ResearchReport,
)
from opentrading.domain.market import Provenance


def synthetic_evidence(evidence_id: str = "ev-1") -> EvidenceItem:
    timestamp = datetime.now(UTC)
    return EvidenceItem(
        evidence_id=evidence_id,
        kind=EvidenceKind.MARKET_DATA,
        title="Synthetic fixture",
        observed_at=timestamp,
        provenance=Provenance(source_id="synthetic", retrieved_at=timestamp),
        content="Synthetic content; not a market observation.",
    )


def test_report_rejects_unknown_evidence_reference() -> None:
    with pytest.raises(ValidationError, match="unknown evidence references"):
        ResearchReport(
            report_id="report-1",
            question="Fixture question",
            generated_at=datetime.now(UTC),
            evidence=(synthetic_evidence(),),
            claims=(
                ReportClaim(
                    claim_id="claim-1",
                    kind=ClaimKind.FACT,
                    content="Fixture claim",
                    evidence_ids=("missing",),
                ),
            ),
        )


def test_report_rejects_duplicate_evidence_identity() -> None:
    evidence = synthetic_evidence()
    with pytest.raises(ValidationError, match="evidence_id values must be unique"):
        ResearchReport(
            report_id="report-1",
            question="Fixture question",
            generated_at=datetime.now(UTC),
            evidence=(evidence, evidence),
            claims=(
                ReportClaim(
                    claim_id="claim-1",
                    kind=ClaimKind.FACT,
                    content="Fixture claim",
                    evidence_ids=(evidence.evidence_id,),
                ),
            ),
        )


def test_repository_report_example_matches_contract() -> None:
    example = (
        Path(__file__).resolve().parents[2] / "examples" / "contracts" / "research-report.json"
    )
    report = ResearchReport.model_validate_json(example.read_text(encoding="utf-8"), strict=True)
    assert report.claims[0].evidence_ids == ("ev-fixture-001",)


def test_report_rejects_duplicate_calculation_identity() -> None:
    evidence = synthetic_evidence()
    calculation = ReportCalculation(
        calculation_id="calculation-1",
        method="identity",
        method_version="1",
        inputs=(CalculationInput(name="value", value="1", evidence_id=evidence.evidence_id),),
        result="1",
        evidence_ids=(evidence.evidence_id,),
    )
    with pytest.raises(ValidationError, match="calculation_id values must be unique"):
        ResearchReport(
            report_id="report-1",
            question="Fixture question",
            generated_at=datetime.now(UTC),
            evidence=(evidence,),
            claims=(
                ReportClaim(
                    claim_id="claim-1",
                    kind=ClaimKind.FACT,
                    content="Fixture claim",
                    evidence_ids=(evidence.evidence_id,),
                ),
            ),
            calculations=(calculation, calculation),
        )
