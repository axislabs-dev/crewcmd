import crypto from "node:crypto";
import http2 from "node:http2";
import { and, eq } from "drizzle-orm";
import { db, withRetry } from "@/db";
import { mobilePushDevices } from "@/db/schema";

type PushProvider = "apns" | "fcm";

type PushDevice = {
  id: string;
  provider: string;
  token: string;
  platform: string;
};

export type AgentReplyNotification = {
  userId: string;
  companyId: string;
  agentId: string;
  sessionId: string;
  sessionKey: string;
  messageId: string;
  body: string;
};

type PushPayload = {
  title: string;
  body: string;
  url: string;
  data: Record<string, string>;
};

let fcmAccessToken: { token: string; expiresAt: number } | null = null;

function base64Url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload: Record<string, unknown>, privateKey: string, header: Record<string, unknown> = {}) {
  const encodedHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", ...header }));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

function getPushEnabled() {
  return process.env.CREWCMD_PUSH_ENABLED === "true";
}

function getApnsHost() {
  return process.env.CREWCMD_PUSH_APNS_ENV === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

function normalizePrivateKey(value: string | undefined) {
  return value?.replace(/\\n/g, "\n").trim() || "";
}

export function buildAgentReplyPayload(params: AgentReplyNotification): PushPayload {
  const preview = params.body.replace(/\s+/g, " ").trim().slice(0, 140);
  const url = `/chat?agent=${encodeURIComponent(params.agentId)}&sessionKey=${encodeURIComponent(params.sessionKey)}&messageId=${encodeURIComponent(params.messageId)}`;
  return {
    title: `${params.agentId} responded`,
    body: preview || "Your agent has a new response.",
    url,
    data: {
      kind: "agent_reply",
      agentId: params.agentId,
      sessionId: params.sessionId,
      sessionKey: params.sessionKey,
      messageId: params.messageId,
      url,
    },
  };
}

async function getFcmAccessToken() {
  if (fcmAccessToken && fcmAccessToken.expiresAt > Date.now() + 60_000) {
    return fcmAccessToken.token;
  }

  const raw = process.env.CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;

  let serviceAccount: { client_email?: string; private_key?: string; project_id?: string };
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    console.error("[mobile-push] Invalid CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON");
    return null;
  }

  if (!serviceAccount.client_email || !serviceAccount.private_key) return null;

  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    },
    normalizePrivateKey(serviceAccount.private_key)
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    console.error("[mobile-push] FCM auth failed:", await response.text());
    return null;
  }

  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;

  fcmAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + ((body.expires_in ?? 3600) * 1000),
  };
  return fcmAccessToken.token;
}

async function sendFcm(device: PushDevice, payload: PushPayload) {
  const raw = process.env.CREWCMD_PUSH_FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return { sent: false, reason: "missing_fcm_config" };
  const serviceAccount = JSON.parse(raw) as { project_id?: string };
  if (!serviceAccount.project_id) return { sent: false, reason: "missing_fcm_project" };

  const accessToken = await getFcmAccessToken();
  if (!accessToken) return { sent: false, reason: "missing_fcm_access_token" };

  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: device.token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
        android: {
          priority: "HIGH",
          notification: { click_action: "OPEN_CHAT" },
        },
        apns: {
          payload: { aps: { sound: "default" } },
        },
      },
    }),
  });

  if (!response.ok) {
    console.error("[mobile-push] FCM send failed:", await response.text());
    return { sent: false, reason: "fcm_send_failed" };
  }

  return { sent: true };
}

async function sendApns(device: PushDevice, payload: PushPayload) {
  const teamId = process.env.CREWCMD_PUSH_APNS_TEAM_ID;
  const keyId = process.env.CREWCMD_PUSH_APNS_KEY_ID;
  const privateKey = normalizePrivateKey(process.env.CREWCMD_PUSH_APNS_PRIVATE_KEY);
  const bundleId = process.env.CREWCMD_PUSH_APNS_BUNDLE_ID;
  if (!teamId || !keyId || !privateKey || !bundleId) {
    return { sent: false, reason: "missing_apns_config" };
  }

  const now = Math.floor(Date.now() / 1000);
  const jwt = signJwt({ iss: teamId, iat: now }, privateKey, { kid: keyId });
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: "default",
    },
    ...payload.data,
  });

  return new Promise<{ sent: boolean; reason?: string }>((resolve) => {
    const client = http2.connect(getApnsHost());
    client.on("error", (error) => {
      console.error("[mobile-push] APNs connection failed:", error);
      resolve({ sent: false, reason: "apns_connection_failed" });
    });

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${jwt}`,
      "apns-topic": bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();
      if (status >= 200 && status < 300) {
        resolve({ sent: true });
        return;
      }
      console.error("[mobile-push] APNs send failed:", status, responseBody);
      resolve({ sent: false, reason: "apns_send_failed" });
    });
    request.end(body);
  });
}

async function sendToDevice(device: PushDevice, payload: PushPayload) {
  const provider = device.provider as PushProvider;
  if (provider === "fcm") return sendFcm(device, payload);
  if (provider === "apns") return sendApns(device, payload);
  return { sent: false, reason: "unsupported_provider" };
}

export async function sendAgentReplyNotification(params: AgentReplyNotification) {
  if (!getPushEnabled() || !db) {
    return { attempted: 0, sent: 0, skipped: true };
  }

  const devices = await withRetry(() =>
    db!.select({
      id: mobilePushDevices.id,
      provider: mobilePushDevices.provider,
      token: mobilePushDevices.token,
      platform: mobilePushDevices.platform,
    })
      .from(mobilePushDevices)
      .where(and(
        eq(mobilePushDevices.userId, params.userId),
        eq(mobilePushDevices.companyId, params.companyId),
        eq(mobilePushDevices.enabled, true),
      ))
  );

  const payload = buildAgentReplyPayload(params);
  let sent = 0;
  for (const device of devices) {
    try {
      const result = await sendToDevice(device, payload);
      if (result.sent) sent += 1;
    } catch (error) {
      console.error("[mobile-push] Device send failed:", error);
    }
  }

  return { attempted: devices.length, sent, skipped: false };
}
