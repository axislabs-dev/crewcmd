# Chat Hierarchy Threading — Design Spec

**Branch:** `feature/chat-hierarchy-threading`  
**Parent branch:** `feature/agent-slideout-panel`  
**Author:** Neo  
**Date:** 2026-04-02

---

## Overview

Redesign the CrewCmd chat page (`/chat`) to support hierarchical agent threads. Each agent has their own persistent thread (gateway session). Parent agents monitor child threads. Humans can drop into any thread at any point.

## Mental Model

```
Roger (human)
  └─ Neo (team lead) ← default thread, primary human comms
       ├─ Cipher ← Neo monitors this thread
       │    ├─ Forge ← Cipher monitors this thread
       │    └─ Blitz ← Cipher monitors this thread
       ├─ Sentinel
       ├─ Maverick
       └─ Razor
```

- **Default view:** Neo's thread (top-level agent)
- **Click Cipher:** See Cipher's thread (Neo↔Cipher + human overrides)
- **Click Forge:** See Forge's thread (Cipher↔Forge + human overrides)
- At any point, the human can type in any thread

## Key Principles

1. **Each agent owns one thread** — mapped to a gateway `sessionKey` (the agent's callsign)
2. **Messages only appear in the child's thread** — parent-to-child comms show in the child's session, not the parent's
3. **Parent monitors child threads** — the parent agent watches child sessions for responses from either the child or a human
4. **OpenClaw handles compaction** — when context grows too large, the gateway compacts automatically per session
5. **Human can always intervene** — typing in any thread sends as the human, not as the parent agent

## Architecture

### Session Key Mapping

| Thread | Gateway `sessionKey` | Who talks here |
|--------|---------------------|----------------|
| Neo | `main` (or `neo`) | Human ↔ Neo |
| Cipher | `cipher` | Neo ↔ Cipher, Human ↔ Cipher |
| Forge | `forge` | Cipher ↔ Forge, Human ↔ Forge |
| Blitz | `blitz` | Cipher ↔ Blitz, Human ↔ Blitz |
| Sentinel | `sentinel` | Neo ↔ Sentinel, Human ↔ Sentinel |

### Gateway Integration

- `chat.send({ sessionKey, message })` — send to a specific agent's thread
- `chat.history({ sessionKey, limit })` — load thread history  
- `chat` events — filtered by `sessionKey` to update the correct thread
- No new gateway APIs needed — everything uses existing session-scoped RPC

### Event Routing

The chat event handler must filter events by `sessionKey`:

```typescript
const chatHandler = (payload: ChatEventPayload) => {
  // Only process events for the currently viewed thread
  if (payload.sessionKey && payload.sessionKey !== activeSessionKey) {
    // Could optionally show an unread indicator on the agent in the sidebar
    return;
  }
  // ... process delta/final/aborted/error as before
};
```

## UI Changes

### 1. Agent Hierarchy Selector (replaces flat dropdown)

Replace the current flat agent dropdown with a hierarchy-aware tree selector.

**Location:** Chat page header (left side, where current dropdown is)

**Structure:**
```
┌─────────────────────────┐
│ 🕶️ NEO (default)      ● │  ← top-level, bold
│   ⚡ CIPHER            ● │  ← indented under Neo
│     🔨 FORGE           ● │  ← indented under Cipher
│     ⚡ BLITZ           ● │  ← indented under Cipher
│   🛡️ SENTINEL         ● │
│   🎰 MAVERICK         ● │
│   🎬 RAZOR            ● │
└─────────────────────────┘
```

- Indent level = depth in `reportsTo` hierarchy
- Status dot (●) shows agent status (green/yellow/grey)
- Unread indicator (blue dot or count) when messages arrive in a thread you're not viewing
- Selected agent highlighted with accent color
- Default selection: top-level agent (no `reportsTo` or `reportsTo === null`)

**Implementation:**
- Build tree from `agents` array using `reportsTo` field
- Recursive render with `paddingLeft: depth * 16px`
- New component: `src/components/chat/agent-tree-selector.tsx`

### 2. Chat Header

When viewing a thread, show:

```
[emoji] CALLSIGN — Role/Title
Reports to: [parent emoji] PARENT_CALLSIGN
```

For top-level agent (no parent):
```
[emoji] CALLSIGN — Role/Title
Team Lead
```

### 3. Thread History Loading

When switching agents in the selector:
1. Save current scroll position
2. Call `chat.history({ sessionKey: agent.callsign, limit: 200 })`
3. Render messages (same format as current, gateway returns `{ messages: [...] }`)
4. Subscribe to `chat` events filtered by new `sessionKey`
5. Restore scroll to bottom

### 4. Unread Indicators

When a `chat` event arrives for a `sessionKey` that isn't currently active:
- Increment unread count for that agent in the tree selector
- Show blue dot or badge number
- Clear when user switches to that thread

**State shape:**
```typescript
const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
```

### 5. Message Attribution

Messages in a thread should show who sent them:
- **Human messages:** Show "You" or Roger's name
- **Agent messages:** Show the agent's emoji + callsign
- **Parent agent messages:** Show parent's emoji + callsign (e.g., Neo talking in Cipher's thread)

The gateway `chat.history` messages have a `role` field. For agent-to-agent comms, we may need to infer the sender from context or add metadata.

## File Changes

### New Files
- `src/components/chat/agent-tree-selector.tsx` — hierarchy dropdown component

### Modified Files
- `src/app/chat/page.tsx` — replace dropdown with tree selector, add session switching, unread tracking, thread-scoped event handling
- `src/app/api/chat/route.ts` — already supports `sessionKey` per agent, no changes needed
- `src/lib/gateway-client.ts` — no changes needed
- `src/lib/gateway-chat-pool.ts` — no changes needed

### Files NOT to touch
- `src/app/agents/[callsign]/page.tsx` — leave as-is
- Any API routes — no backend changes
- `src/components/edit-agent-dialog.tsx` — unrelated

## Data Flow

```
User selects "Cipher" in tree selector
  → setActiveAgent(cipher)
  → setActiveSessionKey("cipher")
  → fetch chat.history({ sessionKey: "cipher", limit: 200 })
  → render messages
  → subscribe to chat events where sessionKey === "cipher"

User types message in Cipher's thread
  → POST /api/chat { messages, agent: "cipher" }
  → API route calls chat.send({ sessionKey: "cipher", message })
  → Gateway routes to Cipher's session
  → Chat events stream back with sessionKey: "cipher"
  → UI renders delta/final in Cipher's thread

Meanwhile, event arrives for sessionKey: "forge"
  → User is viewing Cipher's thread, not Forge's
  → Increment unreadCounts["forge"]
  → Show blue dot on Forge in tree selector
```

## Styling

- Match existing dark theme (CSS variables)
- Tree selector uses same glass-card styling as current dropdown
- Indent lines: subtle `border-left` in `var(--border-subtle)` for child agents
- Unread badge: small blue dot or number, positioned right side of agent row
- Active agent: `bg-[var(--bg-surface-hover)]` + left accent border

## Out of Scope (Future)

- Agent-to-agent comms routing (parent auto-monitoring child threads) — this is an OpenClaw gateway concern, not CrewCmd UI
- Message search across threads
- Thread pinning or bookmarking
- File/image attachments in threads
- Thread-level compaction controls (gateway handles automatically)

## Acceptance Criteria

1. ✅ Chat page loads with hierarchy tree selector showing agents in `reportsTo` order
2. ✅ Default selection is the top-level agent (team lead)
3. ✅ Clicking an agent switches to their thread and loads history
4. ✅ Messages sent go to the correct agent's session
5. ✅ Streaming responses work per-thread (no cross-contamination)
6. ✅ Unread indicators appear when messages arrive in non-active threads
7. ✅ Chat header shows agent info + reporting chain
8. ✅ No new dependencies added
9. ✅ TypeScript strict, no `any` types
10. ✅ Existing Talk/Task mode toggle still works
11. ✅ Voice modes still work with selected agent
