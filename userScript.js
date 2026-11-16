/*
 * TV remote support for any website, loaded by TizenBrew.
 * Written in plain ES5 so it runs on older Samsung TV browsers.
 *
 *   Arrows        move the on-screen pointer (hold to speed up)
 *   OK / Enter    click whatever is under the pointer
 *   Pointer at a screen edge  scrolls the page (or the row under it)
 *   Back          exit fullscreen, else go back a page, else close the app
 *   Play/Pause    play or pause the video on the page
 *   FF / Rewind   skip forward / back 10 seconds
 *
 * The pointer hides after a few seconds of no movement. While a video is
 * fullscreen and the pointer is hidden, Left/Right skip 10 s and OK
 * plays/pauses; Up/Down bring the pointer back.
 */
(function () {
  'use strict';
  if (window.__tvPointerLoaded) return;
  window.__tvPointerLoaded = true;

  // ---- tuning ----
  var SEEK_SECONDS = 10;
  var START_SPEED = 5;       // px per frame when a key is first held
  var MAX_SPEED = 28;        // px per frame after holding a while
  var ACCEL = 0.03;          // px per frame gained per ms held
  var TAP_STEP = 18;         // px moved by a single short press
  var HOLD_DELAY_MS = 220;   // how long a key must be held before gliding starts
  var MAX_SCROLL = 18;       // px per frame when the pointer pushes an edge
  var HIDE_AFTER_MS = 6000;  // hide pointer after this long idle
  var EDGE = 3;              // px from the edge where scrolling starts
  var KEY_TIMEOUT_MS = 600;  // treat a key as released if no repeat arrives

  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
    FAST_FORWARD: 417, REWIND: 412
  };
  var DIRS = {};
  DIRS[KEY.LEFT] = [-1, 0]; DIRS[KEY.RIGHT] = [1, 0];
  DIRS[KEY.UP] = [0, -1]; DIRS[KEY.DOWN] = [0, 1];

  // ---- media keys (TizenBrew also registers the ones in package.json) ----
  try {
    var mediaKeys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind'];
    for (var k = 0; k < mediaKeys.length; k++) {
      try { tizen.tvinputdevice.registerKey(mediaKeys[k]); } catch (e) {}
    }
  } catch (e) {}

  // ---- remember where the app started, so Back on the first page exits ----
  var startUrl = location.href;
  try {
    if (sessionStorage.getItem('tvnav-start')) startUrl = sessionStorage.getItem('tvnav-start');
    else sessionStorage.setItem('tvnav-start', startUrl);
  } catch (e) {}

  // ---- keep everything in one window: no pop-ups or new tabs ----
  window.open = function () { return null; };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[target]') : null;
    if (a && a.target !== '_self' && a.href && a.href.indexOf('javascript:') !== 0) {
      e.preventDefault();
      location.href = a.href;
    }
  }, true);

  // ---- pointer graphic ----
  var x = window.innerWidth / 2, y = window.innerHeight / 2;
  var cursor = null, ripple = null, visible = false, hideTimer = null;

  var ARROW_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="34" height="44" viewBox="0 0 34 44">' +
    '<path d="M3 2 L3 36 L11.5 28 L17.5 41 L23.5 38.2 L17.6 25.6 L29 25.6 Z" ' +
    'fill="#ffffff" stroke="#111111" stroke-width="2.5" stroke-linejoin="round"/></svg>';

  function ensureCursor() {
    var root = document.body || document.documentElement;
    if (!root) return false;
    if (!cursor || !root.contains(cursor)) {
      cursor = document.createElement('div');
      cursor.setAttribute('aria-hidden', 'true');
      cursor.style.cssText =
        'position:fixed;left:0;top:0;width:34px;height:44px;margin:-2px 0 0 -3px;' +
        'pointer-events:none;z-index:2147483647;display:none;' +
        'filter:drop-shadow(0 3px 4px rgba(0,0,0,.55));will-change:transform;';
      cursor.innerHTML = ARROW_SVG;
      root.appendChild(cursor);

      ripple = document.createElement('div');
      ripple.setAttribute('aria-hidden', 'true');
      ripple.style.cssText =
        'position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;' +
        'border-radius:50%;border:3px solid rgba(255,255,255,.9);' +
        'pointer-events:none;z-index:2147483646;opacity:0;' +
        'transition:transform .35s ease-out,opacity .35s ease-out;';
      root.appendChild(ripple);
    }
    return true;
  }

  function draw() {
    if (!ensureCursor()) return;
    cursor.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }

  function showCursor() {
    if (!ensureCursor()) return;
    visible = true;
    cursor.style.display = 'block';
    draw();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCursor, HIDE_AFTER_MS);
  }

  function hideCursor() {
    visible = false;
    if (cursor) cursor.style.display = 'none';
  }

  function showRipple() {
    if (!ensureCursor()) return;
    ripple.style.transition = 'none';
    ripple.style.opacity = '1';
    ripple.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) scale(.3)';
    ripple.getBoundingClientRect(); // restart the animation
    ripple.style.transition = 'transform .35s ease-out,opacity .35s ease-out';
    ripple.style.opacity = '0';
    ripple.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px) scale(1.4)';
  }

  window.addEventListener('resize', function () {
    x = Math.min(x, window.innerWidth - 1);
    y = Math.min(y, window.innerHeight - 1);
    draw();
  });

  // ---- mouse events, so hover menus and clicks work like a real mouse ----
  function fire(el, type, related) {
    var opts = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y,
      button: 0, buttons: (type === 'mousedown' || type === 'pointerdown') ? 1 : 0,
      relatedTarget: related || null
    };
    var ev;
    try {
      if (type.indexOf('pointer') === 0 && window.PointerEvent) {
        opts.pointerId = 1; opts.pointerType = 'mouse'; opts.isPrimary = true;
        ev = new PointerEvent(type, opts);
      } else if (type.indexOf('pointer') === 0) {
        return;
      } else {
        ev = new MouseEvent(type, opts);
      }
    } catch (e) { return; }
    el.dispatchEvent(ev);
  }

  var hoverEl = null;
  function elementAtPointer() {
    var el = document.elementFromPoint(x, y);
    return el === cursor || el === ripple ? null : el;
  }

  function updateHover() {
    var el = elementAtPointer();
    if (!el) return;
    if (el !== hoverEl) {
      if (hoverEl && document.contains(hoverEl)) {
        fire(hoverEl, 'pointerout', el); fire(hoverEl, 'mouseout', el);
      }
      fire(el, 'pointerover', hoverEl); fire(el, 'mouseover', hoverEl);
      hoverEl = el;
    }
    fire(el, 'pointermove'); fire(el, 'mousemove');
  }

  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'image', 'file', 'color'].indexOf(t) === -1;
  }

  function clickAtPointer() {
    showCursor();
    showRipple();
    var el = elementAtPointer();
    if (!el) return;
    if (el.tagName === 'VIDEO' && !el.controls) { togglePlay(el); return; }
    fire(el, 'pointerdown'); fire(el, 'mousedown');
    var focusTarget = el.closest ? el.closest('a, button, input, select, textarea, [tabindex]') : null;
    if (focusTarget) { try { focusTarget.focus({ preventScroll: true }); } catch (e) {} }
    fire(el, 'pointerup'); fire(el, 'mouseup');
    fire(el, 'click');
  }

  // ---- scrolling when the pointer pushes against an edge ----
  function canScroll(el, dx, dy) {
    var cs = window.getComputedStyle(el);
    if (dy) {
      if (!/(auto|scroll|overlay)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 1) return false;
      return dy < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    }
    if (!/(auto|scroll|overlay)/.test(cs.overflowX) || el.scrollWidth <= el.clientWidth + 1) return false;
    return dx < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }

  function scrollUnderPointer(dx, dy) {
    var el = elementAtPointer();
    while (el && el !== document.body && el !== document.documentElement) {
      if (canScroll(el, dx, dy)) { el.scrollLeft += dx; el.scrollTop += dy; return; }
      el = el.parentElement;
    }
    window.scrollBy(dx, dy);
  }

  // ---- movement loop ----
  var held = {};       // keyCode -> { since, last }
  var running = false;
  var lastFrame = 0;

  function now() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }
  // A plain ~60 fps timer; more dependable than animation frames on TV browsers.
  function nextFrame(fn) {
    setTimeout(function () { fn(now()); }, 16);
  }

  function tick(t) {
    var dt = lastFrame ? Math.min(50, t - lastFrame) / 16.7 : 1; // frames elapsed
    lastFrame = t;
    var dx = 0, dy = 0, any = false;
    for (var code in held) {
      if (!held.hasOwnProperty(code)) continue;
      var h = held[code];
      if (t - h.last > KEY_TIMEOUT_MS) { delete held[code]; continue; }
      any = true;
      var heldFor = t - h.since - HOLD_DELAY_MS;
      if (heldFor < 0) continue; // a quick tap only moves TAP_STEP
      var speed = Math.min(MAX_SPEED, START_SPEED + heldFor * ACCEL) * dt;
      dx += DIRS[code][0] * speed;
      dy += DIRS[code][1] * speed;
    }
    if (!any) { running = false; lastFrame = 0; return; }
    movePointer(dx, dy);
    nextFrame(tick);
  }

  function clampScroll(v) {
    var s = Math.max(-MAX_SCROLL, Math.min(MAX_SCROLL, Math.round(v)));
    return s || (v < 0 ? -1 : 1);
  }

  function movePointer(dx, dy) {
    var w = window.innerWidth, h = window.innerHeight;
    var nx = x + dx, ny = y + dy;
    var sx = 0, sy = 0;
    if (nx < EDGE && dx < 0) sx = nx - EDGE;
    if (nx > w - 1 - EDGE && dx > 0) sx = nx - (w - 1 - EDGE);
    if (ny < EDGE && dy < 0) sy = ny - EDGE;
    if (ny > h - 1 - EDGE && dy > 0) sy = ny - (h - 1 - EDGE);
    x = Math.max(0, Math.min(w - 1, nx));
    y = Math.max(0, Math.min(h - 1, ny));
    if (sx) scrollUnderPointer(clampScroll(sx), 0);
    if (sy) scrollUnderPointer(0, clampScroll(sy));
    showCursor();
    updateHover();
  }

  function pressDirection(code) {
    var t = now();
    if (!visible) { showCursor(); }
    if (!held[code]) {
      held[code] = { since: t, last: t };
      movePointer(DIRS[code][0] * TAP_STEP, DIRS[code][1] * TAP_STEP);
    } else {
      held[code].last = t;
    }
    if (!running) { running = true; lastFrame = 0; nextFrame(tick); }
  }

  // ---- video control ----
  function fullscreenEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function mainVideo() {
    var fs = fullscreenEl();
    if (fs) {
      if (fs.tagName === 'VIDEO') return fs;
      var inside = fs.querySelector('video');
      if (inside) return inside;
    }
    var vids = document.querySelectorAll('video'), best = null, bestArea = 0;
    for (var i = 0; i < vids.length; i++) {
      var r = vids[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = vids[i]; }
    }
    return best;
  }

  function togglePlay(v) { if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); }
  function seek(v, s) {
    var t = v.currentTime + s;
    if (isFinite(v.duration)) t = Math.min(t, v.duration - 0.5);
    v.currentTime = Math.max(0, t);
  }

  function exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
  }

  function goBack() {
    if (fullscreenEl()) { exitFullscreen(); return; }
    var active = document.activeElement;
    if (isTextInput(active)) { active.blur(); return; }
    if (location.href !== startUrl && history.length > 1) { history.back(); return; }
    try { tizen.application.getCurrentApplication().exit(); } catch (e) { history.back(); }
  }

  // ---- key handling ----
  document.addEventListener('keydown', function (e) {
    var code = e.keyCode;
    var active = document.activeElement;
    var typing = isTextInput(active);
    var video = mainVideo();
    var watching = fullscreenEl() && video && !visible;
    var handled = true;

    switch (code) {
      case KEY.PLAY_PAUSE: if (video) togglePlay(video); break;
      case KEY.PLAY: if (video && video.paused) togglePlay(video); break;
      case KEY.PAUSE: case KEY.STOP: if (video) video.pause(); break;
      case KEY.FAST_FORWARD: if (video) seek(video, SEEK_SECONDS); break;
      case KEY.REWIND: if (video) seek(video, -SEEK_SECONDS); break;
      case KEY.BACK: case KEY.ESC: goBack(); break;

      case KEY.LEFT: case KEY.RIGHT:
        if (typing) { handled = false; break; }
        if (watching) { seek(video, code === KEY.RIGHT ? SEEK_SECONDS : -SEEK_SECONDS); break; }
        pressDirection(code);
        break;

      case KEY.UP: case KEY.DOWN:
        if (typing) active.blur();
        pressDirection(code);
        break;

      case KEY.ENTER:
        if (typing) { handled = false; break; }
        if (watching) { togglePlay(video); break; }
        clickAtPointer();
        break;

      default: handled = false;
    }

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener('keyup', function (e) {
    if (DIRS[e.keyCode]) {
      delete held[e.keyCode];
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Show the pointer in the middle of the screen once the page is ready.
  function init() { showCursor(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
