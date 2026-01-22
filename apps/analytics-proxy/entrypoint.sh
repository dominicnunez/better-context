#!/bin/sh
set -e

# Substitute environment variables in nginx config
envsubst '$PORT $POSTHOG_CLOUD_REGION' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# Start nginx
exec nginx -g 'daemon off;'
