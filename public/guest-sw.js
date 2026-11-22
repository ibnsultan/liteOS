/* The guest drive's service worker (docs/account-types.md): where the browser allows one, it answers the guest
   drive's URLs (BASE/os/guestfs/...) for everything in a guest's pages, <img>, <video>, <audio> and downloads
   included, with the same code the pages use (assets/js/guest-drive.js). Pages work without it too; then only
   fetch() reaches a guest's files. Every other request goes to the network untouched, and real accounts never use
   those URLs, so a worker left behind after a guest session changes nothing for them.

   Registered by the shell (os.js) as BASE/guest-sw.js?quota=<bytes>&kinds=<json>, scope BASE. */
'use strict';
importScripts('assets/js/guest-drive.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (self.LOS_guestDrive.handles(new URL(e.request.url))) e.respondWith(self.LOS_guestDrive.handle(e.request));
});
