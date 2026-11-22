{{-- LiteOS itself asked for inside a frame (App\Http\Middleware\TopLevelOnly): the whole tab goes there instead, so
     LiteOS never shows inside itself. A frame that may not move its tab (the Browser app's sandbox) says so. --}}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiteOS</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; font: 13px/1.5 "Segoe UI", system-ui, sans-serif; color: #5a606b; background: transparent; }
  p { margin: 0; padding: 16px; text-align: center; }
</style>
</head>
<body>
<p id="msg" hidden>LiteOS can’t open inside itself. Open it in its own browser tab.</p>
<script>
  (function () {
    var target = @json($target);
    var say = function () { document.getElementById('msg').hidden = false; };
    // a sandboxed or cross-site frame is often stopped without an error, so the message shows if the tab hasn't moved
    setTimeout(say, 800);
    try {
      if (window.top !== window) window.top.location.replace(target);
      else say();
    } catch (e) {
      say();
    }
  })();
</script>
</body>
</html>
