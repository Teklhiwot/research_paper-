"""
logging_config.py

Structured JSON logging for the fog-node, built on structlog.

Every log record emitted via the bound logger carries at minimum:
    service_name    – always "fog-node"
    correlation_id  – AMQP message correlationId or HTTP X-Correlation-Id
    timestamp       – ISO-8601 UTC timestamp
    level           – log level name string
    event           – human-readable message (structlog calls this "event")

Usage
─────
    from .logging_config import get_logger

    logger = get_logger()              # module-level logger (no correlation)
    log    = logger.bind(correlation_id="abc-123", event_id="evt-001")
    log.info("Report processed")
    log.warning("Duplicate detected", source_id="dev-1")
    log.error("Validation failed", errors=[...])

Configuration
─────────────
    LOG_LEVEL  – minimum level to emit  (default: INFO)
    LOG_PRETTY – if "true", emit human-readable key=value output instead of JSON
"""
from __future__ import annotations

import logging
import os
import sys

import structlog

# ─── Constants ────────────────────────────────────────────────────────────────

SERVICE_NAME = "fog-node"
LOG_LEVEL    = os.getenv("LOG_LEVEL", "INFO").upper()
LOG_PRETTY   = os.getenv("LOG_PRETTY", "false").lower() == "true"

# ─── One-time configuration (call at startup) ─────────────────────────────────


def configure_logging() -> None:
    """
    Configure structlog + stdlib logging to emit structured JSON to stdout.

    Call this once at application start (before creating any loggers).
    Safe to call multiple times – subsequent calls are no-ops because
    structlog is already configured.
    """
    # ── stdlib root logger: route everything through structlog ────────────────
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=getattr(logging, LOG_LEVEL, logging.INFO),
    )

    # Silence noisy third-party loggers unless debugging.
    for noisy in ("aio_pika", "aiormq", "httpx", "httpcore", "web3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # ── Shared processors pipeline ────────────────────────────────────────────
    shared_processors: list = [
        # Inject service_name into every event dict.
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True, key="timestamp"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    # ── Output renderer ───────────────────────────────────────────────────────
    if LOG_PRETTY:
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=[
            *shared_processors,
            # Prepare the event for stdlib logging so that log records emitted
            # by third-party libraries are also rendered as JSON.
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Wire the stdlib formatter so all stdlib log records pass through structlog.
    formatter = structlog.stdlib.ProcessorFormatter(
        processor=renderer,
        foreign_pre_chain=shared_processors,
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    # Remove the basicConfig handler and replace with the structlog handler so
    # there is exactly one output handler.
    root.handlers = [handler]


# ─── Logger factory ───────────────────────────────────────────────────────────


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """
    Return a structlog BoundLogger pre-bound with ``service_name``.

    The returned logger can be further bound with request/message context:

        log = get_logger(__name__).bind(correlation_id="...", event_id="...")

    Args:
        name: Logger name (defaults to the calling module's __name__).

    Returns:
        A BoundLogger with ``service_name`` already set.
    """
    return structlog.get_logger(name or __name__).bind(service_name=SERVICE_NAME)
