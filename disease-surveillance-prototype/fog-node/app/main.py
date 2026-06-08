"""
main.py

FastAPI application for the fog-node.

On startup the lifespan context manager:
  1. Reads RABBITMQ_URL from the environment.
  2. Spawns an async background task that connects to RabbitMQ, declares the
     full exchange/queue topology, and consumes messages indefinitely.
  3. Waits up to CONSUMER_READY_TIMEOUT seconds for the first successful
     connection before allowing the server to start (allowing Docker health
     checks to differentiate "booting" from "broker unreachable").

On shutdown the lifespan cancels the consumer task and waits for it to finish.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from .consumers import start_consumer
from .logging_config import configure_logging, get_logger

# ─── Logging ──────────────────────────────────────────────────────────────────

configure_logging()
logger = get_logger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────

RABBITMQ_URL: str = os.getenv('RABBITMQ_URL', 'amqp://guest:guest@localhost/')

# How long (seconds) to wait for the initial broker connection during startup.
# If the broker is not reachable within this window, the server starts anyway
# and the consumer keeps retrying in the background.
CONSUMER_READY_TIMEOUT: int = int(os.getenv('CONSUMER_READY_TIMEOUT', '30'))

# ─── Application state ────────────────────────────────────────────────────────

_consumer_task: asyncio.Task | None = None

# ─── Lifespan ─────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """
    FastAPI lifespan context manager.

    Everything before ``yield`` runs on startup; everything after on shutdown.
    """
    global _consumer_task  # noqa: PLW0603

    # ── Startup ───────────────────────────────────────────────────────────────
    ready_event = asyncio.Event()

    _consumer_task = asyncio.create_task(
        start_consumer(RABBITMQ_URL, ready=ready_event),
        name='rabbitmq-consumer',
    )

    # Wait for the consumer to signal it has connected and declared queues.
    # asyncio.shield prevents cancelling the consumer if the timeout fires.
    try:
        await asyncio.wait_for(
            asyncio.shield(ready_event.wait()),
            timeout=CONSUMER_READY_TIMEOUT,
        )
        logger.info("RabbitMQ consumer connected and topology declared",
                    correlation_id="none")
    except asyncio.TimeoutError:
        logger.warning(
            "RabbitMQ not reachable within startup timeout – consumer will keep retrying",
            correlation_id="none",
            timeout_s=CONSUMER_READY_TIMEOUT,
        )

    yield  # ← server is running here

    # ── Shutdown ──────────────────────────────────────────────────────────────
    if _consumer_task and not _consumer_task.done():
        _consumer_task.cancel()
        try:
            await _consumer_task
        except asyncio.CancelledError:
            pass

    logger.info("Fog-node stopped cleanly", correlation_id="none")


# ─── Application ──────────────────────────────────────────────────────────────

app = FastAPI(
    title='fog-node',
    description='Disease surveillance fog-node: validates and deduplicates reports.',
    version='1.0.0',
    lifespan=lifespan,
)


# ── GET / – health / readiness probe ─────────────────────────────────────────

@app.get('/', tags=['health'])
async def health() -> dict:
    """
    Returns service status.

    ``consumer`` reflects whether the background RabbitMQ consumer task is
    still alive (does not indicate broker connectivity directly).
    """
    consumer_alive = _consumer_task is not None and not _consumer_task.done()
    return {
        'service':  'fog-node',
        'status':   'ok',
        'consumer': 'running' if consumer_alive else 'stopped',
    }

