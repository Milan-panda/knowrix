#!/bin/sh
set -e

echo "Frontend starting in $ENVIRONMENT mode"

if [ "$ENVIRONMENT" = "dev" ]; then
  exec npm run dev
else
  npm run build
  exec npm start
fi
