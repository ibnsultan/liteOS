{{-- Shown in the desktop's lock frame once the password was right: tells the desktop to take the lock screen away. --}}
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unlocked</title></head>
<body style="margin:0;background:transparent">
<script>window.parent.postMessage({ type: 'liteos-unlocked' }, location.origin);</script>
</body></html>
