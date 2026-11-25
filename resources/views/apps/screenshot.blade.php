{{-- Screenshot: the app window's page (AppsController). Its script and styles are in public/assets/apps/screenshot/:
     app.js draws one toolbar: New, picture or recording, what to capture and the delay; with a picture open, the
     markup tools in the middle (markup.js: pen, highlighter, eraser, shapes, text, blur, crop; undo and redo) and Open
     in Whiteboard, Save and Copy on the right; More holds Open file, Save as, zoom and Settings. A narrow window puts
     the markup tools in a bar along the bottom. The desktop does the capturing (public/assets/js/capture.js,
     OS.capture in the SDK), so the keys Ctrl+Alt+S, PrtSc, Alt+PrtSc and Shift+PrtSc work without this window open. --}}
<x-layout-window app="screenshot" title="Screenshot" :styles="['screenshot.css']" :scripts="['markup.js', 'app.js']">
<div class="app ss" id="app">
  <header class="ss-title" id="titlebar">
    <span class="ss-title-icon" id="tbIcon" aria-hidden="true"></span>
    <span class="ss-title-name" id="tbName">Screenshot</span>
    <span class="spacer"></span>
    <span class="ss-title-controls" id="tbControls"></span>
  </header>
  <div class="ss-home" id="home">
    <div class="ss-bar" id="bar" role="toolbar" aria-label="Screenshot">
      <span class="ss-left">
        <button type="button" class="ss-btn ss-new" id="newBtn" title="New screenshot (Ctrl+N)" aria-label="New"></button>
        <span class="ss-kind" role="group" aria-label="Kind">
          <button type="button" class="ss-ib" id="kindPicture" title="Picture" aria-label="Picture"></button>
          <button type="button" class="ss-ib" id="kindRecording" title="Recording" aria-label="Recording"></button>
        </span>
        <button type="button" class="ss-ib ss-drop" id="modeBtn" aria-haspopup="menu"></button>
        <button type="button" class="ss-ib ss-drop" id="delayBtn" aria-haspopup="menu"></button>
      </span>
      <span class="ss-mid" id="midSlot">
        <span class="ss-toolswrap" id="toolsWrap" hidden>
          <span class="ss-tools-main" id="toolsMain">
            <span class="ss-toolgroup" id="toolGroup" role="group" aria-label="Tools"></span>
            <span class="ss-vsep" aria-hidden="true"></span>
            <button type="button" class="ss-ib" id="undoBtn" title="Undo (Ctrl+Z)" aria-label="Undo"></button>
            <button type="button" class="ss-ib" id="redoBtn" title="Redo (Ctrl+Y)" aria-label="Redo"></button>
          </span>
          <span class="ss-cropbar" id="cropBar" role="group" aria-label="Crop" hidden>
            <span class="ss-crop-size" id="cropSize"></span>
            <button type="button" class="ss-btn ss-primary" id="cropApply" title="Apply (Enter)"></button>
            <button type="button" class="ss-btn" id="cropCancel" title="Cancel (Esc)"></button>
          </span>
        </span>
      </span>
      <span class="ss-right">
        <span class="ss-acts" id="edActs" hidden>
          <button type="button" class="ss-ib ss-board" id="boardBtn" title="Open in Whiteboard" aria-label="Whiteboard"></button>
          <button type="button" class="ss-ib" id="saveBtn" title="Save (Ctrl+S)" aria-label="Save"></button>
          <button type="button" class="ss-ib" id="copyBtn" title="Copy (Ctrl+C)" aria-label="Copy"></button>
          <span class="ss-vsep" aria-hidden="true"></span>
        </span>
        <button type="button" class="ss-ib" id="moreBtn" title="More" aria-label="More" aria-haspopup="menu"></button>
      </span>
    </div>
    <main class="ss-body" id="homeBody"><p class="ss-hint" id="hint"></p></main>
    <section class="ss-ed" id="editor" aria-label="Markup" hidden>
      <div class="ss-stage" id="stage">
        <div class="ss-paper" id="paper"><canvas id="cv"></canvas><canvas id="ov"></canvas></div>
      </div>
      <div class="ss-bottom" id="bottomBar" role="toolbar" aria-label="Markup" hidden></div>
    </section>
  </div>
  <section class="ss-set" id="settings" aria-labelledby="setTitle" hidden>
    <div class="ss-set-head">
      <button type="button" class="ss-ib" id="setBack" title="Back (Esc)" aria-label="Back"></button>
      <h1 id="setTitle">Settings</h1>
    </div>
    <div class="ss-set-body" id="setBody"></div>
  </section>
</div>
</x-layout-window>
