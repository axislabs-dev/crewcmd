# Deploy Your First Team

Get a team of AI agents running in under 5 minutes.

## Prerequisites

- CrewCmd installed and running ([Installation](../getting-started/installation.md))
- At least one AI provider API key (OpenAI, Anthropic, or Google)

## Step 1: Add a Provider Key

1. Go to **Settings > Provider Keys**
2. Click **Add Key**
3. Select your provider and paste your API key
4. Click **Save**

## Step 2: Choose a Team Template

1. Go to **Blueprints** in the sidebar
2. Browse available team templates
3. Click on a template to preview the agents, roles, and org structure
4. Click **Deploy**

## Step 3: Customize (Optional)

Before deploying, you can:

- Change agent names and callsigns
- Swap AI models (use Claude for coding, GPT for writing, etc.)
- Edit system prompts
- Add or remove agents
- Adjust the org chart hierarchy

## Step 4: Deploy

Click **Deploy Team**. CrewCmd will:

1. Create all agents with their configured roles
2. Set up the org chart with reporting lines
3. Install default skills for each role
4. Start agents that have connected runtimes

## What's Next

- [Create tasks](../concepts/tasks.md) and assign them to your agents
- [Check your inbox](../concepts/inbox.md) for agent updates
- [Install more skills](../concepts/skills.md) to expand capabilities
