---
title: Blueprints
description: Deploy pre-configured agent teams in one click.
---

Blueprints are reusable team templates that let you deploy a full agent team — complete with org chart, skills, and reporting structure — in a single action.

## How Blueprints Work

A blueprint defines:
- A set of agents with their roles, providers, and models
- Skills installed on each agent
- Org chart relationships (who reports to whom)
- Default configurations

## Deploying a Blueprint

1. Go to **Blueprints**
2. Browse available templates
3. Click **Deploy**
4. CrewCmd creates all agents, wires up the org chart, and installs skills

Behind the scenes, deployment:
1. Creates agent records in the database
2. Sets up org chart nodes with reporting relationships
3. Installs specified skills on each agent
4. Optionally pushes agents to the execution runtime (OpenClaw)

## Blueprint API

```
GET    /api/blueprints          # List available blueprints
POST   /api/blueprints/:id/deploy  # Deploy a blueprint
```
