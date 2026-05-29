const PROVIDER_ENV_VARS = {
  anthropic:               'ANTHROPIC_API_KEY',
  alibaba:                 'DASHSCOPE_API_KEY',
  'alibaba-cn':            'DASHSCOPE_API_KEY',
  'alibaba-coding-plan':   'ALIBABA_CODING_PLAN_API_KEY',
  'alibaba-coding-plan-cn':'ALIBABA_CODING_PLAN_API_KEY',
  zhipuai:                 'ZHIPU_API_KEY',
  'zhipuai-coding-plan':   'ZHIPU_API_KEY',
}

const PROVIDER_PATHS = {
  anthropic: 'anthropic',
}

function resolve() {
  const providerId = process.env.MYCO_AGENT_PROVIDER || 'anthropic'
  const providerPath = PROVIDER_PATHS[providerId] || 'opencode'

  let apiKey = process.env.MYCO_AGENT_API_KEY
  if (!apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId]
    if (envVarName) {
      apiKey = process.env[envVarName]
    }
  }

  if (providerId !== 'anthropic' && !apiKey) {
    const envVarName = PROVIDER_ENV_VARS[providerId] || 'MYCO_AGENT_API_KEY'
    throw new Error(
      `No API key found for provider ${providerId}. ` +
      `Set MYCO_AGENT_API_KEY or ${envVarName} in .env.`
    )
  }

  const model = process.env.MYCO_AGENT_MODEL || null
  const auxModel = process.env.MYCO_AUX_MODEL || model

  return { providerId, apiKey, model, auxModel, providerPath }
}

module.exports = { resolve, PROVIDER_ENV_VARS, PROVIDER_PATHS }