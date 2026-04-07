# Budgets & Governance

Control spending and maintain oversight as your AI team scales.

## Per-Agent Budgets

Set spending limits for each agent:

1. Go to **Budgets** in the sidebar
2. Click on an agent
3. Set daily/weekly/monthly limits
4. Choose what happens when the limit is hit: pause agent, notify admin, or escalate

## Approval Gates

Require human approval before agents take certain actions:

1. Go to **Settings > Governance**
2. Create an approval gate
3. Define the trigger (e.g., "any task over $50", "production deployments")
4. Assign approvers

When an agent hits a gate, the request appears in the inbox for approval.

## Cost Tracking

CrewCmd tracks token usage and estimates cost per agent:

- **Per-message costs** — Based on token count and model pricing
- **Per-task costs** — Total spend for completing a task
- **Per-agent costs** — Running total by agent
- **Team costs** — Aggregate across all agents

View cost breakdowns in **Budgets > Cost Events**.

## Audit Trail

Every action in CrewCmd is logged:

- Agent starts, stops, restarts
- Task assignments and status changes
- Approval requests and decisions
- Configuration changes
- Budget limit hits

View the full audit log in **Governance > Audit Log**.

## Escalation Rules

Define escalation paths for budget overruns:

1. Agent exceeds 80% of budget → notify admin
2. Agent exceeds 100% → pause and escalate
3. Critical agents can have higher thresholds

Configure in **Settings > Escalations**.
