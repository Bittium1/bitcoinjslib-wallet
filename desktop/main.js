'use strict';

const path = require('node:path');
const { app, BrowserWindow, dialog, Menu, session, shell } = require('electron');
const { startWalletServer } = require('./backend');
const { loadDesktopConfig } = require('./config');

let mainWindow = null;
let walletServer = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow)
      return;
    if (mainWindow.isMinimized())
      mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow(baseUrl) {
  const expectedOrigin = new URL(baseUrl).origin;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 650,
    show: false,
    backgroundColor: '#303641',
    title: 'SF Bitcoin Devs Wallet',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    let targetOrigin = '';
    try {
      targetOrigin = new URL(targetUrl).origin;
    } catch (error) {
      event.preventDefault();
      return;
    }
    if (targetOrigin !== expectedOrigin)
      event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(baseUrl);
}

async function showStartupFailure(error, configPath) {
  const result = await dialog.showMessageBox({
    type: 'error',
    title: 'Local wallet startup failed',
    message: 'The desktop wallet could not connect to local Bitcoin Core and Fulcrum.',
    detail: `${error.message}\n\nConfiguration: ${configPath}`,
    buttons: ['Open configuration folder', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });
  if (result.response === 0)
    shell.showItemInFolder(configPath);
  app.quit();
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  let desktopConfig;
  try {
    desktopConfig = loadDesktopConfig({ userDataPath: app.getPath('userData') });
    walletServer = await startWalletServer({
      root: path.resolve(__dirname, '..'),
      bitcoinCli: desktopConfig.bitcoinCli,
      bitcoinDataDir: desktopConfig.bitcoinDataDir,
      electrumHost: desktopConfig.electrumHost,
      electrumPort: desktopConfig.electrumPort,
      port: desktopConfig.port,
      broadcastEnabled: desktopConfig.broadcastEnabled
    });
  } catch (error) {
    const configPath = desktopConfig && desktopConfig.configPath ?
      desktopConfig.configPath : path.join(app.getPath('userData'), 'wallet-config.json');
    await showStartupFailure(error, configPath);
    return;
  }

  createWindow(walletServer.url);
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && walletServer)
    createWindow(walletServer.url);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit();
});

app.on('before-quit', () => {
  if (walletServer)
    walletServer.server.close();
});
