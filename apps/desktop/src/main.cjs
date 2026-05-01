const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");

const DEFAULT_SERVER_URL = "http://localhost:3000";
let currentServerUrl = null;

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
}

async function createWindow() {
  const serverUrl = resolveServerUrl();
  currentServerUrl = serverUrl;
  const serverOrigin = new URL(serverUrl).origin;

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "CrewCmd",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
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

app.whenReady().then(() => {
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
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
