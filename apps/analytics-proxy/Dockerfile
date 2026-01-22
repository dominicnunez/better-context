FROM nginx:alpine

# Copy nginx config template
COPY nginx.conf /etc/nginx/nginx.conf.template

# Copy and set up entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Railway uses PORT environment variable
ENV PORT=8080
ENV POSTHOG_CLOUD_REGION=us

ENTRYPOINT ["/entrypoint.sh"]
