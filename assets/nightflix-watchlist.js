/**
 * Nightflix — Watchlist + Continue Watching + Animation Filter + Auto-Load
 *
 * 1. Intercepts all TMDB fetch/XHR calls and forces with_genres=16 (Animation)
 *    so only cartoon/animated content is ever shown — no live action.
 * 2. MutationObserver auto-clicks "Load More" so content loads without
 *    the user having to press anything.
 * 3. Injects "+ Watchlist" / "✓ Saved" buttons on every media card.
 * 4. Implements window.NightflixWatchlist.toggle() used by the SPA.
 * 5. Records continue-watching entries on navigation, capturing real
 *    title + poster from the clicked card's DOM.
 * 6. Injects a "Watchlist" link into the React nav after it mounts.
 *
 * localStorage keys:
 *   nightflix_watchlist          → Array<{ id, title, poster, type }>
 *   nightflix_continue_watching  → Array<{ id, title, poster, type, timestamp }>
 */

(function () {
  'use strict';

  const WL_KEY           = 'nightflix_watchlist';
  const CW_KEY           = 'nightflix_continue_watching';
  const MAX_CW           = 20;
  const ANIMATION_GENRE  = 16;

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }

  function writeJSON(key, data) {
    try { localStorage.setItem(key, JSON.stringify(data)); }
    catch {}
  }

  // ── 1. ANIMATION-ONLY FILTER — intercept Fetch ───────────────────────────────

  function _isAnimation(item) {
    if (!item) return false;
    if (Array.isArray(item.genre_ids)) return item.genre_ids.includes(ANIMATION_GENRE);
    if (Array.isArray(item.genres))    return item.genres.some(g => g.id === ANIMATION_GENRE);
    return false;
  }

  // Only add the genre filter to list/discover endpoints — never to detail
  // endpoints like /movie/123 or /tv/123 (those have no results array and
  // are needed by React to resolve routes and hide the splash screen).
  function _isListEndpoint(url) {
    return /\/(discover|search|trending|popular|top_rated|airing_today|on_the_air|now_playing|upcoming)/.test(url);
  }

  function _filterTmdb(data) {
    if (data && Array.isArray(data.results)) {
      const filtered = data.results.filter(_isAnimation);
      // Only replace if we actually got some animation results back.
      // If TMDB returned nothing animated, keep originals so the app
      // doesn't hang with an empty list.
      if (filtered.length > 0) data.results = filtered;
    }
    return data;
  }

  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      let url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
      if (url && url.includes('api.themoviedb.org')) {
        // Only inject genre filter on list endpoints
        if (_isListEndpoint(url) && !url.includes('with_genres=')) {
          url += (url.includes('?') ? '&' : '?') + 'with_genres=' + ANIMATION_GENRE;
        }
        if (typeof args[0] === 'string')        args[0] = url;
        else if (args[0] instanceof Request)    args[0] = new Request(url, args[0]);

        const response = await _origFetch.apply(this, args);
        const clone    = response.clone();
        try {
          const data     = await clone.json();
          const filtered = _filterTmdb(data);
          return new Response(JSON.stringify(filtered), {
            status: response.status, statusText: response.statusText, headers: response.headers
          });
        } catch (e) { return response; }
      }
    } catch (err) { console.warn('Fetch intercept error:', err); }
    return _origFetch.apply(this, args);
  };

  // ── 1b. ANIMATION-ONLY FILTER — intercept XHR ────────────────────────────────

  const _origXHROpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (typeof url === 'string' && url.includes('api.themoviedb.org')) {
        if (_isListEndpoint(url) && !url.includes('with_genres=')) {
          url += (url.includes('?') ? '&' : '?') + 'with_genres=' + ANIMATION_GENRE;
        }
        this.addEventListener('readystatechange', function () {
          if (this.readyState === 4 && this.status === 200) {
            try {
              const data     = JSON.parse(this.responseText);
              const filtered = _filterTmdb(data);
              Object.defineProperty(this, 'responseText', { value: JSON.stringify(filtered) });
              Object.defineProperty(this, 'response',     { value: JSON.stringify(filtered) });
            } catch (e) {}
          }
        });
      }
    } catch (err) { console.warn('XHR intercept error:', err); }
    return _origXHROpen.apply(this, [method, url, ...rest]);
  };

  // ── 2. AUTO-CLICK "LOAD MORE" ─────────────────────────────────────────────────

  let _autoClickCount = 0;
  let _observerBusy   = false;

  function _autoLoadMore() {
    const btn = Array.from(document.querySelectorAll('button')).find(
      b => b.textContent && b.textContent.trim().toLowerCase().includes('load more')
    );
    if (btn && _autoClickCount < 10) {
      _autoClickCount++;
      btn.click();
    }
  }

  // Reset counter whenever the user deliberately changes section/tab
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest('button, a, div[role="button"]')) {
      _autoClickCount = 0;
    }
  });

  // ── 3. WATCHLIST BUTTON OVERLAYS ──────────────────────────────────────────────

  function _attachWatchlistButtons() {
    const cards = document.querySelectorAll(
      'div[class*="card"], article, div[class*="cursor-pointer"]'
    );
    cards.forEach(function (card) {
      if (card.querySelector('.nf-wl-btn')) return; // already has one

      const img     = card.querySelector('img');
      const titleEl = card.querySelector('h2, h3, h4, p, [class*="title"]') || img;
      if (!img || !titleEl) return;

      const rawTitle = titleEl.textContent
        ? titleEl.textContent.trim()
        : (img.getAttribute('alt') || 'Untitled');
      if (!rawTitle) return;

      card.style.position = 'relative';

      // Prefer a numeric data-id attribute; fall back to a slug from the title
      const itemId   = card.getAttribute('data-id') || rawTitle.toLowerCase().replace(/\s+/g, '-');
      const wl       = readJSON(WL_KEY);
      const isSaved  = wl.some(i => String(i.id) === String(itemId));

      const btn      = document.createElement('button');
      btn.className  = 'nf-wl-btn';
      btn.innerText  = isSaved ? '✓ Saved' : '+ Watchlist';
      btn.style.cssText = [
        'position:absolute', 'top:8px', 'right:8px', 'z-index:99',
        'background:' + (isSaved ? '#00c853' : 'rgba(0,0,0,0.75)'),
        'color:#fff', 'border:1px solid rgba(255,255,255,0.3)',
        'border-radius:6px', 'padding:4px 8px', 'font-size:11px',
        'font-weight:bold', 'cursor:pointer', 'backdrop-filter:blur(4px)',
        'transition:all 0.2s ease'
      ].join(';');

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        window.NightflixWatchlist.toggle(
          { id: itemId, title: rawTitle, poster: img.src, type: 'tv' },
          btn
        );
      });

      card.appendChild(btn);
    });
  }

  // ── MutationObserver — drives auto-load-more + button injection ───────────────

  const _observer = new MutationObserver(function () {
    if (_observerBusy) return;
    _observerBusy = true;
    try {
      _autoLoadMore();
      _observer.disconnect();
      _attachWatchlistButtons();
      if (document.body) _observer.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      console.warn('Observer error:', e);
    } finally {
      _observerBusy = false;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (document.body) _observer.observe(document.body, { childList: true, subtree: true });
    });
  } else {
    if (document.body) _observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── 4. WATCHLIST API ──────────────────────────────────────────────────────────

  window.NightflixWatchlist = {
    getAll() { return readJSON(WL_KEY); },

    // legacy alias used by older button code
    get()    { return readJSON(WL_KEY); },

    has(id)  { return readJSON(WL_KEY).some(x => String(x.id) === String(id)); },

    toggle(item, btn) {
      const list = readJSON(WL_KEY);
      const idx  = list.findIndex(x => String(x.id) === String(item.id));
      let saved;
      if (idx === -1) {
        list.unshift({ id: item.id, title: item.title, poster: item.poster, type: item.type || 'tv' });
        saved = true;
      } else {
        list.splice(idx, 1);
        saved = false;
      }
      writeJSON(WL_KEY, list);
      _syncBtn(btn, saved);
      _dispatchChange();
      return saved;
    },

    remove(id) {
      writeJSON(WL_KEY, readJSON(WL_KEY).filter(x => String(x.id) !== String(id)));
      _dispatchChange();
    }
  };

  function _syncBtn(btn, saved) {
    if (!btn) return;
    if (saved) {
      btn.innerText         = '✓ Saved';
      btn.style.background  = '#00c853';
      btn.style.color       = '#fff';
      btn.title             = 'Remove from Watchlist';
    } else {
      btn.innerText         = '+ Watchlist';
      btn.style.background  = 'rgba(0,0,0,0.75)';
      btn.style.color       = '#fff';
      btn.title             = 'Add to Watchlist';
    }
  }

  function _dispatchChange() {
    window.dispatchEvent(new CustomEvent('nightflix:watchlist-change'));
  }

  // ── 5. CONTINUE WATCHING API ──────────────────────────────────────────────────

  window.NightflixContinueWatching = {
    record(item) {
      let list = readJSON(CW_KEY).filter(x => String(x.id) !== String(item.id));
      list.unshift({ ...item, timestamp: Date.now() });
      if (list.length > MAX_CW) list = list.slice(0, MAX_CW);
      writeJSON(CW_KEY, list);
    },
    getAll() { return readJSON(CW_KEY); },
    remove(id) { writeJSON(CW_KEY, readJSON(CW_KEY).filter(x => String(x.id) !== String(id))); }
  };

  // Capture the card clicked so we can read title + poster before navigation
  let _lastClickedCard = null;
  document.addEventListener('click', function (e) {
    const card = e.target.closest('[data-id]');
    if (card) _lastClickedCard = card;
  }, true);

  function _tryRecordFromPath(path) {
    const m = path.match(/^\/(watch\/)?(movie|tv)\/(\d+)/);
    if (!m) return;
    const type = m[2], id = m[3];

    let title = '', poster = '';
    if (_lastClickedCard) {
      const titleEl  = _lastClickedCard.querySelector('[class*="title"], h3, h2, p');
      const posterEl = _lastClickedCard.querySelector('img');
      if (titleEl)  title  = titleEl.textContent.trim();
      if (posterEl) poster = posterEl.getAttribute('src') || '';
      _lastClickedCard = null;
    }

    const existing = readJSON(CW_KEY).find(x => String(x.id) === id);
    window.NightflixContinueWatching.record({
      ...(existing || {}),
      id,
      title:  title  || (existing && existing.title)  || '',
      poster: poster || (existing && existing.poster) || '',
      type,
    });
  }

  ['pushState', 'replaceState'].forEach(function (method) {
    const orig = history[method];
    history[method] = function (state, title, url) {
      const result = orig.apply(this, arguments);
      if (url) _tryRecordFromPath(String(url));
      return result;
    };
  });
  window.addEventListener('popstate', function () { _tryRecordFromPath(location.pathname); });

  // ── 6. INJECT WATCHLIST NAV LINK ──────────────────────────────────────────────

  const NAV_LINK_ID = 'nf-watchlist-navlink';

  function _injectNavLink() {
    if (document.getElementById(NAV_LINK_ID)) return;
    const desktopRow = document.querySelector('nav .hidden.md\\:flex.items-center.gap-1');
    if (!desktopRow) return;

    const a     = document.createElement('a');
    a.id        = NAV_LINK_ID;
    a.href      = 'watchlist.html';
    a.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" style="display:inline;margin-right:6px;vertical-align:-2px">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
      </svg>Watchlist`;
    a.style.cssText = 'display:flex;align-items:center;gap:6px;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:700;color:#fff;text-decoration:none;transition:color .2s,background .2s;';
    a.onmouseenter = function () { a.style.color = '#00f5ff'; a.style.background = 'rgba(255,255,255,0.05)'; };
    a.onmouseleave = function () { a.style.color = '#fff';    a.style.background = ''; };

    function _updateBadge() {
      const count = readJSON(WL_KEY).length;
      let badge   = a.querySelector('.nf-wl-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className    = 'nf-wl-badge';
          badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#00f5ff;color:#0a0e1a;font-size:9px;font-weight:900;font-family:Orbitron,sans-serif;margin-left:2px;';
          a.appendChild(badge);
        }
        badge.textContent = count > 99 ? '99+' : count;
      } else if (badge) {
        badge.remove();
      }
    }

    _updateBadge();
    window.addEventListener('nightflix:watchlist-change', _updateBadge);
    desktopRow.appendChild(a);

    // Mobile drawer
    const mobileMenu = document.querySelector('nav .md\\:hidden.glass-dark');
    if (mobileMenu) {
      const ma      = document.createElement('a');
      ma.href       = 'watchlist.html';
      ma.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;font-size:14px;font-weight:500;color:#9ca3af;text-decoration:none;';
      ma.textContent  = '🔖 Watchlist';
      mobileMenu.appendChild(ma);
    }
  }

  let _navAttempts = 0;
  const _navTimer  = setInterval(function () {
    _injectNavLink();
    _navAttempts++;
    if (document.getElementById(NAV_LINK_ID) || _navAttempts > 40) clearInterval(_navTimer);
  }, 150);

  window.addEventListener('popstate', function () { setTimeout(_injectNavLink, 300); });
  const _origPush = history.pushState;
  history.pushState = function () {
    const r = _origPush.apply(this, arguments);
    setTimeout(_injectNavLink, 300);
    return r;
  };

})();
