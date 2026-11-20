/* LiteOS: a greeting for whoever opens the browser's developer console on the desktop or the sign-in pages: the kite,
   the name, a line for developers, and a warning against pasting code (the classic way to trick someone into giving
   away their session). The kite is read from the page's own logo file and drawn as a background, because consoles
   only take data: images. Once per page, and only in the top page (not in a framed one, such as the lock screen). */
(function () {
  'use strict';
  if (window.top !== window) return;
  const font = 'system-ui,"Segoe UI",sans-serif';
  const brand = 'color:#2F6FD6;font:700 40px/60px ' + font; // as tall as the kite beside it
  const text = 'color:inherit;font:13px/1.6 ' + font;
  const dim = 'color:#888;font:12px/1.6 ' + font;
  const warn = 'color:#C42B1C;font:600 13px/1.6 ' + font;
  function say(kite) {
    // the kite and the name drawn as one picture, so they line up exactly (a console can't align two styled pieces)
    if (kite) console.log('%c ', 'font-size:1px;padding:30px 110px;background:url("' + kite + '") no-repeat left center/contain');
    else console.log('%cLiteOS', brand);
    console.log('%cA desktop in your browser. Curious how it works, or want to build an app for it?\n' +
      '%cApps get their own window and talk to the desktop through the SDK (window.LiteOS).',
    text, dim);
    console.log('%cA word of caution: if someone asked you to paste something here, don’t. It could give them your files and your account.', warn);
  }
  try {
    fetch(new URL('assets/img/kite-blue.svg', document.baseURI), { cache: 'force-cache' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((svg) => {
        if (!svg.startsWith('<svg')) { say(''); return; }
        // the kite at the left (60 × 60), the name beside it, centred on the same line
        const mark = svg.replace('<svg ', '<svg x="0" y="0" width="60" height="60" ');
        const pic = '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 220 60">' + mark +
          '<text x="70" y="30" dominant-baseline="central" font-family="Segoe UI, system-ui, sans-serif" font-weight="700" font-size="38" fill="#2F6FD6">LiteOS</text></svg>';
        say('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pic));
      }, () => say(''));
  } catch (e) { say(''); }
})();
