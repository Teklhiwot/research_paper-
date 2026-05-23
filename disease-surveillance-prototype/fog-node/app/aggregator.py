"""
aggregator.py

Redis Sorted Set–based sliding-window event aggregator for the fog-node.

Each (syndromeCode, location) pair is tracked in a dedicated Sorted Set:

    key    : agg:{syndromeCode}:{location}
    member : eventId          – unique event identifier
    score  : POSIX timestamp  – float seconds since epoch (UTC)

On every accepted event:
  1. ``record_event``  adds the member with its timestamp score.
  2. Entries older than WINDOW_SECONDS (24 h) are trimmed atomically via a
     pipeline so the set never grows unbounded.
  3. The key's TTL is refreshed to WINDOW_SECONDS so unused keys expire
     automatically without a separate cleanup job.

``get_hourly_count`` counts members whose score falls within the last
3 600 seconds using ZCOUNT with an open lower bound.

Both functions are fail-open: a Redis error is logged and a sentinel value
(0 for counts, no-op for record) is returned so an outage never crashes the
consumer pipeline.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_URL: str = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

# Retention window for aggregation data – 24 hours.
WINDOW_SECONDS: int = 86_400

# Sliding window for get_hourly_count – 1 hour.
HOURLY_WINDOW: int = 3_600

# ─── Shared async Redis client (lazy, connection-pooled) ─────────────────────

_client: Optional[aioredis.Redis] = None


def _get_client() -> aioredis.Redis:
    """Return the module-level Redis client, creating it on first call."""
    global _client  # noqa: PLW0603
    if _client is None:
        _client = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _client


# ─── Key helper ───────────────────────────────────────────────────────────────


def _agg_key(syndrome: str, location: str) -> str:
    """Return the Sorted Set key for a (syndromeCode, location) pair."""
    return f'agg:{syndrome}:{location}'


# ─── Public API ───────────────────────────────────────────────────────────────


async def record_event(syndrome: str, location: str, event_id: str) -> None:
    """
    Record an accepted surveillance event in the aggregation Sorted Set.

    Steps (executed as a single pipelined round-trip):
      1. ``ZADD key score member``   – add *event_id* with the current UTC
         timestamp as the score.  If the member already exists its score is
         updated, which is idempotent.
      2. ``ZREMRANGEBYSCORE key -inf (now - WINDOW_SECONDS)``  – evict entries
         older than 24 hours, keeping the set bounded.
      3. ``EXPIRE key WINDOW_SECONDS``  – reset the key TTL so that sets for
         quiet (syndrome, location) pairs are garbage-collected by Redis.

    Parameters
    ----------
    syndrome:  syndromeCode of the event (e.g. ``'COVID19'``).
    location:  location field of the event.
    event_id:  unique eventId used as the Sorted Set member.
    """
    key = _agg_key(syndrome, location)
    now = time.time()
    cutoff = now - WINDOW_SECONDS

    try:
        client = _get_client()
        async with client.pipeline(transaction=False) as pipe:
            pipe.zadd(key, {event_id: now})
            pipe.zremrangebyscore(key, '-inf', cutoff)
            pipe.expire(key, WINDOW_SECONDS)
            await pipe.execute()

        logger.debug(
            '[aggregator] Recorded event %s for agg key %s (score=%.3f)',
            event_id, key, now,
        )

    except aioredis.RedisError as exc:
        logger.error(
            '[aggregator] Redis error recording event %s for %s: %s',
            event_id, key, exc,
        )


async def get_hourly_count(syndrome: str, location: str) -> int:
    """
    Return the number of events recorded for (*syndrome*, *location*) in the
    last ``HOURLY_WINDOW`` seconds (3 600 s = 1 hour).

    Uses ``ZCOUNT key (now-3600) +inf`` to count members whose score (UTC
    timestamp) falls within the sliding window.  The exclusive lower bound
    ``(`` avoids double-counting an event whose score equals the cutoff
    exactly, though in practice float precision makes this extremely unlikely.

    Returns ``0`` on any Redis error (fail-open).

    Parameters
    ----------
    syndrome:  syndromeCode to query (e.g. ``'COVID19'``).
    location:  location to query.

    Returns
    -------
    int
        Count of distinct events in the last hour for the given pair.
    """
    key = _agg_key(syndrome, location)
    cutoff = time.time() - HOURLY_WINDOW

    try:
        client = _get_client()
        # Exclusive lower bound: f'({cutoff}' skips the exact boundary score.
        count: int = await client.zcount(key, f'({cutoff}', '+inf')
        logger.debug(
            '[aggregator] %s → %d event(s) in last %ds',
            key, count, HOURLY_WINDOW,
        )
        return count

    except aioredis.RedisError as exc:
        logger.error(
            '[aggregator] Redis error reading count for %s: %s', key, exc,
        )
        return 0
