#!/bin/bash
set -e

ENVIRONMENT=$(grep '^ENVIRONMENT=' .env | head -1 | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]')

echo "Starting ContextIQ in '$ENVIRONMENT' mode..."

if [ "$ENVIRONMENT" = "dev" ]; then
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.dev.yml \
    up --build --renew-anon-volumes "$@"

elif [ "$ENVIRONMENT" = "prod" ]; then
  API_DOMAIN=$(grep '^API_DOMAIN=' .env | head -1 | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]')
  CERT_EMAIL=$(grep '^CERT_EMAIL=' .env | head -1 | cut -d= -f2 | cut -d'#' -f1 | tr -d '[:space:]')
  CERT_PATH="./nginx/certbot/conf/live/$API_DOMAIN/fullchain.pem"

  if [ -z "$API_DOMAIN" ] || [ -z "$CERT_EMAIL" ]; then
    echo "Error: API_DOMAIN and CERT_EMAIL must be set in .env for prod"
    exit 1
  fi

  if [ ! -f "$CERT_PATH" ]; then
    echo "No SSL certificate found for $API_DOMAIN. Bootstrapping..."
    mkdir -p "./nginx/certbot/conf/live/$API_DOMAIN"
    mkdir -p "./nginx/certbot/www"

    # Temporary self-signed cert so nginx can start and serve ACME challenges
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "./nginx/certbot/conf/live/$API_DOMAIN/privkey.pem" \
      -out "./nginx/certbot/conf/live/$API_DOMAIN/fullchain.pem" \
      -subj "/CN=localhost" 2>/dev/null

    echo "Starting nginx with temporary certificate..."
    docker compose \
      -f docker-compose.yml \
      -f docker-compose.prod.yml \
      up -d nginx

    # Remove the dummy cert so certbot can write the real one
    rm -rf "./nginx/certbot/conf/live"
    rm -rf "./nginx/certbot/conf/archive"
    rm -rf "./nginx/certbot/conf/renewal"

    echo "Requesting certificate from Let's Encrypt for $API_DOMAIN..."
    docker run --rm \
      -v "$(pwd)/nginx/certbot/conf:/etc/letsencrypt" \
      -v "$(pwd)/nginx/certbot/www:/var/www/certbot" \
      certbot/certbot certonly --webroot \
      -w /var/www/certbot \
      -d "$API_DOMAIN" \
      --email "$CERT_EMAIL" \
      --agree-tos \
      --no-eff-email \
      --non-interactive

    echo "Certificate obtained. Reloading nginx..."
    docker compose \
      -f docker-compose.yml \
      -f docker-compose.prod.yml \
      exec nginx nginx -s reload
  fi

  docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up --build -d "$@"

else
  echo "Error: ENVIRONMENT must be 'dev' or 'prod' in .env"
  exit 1
fi
