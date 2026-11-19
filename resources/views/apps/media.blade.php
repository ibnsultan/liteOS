{{-- Media: the app window's page (AppsController). Its scripts and styles are in public/assets/apps/media/. --}}
<x-layout-window app="media" title="Media" :styles="['media.css']" :scripts="['app.js']">
<div class="pl" id="pl">
  <!-- title bar (the shell draws the window buttons on the right) -->
  <header class="pl-titlebar" id="titlebar">
    <button class="pl-tb-btn" id="backBtn" title="Back to library" aria-label="Back to library" hidden></button>
    <img class="pl-tb-icon" id="tbIcon" alt="">
    <span class="pl-tb-name">Media</span>
  </header>

  <div class="pl-body">
    <!-- library navigation -->
    <nav class="pl-nav" id="nav" aria-label="Library">
      <button class="pl-nav-item" data-view="home"><span data-i="home"></span><span>Home</span></button>
      <button class="pl-nav-item" data-view="photos"><span data-i="image"></span><span>Photos</span></button>
      <button class="pl-nav-item" data-view="music"><span data-i="music"></span><span>Music library</span></button>
      <button class="pl-nav-item" data-view="videos"><span data-i="video"></span><span>Video library</span></button>
      <button class="pl-nav-item" data-view="tv"><svg class="ico" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 3l4 4 4-4"/></svg><span>Live TV</span></button>
      <div class="pl-nav-sep"></div>
      <button class="pl-nav-item" data-view="queue"><span data-i="list"></span><span>Play queue</span><b class="pl-count" id="qCount"></b></button>
    </nav>

    <main class="pl-main" id="main">
      <section class="pl-page" data-page="home">
        <h1>Home</h1>
        <div class="pl-actions">
          <button class="btn" id="openBtn">Open file(s)</button>
          <button class="btn" id="openFolderBtn">Open folder</button>
        </div>
        <h2>Recent media</h2>
        <div class="pl-grid" id="recent"></div>
      </section>

      <section class="pl-page" data-page="photos" hidden>
        <div class="pl-pagehead"><h1>Photos</h1><span class="spacer"></span><button class="btn" id="slideAll">Slideshow</button></div>
        <div id="photoList"></div>
      </section>

      <section class="pl-page" data-page="music" hidden>
        <h1>Music library</h1>
        <div class="pl-actions">
          <button class="btn btn-primary" id="playAllMusic">Play all</button>
          <button class="btn" id="shuffleAllMusic">Shuffle and play</button>
        </div>
        <div class="pl-table" id="musicList"></div>
      </section>

      <section class="pl-page" data-page="videos" hidden>
        <h1>Video library</h1>
        <div class="pl-grid" id="videoList"></div>
      </section>

      <section class="pl-page" data-page="tv" hidden>
        <h1>Live TV</h1>
        <div class="pl-tvbar">
          <input class="input" type="search" id="tvSearch" placeholder="Search channels" aria-label="Search channels" disabled>
          <select class="select" id="tvSource" aria-label="Show" hidden></select>
          <select class="select" id="tvGroup" aria-label="Group" hidden></select>
          <span class="spacer"></span>
          <button class="btn pl-iconbtn" id="tvRefresh" title="Refresh playlists" aria-label="Refresh playlists"><span data-i="reload"></span></button>
          <button class="btn btn-primary" id="tvAdd">New channel</button>
        </div>
        <div class="pl-channels" id="tvList"></div>
      </section>

      <section class="pl-page" data-page="queue" hidden>
        <h1>Play queue</h1>
        <div class="pl-actions">
          <button class="btn" id="addBtn">Add files</button>
          <button class="btn" id="clearBtn">Clear</button>
        </div>
        <div class="pl-table" id="qlist"></div>
      </section>

      <!-- now playing: the video picture, or the song view -->
      <section class="pl-now-view" id="nowView" hidden>
        <div class="pl-stage" id="stage" tabindex="0" aria-label="Player">
          <video id="video" playsinline preload="metadata" crossorigin="anonymous"></video>
          <div class="pl-audio" id="audioView" hidden>
            <div class="pl-cover" id="cover"><span id="coverIcon"></span></div>
            <div class="pl-now">
              <div class="pl-now-title" id="nowTitle"></div>
              <div class="pl-now-sub" id="nowSub"></div>
            </div>
            <canvas class="pl-viz" id="viz" width="640" height="120" aria-hidden="true"></canvas>
          </div>
          <div class="pl-flash" id="flash" aria-hidden="true"></div>
          <div class="pl-loader" id="spinner" role="status" aria-label="Loading" hidden></div>
          <div class="pl-error" id="error" hidden></div>
          <div class="pl-resume" id="resume" hidden></div>
        </div>
      </section>

      <div class="pl-uploading" id="uploading" hidden><i></i><span></span></div>
    </main>
  </div>

  <!-- photo viewer (covers everything below the title bar) -->
  <div class="pl-viewer" id="viewer" hidden tabindex="-1">
    <div class="pl-vbar">
      <div class="pl-vname"><b id="vName"></b><span id="vIndex"></span></div>
      <button class="pl-vbtn" id="vZoomOut" title="Zoom out (-)" aria-label="Zoom out"><span data-i="zoomOut"></span></button>
      <span class="pl-vzoom" id="vZoom">100%</span>
      <button class="pl-vbtn" id="vZoomIn" title="Zoom in (+)" aria-label="Zoom in"><span data-i="zoomIn"></span></button>
      <button class="pl-vbtn" id="vFit" title="Fit (0)" aria-label="Fit"><span data-i="expand"></span></button>
      <button class="pl-vbtn" id="vRotate" title="Rotate (R)" aria-label="Rotate"><span data-i="rotate"></span></button>
      <span class="pl-vsep"></span>
      <button class="pl-vbtn" id="vShow" title="Show in Files" aria-label="Show in Files"><span data-i="folder"></span></button>
      <button class="pl-vbtn" id="vDelete" title="Move to Trash (Delete)" aria-label="Move to Trash"><span data-i="trash"></span></button>
      <button class="pl-vbtn pl-vtext" id="vWall" title="Use as the desktop background">Set as wallpaper</button>
      <button class="pl-vbtn pl-vtext" id="vSlide" title="Slideshow (Space)">Slideshow</button>
      <span class="pl-vsep"></span>
      <button class="pl-vbtn" id="vClose" title="Close (Esc)" aria-label="Close"><span data-i="x"></span></button>
    </div>
    <div class="pl-vstage" id="vStage">
      <img id="vImg" alt="" draggable="false">
      <button class="pl-varrow prev" id="vPrev" aria-label="Previous photo"><span data-i="back"></span></button>
      <button class="pl-varrow next" id="vNext" aria-label="Next photo"><span data-i="forward"></span></button>
    </div>
  </div>

  <!-- transport bar -->
  <footer class="pl-transport" id="controls">
    <div class="pl-seekrow">
<span class="pl-livebadge">Live</span>
            <span class="pl-t" id="curTime">0:00</span>
      <div class="pl-seek" id="seek">
        <div class="pl-seek-track"><div class="pl-buffered" id="buffered"></div><div class="pl-played" id="played"></div><div class="pl-thumb" id="thumb"></div></div>
        <div class="pl-tip" id="tip">0:00</div>
      </div>
      <span class="pl-t" id="durTime">0:00</span>
    </div>
    <div class="pl-bar">
      <button class="pl-np" id="nowBtn" title="Show now playing" disabled>
        <span class="pl-np-art" id="npArt"></span>
        <span class="pl-np-text"><b id="barTitle">Nothing playing</b><small id="barSub">Open a file to start</small></span>
      </button>
      <div class="pl-center">
        <button class="pl-btn" id="shuffleBtn" title="Shuffle" aria-label="Shuffle"></button>
        <button class="pl-btn" id="prevBtn" title="Previous (P)" aria-label="Previous"></button>
        <button class="pl-btn" id="backTenBtn" title="Back 10 seconds (J)" aria-label="Back 10 seconds"></button>
        <button class="pl-btn pl-play" id="playBtn" title="Play (Space)" aria-label="Play"></button>
        <button class="pl-btn" id="fwdBtn" title="Forward 30 seconds (L)" aria-label="Forward 30 seconds"></button>
        <button class="pl-btn" id="nextBtn" title="Next (N)" aria-label="Next"></button>
        <button class="pl-btn" id="repeatBtn" title="Repeat" aria-label="Repeat"></button>
      </div>
      <div class="pl-right">
        <div class="pl-vol">
          <button class="pl-btn" id="muteBtn" title="Mute (M)" aria-label="Mute"></button>
          <input type="range" id="vol" min="0" max="100" value="100" aria-label="Volume">
        </div>
        <button class="pl-btn" id="ccBtn" title="Subtitles (C)" aria-label="Subtitles"></button>
        <button class="pl-btn" id="pipBtn" title="Mini player" aria-label="Mini player"></button>
        <button class="pl-btn" id="fsBtn" title="Full screen (F)" aria-label="Full screen"></button>
        <button class="pl-btn" id="moreBtn" title="More options" aria-label="More options"></button>
      </div>
    </div>
  </footer>
</div>
</x-layout-window>
