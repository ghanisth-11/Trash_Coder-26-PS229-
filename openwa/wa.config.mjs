const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

export default {
  apiKey: required('WA_API_KEY'),
  plugins: ['@open-wa/integration-webhook'],
  pluginConfig: {
    webhook: {
      url: required('KABADIWALA_OPENWA_WEBHOOK_URL'),
      events: ['message.received'],
      headers: { 'X-Webhook-Secret': required('OPENWA_WEBHOOK_SECRET') },
      retries: 3,
      retryDelay: 1000,
      timeout: 15000,
    },
  },
};
