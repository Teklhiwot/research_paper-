"""
validators.py

Pydantic model for the canonical surveillance event schema and business-rule
validation (timestamp currency, allowed syndrome codes).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

# ─── Constants ────────────────────────────────────────────────────────────────

ALLOWED_SYNDROME_CODES: frozenset[str] = frozenset(
    {'COVID19', 'DENGUE', 'INFLUENZA', 'UNKNOWN'}
)

# ─── Pydantic model ───────────────────────────────────────────────────────────


class SurveillanceEvent(BaseModel):
    """
    Canonical disease-surveillance report schema.

    Mirrors the normalised object produced by the api-gateway's normaliseReport()
    function.  All required fields must be non-empty strings.
    """

    eventId:      str = Field(..., min_length=1)
    sourceId:     str = Field(..., min_length=1)
    timestamp:    str = Field(..., min_length=1)   # ISO 8601 string
    syndromeCode: str = Field(..., min_length=1)
    location:     str = Field(..., min_length=1)
    reporterId:   str = Field(..., min_length=1)

    # Optional fields present in normalised reports but not required for validation
    notes:  Optional[str] = ''
    status: Optional[str] = 'pending'


# ─── Business-rule validation ─────────────────────────────────────────────────


def validate_event(event: SurveillanceEvent) -> Tuple[bool, List[str]]:
    """
    Apply business rules to a structurally valid SurveillanceEvent.

    Rules
    -----
    1. ``timestamp`` must be a parseable ISO 8601 datetime and must **not** be
       in the future (wall-clock UTC).  A tolerance of 0 seconds is applied —
       clocks slightly ahead of the server are rejected to prevent pre-dated
       reports from bypassing deduplication windows.

    2. ``syndromeCode`` must be one of :data:`ALLOWED_SYNDROME_CODES`.

    Returns
    -------
    ``(True, [])``
        All rules pass.
    ``(False, [reason, ...])``
        One or more violations; each entry is a human-readable description.
    """
    errors: List[str] = []

    # ── Rule 1: timestamp not in the future ───────────────────────────────────
    try:
        # Normalise 'Z' suffix to the +00:00 form that fromisoformat accepts
        ts_normalised = event.timestamp.replace('Z', '+00:00')
        event_time = datetime.fromisoformat(ts_normalised)

        # Treat naive timestamps as UTC to be conservative
        if event_time.tzinfo is None:
            event_time = event_time.replace(tzinfo=timezone.utc)

        if event_time > datetime.now(timezone.utc):
            errors.append(
                f"timestamp '{event.timestamp}' is in the future"
            )
    except ValueError:
        errors.append(
            f"timestamp '{event.timestamp}' is not a valid ISO 8601 datetime"
        )

    # ── Rule 2: allowed syndrome code ─────────────────────────────────────────
    if event.syndromeCode not in ALLOWED_SYNDROME_CODES:
        errors.append(
            f"syndromeCode '{event.syndromeCode}' is not in the allowed list "
            f"{sorted(ALLOWED_SYNDROME_CODES)}"
        )

    return len(errors) == 0, errors

