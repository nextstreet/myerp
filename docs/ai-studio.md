# AI content studio

Version 0.6 adds an optional AI layer. Product creation, manual facts, image upload, listing editing, pricing and preflight continue to work when `AI_PROVIDER=disabled`.

## Safety and precedence

Facts are kept in three independent layers:

1. `ai_suggestions`: replaceable model output that is never applied automatically.
2. `manual_facts`: facts typed or pasted by the operator.
3. `confirmed_facts`: facts explicitly reviewed by a human.

The effective generation context uses this precedence:

`confirmed facts > manual facts > original product data`

AI suggestions are excluded from downstream copy and image generation until the operator copies, edits and saves them in the confirmed-facts area.

Generated copy is returned as a draft. It changes a listing only after the operator presses the save button for that country. Generated images are stored with `validation_status=pending`; they are not made primary, linked to a variant or sent to Mercado Libre automatically.

## Provider setup

Version 0.6 implements a replaceable `openai-compatible` provider using server-side Chat Completions and Images endpoints. The key never enters browser code, normal API responses or Git.

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://provider.example/v1
AI_API_KEY=<server-side secret>
AI_MODEL=<text model>
AI_VISION_MODEL=<multimodal model; defaults to AI_MODEL>
AI_IMAGE_MODEL=<optional image/edit model>
AI_REQUEST_TIMEOUT_MS=120000
AI_MAX_INPUT_IMAGES=8
AI_MAX_INPUT_IMAGE_BYTES=5000000
AI_GENERATED_IMAGE_SIZE=1024x1024
```

Do not send these values through chat. Configure them only in the server `.env` or a secret manager and keep `.env` permission mode at `600`.

If `AI_IMAGE_MODEL` is empty, fact extraction, copy generation and image-plan generation remain available while image buttons stay disabled.

## Upgrade

```bash
git pull origin main
docker compose build api
docker compose run --rm api npm run db:migrate
docker compose up -d api
curl -s http://127.0.0.1:3100/health
```

Expected health fields after configuration:

```json
{
  "version": "<deployed-package-version>",
  "aiProviderConfigured": true,
  "aiImageGenerationConfigured": true
}
```

## Operator flow

1. Create a product manually and add all variants.
2. Open **AI 内容工作台**.
3. Optionally type manual facts and upload several product images.
4. Select only the images that the model should inspect and run analysis.
5. Review AI suggestions, copy acceptable values into the confirmation area, edit and save.
6. Save category IDs in the normal review page if known.
7. Generate three-country copy; review and save each site independently.
8. Generate the image plan, choose a real product reference and generate drafts one by one.
9. Inspect structure, color and dimensions before associating an image with a variant.

Every chargeable AI request carries a browser-generated idempotency key and is recorded in `ai_generations` without storing credentials or raw image bytes.
