export class DisabledAiProvider {
  constructor() {
    this.name = 'disabled';
    this.configured = false;
    this.supportsImages = false;
  }

  async generate() {
    const error = new Error('AI provider is disabled. Configure a server-side provider before generating content.');
    error.code = 'ai_provider_disabled';
    error.statusCode = 503;
    throw error;
  }

  async generateJson() { return this.generate(); }
  async generateImage() { return this.generate(); }
}

export class OpenAiCompatibleProvider {
  constructor({ baseUrl, apiKey, model, visionModel, imageModel, requestTimeoutMs, generatedImageSize }) {
    this.name = 'openai-compatible';
    this.configured = true;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.visionModel = visionModel || model;
    this.imageModel = imageModel;
    this.requestTimeoutMs = requestTimeoutMs || 120000;
    this.generatedImageSize = generatedImageSize || '1024x1024';
    this.supportsImages = Boolean(imageModel);
  }

  async request(path, init) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init.headers || {})
      }
    });
    if (!response.ok) {
      const error = new Error(`AI provider returned HTTP ${response.status}`);
      error.code = 'ai_provider_error';
      error.statusCode = 502;
      throw error;
    }
    return response;
  }

  async generate({ system, prompt, images = [], temperature = 0.2 }) {
    if (!this.baseUrl || !this.apiKey || !this.model) {
      throw new Error('AI provider configuration is incomplete');
    }
    const userContent = images.length
      ? [
          { type: 'text', text: prompt },
          ...images.map((image) => ({
            type: 'image_url',
            image_url: { url: `data:${image.mimeType};base64,${image.buffer.toString('base64')}` }
          }))
        ]
      : prompt;
    const response = await this.request('/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: images.length ? this.visionModel : this.model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent }
        ]
      })
    });
    const body = await response.json();
    return body.choices?.[0]?.message?.content ?? '';
  }

  async generateJson(input) {
    return parseJsonOutput(await this.generate(input));
  }

  async generateImage({ prompt, referenceImage = null, size = this.generatedImageSize }) {
    if (!this.imageModel) {
      const error = new Error('AI image model is not configured');
      error.code = 'ai_image_provider_disabled';
      error.statusCode = 503;
      throw error;
    }
    const gptImage = /^(gpt-image|chatgpt-image)/i.test(this.imageModel);
    let response;
    if (referenceImage) {
      const form = new FormData();
      form.set('model', this.imageModel);
      form.set('prompt', prompt);
      form.set('size', size);
      if (gptImage) form.set('output_format', 'png');
      else form.set('response_format', 'b64_json');
      form.set('image', new Blob([referenceImage.buffer], { type: referenceImage.mimeType }), referenceImage.filename || 'reference.png');
      response = await this.request('/images/edits', { method: 'POST', body: form });
    } else {
      response = await this.request('/images/generations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.imageModel, prompt, size,
          ...(gptImage ? { output_format: 'png' } : { response_format: 'b64_json' })
        })
      });
    }
    const body = await response.json();
    const base64 = body.data?.[0]?.b64_json;
    if (!base64) {
      const error = new Error('AI image provider did not return base64 image data');
      error.code = 'ai_image_response_invalid';
      error.statusCode = 502;
      throw error;
    }
    return {
      buffer: Buffer.from(base64, 'base64'),
      mimeType: 'image/png',
      revisedPrompt: body.data?.[0]?.revised_prompt ?? null
    };
  }
}

export function parseJsonOutput(value) {
  const text = String(value ?? '').trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    const error = new Error('AI provider returned invalid JSON');
    error.code = 'ai_output_invalid';
    error.statusCode = 502;
    throw error;
  }
}

export function createAiProvider(config) {
  if (config.provider === 'disabled') return new DisabledAiProvider();
  if (config.provider === 'openai-compatible') return new OpenAiCompatibleProvider(config);
  throw new Error(`Unsupported AI provider: ${config.provider}`);
}
