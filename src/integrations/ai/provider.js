export class DisabledAiProvider {
  async generate() {
    const error = new Error('AI provider is disabled. Configure a server-side provider before generating content.');
    error.code = 'ai_provider_disabled';
    throw error;
  }
}

export class OpenAiCompatibleProvider {
  constructor({ baseUrl, apiKey, model }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate({ system, prompt, temperature = 0.2 }) {
    if (!this.baseUrl || !this.apiKey || !this.model) {
      throw new Error('AI provider configuration is incomplete');
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (!response.ok) {
      const error = new Error(`AI provider returned HTTP ${response.status}`);
      error.code = 'ai_provider_error';
      throw error;
    }
    const body = await response.json();
    return body.choices?.[0]?.message?.content ?? '';
  }
}

export function createAiProvider(config) {
  if (config.provider === 'disabled') return new DisabledAiProvider();
  if (config.provider === 'openai-compatible') return new OpenAiCompatibleProvider(config);
  throw new Error(`Unsupported AI provider: ${config.provider}`);
}
