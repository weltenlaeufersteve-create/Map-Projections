const { app, BrowserWindow, ipcMain, dialog } = require('electron');

let win;

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    frame: false,
    backgroundColor: '#0f0e0c',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  win.loadFile('index.html');
});

app.on('window-all-closed', () => app.quit());

ipcMain.on('win:minimize', () => win.minimize());
ipcMain.on('win:maximize', () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('win:close', () => win.close());

ipcMain.handle('dialog:openFiles', async (_, opts) =>
  dialog.showOpenDialog(win, opts)
);
