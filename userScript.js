/*
 * TV remote support for any website, loaded by TizenBrew.
 * Written in plain ES5 so it runs on older Samsung TV browsers.
 *
 *   Arrows        move the blue highlight between links/buttons
 *   OK / Enter    click the highlighted item
 *   Back          exit fullscreen, else go back a page, else close the app
 *   Play/Pause    play or pause the video on the page
 *   FF / Rewind   skip forward / back 10 seconds
 *   While a video is fullscreen: Left/Right skip 10 s, OK plays/pauses
 */
(function () {
  'use strict';
  if (window.__tvNavLoaded) return;
  window.__tvNavLoaded = true;

  var SEEK_SECONDS = 10;
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
    FAST_FORWARD: 417, REWIND: 412
  };
  var FOCUSABLE = 'a[href], button, input, select, textarea, video, ' +
    '[role="button"], [role="link"], [role="tab"], [onclick], ' +
    '[tabindex]:not([tabindex="-1"])';

  // ---- media keys (TizenBrew also registers the ones in package.json) ----
  try {
    var mediaKeys = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop',
      'MediaFastForward', 'MediaRewind'];
    for (var k = 0; k < mediaKeys.length; k++) {
      try { tizen.tvinputdevice.registerKey(mediaKeys[k]); } catch (e) {}
    }
  } catch (e) {}

  // ---- highlight box: drawn on top of the page so the site's own CSS
  //      and re-renders can't hide or remove it ----
  var ring = null;
  function getRing() {
    if (ring && document.documentElement.contains(ring)) return ring;
    ring = document.createElement('div');
    ring.setAttribute('aria-hidden', 'true');
    ring.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;display:none;' +
      'border:4px solid #4da3ff;border-radius:8px;' +
      'box-shadow:0 0 0 4px rgba(77,163,255,.35),0 0 18px rgba(77,163,255,.6);' +
      'transition:top .12s,left .12s,width .12s,height .12s;';
    (document.body || document.documentElement).appendChild(ring);
    return ring;
  }
  function placeRing() {
    var box = getRing();
    if (!current || !document.contains(current)) { box.style.display = 'none'; return; }
    var r = current.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = (r.left - 6) + 'px';
    box.style.top = (r.top - 6) + 'px';
    box.style.width = (r.width + 4) + 'px';
    box.style.height = (r.height + 4) + 'px';
  }
  window.addEventListener('scroll', placeRing, true);
  window.addEventListener('resize', placeRing);
  setInterval(placeRing, 250); // follows carousels and animated layouts

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

  // ---- helpers ----
  function isTextInput(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return true;
    if (el.tagName !== 'INPUT') return false;
    var t = (el.type || 'text').toLowerCase();
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'image', 'file', 'color'].indexOf(t) === -1;
  }

  function isVisible(el) {
    if (el.disabled) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = window.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0.05;
  }

  function candidates() {
    var all = document.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < all.length; i++) if (isVisible(all[i])) out.push(all[i]);
    return out;
  }

  function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

  function inViewport(r) {
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  }

  // ---- highlight / focus ----
  var current = null;

  function setFocus(el) {
    current = el;
    placeRing();
    if (!el) return;
    // Focusing a text box would pop up the on-screen keyboard, so only do it on OK.
    if (!isTextInput(el)) {
      try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) {} }
    }
    try { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } catch (e) {}
    var r = el.getBoundingClientRect();
    var margin = 60;
    if (r.top < margin || r.bottom > window.innerHeight - margin ||
        r.left < 0 || r.right > window.innerWidth) {
      try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
      catch (e) { el.scrollIntoView(false); }
    }
    placeRing();
  }

  function firstOnScreen(list) {
    var best = null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (!inViewport(r)) continue;
      if (!best) { best = list[i]; continue; }
      var b = best.getBoundingClientRect();
      if (r.top < b.top - 5 || (Math.abs(r.top - b.top) <= 5 && r.left < b.left)) best = list[i];
    }
    return best || list[0] || null;
  }

  function move(dir) {
    var list = candidates();
    if (!current || !document.contains(current) || !isVisible(current)) {
      setFocus(firstOnScreen(list));
      return;
    }
    var cr = current.getBoundingClientRect();
    var cx = cr.left + cr.width / 2, cy = cr.top + cr.height / 2;
    var best = null, bestScore = Infinity;

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === current || el.contains(current) || current.contains(el)) continue;
      var r = el.getBoundingClientRect();
      var px = r.left + r.width / 2, py = r.top + r.height / 2;
      var ok, main, side, drift;

      if (dir === 'right') {
        ok = px > cx + 1 && r.left > cr.left + 1;
        main = Math.max(0, r.left - cr.right); side = gap(r.top, r.bottom, cr.top, cr.bottom); drift = Math.abs(py - cy);
      } else if (dir === 'left') {
        ok = px < cx - 1 && r.right < cr.right - 1;
        main = Math.max(0, cr.left - r.right); side = gap(r.top, r.bottom, cr.top, cr.bottom); drift = Math.abs(py - cy);
      } else if (dir === 'down') {
        ok = py > cy + 1 && r.top > cr.top + 1;
        main = Math.max(0, r.top - cr.bottom); side = gap(r.left, r.right, cr.left, cr.right); drift = Math.abs(px - cx);
      } else {
        ok = py < cy - 1 && r.bottom < cr.bottom - 1;
        main = Math.max(0, cr.top - r.bottom); side = gap(r.left, r.right, cr.left, cr.right); drift = Math.abs(px - cx);
      }
      if (!ok) continue;

      var score = main + side * 4 + drift * 0.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }

    if (best) setFocus(best);
    else if (dir === 'up') window.scrollBy(0, -window.innerHeight * 0.6);
    else if (dir === 'down') window.scrollBy(0, window.innerHeight * 0.6);
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
        if (fullscreenEl() && video) { seek(video, code === KEY.RIGHT ? SEEK_SECONDS : -SEEK_SECONDS); break; }
        move(code === KEY.RIGHT ? 'right' : 'left');
        break;

      case KEY.UP: case KEY.DOWN:
        if (fullscreenEl()) { handled = false; break; }
        if (typing) active.blur();
        move(code === KEY.DOWN ? 'down' : 'up');
        break;

      case KEY.ENTER:
        if (typing) { handled = false; break; }
        if (fullscreenEl() && video) { togglePlay(video); break; }
        if (!current || !document.contains(current)) { move('down'); break; }
        if (current.tagName === 'VIDEO') togglePlay(current);
        else if (isTextInput(current)) current.focus();
        else current.click();
        break;

      default: handled = false;
    }

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
