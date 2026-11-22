# Apps on a LiteLink device

## What LiteLink is

[LiteLink](https://github.com/ibnsultan/litelink) is a lightweight, Debian-based operating system for thin clients and small PCs. It connects as remote Terminal for different protocal such as RDP and provided support for web-Kiosk

LiteOS can run on a LiteLink device. LiteLink then gives LiteOS a bridge to the device itself: its USB drives, printers, sound, network, Bluetooth and power. On an ordinary computer there is no bridge, and LiteOS works as it always does.

## What it means for an app

Most apps need nothing special. USB drives come through the same file calls and Open and Save windows as your drive, and printing has one call. Off a LiteLink device none of this appears, so an app written this way works the same everywhere.

## Telling whether you're on a device

`OS.device` describes the device for this window:

|                         |                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `OS.device.api`       | The device bridge, or `null` when LiteOS isn't on a LiteLink device. Known as soon as the app starts.                                   |
| `OS.device.ready`     | A promise of what the device allows (`{ storage, audio, network, power, print, … }`), or `null`. It never fails.                     |
| `OS.device.has(area)` | Whether one area can be used, such as `'storage'`, `'print'`, `'audio'` or `'bluetooth'`. `false` until `ready` has answered. |
| `OS.device.available` | `true` once the device has answered.                                                                                                    |

```js
if (await OS.device.ready && OS.device.has('storage')) {
  // the device's USB drives can be used here
}
```

## Two rules

**Show device features only when they're there.** Wait for `ready`, then check `has(area)`. When an area isn't there, show nothing of it: no greyed-out button and no "not available" note. The app should look exactly as it does on an ordinary computer.

**Don't use the computer's own files.** On a LiteLink device, the files on the thin client itself are off limits. Don't offer "Upload from this computer", and don't use the browser's file chooser (`<input type="file">`). Use `OS.dialog.open` instead: it lists the user's drive and the USB drives.

```js
const onDevice = !!OS.device.api; // known straight away
if (!onDevice) menu.push({ label: 'Upload from this computer…', action: uploadFromComputer });
```

## USB drives

On a device, the Open and Save windows also list the USB drives that are plugged in. A file on one has a path like this:

```
usb:<drive>:/Reports/q3.docx
```

Treat it like any other path. The usual file calls work on it:

- `OS.fs.list`, `stat`, `read`, `write`, `writeBase64`, `mkdir` and `upload` work on the drive itself. Writing works only when the device allows it; otherwise the call fails with "This USB drive can only be read."
- `rename`, `move`, `copy` and `remove` aren't available on USB drives yet, and fail with "USB drives can't do that yet."
- `OS.fs.isUsb(path)` tells you whether a path is on a USB drive.
- To show a USB file in an `<img>`, `<video>` or `<audio>`, use `await OS.fs.objectUrl(path)` rather than `rawUrl`. Free it with `OS.fs.revokeUrl(url)` when you're done, or let the window close. `fetch(OS.fs.rawUrl(path))` works for USB files too.
- `OS.fs.readBlob(path)` gives a file's contents as a `Blob`, wherever the file is.
- A USB file is read whole, up to 64 MB.
- Don't keep USB paths in a recent-files list: the drive may not be plugged in next time.

## Printing

On a device that allows printing, LiteOS has its own print window, with the device's printers and their options: copies, pages, sides, colour, paper size and orientation. The app hands it a PDF.

|                                             |                                                                                                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OS.canPrint()`                           | Whether `OS.print` will show LiteOS's print window. Check it before making the PDF.                                                                             |
| `OS.print(pdf, { title, copies, pages })` | Prints a PDF (a `Blob`, `ArrayBuffer` or bytes). Resolves to `{ job, printer }`, `null` if the user cancelled, or `false` when LiteOS can't print here. |
| `OS.printJobs()`                          | The user's documents still waiting or printing.                                                                                                                   |
| `OS.cancelPrintJob(job)`                  | Cancels one of them.                                                                                                                                              |

```js
async function print() {
  if (await OS.canPrint()) {
    await OS.print(await makePdf(), { title: docTitle });
    return;
  }
  window.print(); // an ordinary computer: print the usual way
}
```

LiteOS tells the user when a document is waiting, for example because a printer is out of paper, and when it has printed. The app doesn't need to follow the job.

## Other device features

`OS.device.api` also reaches the device's sound, network, Bluetooth and power. Settings uses these for its device pages. An app that wants them must follow the two rules above: check `has(area)` first, and show nothing when the area isn't there. Errors from the device come back as plain sentences, so show them to the user as they are.
