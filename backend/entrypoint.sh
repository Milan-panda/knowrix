#!/bin/sh
set -e

echo "Backend starting in $ENVIRONMENT mode"

if [ "$ENVIRONMENT" = "dev" ]; then
  exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --reload \
    --log-level debug
else
  exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4 \
    --log-level info
fi
