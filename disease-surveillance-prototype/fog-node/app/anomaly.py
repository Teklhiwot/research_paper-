"""
anomaly.py

EWMA (Exponentially Weighted Moving Average) anomaly detection for the fog-node.

Per-pair state is persisted in a Redis Hash so it survives fog-node restarts
and is shared across horizontally scaled instances:

    key    :  ewma:{syndromeCode}:{location}
    fields :  mean       – EWMA of hourly event counts (float)
              variance   – EWMA variance of hourly event counts (float)
              count      – number of EWMA updates applied (int, warmup guard)

EWMA update (Hunter 1986 formulation, alpha = 0.3)
---------------------------------------------------
    delta        = current_count - old_mean
    new_mean     = alpha * current_count + (1 - alpha) * old_mean
    new_variance = (1 - alpha) * old_variance + alpha * delta²

Alert conditions (OR logic – either alone triggers an alert)
-------------------------------------------------------------
    statistical : current_count > new_mean + SIGMA * sqrt(new_variance)
                  (only after MIN_OBSERVATIONS warm-up updates)
    absolute    : current_count >= THRESHOLD (always active)

Severity matrix
---------------
    CRITICAL – both conditions triggered simultaneously
    HIGH     – statistical anomaly only (3-sigma breach)
    MEDIUM   – absolute threshold only

Fail-open: any Redis error is logged; the function still raises a MEDIUM alert
if the absolute threshold is breached so broker outages never mask outbreaks.
"""
from __future__ import annotations

import logging
import math
import os
import time
import uuid
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

REDIS_URL: str = os.getenv('REDIS_URL', 'redis://localhost:6379/0')

ALPHA: float         = 0.3    # EWMA smoothing factor
SIGMA: float         = 3.0    # sigma multiplier for the statistical rule
THRESHOLD: int       = int(os.getenv('ANOMALY_THRESHOLD', '10'))   # cases / hour
MIN_OBSERVATIONS: int = 5     # updates before statistical rule fires (warm-up)
EWMA_TTL: int        = 7 * 86_400  # keep EWMA state for 7 days of inactivity

# ─── Shared async Redis client (lazy, connection-pooled) ─────────────────────

_client: Optional[aioredis.Redis] = None


def _get_client() -> aioredis.Redis:
    """Return the module-level Redis client, creating it on first call."""
    global _client  # noqa: PLW0603
    if _client is None:
        _client = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _client


# ─── Internal helpers ─────────────────────────────────────────────────────────


def _ewma_key(syndrome: str, location: str) -> str:
    return f'ewma:{syndrome}:{location}'


def _severity(stat_anomaly: bool, threshold_breach: bool) -> str:
    if stat_anomaly and threshold_breach:
        return 'CRITICAL'
    if stat_anomaly:
        return 'HIGH'
    return 'MEDIUM'


def _build_alert(
    syndrome: str,
    location: str,
    count: int,
    timestamp: str,
    stat_anomaly: bool,
    threshold_breach: bool,
) -> dict:
    return {
        'alertId':      str(uuid.uuid4()),
        'syndromeCode': syndrome,
        'location':     location,
        'count':        count,
        'timestamp':    timestamp,
        'severity':     _severity(stat_anomaly, threshold_breach),
    }


# ─── Public API ───────────────────────────────────────────────────────────────


async def check_anomaly(
    syndrome: str,
    location: str,
    current_count: int,
    timestamp: str,
) -> Optional[dict]:
    """
    Update the EWMA model for (*syndrome*, *location*) and test for anomalies.

    Parameters
    ----------
    syndrome:
        ``syndromeCode`` of the event (e.g. ``'COVID19'``).
    location:
        ``location`` field of the event.
    current_count:
        Hourly event count from :func:`aggregator.get_hourly_count`.
    timestamp:
        ISO 8601 timestamp carried through to the alert object.

    Returns
    -------
    dict
        Alert object ``{alertId, syndromeCode, location, count, timestamp,
        severity}`` when an anomaly is detected.
    None
        Normal observation — no action needed.
    """
    key = _ewma_key(syndrome, location)

    try:
        client = _get_client()
        raw = await client.hgetall(key)

        # ── First observation: seed the model ─────────────────────────────────
        if not raw:
            await client.hset(key, mapping={
                'mean':     str(float(current_count)),
                'variance': '0.0',
                'count':    '1',
            })
            await client.expire(key, EWMA_TTL)
            logger.debug(
                '[anomaly] Seeded EWMA %s with count=%d', key, current_count
            )
            # Threshold alert is always valid, even on the very first event
            if current_count >= THRESHOLD:
                alert = _build_alert(
                    syndrome, location, current_count, timestamp,
                    stat_anomaly=False, threshold_breach=True,
                )
                logger.warning('[anomaly] Threshold alert (seed): %s', alert)
                return alert
            return None

        # ── Load existing state ───────────────────────────────────────────────
        old_mean     = float(raw['mean'])
        old_variance = float(raw['variance'])
        obs_count    = int(raw['count'])

        # ── EWMA update ───────────────────────────────────────────────────────
        delta        = current_count - old_mean
        new_mean     = ALPHA * current_count + (1 - ALPHA) * old_mean
        new_variance = (1 - ALPHA) * old_variance + ALPHA * delta * delta
        new_count    = obs_count + 1

        # Persist atomically (fire-and-forget pipeline – no transaction needed)
        async with client.pipeline(transaction=False) as pipe:
            pipe.hset(key, mapping={
                'mean':     str(new_mean),
                'variance': str(new_variance),
                'count':    str(new_count),
            })
            pipe.expire(key, EWMA_TTL)
            await pipe.execute()

        # ── Evaluate alert conditions ─────────────────────────────────────────
        std = math.sqrt(new_variance)

        # Statistical rule fires only after the warm-up period so early
        # high-variance observations do not flood with false positives.
        stat_anomaly     = (
            obs_count >= MIN_OBSERVATIONS
            and current_count > new_mean + SIGMA * std
        )
        threshold_breach = current_count >= THRESHOLD

        if stat_anomaly or threshold_breach:
            alert = _build_alert(
                syndrome, location, current_count, timestamp,
                stat_anomaly, threshold_breach,
            )
            logger.warning(
                '[anomaly] Alert %s – %s/%s count=%d mean=%.2f std=%.2f severity=%s',
                alert['alertId'], syndrome, location,
                current_count, new_mean, std, alert['severity'],
            )
            return alert

        logger.debug(
            '[anomaly] Normal: %s/%s count=%d mean=%.2f std=%.2f',
            syndrome, location, current_count, new_mean, std,
        )
        return None

    except aioredis.RedisError as exc:
        logger.error('[anomaly] Redis error for %s: %s', key, exc)
        # Fail-open: still honour the absolute threshold without EWMA state
        if current_count >= THRESHOLD:
            alert = _build_alert(
                syndrome, location, current_count, timestamp,
                stat_anomaly=False, threshold_breach=True,
            )
            logger.warning('[anomaly] Threshold alert (Redis unavailable): %s', alert)
            return alert
        return None

