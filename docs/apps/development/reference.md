# App reference

What an app is made of, and the SDK it uses to talk to the desktop. For a walk-through, start with [Building an app](new-app.md).

## Where an app lives

```
public/assets/apps/<id>/            the package: manifest.json, the icon, scripts and styles
resources/views/apps/<id>.blade.php the window page that loads it
```

The dots in an id become folders for the window page: `com.example.hello` → `resources/views/apps/com/example/hello.blade.php`. The package folder keeps the dots.

After adding or changing an app, reload the desktop. An app whose manifest has a problem is left out, and the reason is written to `storage/logs/laravel.log`.

## manifest.json

| Field | Required | What it does |
| ----- | -------- | ------------ |
| `id` | yes | The app's id, also its folder name and address (`/apps/<id>`). Lowercase letters, digits, dots and dashes. Use a reverse-domain id such as `com.example.hello`. |
| `name` | yes | Shown in the launcher, the dock, window titles and notifications. |
| `version` | yes | Your version, for example `"1.0.0"`. |
| `entry` | yes | The entry page, for example `"index.html"`. Kept for the future package format. |
| `icon` | yes | The icon file in the package, for example `"icon.svg"`: 64 × 64, no background. |
| `opens` | no | File types the app opens, without dots: `["txt", "md"]`. Used for double-click and **Open with**. When two apps list a type, the built-in one is the default. |
| `window.size` | no | `[width, height]` of a new window. Default `[960, 640]`. |
| `window.chrome` | no | `"standard"` (LiteOS draws the title bar, the default) or `"custom"` (the app draws its own). |
| `window.single` | no | `true` to allow one window only: opening the app again brings it forward. |
| `window.reportsReady` | no | `true` to show the opening screen until the app calls `OS.win.loaded()`. |

`sdk`, `summary`, `author`, `category` and `permissions` are part of the planned package format. Set them, though nothing checks them yet.

## The window page

```blade
<x-layout-window app="com.example.hello" title="Hello" :styles="['hello.css']" :scripts="['app.js']">
  ...the app's markup...
</x-layout-window>
```

| Attribute | What it is |
| --------- | ---------- |
| `app` | The app id. |
| `title` | The page title. |
| `:styles` | Your stylesheets, relative to the package folder. |
| `:scripts` | Your scripts in load order, relative to the package folder. Default `['app.js']`. |

The layout loads LiteOS's styles and the SDK before your files. Its classes, such as `btn`, `btn-primary` and `input`, follow the user's theme, text size and contrast settings.

## The SDK

Start your code with `LiteOS.ready((OS) => { ... })`. It runs once the page and the theme are ready, and hands you the SDK as `OS`.

### Start-up

| | |
| - | - |
| `OS.args` | What the app was opened with, for example `{ path: '/Documents/a.txt' }`. |
| `OS.user` | The signed-in user: `name`, `username`, `role`, and `can`, what the account may do. |
| `OS.settings` | The user's settings, such as `theme` and `textSize`. |
| `OS.inShell` | `true` inside a desktop window, `false` when the page is opened on its own. |

### The window: `OS.win`

| | |
| - | - |
| `setTitle(title)` | Names the window. |
| `setDirty(dirty)` | Marks unsaved changes; closing the window then asks first. |
| `setMenus(menus)` | The app's menus in the top bar: `[{ label, items: [{ label, key, action }] }]`. |
| `loading(text, progress)` / `loaded()` | With `reportsReady`: a line of text on the opening screen, then remove it. |
| `close()` | Closes the window. |
| `dragRegion(el)` | Makes an element drag the window, for a custom title bar. |

### Files: `OS.fs`

| | |
| - | - |
| `read(path)` | Reads a text file: `{ content, entry }`. |
| `write(path, content)` | Saves text, creating or replacing the file. |
| `list(path)` / `stat(path)` | A folder's entries, or one entry. |
| `mkdir(path)`, `rename(path, name)`, `move(paths, dest)`, `copy(paths, dest)`, `remove(paths)` | Make, rename, move, copy, or move to the Trash. |
| `upload(dir, files)` | Uploads files from the user's computer into a folder. |
| `rawUrl(path)` | A URL for a file's bytes, for `<img>`, `<video>` or `fetch`. |
| `recent()` / `search(query)` | Recently opened files, or files found by name. |

### Dialogs: `OS.dialog`

| | |
| - | - |
| `open({ title, accept })` | LiteOS's Open window. Returns the chosen path, or `null`. |
| `save({ title, defaultName, ext })` | LiteOS's Save window. Returns the path to save to, or `null`. |
| `folder({ title })` | Choose a folder. |
| `confirm({ title, message, okLabel, danger })` | `true` or `false`. |
| `prompt({ title, label, value })` | The text entered, or `null`. |
| `alert({ title, message })` | A message with an OK button. |

### Everything else

| | |
| - | - |
| `OS.notify(message, type)` | A notification from the desktop. `type` is `'info'`, `'success'` or `'error'`. |
| `OS.open(appId, args)` | Opens another app, for example `OS.open('documents', { path })`. |
| `OS.openFile(path)` | Opens a file in its default app. |
| `OS.saveSettings(changes)` / `OS.onSettings(fn)` | Change the user's settings, or hear when they change. |
| `OS.menu(items, at)` | A context menu at a mouse event. |
| `OS.icon(name, size)` | One of LiteOS's line icons, for toolbars. |
| `OS.util` | Helpers: `basename`, `dirname`, `join`, `ext`, `formatSize`, `formatDate`, `escape`, `debounce`. |

USB drives, printing and the rest of a LiteLink device are covered in [Apps on a LiteLink device](litelink.md).

## Testing

- Test inside a desktop window, not only in a browser tab: dialogs, menus, the title and notifications only exist there.
- Use a test account. An app can read and write everything on the signed-in user's drive.
- Check light and dark themes, a larger text size and high contrast.
