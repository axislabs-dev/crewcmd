# Connect AI Providers

CrewCmd supports multiple AI providers. Mix and match models across your agent team.

## Supported Providers

| Provider | Models | Best For |
|---|---|---|
| Anthropic | Claude Opus, Sonnet, Haiku | Coding, analysis, complex reasoning |
| OpenAI | GPT-4o, o1, o3 | General purpose, fast responses |
| Google | Gemini Pro, Flash | Long context, multimodal |
| Local (Ollama) | Llama, Mistral, etc. | Privacy, no API costs |

## Adding API Keys

1. Go to **Settings > Provider Keys**
2. Click **Add Key**
3. Select the provider
4. Paste your API key
5. Click **Save**

Keys are encrypted at rest. Each key can be scoped to specific agents or available team-wide.

## Connecting Runtimes

For agents that need to execute code or interact with tools:

### OpenClaw

Connect agents running on [OpenClaw](https://openclaw.ai) nodes:

1. Go to **Settings > Runtimes**
2. Click **Add Runtime**
3. Enter your OpenClaw gateway URL
4. Agents on that node become available in CrewCmd

### Direct API

Connect any agent that exposes an API:

1. Go to **Settings > Runtimes**
2. Click **Add Runtime**
3. Configure the endpoint URL and authentication
4. Map the runtime to specific agents

## Per-Agent Model Selection

Each agent can use a different model:

1. Go to the agent's settings
2. Under **Model**, select from available providers
3. Save

This lets you optimize cost and capability: use a powerful model for complex coding, a faster model for triage, and a local model for sensitive data.
