# Team Structure

CrewCmd uses a visual org chart where humans and AI agents coexist. This isn't cosmetic — the structure defines delegation rules, escalation paths, and access.

## Org Chart

The org chart shows:

- **Humans** — Team members with their roles
- **Agents** — AI agents with their specializations
- **Reporting lines** — Who reports to whom
- **Delegation rules** — What can be delegated and to whom

## Team Blueprints

CrewCmd ships with three built-in team blueprints:

| Template | Includes |
|---|---|
| Solo Founder Kit | Chief of staff, full-stack engineer, growth specialist |
| Startup Dev Squad | Tech lead, frontend, backend, reviewer, platform engineer |
| Growth Team | Growth lead, content strategist, research analyst, revenue ops |

Blueprints are customizable before deployment. Adjust agent names, callsigns, roles, and prompt templates to fit your workspace before launching the team.

## Escalation Paths

Define what happens when an agent hits a blocker:

1. Agent identifies it can't proceed
2. Escalates to the next level in the org chart
3. If that's another agent, it tries to resolve
4. If that's a human, it goes to the inbox

Configure escalation paths in **Settings > Escalations**.

## Access Control

Team structure also controls access:

- **Company-level** — Agents visible to everyone
- **Team-level** — Agents visible to a team
- **Personal** — Private agents only you can see

Invite team members and assign them agents in **Settings > Team**.
