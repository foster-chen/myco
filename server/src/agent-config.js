'use strict';

const PROVIDER_ENV_VARS = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'MYCO_OPENAI_API_KEY',
};

const PROVIDER_DEFAULTS = {
  anthropic: {
    id: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    baseUrl: null,
  },
  openai: {
    id: 'openai',
    defaultModel: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
};

function resolve() {
  const providerId = process.env.MYCO_AGENT_PROVIDER || 'anthropic';
  const defaults = PROVIDER_DEFAULTS[providerId];
  if (!defaults) {
    throw new Error(
      `Unknown MYCO_AGENT_PROVIDER: ${providerId}. Valid values: ${Object.keys(PROVIDER_DEFAULTS).join(', ')}`
    );
  }

  let apiKey = process.env.MYCO_AGENT_API_KEY;
  if (!apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId];
    if (envVarName) {
      apiKey = process.env[envVarName];
    }
  }

  if (providerId !== 'anthropic' && !apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId] || 'MYCO_AGENT_API_KEY';
    throw new Error(
      `No API key for provider ${providerId}. Set ${envVarName} or MYCO_AGENT_API_KEY in .env.`
    );
  }

  const model = process.env.MYCO_AGENT_MODEL || defaults.defaultModel;
  const auxModel = process.env.MYCO_AUX_MODEL || model;
  const baseUrl = process.env.MYCO_AGENT_BASE_URL || defaults.baseUrl;

  return {
    providerId: defaults.id,
    apiKey,
    model,
    auxModel,
    baseUrl,
    providerPath: providerId,
  };
}

module.exports = { resolve, PROVIDER_ENV_VARS, PROVIDER_DEFAULTS };