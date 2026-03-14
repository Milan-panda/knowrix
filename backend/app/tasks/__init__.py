# Celery tasks package — import task modules so they register with the worker
from app.tasks import ingestion  # noqa: F401
