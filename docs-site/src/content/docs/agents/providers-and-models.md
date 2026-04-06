---
title: Providers & Models
description: Configuring LLM providers and model selection for agents.
---

CrewCmd supports multiple LLM providers. Each company configures their own API keys, and models are fetched dynamically from provider APIs.

## Supported Providers

| Provider | Key | Notes |
|----------|-----|-------|
| **Anthropic** | `anthropic` | Claude models |
| **OpenAI** | `openai` | GPT and o-series models |
| **Google** | `google` | Gemini models |
| **OpenRouter** | `openrouter` | Aggregator — access many providers |

## Setting Up Provider Keys

1. Go to **Settings > Provider Keys**
2. Select a provider
3. Enter your API key
4. Keys are encrypted at rest and scoped to your company

Provider keys are stored per-company in the database — not as environment variables. This enables multi-tenant isolation and runtime key management.

## Model Selection

When creating or editing an agent, the model dropdown is populated dynamically by querying the provider's API. Models are cached for 1 hour.

```
GET /api/providers/:provider/models
```

This ensures you always see the latest available models without manual configuration.

## Provider Compatibility

Skills declare which providers they're compatible with. For example, **Claude Code** requires the Anthropic provider, while **Codex** requires OpenAI. The UI enforces these constraints when configuring agents.
