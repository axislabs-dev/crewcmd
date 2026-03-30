#!/usr/bin/env npx tsx
/**
 * PR Review Feedback Loop Dispatcher
 * 
 * This script runs on a cron schedule to detect PRs that have requested changes
 * from Sentinel and re-dispatch the original agent to fix the issues.
 * 
 * Cycle:
 * 1. Find tasks where status='review' AND prStatus='changes_requested'
 * 2. Fetch Sentinel's review comments from GitHub
 * 3. Re-dispatch the original agent with the feedback
 * 4. Increment reviewCycleCount
 * 5. Agent fixes and pushes, clearing prStatus='open'
 * 6. Sentinel auto-re-reviews on next cycle
 */

import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { eq, and, gt } from "drizzle-orm";

const MISSION_CONTROL_URL = process.env.MISSION_CONTROL_URL || "https://mission-control-blond-sigma.vercel.app";
const AUTH_TOKEN = process.env.MISSION_CONTROL_AUTH_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENCLAW_API = process.env.OPENCLAW_API || "http://localhost:18789";
const MAX_REVIEW_CYCLES = 3;

interface GitHubPReviewComment {
  body: string;
  user: { login: string };
  created_at: string;
}

async function fetchPRComments(owner: string, repo: string, pullNumber: number): Promise<string> {
  if (!GITHUB_TOKEN) {
    console.error("[dispatch-pr-reviews] GITHUB_TOKEN not set");
    return "";
  }
  
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}/comments`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  
  if (!res.ok) {
    console.error(`[dispatch-pr-reviews] Failed to fetch PR comments: ${res.status}`);
    return "";
  }
  
  const comments: GitHubPReviewComment[] = await res.json();
  const sentinelComments = comments
    .filter(c => c.user.login === "axislabs-bot" || c.user.login === "sentinel")
    .map(c => c.body)
    .join("\n\n---\n\n");
  
  return sentinelComments;
}

function extractPRNumber(prUrl: string): { owner: string; repo: string; number: number } | null {
  const match = prUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
}

async function reDispatchAgent(
  task: typeof schema.tasks.$inferSelect,
  reviewComments: string
): Promise<boolean> {
  if (!AUTH_TOKEN) {
    console.error("[dispatch-pr-reviews] MISSION_CONTROL_AUTH_TOKEN not set");
    return false;
  }
  
  // Build the re-dispatch prompt
  const prompt = `You are being re-dispatched to fix PR review issues.

## Original Task
**Title:** ${task.title}
**Description:** ${task.description || "No description"}

## Repository
${task.repo}

## Branch
${task.branch}

## PR URL
${task.prUrl}

## Sentinel's Review Comments
The following issues were flagged by Sentinel:

${reviewComments}

## Your Task
1. Read the review comments above carefully
2. Fix the flagged issues on the same branch (\`${task.branch}\`)
3. Push your changes with: \`git push --force-with-lease origin ${task.branch}\`
4. Once pushed, update the task status to mark that fixes have been applied

## Important
- Do NOT create a new branch - fix on the existing branch
- Force push to update the PR with your fixes
- After pushing, the PR will be auto-reviewed again by Sentinel`;

  try {
    // Call OpenClaw to spawn the agent
    const response = await fetch(`${OPENCLAW_API}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agentId: task.assignedAgentId,
        task: prompt,
        label: `fix-pr-${task.shortId}`,
        metadata: {
          taskId: task.id,
          originalTask: task.title,
          prUrl: task.prUrl,
          reviewCycle: task.reviewCycleCount + 1,
        },
      }),
    });
    
    if (!response.ok) {
      console.error(`[dispatch-pr-reviews] Failed to spawn agent: ${response.status}`);
      return false;
    }
    
    console.log(`[dispatch-pr-reviews] Re-dispatched agent ${task.assignedAgentId} for task ${task.shortId}`);
    return true;
  } catch (error) {
    console.error(`[dispatch-pr-reviews] Error dispatching agent:`, error);
    return false;
  }
}

async function updateTask(
  taskId: string,
  updates: Partial<typeof schema.tasks.$inferInsert>
) {
  const response = await fetch(`${MISSION_CONTROL_URL}/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify(updates),
  });
  
  if (!response.ok) {
    console.error(`[dispatch-pr-reviews] Failed to update task: ${response.status}`);
    return false;
  }
  
  return true;
}

async function main() {
  console.log("[dispatch-pr-reviews] Starting PR review feedback loop...");
  
  if (!db) {
    console.error("[dispatch-pr-reviews] Database not configured");
    return;
  }
  
  // Find tasks that need re-dispatch
  const blockedTasks = await db
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "review"),
        eq(schema.tasks.prStatus, "changes_requested")
      )
    );
  
  console.log(`[dispatch-pr-reviews] Found ${blockedTasks.length} tasks with requested changes`);
  
  for (const task of blockedTasks) {
    console.log(`[dispatch-pr-reviews] Processing task ${task.shortId}: ${task.title}`);
    
    // Check cycle limit
    if (task.reviewCycleCount >= MAX_REVIEW_CYCLES) {
      console.log(`[dispatch-pr-reviews] Task ${task.shortId} exceeded max review cycles (${MAX_REVIEW_CYCLES}), assigning to human`);
      
      // Assign to human and stop the cycle
      await fetch(`${MISSION_CONTROL_URL}/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          humanAssignee: "roger",
          status: "inbox",
          reviewNotes: `Auto-assigned: Exceeded ${MAX_REVIEW_CYCLES} review cycles without resolution.`,
        }),
      });
      
      // Log activity
      await db.insert(schema.activityLog).values({
        agentId: "system",
        actionType: "review_cycle_exceeded",
        description: `Task ${task.shortId} exceeded max review cycles, assigned to Roger`,
        metadata: { taskId: task.id, reviewCycleCount: task.reviewCycleCount },
      }).catch(() => {});
      
      continue;
    }
    
    // Extract PR info and fetch comments
    const prInfo = task.prUrl ? extractPRNumber(task.prUrl) : null;
    let reviewComments = task.reviewNotes || "";
    
    if (prInfo) {
      reviewComments = await fetchPRComments(prInfo.owner, prInfo.repo, prInfo.number);
    }
    
    if (!reviewComments) {
      console.log(`[dispatch-pr-reviews] No review comments found for task ${task.shortId}, using existing reviewNotes`);
      reviewComments = task.reviewNotes || "Please review the PR and address any issues.";
    }
    
    // Re-dispatch the agent
    const dispatched = await reDispatchAgent(task, reviewComments);
    
    if (dispatched) {
      // Increment cycle count
      await fetch(`${MISSION_CONTROL_URL}/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          reviewCycleCount: task.reviewCycleCount + 1,
          status: "in_progress",
        }),
      });
      
      // Log activity
      await db.insert(schema.activityLog).values({
        agentId: task.assignedAgentId || "system",
        actionType: "review_dispatch",
        description: `Re-dispatched for review cycle ${task.reviewCycleCount + 1}`,
        metadata: { 
          taskId: task.id, 
          reviewCycleCount: task.reviewCycleCount + 1,
          prUrl: task.prUrl,
        },
      }).catch(() => {});
      
      console.log(`[dispatch-pr-reviews] Successfully re-dispatched task ${task.shortId} for cycle ${task.reviewCycleCount + 1}`);
    }
  }
  
  console.log("[dispatch-pr-reviews] Done");
}

main().catch(console.error);