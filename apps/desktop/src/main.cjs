const DEFAULT_SERVER_URL = "http://localhost:3000";
let app = null;
let BrowserWindow = null;
let Notification = null;
let ipcMain = null;
let shell = null;
let currentServerUrl = null;
let mainWindow = null;

function resolveServerUrl() {
  const rawUrl = process.env.CREWCMD_DESKTOP_SERVER_URL || DEFAULT_SERVER_URL;
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid CREWCMD_DESKTOP_SERVER_URL: ${rawUrl}`);
  }

  const isHttps = url.protocol === "https:";
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (!isHttps && !isLocalHttp) {
    throw new Error("CrewCmd desktop only accepts HTTPS or localhost HTTP server URLs");
  }

  return url.toString();
}

function isSameOrigin(targetUrl, serverOrigin) {
  try {
    return new URL(targetUrl).origin === serverOrigin;
  } catch {
    return false;
  }
}

function bridgeOk(data) {
  return { ok: true, data };
}

function bridgeFailure(code, message, retryable = false) {
  return { ok: false, code, message, retryable };
}

function isSupportedExternalUrl(targetUrl) {
  try {
    const url = new URL(targetUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeNotificationPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  const route = typeof payload.route === "string" ? payload.route.trim() : "";
  const severity = typeof payload.severity === "string" ? payload.severity.trim() : "info";

  if (!title || !body) return null;
  if (route && !route.startsWith("/")) return null;

  return {
    id: typeof payload.id === "string" ? payload.id : undefined,
    title,
    body,
    route: route || "/",
    severity,
  };
}

function navigateToCrewCmdRoute(route) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const serverUrl = currentServerUrl || resolveServerUrl();
  const nextUrl = new URL(route, serverUrl);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.loadURL(nextUrl.toString()).catch(() => undefined);
}

function registerBridgeHandlers() {
  ipcMain.handle("desktop.app.getInfo", () =>
    bridgeOk({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      releaseChannel: process.env.CREWCMD_DESKTOP_RELEASE_CHANNEL || "development",
      shellMode: "server-url",
    })
  );

  ipcMain.handle("desktop.server.getUrl", () => bridgeOk({ url: currentServerUrl || resolveServerUrl() }));

  ipcMain.handle("desktop.shell.openExternal", async (_event, url) => {
    if (!isSupportedExternalUrl(url)) {
      return bridgeFailure("invalid_input", "Unsupported external URL", false);
    }

    await shell.openExternal(url);
    return bridgeOk({ opened: true });
  });

  ipcMain.handle("desktop.notifications.getPermission", () =>
    bridgeOk({ permission: Notification.isSupported() ? "granted" : "unsupported" })
  );

  ipcMain.handle("desktop.notifications.requestPermission", () =>
    bridgeOk({ permission: Notification.isSupported() ? "granted" : "unsupported" })
  );

  ipcMain.handle("desktop.notifications.show", (_event, payload) => {
    if (!Notification.isSupported()) {
      return bridgeFailure("unsupported_platform", "Desktop notifications are not supported", false);
    }

    const notificationPayload = normalizeNotificationPayload(payload);
    if (!notificationPayload) {
      return bridgeFailure("invalid_input", "Notification title, body, and route are required", false);
    }

    const notification = new Notification({
      title: notificationPayload.title,
      body: notificationPayload.body,
      urgency: notificationPayload.severity === "critical" ? "critical" : "normal",
    });
    notification.on("click", () => navigateToCrewCmdRoute(notificationPayload.route));
    notification.show();

    return bridgeOk({ id: notificationPayload.id ?? null, shown: true });
  });
}

async function createWindow() {
  const serverUrl = resolveServerUrl();
  currentServerUrl = serverUrl;
  const serverOrigin = new URL(serverUrl).origin;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "CrewCmd",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: `${__dirname}/preload.cjs`,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSameOrigin(url, serverOrigin)) return { action: "allow" };
    shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isSameOrigin(url, serverOrigin)) return;
    event.preventDefault();
    shell.openExternal(url).catch(() => undefined);
  });

  await mainWindow.loadURL(serverUrl);
}

async function bootstrap() {
  ({ app, BrowserWindow, Notification, ipcMain, shell } = await import("electron"));

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  await app.whenReady();
  registerBridgeHandlers();

  createWindow().catch((error) => {
    console.error(error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        console.error(error);
        app.quit();
      });
    }
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
