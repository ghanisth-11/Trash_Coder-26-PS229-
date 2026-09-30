FROM openwa/wa-automate:latest

USER root
WORKDIR /usr/src/app
RUN npm install --omit=dev @open-wa/wa-automate@5.1.0 @open-wa/integration-webhook@5.1.0
COPY wa.config.mjs /usr/src/app/wa.config.mjs

ENTRYPOINT []
CMD ["sh", "-c", "npx @open-wa/wa-automate@5.1.0 --config /usr/src/app/wa.config.mjs --session-id \"${WA_SESSION_ID:?WA_SESSION_ID is required}\" --host 0.0.0.0 --port \"${WA_PORT:-8080}\""]
