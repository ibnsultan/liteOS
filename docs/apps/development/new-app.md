# Building an app

This tutorial builds a small app, **Hello**, that opens and saves text files. It takes a few minutes and needs no build tools: an app is a folder of static files plus one page that loads them.

Every manifest field and SDK call used here is listed in the [reference](reference.md).

## What you need

- A LiteOS checkout you can run, and an account to test with. Use a test account rather than your own: an app can read and write everything on the signed-in user's drive.
- A text editor.

## 1. Choose an id

Every app has an id. It names the app's folder and its address (`/apps/<id>`). Use a reverse-domain id with a dot, so it can never clash with a built-in app:

```
com.example.hello
```

Ids are lowercase letters, digits, dots and dashes.

## 2. Create the package

Make the folder `public/assets/apps/com.example.hello/`. Everything the app needs goes in here.

Add `manifest.json`, which tells LiteOS the app's name, icon and window:

```json
{
  "id": "com.example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "sdk": "^1.0",
  "summary": "Opens and saves text files.",
  "author": "Example",
  "category": "Utilities",
  "entry": "index.html",
  "icon": "icon.svg",
  "opens": ["txt"],
  "window": { "size": [520, 360], "chrome": "standard" }
}
```

`opens` lists the file types the app can open. Here it's `txt`, so Hello appears under **Open with** for text files.

Add `icon.svg`, a 64 × 64 icon with no background of its own:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="#3D7BF2"/><path d="M22 20v24M42 20v24M22 32h20" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>
```

## 3. Add the window page

The window page is what LiteOS shows inside the app's window. Create `resources/views/apps/com/example/hello.blade.php` (the dots in the id become folders):

```blade
<x-layout-window app="com.example.hello" title="Hello" :styles="['hello.css']" :scripts="['app.js']">
<div class="hello">
  <textarea class="input" id="text" aria-label="Text" placeholder="Say hello"></textarea>
  <div class="actions">
    <button class="btn" id="open">Open</button>
    <button class="btn btn-primary" id="save">Save</button>
  </div>
</div>
</x-layout-window>
```

`<x-layout-window>` loads LiteOS's styles and the SDK, then your own files. The `input`, `btn` and `btn-primary` classes come with it, so the app matches the rest of the desktop in light and dark.

Add `hello.css` to the package:

```css
.hello { display: flex; flex-direction: column; gap: 10px; height: 100vh; padding: 14px; box-sizing: border-box; }
.hello textarea { flex: 1; resize: none; }
.hello .actions { display: flex; justify-content: flex-end; gap: 8px; }
```

## 4. Write the app

Add `app.js` to the package. Your code runs inside `LiteOS.ready`, which hands you the SDK as `OS`:

```js
LiteOS.ready(async (OS) => {
  const text = document.getElementById('text');
  let path = OS.args.path || null; // set when the app was opened with a file

  function showTitle() {
    OS.win.setTitle((path ? OS.util.basename(path) : 'Untitled') + ' - Hello');
  }

  async function open() {
    const chosen = await OS.dialog.open({ title: 'Open', accept: ['txt'] });
    if (!chosen) return;
    text.value = (await OS.fs.read(chosen)).content;
    path = chosen;
    OS.win.setDirty(false);
    showTitle();
  }

  async function save() {
    const target = path || await OS.dialog.save({ title: 'Save', defaultName: 'Hello.txt', ext: 'txt' });
    if (!target) return;
    await OS.fs.write(target, text.value);
    path = target;
    OS.win.setDirty(false);
    showTitle();
    OS.notify('Saved ' + OS.util.basename(path) + '.', 'success');
  }

  document.getElementById('open').addEventListener('click', open);
  document.getElementById('save').addEventListener('click', save);
  text.addEventListener('input', () => OS.win.setDirty(true));

  if (path) text.value = (await OS.fs.read(path)).content;
  showTitle();
});
```

What each part of the SDK does here:

- `OS.args.path` is the file the app was opened with, for example by a double-click in Files.
- `OS.dialog.open` and `OS.dialog.save` show LiteOS's own Open and Save windows.
- `OS.fs.read` and `OS.fs.write` read and write files on the user's drive.
- `OS.win.setTitle` names the window, and `OS.win.setDirty(true)` marks it as having unsaved changes, so closing it asks first.
- `OS.notify` shows a notification from the desktop.

## 5. Try it

Reload the desktop. Hello is now in the launcher. Open it, type something and press **Save**. Then find the file in Files and double-click it, or right-click it and choose **Open with › Hello**: the app opens with the file loaded.

If Hello isn't in the launcher, check `storage/logs/laravel.log` for a line like `App in com.example.hello/ skipped: ...`, which says what's wrong with the manifest. If the window shows a 404 page, the window page is missing or in the wrong folder.

## 6. Make it feel at home

A few small additions make an app behave like the built-in ones:

- **A menu bar.** `OS.win.setMenus` adds menus to the window, with keyboard shortcuts:

  ```js
  OS.win.setMenus([{ label: 'File', items: [
    { label: 'Open…', key: 'Ctrl+O', action: open },
    { label: 'Save', key: 'Ctrl+S', action: save },
  ] }]);
  ```

- **An opening screen.** Add `"reportsReady": true` to the manifest's `window`, then call `OS.win.loaded()` once the app is ready. The window shows the app's icon until then, instead of a half-drawn page.
- **Errors.** Wrap file work in `try`/`catch` and pass the message to `OS.notify(e.message, 'error')`.

## 7. Remove it

Delete the package folder and the window page, then reload the desktop.

## Next steps

- The [reference](reference.md) lists every manifest field and the rest of the SDK: files, dialogs, menus, settings and more.
- [Apps on a LiteLink device](litelink.md) covers USB drives, printing and the device's other features.
