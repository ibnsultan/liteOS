/*
 * LiteOS alarm sounds: a few short tunes made with Web Audio (no sound files), for the reminders service
 * (reminders.js: alarms and timers ringing) and for Clock's sound picker to preview them.
 *
 *   const stop = LOS_sounds.play('chimes', { volume: 0.8, loop: true });   // volume 0–1
 *   stop();
 */
(function () {
  'use strict';

  let ctx = null;
  const audio = () => (ctx = ctx || new (window.AudioContext || window.webkitAudioContext)());

  /** One note: a frequency with overtones (partials: [ratio, level]), a wave shape and a decay. */
  function note(out, t, f, len, level, wave, partials) {
    (partials || [[1, 1]]).forEach(([ratio, lv]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = wave || 'sine';
      o.frequency.value = f * ratio;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, level * lv), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + len + 0.05);
    });
  }
  const BELL = [[1, 1], [2.76, 0.35], [5.4, 0.12]];

  // each tune: its notes from time 0, and how long one round lasts (it repeats while looping)
  const TUNES = {
    chimes: { name: 'Chimes', round: 2.2, play: (o, t) => [1047, 1319, 1568, 2093].forEach((f, i) => note(o, t + i * 0.18, f, 1.4, 0.5, 'sine', BELL)) },
    bells: { name: 'Bells', round: 2.4, play: (o, t) => { note(o, t, 659, 1.8, 0.6, 'sine', BELL); note(o, t + 0.45, 523, 2, 0.6, 'sine', BELL); } },
    beeps: { name: 'Beeps', round: 1.6, play: (o, t) => [0, 0.16, 0.32, 0.48].forEach((d) => note(o, t + d, 1760, 0.11, 0.3, 'triangle')) },
    xylophone: { name: 'Xylophone', round: 2, play: (o, t) => [784, 880, 1047, 1175, 1319, 1175, 1047].forEach((f, i) => note(o, t + i * 0.13, f, 0.35, 0.5, 'triangle', [[1, 1], [4, 0.2]])) },
    gentle: { name: 'Gentle', round: 3, play: (o, t) => { note(o, t, 440, 2.2, 0.35, 'sine', [[1, 1], [2, 0.15]]); note(o, t + 0.6, 554, 2.2, 0.3, 'sine', [[1, 1], [2, 0.15]]); note(o, t + 1.2, 659, 1.8, 0.25, 'sine'); } },
  };

  function play(id, opts) {
    const o = opts || {};
    const tune = TUNES[id] || TUNES.chimes;
    let stopped = false;
    let timer = null;
    try {
      audio();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { return () => {}; }
    const out = ctx.createGain();
    out.gain.value = Math.max(0, Math.min(1, o.volume == null ? 0.8 : o.volume));
    out.connect(ctx.destination);
    const round = () => {
      if (stopped) return;
      tune.play(out, ctx.currentTime + 0.02);
      if (o.loop) timer = setTimeout(round, tune.round * 1000);
    };
    round();
    // a ringing alarm gives up after a while if nobody's there
    const giveUp = o.loop ? setTimeout(() => stop(), (o.maxSeconds || 60) * 1000) : null;
    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      clearTimeout(giveUp);
      try { out.gain.setTargetAtTime(0, ctx.currentTime, 0.05); setTimeout(() => out.disconnect(), 300); } catch (e) { /* gone */ }
    }
    return stop;
  }

  window.LOS_sounds = { list: Object.keys(TUNES).map((k) => [k, TUNES[k].name]), play };
})();
