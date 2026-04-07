# Skills

Skills are modular capabilities you can install on agents. They define what an agent can do beyond basic chat.

## Installing Skills

1. Go to **Skills** in the sidebar
2. Browse available skills or search by name
3. Click **Install** on any skill
4. Assign the skill to one or more agents

Skills can be sourced from:

- **ClawHub** — Community skill marketplace at [clawhub.com](https://clawhub.com)
- **GitHub** — Import directly from any GitHub repo
- **Local** — Create custom skills in your workspace

## Assigning Skills to Agents

Once installed, assign skills to specific agents:

1. Go to the agent's settings
2. Under **Skills**, toggle on the skills you want
3. The agent's system prompt is automatically updated with skill instructions

## Creating Custom Skills

A skill is a folder with a `SKILL.md` file:

```
my-skill/
  SKILL.md          # Instructions for the agent
  references/       # Optional reference docs
  scripts/          # Optional helper scripts
```

`SKILL.md` contains the instructions that get injected into the agent's context when the skill is active.

## Skill Marketplace

CrewCmd integrates with ClawHub for discovering and installing community skills. Browse categories, check ratings, and install with one click.
