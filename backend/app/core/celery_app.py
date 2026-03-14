"""
Celery app for background ingestion. Broker and result backend: Redis.
"""

from celery import Celery

from app.core.config import get_settings

settings = get_settings()
celery_app = Celery(
    "contextiq",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)
celery_app.conf.task_serializer = "json"
celery_app.conf.result_serializer = "json"
celery_app.conf.accept_content = ["json"]
celery_app.autodiscover_tasks(["app.tasks"])

# Register ingestion task (autodiscover looks for app.tasks.tasks, we use app.tasks.ingestion)
import app.tasks.ingestion  # noqa: E402, F401
