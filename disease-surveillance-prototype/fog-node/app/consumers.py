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
import logging
from typing import Optional

import aio_pika
import aio_pika.abc
from pydantic import ValidationError

from .validators import SurveillanceEvent, validate_event

logger = logging.getLogger(__name__)

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

        # ── Step 1: JSON decode ───────────────────────────────────────────────
        try:
            body = json.loads(message.body.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            logger.error("[consumer] Cannot decode message body: %s", exc)
            await message.nack(requeue=False)
            return

        event_id_hint = (
            body.get('eventId', '<unknown>') if isinstance(body, dict) else '<unknown>'
        )

        # ── Step 2: Pydantic schema validation ────────────────────────────────
        try:
            event = SurveillanceEvent.model_validate(body)
        except ValidationError as exc:
            logger.warning(
                "[consumer] Schema validation failed for %s: %s",
                event_id_hint,
                exc.errors(),
            )
            await message.nack(requeue=False)
            return

        # ── Step 3: Business rule validation ──────────────────────────────────
        valid, errors = validate_event(event)
        if not valid:
            logger.warning(
                "[consumer] Business rule violation for %s: %s",
                event.eventId,
                errors,
            )
            await message.nack(requeue=False)
            return

        # ── Step 5: Proceed to deduplication ──────────────────────────────────
        # Message has passed all validation.  Deduplication via Redis will be
        # implemented here in the next iteration.
        logger.info(
            "[consumer] Event %s validated (syndrome=%s, ts=%s) – "
            "proceeding to deduplication",
            event.eventId,
            event.syndromeCode,
            event.timestamp,
        )
        # TODO: Redis deduplication
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
            logger.info("[consumer] Connecting to RabbitMQ …")
            connection = await aio_pika.connect_robust(rabbitmq_url)

            async with connection:
                channel = await connection.channel()
                await channel.set_qos(prefetch_count=_PREFETCH_COUNT)

                processing_queue = await _setup_topology(channel)

                if ready is not None and not ready.is_set():
                    ready.set()

                logger.info(
                    "[consumer] Ready – consuming from '%s' (prefetch=%d)",
                    _PROCESSING_QUEUE,
                    _PREFETCH_COUNT,
                )

                async with processing_queue.iterator() as queue_iter:
                    async for message in queue_iter:
                        await _handle_message(message)

        except asyncio.CancelledError:
            logger.info("[consumer] Shutdown signal received – stopping")
            raise

        except Exception as exc:
            logger.error(
                "[consumer] Unexpected error: %s – retrying in 5 s", exc, exc_info=True
            )
            await asyncio.sleep(5)

