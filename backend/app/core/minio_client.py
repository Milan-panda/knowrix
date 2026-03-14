import time
import logging

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import ClientError, EndpointConnectionError
from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

s3_client = boto3.client(
    "s3",
    endpoint_url=settings.MINIO_ENDPOINT,
    aws_access_key_id=settings.MINIO_ROOT_USER,
    aws_secret_access_key=settings.MINIO_ROOT_PASSWORD,
    config=BotoConfig(signature_version="s3v4"),
    region_name="us-east-1",
)


def ensure_bucket(max_retries: int = 5, delay: float = 2.0):
    """Create the default bucket if it doesn't exist, with retry for startup race."""
    for attempt in range(1, max_retries + 1):
        try:
            s3_client.head_bucket(Bucket=settings.MINIO_BUCKET)
            logger.info("MinIO bucket '%s' exists", settings.MINIO_BUCKET)
            return
        except ClientError as e:
            error_code = int(e.response["Error"]["Code"])
            if error_code == 404:
                s3_client.create_bucket(Bucket=settings.MINIO_BUCKET)
                logger.info("Created MinIO bucket '%s'", settings.MINIO_BUCKET)
                return
            raise
        except (EndpointConnectionError, Exception) as e:
            if attempt == max_retries:
                raise
            logger.warning(
                "MinIO not ready (attempt %d/%d): %s — retrying in %.0fs",
                attempt, max_retries, e, delay,
            )
            time.sleep(delay)
            delay *= 2


def get_s3():
    return s3_client
