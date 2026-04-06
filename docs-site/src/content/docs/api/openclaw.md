---
title: OpenClaw Integration API
description: REST API endpoints for connecting to OpenClaw/NanoClaw execution runtimes.
---

CrewCmd connects to **OpenClaw** (or NanoClaw) as the execution plane for running agents. CrewCmd is the management plane; OpenClaw handles the actual agent execution.

## Runtime Connection

### Probe Gateway

```http
POST /api/runtimes/probe
```

Tests a gateway connection and discovers available agents and models.

**Body:**
```json
{
  "gatewayUrl": "ws://localhost:8080",
  "httpUrl": "http://localhost:8080",
  "authToken": "your-token"
}
```

### Save Connection

```http
POST /api/runtimes
```

### List Runtimes

```http
GET /api/runtimes
```

### Get Runtime Status

```http
GET /api/runtimes/:id/status
```

Returns live status from the gateway (polled every 30s).

## Agent Import

### Import Agents

```http
POST /api/runtimes/import
```

Imports discovered agents from a runtime into CrewCmd's database.

### Sync Agents

```http
POST /api/runtimes/:id/sync
```

Pulls latest agent data from the gateway.

### Deploy to Runtime

```http
POST /api/runtimes/:id/deploy
```

Pushes agents from CrewCmd to the gateway (used by blueprint deployment).

## OpenClaw Gateway

### Health Check

```http
GET /api/openclaw/health
```

### List Gateway Agents

```http
GET /api/openclaw/agents
```

### List Gateway Nodes

```http
GET /api/openclaw/nodes
```
