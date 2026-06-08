"""
consumers.py

Async RabbitMQ consumer for the fog-node.

Topology
--------

  surveillance.reports  (topic exchange, durable)   ← api-gateway publishes here
        │
        │  routing key: report.new
        ▼
  fog.processing        (queue, durable)             ← this consumer reads here
        │  x-dead-letter-exchange → reports.invalid
        │
        ▼  on nack(requeue=False)
  reports.invalid       (fanout exchange, durable)
        │
        ▼
  reports.invalid       (queue, durable)             ← dead-letter sink

Message lifecycle per message
------------------------------
  1. JSON decode
  2. Pydantic schema validation (SurveillanceEvent)
  3. Business rules  (timestamp, syndromeCode)
  4a. Any failure  → nack(requeue=False)  → DLX routes to reports.invalid
  4b. All pass     → ack                 → proceed to deduplication (TODO)
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

import aio_pika
import aio_pika.abc
from pydantic import ValidationError

from .aggregator import get_hourly_count, record_event
from .anomaly import check_anomaly
from .dedup import is_duplicate
from .forwarder import route_event, setup_exchanges
from .logging_config import get_logger
from .validators import SurveillanceEvent, validate_event

logger = get_logger(__name__)

# ─── Queue / exchange names (must match api-gateway constants) ────────────────

_SOURCE_EXCHANGE    = 'surveillance.reports'   # api-gateway publishes here
_SOURCE_ROUTING_KEY = 'report.new'
_PROCESSING_QUEUE   = 'fog.processing'

_DLX_EXCHANGE       = 'reports.invalid'        # dead-letter exchange
_DLQ_NAME           = 'reports.invalid'        # dead-letter queue

# Max in-flight messages per channel
_PREFETCH_COUNT = 10


# ─── Topology setup ───────────────────────────────────────────────────────────


async def _setup_topology(
    channel: aio_pika.abc.AbstractChannel,
) -> aio_pika.abc.AbstractQueue:
    """
    Idempotently declare all exchanges and queues.

    Returns the ``fog.processing`` queue object ready for consumption.
    Must be called after every (re)connection because channels are not
    persistent across reconnects.
    """
    # 1. Source exchange (topic) – declared by the api-gateway too; safe to
    #    re-declare with the same parameters (idempotent in RabbitMQ).
    source_exchange = await channel.declare_exchange(
        _SOURCE_EXCHANGE,
        aio_pika.ExchangeType.TOPIC,
        durable=True,
    )

    # 2. Dead-letter exchange (fanout – routing key is irrelevant for DLX).
    dlx = await channel.declare_exchange(
        _DLX_EXCHANGE,
        aio_pika.ExchangeType.FANOUT,
        durable=True,
    )

    # 3. Dead-letter queue, bound to the DLX.
    dlq = await channel.declare_queue(_DLQ_NAME, durable=True)
    await dlq.bind(dlx)

    # 4. Main processing queue.
    #    x-dead-letter-exchange: nacked messages (requeue=False) are
    #    automatically routed to the DLX by the broker.
    processing_queue = await channel.declare_queue(
        _PROCESSING_QUEUE,
        durable=True,
        arguments={'x-dead-letter-exchange': _DLX_EXCHANGE},
    )

    # 5. Bind processing queue to the source exchange.
    await processing_queue.bind(source_exchange, routing_key=_SOURCE_ROUTING_KEY)

    # 6. Declare all downstream forwarding exchanges.
    await setup_exchanges(channel)

    return processing_queue


# ─── Message handler ──────────────────────────────────────────────────────────


async def _handle_message(message: aio_pika.abc.AbstractIncomingMessage) -> None:
    """
    Process a single incoming message through the full validation pipeline.

    The ``ignore_processed=True`` flag on the context manager means we are
    responsible for calling ack/nack ourselves; the context manager will not
    double-ack or double-nack if we have already done so.
    """
    async with message.process(ignore_processed=True):

        # Bind correlation_id from AMQP message properties for this message.
        correlation_id: str = message.correlation_id or message.message_id or "none"
        log = logger.bind(correlation_id=correlation_id)

        # ── Step 1: JSON decode ────────────────────────────────────────────────────
        try:
            body = json.loads(message.body.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            log.error("Cannot decode message body", error=str(exc))
            await message.nack(requeue=False)
            return

        event_id_hint = (
            body.get('eventId', '<unknown>') if isinstance(body, dict) else '<unknown>'
        )

        # ── Step 2: Pydantic schema validation ────────────────────────────────
        try:
            event = SurveillanceEvent.model_validate(body)
        except ValidationError as exc:
            log.warning(
                "Schema validation failed",
                event_id=event_id_hint,
                errors=exc.errors(),
            )
            await message.nack(requeue=False)
            return

        # ── Step 3: Business rule validation ──────────────────────────────────
        valid, errors = validate_event(event)
        if not valid:
            log.warning(
                "Business rule violation",
                event_id=event.eventId,
                errors=errors,
            )
            await message.nack(requeue=False)
            return

        # ── Step 5: Deduplication ──────────────────────────────────────────────
        if await is_duplicate(event.model_dump()):
            log.info("Duplicate event – discarding", event_id=event.eventId)
            await message.ack()
            return

        await record_event(event.syndromeCode, event.location, event.eventId)

        # ── Step 6: Anomaly detection ──────────────────────────────────────────
        hourly_count = await get_hourly_count(event.syndromeCode, event.location)
        alert = await check_anomaly(
            event.syndromeCode, event.location, hourly_count, event.timestamp
        )
        # ── Step 7: Route to downstream exchange ──────────────────────────────
        await route_event(event.model_dump(), alert)

        log.info(
            "Event accepted",
            event_id=event.eventId,
            syndrome_code=event.syndromeCode,
            location=event.location,
            hourly_count=hourly_count,
        )
        await message.ack()


# ─── Consumer entry point ─────────────────────────────────────────────────────


async def start_consumer(
    rabbitmq_url: str,
    *,
    ready: Optional[asyncio.Event] = None,
) -> None:
    """
    Connect to RabbitMQ, declare topology, and consume ``fog.processing`` forever.

    Uses ``connect_robust`` so aio-pika handles reconnection at the connection
    level.  The outer ``while True`` loop handles the rarer case where the
    channel or iterator itself fails and we need to re-declare the topology.

    Args:
        rabbitmq_url: AMQP URL, e.g. ``amqp://guest:guest@localhost/``
        ready:        Optional :class:`asyncio.Event` that is set once the
                      first successful connection and topology setup completes.
                      Allows the FastAPI lifespan to wait for readiness.
    """
    while True:
        try:
            logger.info("Connecting to RabbitMQ", correlation_id="none")
            connection = await aio_pika.connect_robust(rabbitmq_url)

            async with connection:
                channel = await connection.channel()
                await channel.set_qos(prefetch_count=_PREFETCH_COUNT)

                processing_queue = await _setup_topology(channel)

                if ready is not None and not ready.is_set():
                    ready.set()

                logger.info(
                    "Consumer ready",
                    correlation_id="none",
                    queue=_PROCESSING_QUEUE,
                    prefetch=_PREFETCH_COUNT,
                )

                async with processing_queue.iterator() as queue_iter:
                    async for message in queue_iter:
                        await _handle_message(message)

        except asyncio.CancelledError:
            logger.info("Shutdown signal received – stopping", correlation_id="none")
            raise

        except Exception as exc:
            logger.error(
                "Unexpected consumer error – retrying in 5 s",
                correlation_id="none",
                error=str(exc),
                exc_info=True,
            )
            await asyncio.sleep(5)

