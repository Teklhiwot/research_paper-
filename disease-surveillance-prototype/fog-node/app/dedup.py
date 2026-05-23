"""
dedup.py

Redis-backed event deduplication for the fog-node.

A composite Redis key is built from the event's sourceId, eventId and a
16-character SHA-256 prefix of the canonical JSON serialisation.  The first
time an event is seen, the key is written with a 24-hour TTL.  Subsequent
arrivals of the same event within that window are flagged as duplicates.

The SET … NX EX command is used so the existence-check and the key-write are
atomic – no separate GET is needed and there is no race condition under
concurrent consumers.

Redis connection errors are logged and the function returns False (fail-open)
so that a transient Redis outage never causes legitimate surveillance events
to be silently dropped.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_URL: str = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Key lifetime – 24 hours.  After this window the same eventId can be
# reprocessed (handles legitimate re-sends after long outages).
DEDUP_TTL: int = 86_400  # seconds

# ─── Module-level client (lazy-initialised, connection-pooled) ────────────────

_client: Optional[aioredis.Redis] = None


def _get_client() -> aioredis.Redis:
    """Return the shared Redis client, creating it on first call."""
    global _client  # noqa: PLW0603
    if _client is None:
        # decode_responses=False keeps values as bytes; we only store '1'.
        _client = aioredis.from_url(REDIS_URL, decode_responses=False)
    return _client


# ─── Key construction ─────────────────────────────────────────────────────────


def _build_key(event: dict) -> str:
    """
    Build the composite deduplication Redis key.

    Format: ``dedup:{sourceId}:{eventId}:{sha256[:16]}``

    The SHA-256 digest is computed over the canonical JSON representation of
    the full event (keys sorted, no extra whitespace) so that two events with
    the same sourceId + eventId but different payloads produce different keys.
    """
    source_id = event.get('sourceId', '')
    event_id  = event.get('eventId', '')

    canonical_json: str = json.dumps(event, sort_keys=True, separators=(',', ':'))
    digest = hashlib.sha256(canonical_json.encode('utf-8')).hexdigest()[:16]

    return f'dedup:{source_id}:{event_id}:{digest}'


# ─── Public API ───────────────────────────────────────────────────────────────


async def is_duplicate(event: dict) -> bool:
    """
    Check whether *event* has already been processed within the dedup window.

    Algorithm
    ---------
    1. Build the composite key from ``sourceId``, ``eventId`` and a SHA-256
       fingerprint of the canonical JSON.
    2. Issue ``SET key 1 NX EX 86400``.
       - If the key **did not exist**: Redis sets it and returns ``True`` →
         this is a **new** event  → return ``False``.
       - If the key **already existed**: Redis returns ``None`` →
         this is a **duplicate** → return ``True``.

    The NX + EX combination is atomic, so concurrent fog-node instances
    processing the same message race safely.

    Failure mode
    ------------
    Any Redis error is logged and the function returns ``False`` (fail-open).
    Losing deduplication for a window is safer than dropping surveillance
    events because the cache layer is temporarily unavailable.

    Parameters
    ----------
    event:
        Plain dict representing the surveillance event.  Typically produced
        via ``SurveillanceEvent.model_dump()``.

    Returns
    -------
    ``True``  – duplicate; caller should ack and discard.
    ``False`` – new event; caller should proceed with processing.
    """
    key = _build_key(event)

    try:
        client = _get_client()
        # SET key '1' NX EX <ttl>
        # Returns True  if key was newly set   → not a duplicate
        # Returns None  if key already existed → duplicate
        was_set = await client.set(key, b'1', ex=DEDUP_TTL, nx=True)

        if was_set is None:
            logger.info('[dedup] Duplicate event dropped: %s', key)
            return True

        logger.debug('[dedup] New event cached (TTL=%ds): %s', DEDUP_TTL, key)
        return False

    except aioredis.RedisError as exc:
        logger.error(
            '[dedup] Redis error – failing open (event will be processed): %s', exc
        )
        return False
