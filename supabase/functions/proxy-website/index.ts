import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRIVATE_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
];
const PRIVATE_RANGES = [
  /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, /^fc/, /^fd/,
];

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (PRIVATE_HOSTS.includes(h)) return true;
  return PRIVATE_RANGES.some((re) => re.test(h));
}

function sameRegistrableDomain(a: string, b: string): boolean {
  // Simple suffix match: allow exact or subdomain match
  const norm = (x: string) => x.replace(/^www\./, "").toLowerCase();
  const A = norm(a), B = norm(b);
  return A === B || A.endsWith("." + B) || B.endsWith("." + A);
}

function injectOverlay(html: string, shareToken: string, baseHref: string, currentUrl: string, allowedHosts: string[]): string {
  const overlay = `
<base href="${baseHref}">
<style id="phlash-review-overlay-style">
  html.phlash-comment-mode, html.phlash-comment-mode * { cursor: crosshair !important; }
  html.phlash-comment-mode body { user-select: none !important; }
  /* Pin colours are themed by the parent app (src/lib/reviewTheme.ts); the
     values here are the fallbacks used until a theme message arrives. */
  :root { --phlash-pin: #000075; --phlash-pin-fg: #ffffff; --phlash-pin-internal: #d97706; --phlash-pin-resolved: #6b7280; }
  .phlash-pin-marker { position: absolute; width: 28px; height: 28px; border-radius: 999px 999px 999px 2px; background: var(--phlash-pin); color: var(--phlash-pin-fg); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 2147483600; border: 2px solid var(--phlash-pin-fg); transform: translate(-2px, -26px); pointer-events: none; }
  .phlash-pin-marker.phlash-pin-internal { background: var(--phlash-pin-internal); }
  .phlash-pin-marker.phlash-pin-resolved { background: var(--phlash-pin-resolved); opacity: 0.6; }
</style>
<script id="phlash-review-overlay">
(function(){
  if (window.__phlashReviewInjected) return;
  window.__phlashReviewInjected = true;
  var SHARE_TOKEN = ${JSON.stringify(shareToken)};
  var CURRENT_URL = ${JSON.stringify(currentUrl)};
  var ALLOWED_HOSTS = ${JSON.stringify(allowedHosts)};
  function isAllowedHost(h){
    h = (h||'').toLowerCase().replace(/^www\\./,'');
    return ALLOWED_HOSTS.some(function(a){ a=(a||'').toLowerCase().replace(/^www\\./,''); return h===a || h.endsWith('.'+a) || a.endsWith('.'+h); });
  }

  function post(type, payload){
    try { window.parent.postMessage({ source: 'phlash-review', type: type, payload: payload }, '*'); } catch(e){}
  }

  var OVERLAY_SELECTOR = '#phlash-pin-layer, #phlash-hover-box, #phlash-hover-label';

  // ================= ELEMENT ANCHORING =================
  // A pin is stored as a selector for a DOM element plus an offset inside that
  // element's box (in percent), so it follows its component when the page
  // reflows at another viewport width or is re-rendered after a reload.
  // Document-percent coordinates are still recorded and act as the fallback for
  // pins created before anchoring existed, or when the element can't be found.

  var STABLE_ATTRS = ['data-testid','data-test-id','data-test','data-qa','data-cy','data-id','itemprop','name','aria-label'];

  function cssEscape(v){
    try { if (window.CSS && CSS.escape) return CSS.escape(String(v)); } catch(_){}
    return String(v).replace(/[^a-zA-Z0-9_-]/g, function(ch){ return '\\\\' + ch; });
  }
  function isValidIdent(v){ return /^[A-Za-z][\\w-]*$/.test(v || ''); }
  function attrEscape(v){ return String(v).replace(/["\\\\]/g, function(ch){ return '\\\\' + ch; }); }

  // A selector that identifies this single element on the page, or '' if none.
  function uniqueSelectorFor(el){
    try {
      if (el.id && isValidIdent(el.id)) {
        var byId = '#' + cssEscape(el.id);
        if (document.querySelectorAll(byId).length === 1) return byId;
      }
      var tag = el.tagName.toLowerCase();
      for (var i = 0; i < STABLE_ATTRS.length; i++) {
        var a = STABLE_ATTRS[i];
        var v = el.getAttribute && el.getAttribute(a);
        if (!v || v.length > 120) continue;
        var sel = tag + '[' + a + '="' + attrEscape(v) + '"]';
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    } catch(_){}
    return '';
  }

  // Structural path (nth-of-type chain) up to the nearest stably identified ancestor.
  function anchorPath(el){
    if (!el || el.nodeType !== 1) return '';
    var parts = [], node = el, depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && depth < 60) {
      var uniq = uniqueSelectorFor(node);
      if (uniq) { parts.unshift(uniq); break; }
      var tag = node.tagName.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) return '';
      var parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var idx = 1, sib = node;
      while ((sib = sib.previousElementSibling)) { if (sib.tagName === node.tagName) idx++; }
      parts.unshift(tag + ':nth-of-type(' + idx + ')');
      node = parent; depth++;
    }
    var path = parts.join(' > ');
    try { document.querySelector(path); } catch(_){ return ''; }
    return path;
  }

  function isUsable(el){
    if (!el || el.nodeType !== 1 || el.isConnected === false) return false;
    try { if (el.closest && el.closest(OVERLAY_SELECTOR)) return false; } catch(_){}
    var r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  }

  function normText(s){ return String(s == null ? '' : s).replace(/\\s+/g, ' ').trim().toLowerCase().slice(0, 120); }

  // Last resort: find the element that best matches the recorded fingerprint.
  // Handles responsive layouts that swap in a different node for the same
  // component (e.g. a desktop nav item replaced by a mobile menu item).
  function fuzzyResolve(p){
    var tag = String(p.element_tag || '').toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) tag = '';
    var wantClasses = String(p.element_classes || '').trim().split(/\\s+/).filter(Boolean);
    var wantText = normText(p.element_text);
    var wantHref = p.element_href || '', wantSrc = p.element_src || '';
    if (!tag && !wantClasses.length && !wantText && !wantHref && !wantSrc) return null;
    var list;
    try { list = document.querySelectorAll(tag || '*'); } catch(_){ return null; }
    var best = null, bestScore = 0, max = Math.min(list.length, 4000);
    for (var i = 0; i < max; i++) {
      var el = list[i];
      if (!isUsable(el)) continue;
      var score = 0;
      if (wantHref && typeof el.href === 'string' && el.href === wantHref) score += 4;
      if (wantSrc && typeof el.src === 'string' && el.src === wantSrc) score += 4;
      if (wantText && normText((el.innerText || el.textContent || '').slice(0, 200)) === wantText) score += 3;
      if (p.element_id && el.id && el.id === p.element_id) score += 3;
      if (wantClasses.length && el.classList && el.classList.length) {
        var hit = 0;
        for (var c = 0; c < wantClasses.length; c++) if (el.classList.contains(wantClasses[c])) hit++;
        score += (hit / wantClasses.length) * 3;
        if (hit === wantClasses.length && el.classList.length === wantClasses.length) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return bestScore >= 3 ? best : null;
  }

  function resolveAnchor(p){
    if (p.anchor_selector) {
      try {
        var el = document.querySelector(p.anchor_selector);
        if (isUsable(el)) return el;
      } catch(_){}
    }
    if (p.element_id && isValidIdent(p.element_id)) {
      var byId = document.getElementById(p.element_id);
      if (isUsable(byId)) return byId;
    }
    return fuzzyResolve(p);
  }

  // Fixed/sticky components move with the viewport, so their pins must be
  // positioned in viewport space and refreshed while scrolling.
  function needsViewportCoords(el){
    var node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 40) {
      var pos = '';
      try { pos = window.getComputedStyle(node).position; } catch(_){}
      if (pos === 'fixed' || pos === 'sticky') return true;
      node = node.parentElement; depth++;
    }
    return false;
  }

  function num(v, d){ var n = Number(v); return isFinite(n) ? n : d; }
  function clampPct(v, d){ var n = num(v, d); return n < 0 ? 0 : (n > 100 ? 100 : n); }

  // --- Hover highlight (DevTools-style inspector), only active in comment mode ---
  var __hoverBox = null, __hoverLabel = null, __hoverEl = null;

  function ensureHoverEls(){
    if (__hoverBox) return;
    __hoverBox = document.createElement('div');
    __hoverBox.id = 'phlash-hover-box';
    __hoverBox.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483550;background:rgba(14,138,147,0.15);border:1px solid #000075;box-sizing:border-box;display:none;';
    __hoverLabel = document.createElement('div');
    __hoverLabel.id = 'phlash-hover-label';
    __hoverLabel.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483551;background:#000075;color:#fff;font:11px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;';
    document.body.appendChild(__hoverBox);
    document.body.appendChild(__hoverLabel);
  }

  function describeHoverEl(el){
    return 'Leave a comment';
  }

  function positionHover(el){
    var r = el.getBoundingClientRect();
    __hoverBox.style.display = 'block';
    __hoverBox.style.left = (window.scrollX + r.left) + 'px';
    __hoverBox.style.top = (window.scrollY + r.top) + 'px';
    __hoverBox.style.width = r.width + 'px';
    __hoverBox.style.height = r.height + 'px';

    __hoverLabel.style.display = 'block';
    __hoverLabel.textContent = describeHoverEl(el);
    var labelTop = r.top - 22;
    if (labelTop < 0) labelTop = r.top + r.height + 4; // flip below if it'd go off-screen
    __hoverLabel.style.left = (window.scrollX + r.left) + 'px';
    __hoverLabel.style.top = (window.scrollY + labelTop) + 'px';
  }

  function showHover(el){
    if (!el || el.nodeType !== 1) return;
    if (el === document.documentElement || el === document.body) { hideHover(); return; }
    if (el.closest && el.closest(OVERLAY_SELECTOR)) return;
    ensureHoverEls();
    __hoverEl = el;
    positionHover(el);
  }

  function hideHover(){
    __hoverEl = null;
    if (__hoverBox) __hoverBox.style.display = 'none';
    if (__hoverLabel) __hoverLabel.style.display = 'none';
  }

  document.addEventListener('mouseover', function(e){
    if (!document.documentElement.classList.contains('phlash-comment-mode')) return;
    showHover(e.target);
  }, true);

  document.addEventListener('mouseout', function(e){
    if (!document.documentElement.classList.contains('phlash-comment-mode')) return;
    if (!e.relatedTarget) hideHover();
  }, true);

  window.addEventListener('scroll', function(){
    if (__hoverEl) positionHover(__hoverEl);
  }, true);
  // Intercept link clicks and form submissions for proxy navigation
  document.addEventListener('click', function(e){
    if (document.documentElement.classList.contains('phlash-comment-mode')) {
      e.preventDefault(); e.stopPropagation();
      var x = e.pageX, y = e.pageY;
      var el = e.target;
      var selector = '';
      try {
        if (el.id) selector = '#' + el.id;
        else selector = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.') : '');
      } catch(_){}

      // Anchor the pin to the clicked element: selector + offset within its box.
      var anchorSelector = '', anchorX = 50, anchorY = 50;
      try {
        anchorSelector = anchorPath(el);
        var box = el.getBoundingClientRect();
        if (box.width > 0) anchorX = ((e.clientX - box.left) / box.width) * 100;
        if (box.height > 0) anchorY = ((e.clientY - box.top) / box.height) * 100;
        anchorX = Math.round(Math.max(0, Math.min(100, anchorX)) * 100) / 100;
        anchorY = Math.round(Math.max(0, Math.min(100, anchorY)) * 100) / 100;
      } catch(_){}

      post('pin', {
        x_position: Math.round(x), y_position: Math.round(y),
        x_percent: (x / document.documentElement.scrollWidth) * 100,
        y_percent: (y / document.documentElement.scrollHeight) * 100,
        anchor_selector: anchorSelector,
        anchor_x_percent: anchorX,
        anchor_y_percent: anchorY,
        viewport_width: Math.round(window.innerWidth),
        viewport_height: Math.round(window.innerHeight),
        scroll_x: Math.round(window.scrollX), scroll_y: Math.round(window.scrollY),
        element_selector: selector,
        element_tag: el.tagName ? el.tagName.toLowerCase() : '',
        element_id: el.id || '',
        element_classes: (el.className && typeof el.className === 'string') ? el.className : '',
        element_text: (el.innerText || '').slice(0, 200),
        element_href: el.href || '',
        element_src: el.src || '',
        page_url: CURRENT_URL,
        page_title: document.title,
      });
      return false;
    }
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('sms:') || href.startsWith('javascript:')) return;
    if (href.startsWith('#')) return;
    try {
      var resolved = new URL(href, CURRENT_URL);
      e.preventDefault();
      if (isAllowedHost(resolved.hostname)) {
        post('navigate', { url: resolved.toString() });
      } else {
        try { window.open(resolved.toString(), '_blank', 'noopener,noreferrer'); } catch(_){}
        post('external-link', { url: resolved.toString() });
      }
    } catch(_){}
  }, true);

  document.addEventListener('submit', function(e){
    e.preventDefault();
    post('form-blocked', {});
  }, true);

  var __ready = false;
  var __pendingPins = null;
  var __pendingScroll = null;
  var __lastPins = [];

  // One entry per rendered pin:
  // { pin, node, el (anchor element), fixed (viewport-space), missSince }
  var __entries = [];
  var __ro = null, __mo = null, __observed = null;
  var __reflowScheduled = false;
  var __anyFixedAnchor = false;

  // Pin colours come from the parent app's design tokens, so review pins stay
  // on-brand after a rebrand. Only plain colour values are accepted.
  var THEME_VARS = {
    pin: '--phlash-pin',
    pinForeground: '--phlash-pin-fg',
    pinInternal: '--phlash-pin-internal',
    pinResolved: '--phlash-pin-resolved'
  };
  var COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\\([0-9a-zA-Z.,%\\s\\/]{1,48}\\)|[a-zA-Z]{3,24})$/;

  function applyTheme(theme){
    if (!theme || typeof theme !== 'object') return;
    for (var key in THEME_VARS) {
      var value = theme[key];
      if (typeof value !== 'string') continue;
      value = value.trim();
      if (!COLOR_RE.test(value)) continue;
      try { document.documentElement.style.setProperty(THEME_VARS[key], value); } catch(_){}
    }
  }

  function pinLayer(){
    var layer = document.getElementById('phlash-pin-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'phlash-pin-layer';
      // Zero-sized origin box: marker coordinates are measured against the
      // layer's own rect, so a positioned or transformed <body> can't offset them.
      layer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483500;';
      (document.body || document.documentElement).appendChild(layer);
    }
    return layer;
  }

  function ensureObservers(){
    if (typeof ResizeObserver !== 'undefined' && !__ro) {
      if (typeof WeakSet !== 'undefined') __observed = new WeakSet();
      __ro = new ResizeObserver(function(){ scheduleReflow(); });
      try { __ro.observe(document.documentElement); } catch(_){}
      try { if (document.body) __ro.observe(document.body); } catch(_){}
    }
    if (typeof MutationObserver !== 'undefined' && !__mo && document.body) {
      // Re-resolve anchors when the page re-renders parts of the DOM.
      __mo = new MutationObserver(function(){ scheduleReflow(); });
      try { __mo.observe(document.body, { childList: true, subtree: true }); } catch(_){}
    }
  }

  function observeEl(el){
    if (!el || !__ro) return;
    if (__observed) { if (__observed.has(el)) return; __observed.add(el); }
    try { __ro.observe(el); } catch(_){}
  }

  function scheduleReflow(){
    if (__reflowScheduled) return;
    __reflowScheduled = true;
    requestAnimationFrame(function(){ __reflowScheduled = false; reflowPins(); });
  }

  // Reposition every marker from its anchor element's current box.
  function reflowPins(){
    if (!__entries.length) return;
    var layer = pinLayer();
    var lr = layer.getBoundingClientRect();
    var originX = window.scrollX + lr.left;
    var originY = window.scrollY + lr.top;
    var sw = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0) || 1;
    var sh = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) || 1;
    __anyFixedAnchor = false;

    var now = Date.now();
    for (var i = 0; i < __entries.length; i++) {
      var en = __entries[i];
      if (!en.el || !isUsable(en.el)) {
        // A miss can mean the page hasn't rendered that part yet, so keep
        // retrying — but not on every DOM mutation, since a fuzzy match scans
        // the document.
        if (en.el || !en.missSince || (now - en.missSince) > 500) {
          en.el = resolveAnchor(en.pin);
          en.fixed = en.el ? needsViewportCoords(en.el) : false;
          en.missSince = en.el ? 0 : now;
          if (en.el) observeEl(en.el);
        }
      }
      var node = en.node, x, y;
      if (en.el) {
        var r = en.el.getBoundingClientRect();
        var ax = clampPct(en.pin.anchor_x_percent, 50);
        var ay = clampPct(en.pin.anchor_y_percent, 50);
        if (en.fixed) {
          __anyFixedAnchor = true;
          node.style.position = 'fixed';
          x = r.left + (ax / 100) * r.width;
          y = r.top + (ay / 100) * r.height;
        } else {
          node.style.position = 'absolute';
          x = window.scrollX + r.left + (ax / 100) * r.width - originX;
          y = window.scrollY + r.top + (ay / 100) * r.height - originY;
        }
        node.removeAttribute('data-pin-anchor-missing');
      } else {
        // No anchor element (legacy pin, or the component is gone): fall back to
        // the document-percent coordinates the pin was created with.
        node.style.position = 'absolute';
        x = (num(en.pin.x_percent, 0) / 100) * sw - originX;
        y = (num(en.pin.y_percent, 0) / 100) * sh - originY;
        node.setAttribute('data-pin-anchor-missing', '1');
      }
      node.style.left = Math.round(x) + 'px';
      node.style.top = Math.round(y) + 'px';
    }
  }

  function doRenderPins(pins){
    var layer = pinLayer();
    ensureObservers();
    var list = pins || [];

    var wanted = {};
    for (var w = 0; w < list.length; w++) wanted[String(list[w].id)] = true;

    // Keep the markers for pins that are still present (a refresh shouldn't
    // discard resolved anchors or make the markers flicker), drop the rest.
    var existing = {};
    for (var j = 0; j < __entries.length; j++) {
      var old = __entries[j];
      if (wanted[String(old.pin.id)]) existing[String(old.pin.id)] = old;
      else if (old.node && old.node.parentNode) old.node.parentNode.removeChild(old.node);
    }

    var next = [];
    for (var n = 0; n < list.length; n++) {
      var p = list[n];
      var en = existing[String(p.id)];
      if (!en) {
        var d = document.createElement('div');
        d.setAttribute('data-pin-id', p.id);
        d.style.pointerEvents = 'auto';
        d.style.cursor = 'pointer';
        (function(id){
          d.addEventListener('click', function(e){ e.stopPropagation(); e.preventDefault(); post('pin-click', { id: id }); });
        })(p.id);
        layer.appendChild(d);
        en = { pin: p, node: d, el: null, fixed: false, missSince: 0 };
      } else if (en.pin.anchor_selector !== p.anchor_selector) {
        en.el = null; en.missSince = 0; // anchor changed server-side, resolve again
      }
      en.pin = p;
      var cls = 'phlash-pin-marker';
      if (p.visibility === 'internal') cls += ' phlash-pin-internal';
      if (p.status === 'resolved') cls += ' phlash-pin-resolved';
      en.node.className = cls;
      en.node.textContent = String(p.label != null ? p.label : (n + 1));
      en.node.title = (p.visibility === 'internal' ? '[Internal] ' : '') + (p.comment || '');
      next.push(en);
    }
    __entries = next;
    reflowPins();
  }
  function renderPins(pins){
    __lastPins = pins || [];
    if (!__ready) { __pendingPins = __lastPins; return; }
    doRenderPins(__lastPins);
    if (__pendingScroll) {
      var id = __pendingScroll; __pendingScroll = null;
      setTimeout(function(){ doScrollToPin(id); }, 50);
    }
  }
  function doScrollToPin(id){
    var el = document.querySelector('[data-pin-id="' + id + '"]');
    if (!el) return false;
    var r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - window.innerHeight/2, behavior: 'smooth' });
    el.style.outline = '3px solid #f59e0b';
    setTimeout(function(){ el.style.outline = ''; }, 1500);
    return true;
  }
  function scrollToPin(id){
    if (!__ready) { __pendingScroll = id; return; }
    if (!doScrollToPin(id)) __pendingScroll = id;
  }

  function markReady(){
    if (__ready) return;
    __ready = true;
    requestAnimationFrame(function(){
      if (__pendingPins) doRenderPins(__pendingPins);
      else if (__lastPins.length) doRenderPins(__lastPins);
      __pendingPins = null;
      post('pin-ready', {});
      if (__pendingScroll) {
        var id = __pendingScroll; __pendingScroll = null;
        setTimeout(function(){ doScrollToPin(id); }, 50);
      }
    });
  }

  // Listen for mode changes from parent
  window.addEventListener('message', function(ev){
    var data = ev.data || {};
    if (data.source !== 'phlash-review-parent') return;
    if (data.type === 'set-mode') {
      if (data.mode === 'comment') {
        document.documentElement.classList.add('phlash-comment-mode');
      } else {
        document.documentElement.classList.remove('phlash-comment-mode');
        hideHover();
      }
    } else if (data.type === 'set-theme') {
      applyTheme(data.theme);
    } else if (data.type === 'render-pins') {
      renderPins(data.pins || []);
    } else if (data.type === 'scroll-to-pin') {
      scrollToPin(data.id);
    }
  });

  // Keep pins glued to their elements while the layout changes.
  var __resizeT = null;
  window.addEventListener('resize', function(){
    scheduleReflow();
    if (__resizeT) clearTimeout(__resizeT);
    // Once resizing settles, re-resolve from scratch: a breakpoint change can
    // swap which element represents the component (desktop nav vs. mobile menu).
    __resizeT = setTimeout(function(){
      for (var i = 0; i < __entries.length; i++) { __entries[i].el = null; __entries[i].missSince = 0; }
      reflowPins();
    }, 150);
  });
  window.addEventListener('orientationchange', function(){ scheduleReflow(); });
  window.addEventListener('scroll', function(){ if (__anyFixedAnchor) scheduleReflow(); }, true);
  window.addEventListener('load', function(){ scheduleReflow(); });
  document.addEventListener('load', function(e){
    var t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'IFRAME')) scheduleReflow();
  }, true);
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(function(){ scheduleReflow(); }); } catch(_){}

  if (document.readyState === 'complete') markReady();
  else window.addEventListener('load', markReady);

  post('ready', { url: CURRENT_URL, title: document.title });
})();
</script>`;

  // Strip CSP/frame-options that may have slipped through
  let cleaned = html
    .replace(/<meta[^>]+http-equiv=["']?(content-security-policy|x-frame-options)["']?[^>]*>/gi, "")
    .replace(/<base[^>]*>/gi, "");

  if (/<head[^>]*>/i.test(cleaned)) {
    // Replacer function (not a replacement string): the overlay contains `$`
    // sequences that would otherwise be expanded as replacement patterns.
    cleaned = cleaned.replace(/<head([^>]*)>/i, (_m, attrs) => `<head${attrs}>${overlay}`);
  } else {
    cleaned = overlay + cleaned;
  }
  return cleaned;
}

function rewriteUrls(html: string, baseUrl: URL, proxyBase: string, shareToken: string): string {
  // Rewrite href, src, action attributes to absolute URLs (so they load from origin)
  // We let the browser fetch assets directly from origin. Only navigation links inside
  // the iframe are intercepted by the injected script and re-loaded through the proxy.
  const absolutize = (val: string): string => {
    try {
      if (!val) return val;
      const v = val.trim();
      if (v.startsWith("data:") || v.startsWith("javascript:") || v.startsWith("mailto:") || v.startsWith("tel:") || v.startsWith("#")) return val;
      const abs = new URL(v, baseUrl).toString();
      return abs;
    } catch { return val; }
  };

  let out = html.replace(/\s(href|src|action|poster)=["']([^"']+)["']/gi, (_m, attr, val) => {
    return ` ${attr}="${absolutize(val)}"`;
  });

  // srcset
  out = out.replace(/\ssrcset=["']([^"']+)["']/gi, (_m, val) => {
    const rewritten = val.split(",").map((part: string) => {
      const trimmed = part.trim();
      const sp = trimmed.split(/\s+/);
      sp[0] = absolutize(sp[0]);
      return sp.join(" ");
    }).join(", ");
    return ` srcset="${rewritten}"`;
  });

  // CSS url() inside style attributes/blocks
  out = out.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, q, val) => {
    return `url(${q}${absolutize(val)}${q})`;
  });

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const shareToken = url.searchParams.get("share_token");
    const targetUrl = url.searchParams.get("url");

    if (!shareToken || !targetUrl) {
      return new Response("Missing share_token or url", { status: 400, headers: corsHeaders });
    }

    let target: URL;
    try { target = new URL(targetUrl); } catch {
      return new Response("Invalid target URL", { status: 400, headers: corsHeaders });
    }
    if (!["http:", "https:"].includes(target.protocol)) {
      return new Response("Only http/https allowed", { status: 400, headers: corsHeaders });
    }
    if (isPrivateHost(target.hostname)) {
      return new Response("Private addresses are not allowed", { status: 403, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: canvas } = await supabase
      .from("canvases")
      .select("id, website_url, staging_url, proxy_enabled, status")
      .eq("share_token", shareToken)
      .maybeSingle();

    if (!canvas) return new Response("Invalid share token", { status: 404, headers: corsHeaders });
    if (!canvas.proxy_enabled) return new Response("Proxy disabled", { status: 403, headers: corsHeaders });

    // Domain allowlist
    const allowedHosts: string[] = [];
    try { if (canvas.website_url) allowedHosts.push(new URL(canvas.website_url).hostname); } catch {}
    try { if (canvas.staging_url) allowedHosts.push(new URL(canvas.staging_url).hostname); } catch {}
    const isAllowed = allowedHosts.some((h) => sameRegistrableDomain(target.hostname, h));
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: "domain_not_allowed", message: "This URL is not in the allowed domains for this canvas." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch target
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        redirect: "follow",
        headers: {
          // Hosting WAFs (nginx/WordPress firewalls) routinely 403 any UA containing
          // the crawler signature `Mozilla/5.0 (compatible...`, which is what the
          // old UA used. Keep a browser-shaped UA and append our token outside the
          // parenthesised group so site owners can still identify us in logs.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 PhlashReview/1.0 (+https://phlash.review)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (e) {
      console.error('[proxy-website] fetch failed', e);
      return new Response(JSON.stringify({ error: "fetch_failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // An upstream error page is usually text/html, so without this check a WAF's
    // "403 Forbidden" page would be rewritten, overlaid and rendered in the canvas
    // as if it were the real site. Surface it as a proxy error instead, which lets
    // the client offer "open in new tab" and the widget fallback.
    if (!upstream.ok) {
      console.error('[proxy-website] upstream refused', upstream.status, target.hostname);
      return new Response(JSON.stringify({
        error: "upstream_error",
        status: upstream.status,
        message: upstream.status === 401 || upstream.status === 403
          ? `The website refused the review proxy's request (HTTP ${upstream.status}). It may be behind a firewall, bot protection, or a login.`
          : `The website returned HTTP ${upstream.status}.`,
      }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contentType = upstream.headers.get("content-type") || "";

    // For non-HTML responses, just stream them through (assets aren't proxied this way; this path is for HTML pages)
    if (!contentType.includes("text/html")) {
      return new Response(JSON.stringify({ error: "not_html", status: upstream.status, content_type: contentType }), {
        status: 415, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let html = await upstream.text();
    const baseHref = target.origin + target.pathname.replace(/[^/]*$/, "");

    html = rewriteUrls(html, target, `${url.origin}${url.pathname}`, shareToken);
    html = injectOverlay(html, shareToken, baseHref, target.toString(), allowedHosts);

    // NOTE: Supabase Edge Functions force `Content-Type: text/plain` and apply
    // `Content-Security-Policy: default-src 'none'; sandbox` to all responses,
    // which prevents serving HTML directly to an iframe `src`. We instead return
    // the HTML wrapped in JSON; the client loads it into the iframe via `srcdoc`.
    return new Response(JSON.stringify({ ok: true, html, url: target.toString() }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error('[proxy-website]', e);
    return new Response(JSON.stringify({ error: "proxy_error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
