{{-- The boot screen: the LiteOS kite drawn stroke by stroke, then a signal running up its string (the web port of
     LiteLink's Plymouth motion, styled by public/assets/css/boot.css). os.js fades it out once the desktop is ready,
     and switches it to the "shimmer" motion while signing out or shutting down.
     <x-boot :label="'Starting '.$instanceName" /> --}}
@props(['label' => 'Starting LiteOS'])
@php
    // the kite's outline, from the same file the rest of LiteOS uses
    $kite = preg_match('/\sd="([^"]+)"/', (string) @file_get_contents(public_path('assets/img/kite-white.svg')), $m) ? $m[1] : '';
    // the strokes the kite is drawn with: string, right, top, left, spine
    $tail = 'M44 471 C80 468 112 464 132 450 C150 436 172 412 162 390 C152 368 122 364 112 386 C102 408 122 424 156 422 C180 421 215 410 246 390 C282 366 320 334 351 300 C380 268 405 232 440 218 C450 214 460 212 468 211';
    $strokes = [
        $tail,
        'M468 211 C420 194 386 168 362 140 C340 113 326 84 318 38',
        'M318 38 C292 80 250 115 212 136 C185 150 160 162 140 172',
        'M140 172 C162 190 182 220 196 260 C206 292 212 330 212 372',
        'M318 50 C318 110 314 160 302 208 C292 250 276 296 252 334',
    ];
@endphp
<div id="boot" class="boot" role="status" aria-label="{{ $label }}">
  <svg class="boot-kite" viewBox="0 0 552 552" aria-hidden="true">
    <defs>
      <mask id="bk-reveal" maskUnits="userSpaceOnUse" x="-200" y="-200" width="952" height="952">
        @foreach ($strokes as $i => $d)<path class="s s{{ $i + 1 }}" pathLength="1" d="{{ $d }}"></path>@endforeach
      </mask>
      <mask id="bk-sig" maskUnits="userSpaceOnUse" x="-200" y="-200" width="952" height="952">
        <path class="sig" pathLength="1" d="{{ $tail }}"></path>
      </mask>
      <linearGradient id="bk-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0"></stop><stop offset=".5" stop-color="#fff" stop-opacity="1"></stop><stop offset="1" stop-color="#fff" stop-opacity="0"></stop>
      </linearGradient>
      <mask id="bk-shim" maskUnits="userSpaceOnUse" x="-200" y="-200" width="952" height="952">
        <g class="band"><rect x="-260" y="-200" width="260" height="912" fill="url(#bk-grad)" transform="rotate(20 -130 256)"></rect></g>
      </mask>
    </defs>
    <g transform="translate(20 20)">
      <g mask="url(#bk-reveal)">
        <path class="dimmer" d="{{ $kite }}" fill="#f2f5fa" fill-rule="evenodd"></path>
        <path class="sigm" d="{{ $kite }}" fill="#7cc0f2" fill-rule="evenodd" mask="url(#bk-sig)"></path>
        <path class="flash" d="{{ $kite }}" fill="#f2f5fa" fill-rule="evenodd"></path>
        <path class="shim" d="{{ $kite }}" fill="#f2f5fa" fill-rule="evenodd" mask="url(#bk-shim)"></path>
      </g>
    </g>
  </svg>
  <div class="boot-msg"></div>
</div>
{{-- the motion is picked before the first paint: after the first page of a visit (sign-in -> desktop) the kite waits in
     its shimmer motion instead of starting to draw and then jumping to the shimmer when the scripts catch up --}}
<script>try { if (sessionStorage.getItem('los_booted') === '1') document.getElementById('boot').classList.add('shimmer'); } catch (e) {}</script>
