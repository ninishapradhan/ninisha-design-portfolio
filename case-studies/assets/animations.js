/* DaVinci Case Studies — vanilla JS for interactions.
 *
 * No React. No frameworks. The HTML is rendered server-side and is
 * fully crawlable. This file adds:
 *
 *   - Tab switching (BrandStore ↔ Commerce Marketing)
 *   - Reveal-on-scroll
 *   - Count-up stats
 *   - Horizontal scroll arrow controls
 *   - Chat playback (typed-bubble reveal, auto-loop on intersection)
 *   - Industry cycler (auto-rotates verticals on the main page)
 *   - Industry filter strip (click chip → swap featured section)
 *   - Without/With side-by-side reveal (With slides in after Without
 *     finishes its first pass)
 *   - Quote carousel (auto-rotate)
 *   - prefers-reduced-motion handling
 */
(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  var reduceMotion = false;
  try {
    reduceMotion = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {}

  /* ─── Tabs ─────────────────────────────────────────────────────── */
  function initTabs(root) {
    var tabBar = root.querySelector("[data-dc-cs-tabs]");
    if (!tabBar) return;
    var tabs   = tabBar.querySelectorAll(".dc-cs-tab");
    var panels = root.querySelectorAll(".dc-cs-panel");
    var defaultTab = root.getAttribute("data-dc-cs-default") || "brandstore";

    function activate(target) {
      tabs.forEach(function (t) {
        t.setAttribute("aria-selected", t.getAttribute("data-tab") === target ? "true" : "false");
      });
      panels.forEach(function (p) {
        var on = p.getAttribute("data-panel") === target;
        p.classList.toggle("is-active", on);
        p.setAttribute("aria-hidden", on ? "false" : "true");
      });
      try { history.replaceState(null, "", "#" + target); } catch (_) {}
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        activate(t.getAttribute("data-tab"));
      });
    });

    var hash = (location.hash || "").replace("#", "");
    var initial = (hash === "brandstore" || hash === "commerce-marketing") ? hash : defaultTab;
    root.classList.remove("pre-boot");
    activate(initial);
  }

  /* ─── Reveal on scroll ─────────────────────────────────────────── */
  function initReveal(root) {
    var els = root.querySelectorAll(".reveal");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ─── Count-up stats ──────────────────────────────────────────── */
  function initCountUp(root) {
    var nodes = root.querySelectorAll("[data-count-to]");
    if (!nodes.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      nodes.forEach(function (n) { n.textContent = formatCount(parseFloat(n.getAttribute("data-count-to")), n); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { runCount(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.4 });
    nodes.forEach(function (n) { io.observe(n); });
  }
  function formatCount(value, node) {
    var suffix = node.getAttribute("data-count-suffix") || "";
    var decimals = parseInt(node.getAttribute("data-count-decimals") || "0", 10);
    return value.toFixed(decimals).replace(/\.0+$/, "") + suffix;
  }
  function runCount(node) {
    var to = parseFloat(node.getAttribute("data-count-to"));
    var dur = parseInt(node.getAttribute("data-count-duration") || "1400", 10);
    var start = performance.now();
    function tick(now) {
      var k = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - k, 3);
      node.textContent = formatCount(to * eased, node);
      if (k < 1) requestAnimationFrame(tick);
      else node.textContent = formatCount(to, node);
    }
    requestAnimationFrame(tick);
  }

  /* ─── Horizontal scroll arrows ────────────────────────────────── */
  function initScrollers(root) {
    root.querySelectorAll(".dc-cs-scroll").forEach(function (scroller) {
      var track = scroller.querySelector(".dc-cs-scroll__track");
      var prev  = scroller.querySelector(".dc-cs-scroll__nav--prev");
      var next  = scroller.querySelector(".dc-cs-scroll__nav--next");
      if (!track) return;
      function step() {
        var card = track.querySelector(".dc-cs-card-anon, .dc-cs-card-sm");
        return card ? card.getBoundingClientRect().width + 20 : 380;
      }
      function update() {
        if (prev) prev.toggleAttribute("disabled", track.scrollLeft <= 4);
        if (next) {
          var max = track.scrollWidth - track.clientWidth - 4;
          next.toggleAttribute("disabled", track.scrollLeft >= max);
        }
      }
      if (prev) prev.addEventListener("click", function () { track.scrollBy({ left: -step(), behavior: "smooth" }); });
      if (next) next.addEventListener("click", function () { track.scrollBy({ left:  step(), behavior: "smooth" }); });
      track.addEventListener("scroll", update, { passive: true });
      window.addEventListener("resize", update);
      update();
    });
  }

  /* ─── Chat playback engine ────────────────────────────────────── */
  // For each .dc-cs-chat__messages, reveal bubbles sequentially. Each
  // .dc-cs-bubble-wrap toggles .is-shown. After the last bubble, wait
  // a tail-pause and (optionally) loop. Auto-scroll the container so
  // the latest bubble is visible.
  //
  // Timing: per-bubble dwell is the data-speed attr (ms). After all
  // bubbles, hold for `data-tail` (default 2400ms) before looping.
  function initChats(root) {
    var chats = root.querySelectorAll(".dc-cs-chat__messages[data-autoplay='true']");
    if (!chats.length) return;
    chats.forEach(setupChat);
  }

  function setupChat(box) {
    var bubbles = box.querySelectorAll(".dc-cs-bubble-wrap");
    if (!bubbles.length) return;
    var speed  = parseInt(box.getAttribute("data-speed") || "700", 10);
    var loop   = box.getAttribute("data-loop") !== "false";
    var tail   = parseInt(box.getAttribute("data-tail") || "2400", 10);
    var state  = { active: false, timer: 0, idx: 0, raf: 0 };

    function reset() {
      bubbles.forEach(function (b) { b.classList.remove("is-shown"); });
      state.idx = 0;
      box.scrollTop = 0;
    }
    function showNext() {
      if (!state.active) return;
      if (state.idx >= bubbles.length) {
        if (loop) {
          state.timer = setTimeout(function () { reset(); showNext(); }, tail);
        }
        return;
      }
      bubbles[state.idx].classList.add("is-shown");
      // Auto-scroll: append-then-scroll-to-bottom, matching the sister
      // homepage's chat. Hidden bubbles are display:none, so scrollHeight
      // grows by exactly the new bubble's height; scrolling to the very
      // bottom keeps the latest message anchored at the chat bottom and
      // older messages naturally scroll up above it.
      requestAnimationFrame(function () {
        try { box.scrollTo({ top: box.scrollHeight, behavior: "smooth" }); }
        catch (_) { box.scrollTop = box.scrollHeight; }
      });
      state.idx += 1;
      // Per-kind dwell — mirrors the sister homepage exactly so every
      // bubble lands and rests long enough to be read before the next.
      var kind = bubbles[state.idx - 1].querySelector(".dc-cs-bubble")?.className || "";
      var dwell;
      if      (/--user/.test(kind))                            dwell =  700;
      else if (/cta-card/.test(kind))                          dwell = 2400;
      else if (/reviews/.test(kind))                           dwell = 2000;
      else if (/rich-carousel/.test(kind))                     dwell = 1800;
      else if (/guardrail/.test(kind))                         dwell = 1700;
      else if (/spec/.test(kind))                              dwell = 1700;
      else if (/hero-image|locator|product|grid/.test(kind))   dwell = 1400;
      else if (/cta-row/.test(kind))                           dwell = 1200;
      else                                                     dwell = 1500;
      state.timer = setTimeout(showNext, dwell);
    }

    function play() {
      if (state.active) return;
      state.active = true;
      reset();
      // small entrance delay
      state.timer = setTimeout(showNext, 350);
    }
    function pause() {
      state.active = false;
      clearTimeout(state.timer);
    }

    // Reduced motion: just show everything statically.
    if (reduceMotion) {
      bubbles.forEach(function (b) { b.classList.add("is-shown"); });
      return;
    }

    // Run when visible (and the parent VS pane lets us run — for the
    // side-by-side, the "With" pane only starts after .is-revealed).
    var paneWith = box.closest(".dc-cs-vs2__with-coming-soon");
    if (paneWith) {
      // Watch the parent VS for the is-revealed class.
      var vs = paneWith.closest(".dc-cs-vs2");
      if (vs) {
        var checkAndPlay = function () {
          if (vs.classList.contains("is-revealed") && isVisible(box)) play();
          else if (!vs.classList.contains("is-revealed")) pause();
        };
        new MutationObserver(checkAndPlay).observe(vs, { attributes: true, attributeFilter: ["class"] });
      }
    }

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            // Only play if the parent VS isn't gating us.
            var gate = box.closest(".dc-cs-vs2__with-coming-soon");
            if (!gate || gate.closest(".dc-cs-vs2").classList.contains("is-revealed")) play();
          } else {
            pause();
          }
        });
      }, { threshold: 0.4 });
      io.observe(box);
    } else {
      play();
    }
  }

  function isVisible(el) {
    var r = el.getBoundingClientRect();
    return r.top < (window.innerHeight || 999) && r.bottom > 0;
  }

  /* ─── Without/With side-by-side reveal ────────────────────────── */
  // When the .dc-cs-vs2 enters viewport, immediately let the Without
  // pane play. When the Without pane has played one full cycle, slide
  // the With pane in (add .is-revealed to the parent).
  function initSideBySide(root) {
    var vs2s = root.querySelectorAll(".dc-cs-vs2");
    if (!vs2s.length) return;
    vs2s.forEach(function (vs) {
      var withoutBox = vs.querySelector(".dc-cs-vs2__pane--without .dc-cs-chat__messages");
      if (!withoutBox) {
        // No chat to wait for — reveal With immediately on intersection.
        if (reduceMotion) { vs.classList.add("is-revealed"); return; }
        if ("IntersectionObserver" in window) {
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) { vs.classList.add("is-revealed"); io.disconnect(); }
            });
          }, { threshold: 0.2 });
          io.observe(vs);
        } else {
          vs.classList.add("is-revealed");
        }
        return;
      }

      if (reduceMotion) { vs.classList.add("is-revealed"); return; }

      var revealTimer = 0;
      function scheduleReveal() {
        // Estimate first-pass duration: bubbles × dwell + tail
        var bubbles = withoutBox.querySelectorAll(".dc-cs-bubble-wrap").length;
        var speed = parseInt(withoutBox.getAttribute("data-speed") || "700", 10);
        var dur = bubbles * speed + 600;
        revealTimer = setTimeout(function () { vs.classList.add("is-revealed"); }, dur);
      }
      function cancelReveal() { clearTimeout(revealTimer); }

      if ("IntersectionObserver" in window) {
        var io2 = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting && !vs.classList.contains("is-revealed")) scheduleReveal();
            else if (!e.isIntersecting && !vs.classList.contains("is-revealed")) cancelReveal();
          });
        }, { threshold: 0.3 });
        io2.observe(vs);
      } else {
        scheduleReveal();
      }
    });
  }

  /* ─── Industry cycler (main page) ─────────────────────────────── */
  // Auto-rotates the .dc-cs-cycler__slide elements. Each slide
  // contains its own chat. We mark only one slide .is-active at a
  // time; that slide's chat then plays. After `data-duration` ms,
  // advance to the next slide. Click on a dot to jump.
  function initCycler(root) {
    root.querySelectorAll("[data-dc-cs-cycler]").forEach(function (cy) {
      var slides = cy.querySelectorAll(".dc-cs-cycler__slide");
      var dots   = cy.querySelectorAll(".dc-cs-cycler__dot");
      if (!slides.length) return;
      var dur    = parseInt(cy.getAttribute("data-duration") || "6000", 10);
      var i = 0;
      var timer = 0;
      function activate(n) {
        slides.forEach(function (s, idx) { s.classList.toggle("is-active", idx === n); });
        dots.forEach(function (d, idx) { d.classList.toggle("is-active", idx === n); });
        i = n;
        // The chat-playback IO will start chats as they intersect, but
        // since cycler is on the same place, we manually reset & play.
        var box = slides[n].querySelector(".dc-cs-chat__messages");
        if (box) restartChat(box);
      }
      function advance() { activate((i + 1) % slides.length); }
      function start() {
        clearInterval(timer);
        if (reduceMotion) return;
        timer = setInterval(advance, dur);
      }
      dots.forEach(function (d, idx) {
        d.addEventListener("click", function () { activate(idx); start(); });
      });

      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { if (e.isIntersecting) start(); else clearInterval(timer); });
        }, { threshold: 0.3 });
        io.observe(cy);
      } else { start(); }

      activate(0);
    });
  }

  function restartChat(box) {
    var bubbles = box.querySelectorAll(".dc-cs-bubble-wrap");
    bubbles.forEach(function (b) { b.classList.remove("is-shown"); });
    box.scrollTop = 0;
    // Re-trigger playback via the existing intersection-observed setup
    // by manually showing bubbles in sequence.
    var speed = parseInt(box.getAttribute("data-speed") || "700", 10);
    var idx = 0;
    function next() {
      if (idx >= bubbles.length) return;
      bubbles[idx].classList.add("is-shown");
      requestAnimationFrame(function () {
        var el = bubbles[idx];
        if (el) {
          var top = el.offsetTop + el.offsetHeight - box.clientHeight + 24;
          if (top > 0) {
            try { box.scrollTo({ top: top, behavior: "smooth" }); }
            catch (_) { box.scrollTop = top; }
          }
        }
      });
      idx += 1;
      var kind = bubbles[idx - 1].querySelector(".dc-cs-bubble")?.className || "";
      var dwell = speed;
      if (/product|grid|locator/.test(kind)) dwell = Math.round(speed * 1.3);
      else if (/cta/.test(kind)) dwell = Math.round(speed * 0.8);
      setTimeout(next, dwell);
    }
    setTimeout(next, 250);
  }

  /* ─── Industry filter strip ───────────────────────────────────── */
  function initFilterStrip(root) {
    root.querySelectorAll("[data-dc-cs-strip]").forEach(function (strip) {
      var chips    = strip.querySelectorAll("[data-strip-chip]");
      var features = strip.querySelectorAll("[data-strip-feature]");
      function activate(key) {
        chips.forEach(function (c) { c.classList.toggle("is-active", c.getAttribute("data-strip-chip") === key); });
        features.forEach(function (f) { f.classList.toggle("is-active", f.getAttribute("data-strip-feature") === key); });
      }
      chips.forEach(function (c) {
        c.addEventListener("click", function () { activate(c.getAttribute("data-strip-chip")); });
      });
      // Activate the first chip on boot.
      if (chips[0]) activate(chips[0].getAttribute("data-strip-chip"));
    });
  }

  /* ─── Quote carousel ──────────────────────────────────────────── */
  function initQuoteCarousel(root) {
    root.querySelectorAll(".dc-cs-quote-carousel").forEach(function (car) {
      var slides = car.querySelectorAll(".dc-cs-quote-carousel__slide");
      var dots   = car.querySelectorAll(".dc-cs-quote-carousel__dot");
      if (!slides.length) return;
      var i = 0, timer = 0;
      function activate(n) {
        slides.forEach(function (s, idx) { s.classList.toggle("is-active", idx === n); });
        dots.forEach(function (d, idx) { d.classList.toggle("is-active", idx === n); });
        i = n;
      }
      function advance() { activate((i + 1) % slides.length); }
      function start() { clearInterval(timer); if (!reduceMotion) timer = setInterval(advance, 7000); }
      dots.forEach(function (d, idx) { d.addEventListener("click", function () { activate(idx); start(); }); });
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) { if (e.isIntersecting) start(); else clearInterval(timer); });
        }, { threshold: 0.3 });
        io.observe(car);
      } else { start(); }
      activate(0);
    });
  }

  /* ─── V2 — scroll-revealed callouts on the scroll-pinned bands ─── */
  // Each .dc-cs-v2-callout reveals as it scrolls into the lower 70%
  // of the viewport, then stays revealed. Reduced motion shows all.
  function initV2Callouts(root) {
    var els = root.querySelectorAll(".dc-cs-v2-callout");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-shown"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-shown");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.35, rootMargin: "0px 0px -10% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ─── V2 BRAND WORLD — typewriter cycle ──────────────────────────
     Each tick: type the next prompt char-by-char, swap the active
     Vanquish image + mini chat rectangle, hold, backspace, advance.
     Reduced motion: prompt + image + mini snap to the first entry. */
  function initV2World(root) {
    var stages = root.querySelectorAll("[data-dc-cs-world]");
    if (!stages.length) return;
    stages.forEach(function (stage) {
      var dataEl  = stage.querySelector("[data-dc-cs-world-data]");
      var textEl  = stage.querySelector("[data-typewriter]");
      var vpEl    = stage.querySelector("[data-world-valueprop]");
      var counter = stage.querySelector("[data-world-counter]");
      var images  = stage.querySelectorAll("[data-world-img]");
      var cardcs  = stage.querySelectorAll("[data-world-c]");
      if (!dataEl || !textEl || !images.length) return;
      var prompts, valueProps;
      try {
        var parsed = JSON.parse(dataEl.textContent);
        // Backwards-compatible: old shape was just an array of prompts.
        if (Array.isArray(parsed)) { prompts = parsed; valueProps = []; }
        else { prompts = parsed.prompts || []; valueProps = parsed.valueProps || []; }
      } catch (_) { return; }
      if (!prompts.length) return;

      if (reduceMotion) {
        textEl.textContent = prompts[0];
        if (vpEl && valueProps[0]) vpEl.textContent = valueProps[0];
        return;
      }

      var idx = 0;
      var typeMs = 55;
      var eraseMs = 28;
      var holdMs = 2400;
      var gapMs = 350;
      var subTimer = null;

      // Group images by their data-world-img value so a single prompt
      // can carry multiple images that sub-cycle while it's active.
      var imageGroups = {};
      images.forEach(function (img) {
        var k = img.getAttribute("data-world-img");
        (imageGroups[k] = imageGroups[k] || []).push(img);
      });

      function setActive(i) {
        if (subTimer) { clearInterval(subTimer); subTimer = null; }
        images.forEach(function (img) { img.classList.remove("is-active"); });
        var group = imageGroups[String(i)] || [];
        if (group[0]) group[0].classList.add("is-active");
        if (group.length > 1) {
          var sub = 0;
          subTimer = setInterval(function () {
            group.forEach(function (g) { g.classList.remove("is-active"); });
            sub = (sub + 1) % group.length;
            group[sub].classList.add("is-active");
          }, 1100);
        }
        cardcs.forEach(function (c, n) { c.classList.toggle("is-active", n === i); });
        if (vpEl) vpEl.textContent = valueProps[i] || "";
        if (counter) counter.textContent = ("0" + (i + 1)).slice(-2);
      }

      function type(text, done) {
        var i = 0;
        textEl.textContent = "";
        (function step() {
          if (i > text.length) { done(); return; }
          textEl.textContent = text.slice(0, i);
          i += 1;
          setTimeout(step, typeMs);
        })();
      }

      function erase(done) {
        var current = textEl.textContent;
        var i = current.length;
        (function step() {
          if (i < 0) { done(); return; }
          textEl.textContent = current.slice(0, i);
          i -= 1;
          setTimeout(step, eraseMs);
        })();
      }

      function cycle() {
        setActive(idx);
        type(prompts[idx], function () {
          setTimeout(function () {
            erase(function () {
              idx = (idx + 1) % prompts.length;
              setTimeout(cycle, gapMs);
            });
          }, holdMs);
        });
      }

      // Kick off after the section enters the viewport so the
      // animation isn't ticking off-screen the whole page load.
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              io.disconnect();
              cycle();
            }
          });
        }, { threshold: 0.2 });
        io.observe(stage);
      } else {
        cycle();
      }
    });
  }

  /* ─── V2 — Jeton-style flat color flip on sections w/ [data-dc-cs-bg-flip] ── */
  // The section starts visually white. When its center crosses the
  // middle of the viewport, the white veneer fades out and the brand
  // dark beneath is revealed. Reduced motion: starts revealed.
  function initV2BgFlip(root) {
    var sections = root.querySelectorAll("[data-dc-cs-bg-flip]");
    if (!sections.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      sections.forEach(function (s) { s.classList.add("has-flipped"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("has-flipped");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.25 });
    sections.forEach(function (s) { io.observe(s); });
  }

  /* ─── LP A — Animated single-phone stage ──────────────────────────
     One active phone in the center, prev + next phones peek from the
     sides (ghosted). 4 verticals, each plays 3 bubbles (user → hero
     → AI reply) before crossfading to the next.

     The state machine here is dead simple:
       - activeIndex = which card is currently center stage
       - data-state on each card is rederived from activeIndex
       - bubbles on the active card are revealed one at a time with
         setTimeout, then a longer timeout fires advance() which moves
         to the next card

     Disabled on touch (pointer:coarse) because mobile uses horizontal
     scroll-snap instead — JS would fight the user's swipe. */
  function initLpStrip(root) {
    var stages = root.querySelectorAll("[data-dc-cs-lp-stage]");
    if (!stages.length) return;

    stages.forEach(function (stage) {
      var track = stage.querySelector("[data-lp-track]");
      var cards = stage.querySelectorAll("[data-lp-card]");
      var dots  = stage.querySelectorAll("[data-lp-jump]");
      if (!track || !cards.length) return;

      var n = cards.length;
      var active = 0;
      var bubbleTimers = [];
      var cycleTimer = null;
      var running = false;

      // Per-card bubble reveal — lazy, ghost-flow timing. Each bubble
      // gets a generous beat before the next appears. After revealing
      // a bubble we scroll the chat container to the bottom so the
      // newest message is always in view (mimics real chat behavior
      // and lets cards with 4-5 bubbles fit without overflow).
      function clearBubbleTimers() {
        bubbleTimers.forEach(clearTimeout);
        bubbleTimers = [];
      }
      function resetBubbles(card) {
        card.querySelectorAll(".dc-cs-lp-stage__bubble").forEach(function (b) {
          b.classList.remove("is-shown");
        });
        var chat = card.querySelector("[data-lp-chat]");
        if (chat) chat.scrollTop = 0;
      }
      function playBubbles(card) {
        clearBubbleTimers();
        resetBubbles(card);
        var chat = card.querySelector("[data-lp-chat]");
        var bubbles = card.querySelectorAll(".dc-cs-lp-stage__bubble");
        // Pacing: each bubble needs time on screen to be read before
        // the next one appears.
        //   - 700ms entry pause (let the card crossfade settle)
        //   - 2000ms after the user prompt
        //   - 2800ms after the hero image (visual content; takes a beat)
        //   - 2000ms between everything else
        //
        // Scroll behavior (fixes the "first prompt yanked away" bug):
        //   - bubbles 0 and 1 (prompt + hero) NEVER trigger a scroll —
        //     the prompt must stay visible while the hero loads in.
        //   - bubbles 2+ scroll the MINIMUM amount needed to bring
        //     the new bubble into view (scrollBy by the overflow only),
        //     not all the way to scrollHeight. This keeps earlier
        //     bubbles in view as long as possible.
        var t = 300;
        bubbles.forEach(function (b, i) {
          bubbleTimers.push(setTimeout(function () {
            b.classList.add("is-shown");
            if (chat && i >= 2) {
              requestAnimationFrame(function () {
                var bRect = b.getBoundingClientRect();
                var cRect = chat.getBoundingClientRect();
                var overflowAmt = bRect.bottom - cRect.bottom;
                if (overflowAmt > 0) {
                  chat.scrollBy({ top: overflowAmt + 12, behavior: "smooth" });
                }
              });
            }
          }, t));
          // Gap to the NEXT bubble — extra room after the hero image
          // since that one carries the most visual weight.
          var isHero = b.classList.contains("dc-cs-lp-stage__bubble--hero");
          t += isHero ? 1700 : 1000;
        });
      }

      function applyStates() {
        cards.forEach(function (card, i) {
          var rel = (i - active + n) % n;
          var state =
            rel === 0 ? "active" :
            rel === 1 ? "next"   :
            rel === n - 1 ? "prev" :
            "off";
          card.setAttribute("data-state", state);
        });
        dots.forEach(function (d, i) {
          d.classList.toggle("is-active", i === active);
        });
      }

      function advance() {
        active = (active + 1) % n;
        applyStates();
        // Wait for the crossfade transition to settle before bubble
        // reveal starts on the new active card.
        playBubbles(cards[active]);
      }

      function start() {
        if (running) return;
        running = true;
        applyStates();
        playBubbles(cards[active]);
        // Cycle period — bubbles take ~3.5s to fully reveal; hold the
        // card for another ~3s of breathing room before swapping.
        // Total: ~6.5s per vertical.
        cycleTimer = setInterval(advance, 7500);
      }
      function stop() {
        if (!running) return;
        running = false;
        clearInterval(cycleTimer);
        cycleTimer = null;
        clearBubbleTimers();
      }

      // Dot click — jump to a specific vertical.
      dots.forEach(function (d, i) {
        d.addEventListener("click", function () {
          active = i;
          applyStates();
          playBubbles(cards[active]);
          // Reset the auto-cycle clock so the user gets a full beat
          // on the card they just selected.
          if (cycleTimer) {
            clearInterval(cycleTimer);
            cycleTimer = setInterval(advance, 7500);
          }
        });
      });

      // Reduced motion: skip the show; reveal everything and stop.
      var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        cards.forEach(function (c) {
          c.setAttribute("data-state", "active");
          c.querySelectorAll(".dc-cs-lp-stage__bubble").forEach(function (b) { b.classList.add("is-shown"); });
        });
        return;
      }

      // One code path for all viewports — start cycling when the
      // stage enters the viewport. CSS hides the prev/next ghost
      // cards on narrow screens (≤900px) so on mobile only the
      // active card is visible, but the autoplay + dot navigation
      // behave identically. This avoids the mobile-only scroll-snap
      // path that didn't autoplay or auto-advance.
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) start();
            else stop();
          });
        }, { threshold: 0.25 });
        io.observe(stage);
      } else {
        start();
      }
    });
  }

  /* ─── Char-by-char reveal on body section H2s (Noomo moment 2) ──
     Splits each section H2 into per-character spans. Pairs with the
     existing .reveal IntersectionObserver — when the parent gets
     .in, the CSS keyframes for each .dc-char start. */
  function initCharReveal(root) {
    var heads = root.querySelectorAll(".dc-cs-body-section > h2, .dc-cs-body-section > .dc-cs-body-section__copy h2");
    heads.forEach(function (h) {
      if (h.dataset.charRevealApplied) return;
      h.dataset.charRevealApplied = "1";
      var raw = h.textContent || "";
      // Rebuild with per-character spans. Whitespace stays as text so
      // word-wrap behaves normally.
      h.textContent = "";
      var idx = 0;
      Array.from(raw).forEach(function (ch) {
        if (/\s/.test(ch)) {
          h.appendChild(document.createTextNode(ch));
        } else {
          var s = document.createElement("span");
          s.className = "dc-char";
          s.style.animationDelay = (idx * 18) + "ms";
          s.textContent = ch;
          h.appendChild(s);
          idx += 1;
        }
      });
    });
  }

  /* ─── 3D mouse-follow tilt on cards (Noomo moment 3) ──────────── */
  function initTilt(root) {
    if (reduceMotion) return;
    var nodes = root.querySelectorAll("[data-tilt]");
    if (!nodes.length) return;
    nodes.forEach(function (el) {
      el.addEventListener("mousemove", function (e) {
        var r = el.getBoundingClientRect();
        // -1 to +1 across each axis, with cursor center as origin.
        var x = ((e.clientX - r.left) / r.width) * 2 - 1;
        var y = ((e.clientY - r.top) / r.height) * 2 - 1;
        // Invert Y so cursor at top tilts the card AWAY (away from
        // viewer at top), which feels right.
        el.style.setProperty("--tilt-x", x.toFixed(3));
        el.style.setProperty("--tilt-y", (-y).toFixed(3));
        el.classList.add("is-tilted");
      });
      el.addEventListener("mouseleave", function () {
        el.style.setProperty("--tilt-x", 0);
        el.style.setProperty("--tilt-y", 0);
        el.classList.remove("is-tilted");
      });
    });
  }

  /* ─── Quote marker reveal — broad cyan bars per LINE, scroll-aware
     Bars wipe off left→right on enter (scrolling down or up into
     view). On scrolling UP past the section, bars come back. On
     scrolling DOWN past the section, text stays revealed. */
  function initQuoteMarker(root) {
    var inner = root.querySelector(".dc-cs-quote-band__inner");
    if (!inner) return;
    var quote = inner.querySelector(".dc-cs-quote-marker");
    if (!quote) return;
    var words = quote.querySelectorAll(".dc-cs-quote-marker__word");
    if (!words.length) return;

    function buildBars() {
      // Remove any existing bars (so we can rebuild on resize)
      var existing = quote.querySelectorAll(".dc-cs-quote-marker__bar");
      existing.forEach(function (b) { b.remove(); });

      var qRect = quote.getBoundingClientRect();

      // Group words into lines with a per-line tolerance so subpixel
      // top differences don't spuriously split a visual line in two.
      var rawWords = [];
      words.forEach(function (w) {
        var r = w.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // skip hidden
        rawWords.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });
      });
      if (!rawWords.length) return;

      rawWords.sort(function (a, b) { return a.top - b.top; });
      var lines = [];
      var current = null;
      var tolerance = 6;
      rawWords.forEach(function (w) {
        if (!current || (w.top - current.top) > tolerance) {
          current = { left: w.left, right: w.right, top: w.top, bottom: w.bottom };
          lines.push(current);
        } else {
          current.left   = Math.min(current.left,   w.left);
          current.right  = Math.max(current.right,  w.right);
          current.top    = Math.min(current.top,    w.top);
          current.bottom = Math.max(current.bottom, w.bottom);
        }
      });

      // Cap bar height to font-size * 1.6 — prevents an aberrant
      // measurement from producing a monster bar that spills out of
      // the blockquote and into the figcaption / logo area below.
      var fontPx = parseFloat(getComputedStyle(quote).fontSize) || 32;
      var maxBarH = fontPx * 1.6;

      lines.forEach(function (line, i) {
        var bar = document.createElement("span");
        bar.className = "dc-cs-quote-marker__bar";
        // Per-line bar sized to that line's text + bleed — preserves the
        // staircase + tilted-corner marker feel on both desktop and mobile.
        bar.style.left  = (line.left - qRect.left - 12) + "px";
        bar.style.width = (line.right - line.left + 24) + "px";
        // Bar height bridges to the next line's top so consecutive bars
        // touch (no exposed text between lines). For the last line we
        // fall back to text bbox + 8 bleed.
        var next = lines[i + 1];
        var bottom = next ? next.top : (line.bottom + 8);
        var top = line.top - 4;
        var height = bottom - top;
        if (height > maxBarH) height = maxBarH;
        bar.style.top    = (top - qRect.top) + "px";
        bar.style.height = height + "px";
        bar.style.transitionDelay = (i * 140) + "ms";
        quote.appendChild(bar);
      });
    }

    // Build immediately and on resize. Also rebuild after fonts load
    // and after full window 'load' for safety on mobile, where font
    // swap and viewport settling can change line widths.
    buildBars();
    var resizeT;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(buildBars, 150);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(buildBars);
    }
    window.addEventListener("load", function () {
      // One last rebuild after everything has settled.
      requestAnimationFrame(buildBars);
    });

    if (reduceMotion || !("IntersectionObserver" in window)) {
      inner.classList.add("is-revealed");
      return;
    }

    // Direction-aware visibility tracker
    var lastY = window.scrollY;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var currentY = window.scrollY;
        var scrollingDown = currentY > lastY;
        lastY = currentY;
        if (e.isIntersecting) {
          // Section is in view — reveal (works whether scrolling up or down)
          inner.classList.add("is-revealed");
        } else if (!scrollingDown) {
          // Exited viewport while scrolling UP — re-cover the text
          inner.classList.remove("is-revealed");
        }
        // If exited while scrolling DOWN past section, leave revealed.
      });
    }, { threshold: 0.5 });
    io.observe(inner);
  }

  /* ─── Chapter tower (sticky left nav on case-study detail pages) ─ */
  function initChapterTower(root) {
    var tower = root.querySelector("[data-dc-cs-tower]");
    if (!tower) return;
    var cards   = tower.querySelectorAll("[data-tower-card]");
    var targets = root.querySelectorAll("[data-tower-target]");
    if (!cards.length || !targets.length) return;

    function setActive(idx) {
      cards.forEach(function (c, i) {
        c.classList.toggle("is-active", String(i) === String(idx));
      });
    }
    setActive(0);

    if (!("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      var visible = entries.filter(function (e) { return e.isIntersecting; });
      if (!visible.length) return;
      visible.sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      setActive(visible[0].target.getAttribute("data-tower-target"));
    }, { rootMargin: "-30% 0px -55% 0px", threshold: 0 });
    targets.forEach(function (t) { io.observe(t); });

    cards.forEach(function (c) {
      c.addEventListener("click", function (e) {
        e.preventDefault();
        var idx = c.getAttribute("data-tower-card");
        var t = root.querySelector('[data-tower-target="' + idx + '"]');
        if (t) {
          var y = t.getBoundingClientRect().top + window.scrollY - 100;
          window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
        }
      });
    });
  }

  /* ─── Caps tiles (interactive expand/collapse — accordion) ─────── */
  function initCapsTiles(root) {
    var wrap = root.querySelector("[data-dc-cs-caps]");
    if (!wrap) return;
    var tiles = wrap.querySelectorAll("[data-caps-tile]");
    if (!tiles.length) return;

    function toggle(target) {
      var open = target.getAttribute("aria-expanded") === "true";
      tiles.forEach(function (t) { t.setAttribute("aria-expanded", "false"); });
      // Always leave at least one open — clicking the active one re-opens it
      // (treat tiles as a radio group, not independent checkboxes).
      target.setAttribute("aria-expanded", open ? "true" : "true");
      // If user clicked the already-open tile, do nothing (keep it open).
      if (!open) target.setAttribute("aria-expanded", "true");
    }

    tiles.forEach(function (t) {
      t.addEventListener("click", function () { toggle(t); });
      t.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle(t);
        }
      });
    });
  }

  /* ─── Orbit cards — scroll-linked arc traversal ────────────────────
     Each .dc-cs-orbit__card carries a --t CSS var in [0..1]. The CSS
     transform turns t into a position along a squashed half-ellipse
     (right → apex → left). On scroll, we map the section's progress
     through the viewport to a global scrollT in [0..1], then assign
     each card its own t with a per-card offset so 3–4 cards are
     visible on the arc at any time.

     Reduced motion, narrow viewport (CSS hides the stage at ≤900px),
     or any failure: we add .is-static to the wrapper and the static
     grid fallback (.dc-cs-orbit__fallback) takes over via CSS. */
  function initOrbit(root) {
    var orbits = root.querySelectorAll("[data-dc-cs-orbit]");
    if (!orbits.length) return;

    orbits.forEach(function (orbit) {
      var stage = orbit.querySelector(".dc-cs-orbit__stage");
      var cards = orbit.querySelectorAll(".dc-cs-orbit__card");
      if (!stage || !cards.length) { orbit.classList.add("is-static"); return; }

      // Reduced motion or no rAF? Switch to the static grid fallback.
      if (reduceMotion || typeof requestAnimationFrame !== "function") {
        orbit.classList.add("is-static");
        return;
      }

      // Sticky-scroll stack reveal. The outer section is tall
      // (~520vh on desktop) and its inner .__sticky pane pins to
      // the viewport. As the user scrolls, we map the section's
      // through-viewport progress to a 0..1 per-card --slide-out
      // value. Each card slides up + fades out across its own
      // 1/N segment of the section.
      var section = orbit.closest("[data-dc-cs-orbit-section]");
      if (!section) { orbit.classList.add("is-static"); return; }
      var n = cards.length;
      var raf = 0;
      var active = false;

      function update() {
        raf = 0;
        var rect = section.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        // total = scrollable distance through the section while the
        // sticky pane is pinned. When section top reaches viewport top,
        // progress = 0. When section bottom - vh reaches viewport top,
        // progress = 1.
        var total = section.offsetHeight - vh;
        if (total <= 0) {
          cards.forEach(function (c) { c.style.setProperty("--slide-out", "0"); });
          return;
        }
        var progress = -rect.top / total;
        if (progress < 0) progress = 0;
        if (progress > 1) progress = 1;

        // Convergence band covers most of the section's scroll
        // runway so the cards glide gracefully from scattered to
        // docked rather than snapping. Entry runway lets the heading
        // settle first; exit runway holds the converged collage in
        // view as the user scrolls toward the next section.
        var entry = 0.08;
        var exit  = 0.82;
        var mapped;
        if (progress <= entry) mapped = 0;
        else if (progress >= exit) mapped = 1;
        else mapped = (progress - entry) / (exit - entry);
        // Ease-in-out cubic — gentle acceleration into the glide,
        // gentle deceleration into the final dock. Reads as a glide,
        // not a whoosh.
        var eased = mapped < 0.5
          ? 4 * mapped * mapped * mapped
          : 1 - Math.pow(-2 * mapped + 2, 3) / 2;
        stage.style.setProperty("--convergence", eased.toFixed(4));
      }

      function onScroll() {
        if (raf) return;
        raf = requestAnimationFrame(update);
      }

      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              if (!active) {
                active = true;
                window.addEventListener("scroll", onScroll, { passive: true });
                window.addEventListener("resize", onScroll);
                update();
              }
            } else if (active) {
              active = false;
              window.removeEventListener("scroll", onScroll);
              window.removeEventListener("resize", onScroll);
            }
          });
        }, { rootMargin: "200px 0px 200px 0px" });
        io.observe(section);
      } else {
        window.addEventListener("scroll", onScroll, { passive: true });
      }
      update();
    });
  }

  /* ─── HUB — dots-grid cursor halo ─────────────────────────────────
     Tracks pointer over .dc-hub-dots and translates the halo blob to
     follow. Disabled on touch and on prefers-reduced-motion. */
  function initHubDots(root) {
    var dots = root.querySelectorAll("[data-dc-hub-dots]");
    if (!dots.length || reduceMotion) return;
    if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;
    dots.forEach(function (d) {
      var halo = d.querySelector(".dc-hub-dots__halo");
      if (!halo) return;
      var raf = 0;
      var targetX = 50, targetY = 40, curX = 50, curY = 40;
      function tick() {
        curX += (targetX - curX) * 0.12;
        curY += (targetY - curY) * 0.12;
        halo.style.left = curX + "%";
        halo.style.top  = curY + "%";
        if (Math.abs(targetX - curX) > 0.1 || Math.abs(targetY - curY) > 0.1) {
          raf = requestAnimationFrame(tick);
        } else { raf = 0; }
      }
      d.parentElement && d.parentElement.addEventListener("mousemove", function (e) {
        var r = d.getBoundingClientRect();
        targetX = ((e.clientX - r.left) / r.width) * 100;
        targetY = ((e.clientY - r.top) / r.height) * 100;
        if (!raf) raf = requestAnimationFrame(tick);
      });
    });
  }

  /* ─── HUB — interleaved spotlight scale-on-scroll ─────────────────
     IntersectionObserver toggles .is-in once the band reaches the
     threshold; CSS handles the scale+opacity transition. */
  function initHubScale(root) {
    var els = root.querySelectorAll("[data-dc-hub-scale]");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.25 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ─── HUB — draw-path-on-scroll spine ─────────────────────────────
     SVG stroke-dashoffset animates from 2400 → 0 once the spine enters
     view. Sister of initHubScale; separate observer so we can tune
     thresholds independently if needed. */
  function initHubSpine(root) {
    var els = root.querySelectorAll("[data-dc-hub-spine]");
    if (!els.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.45 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ─── HUB — sticky tab bar shrink ────────────────────────────────
     Adds .is-stuck to the wrapper once it pins to the top of the
     viewport. Uses a sentinel element so we don't bind to scroll. */
  function initHubStickyTabs(root) {
    var wrap = root.querySelector("[data-dc-hub-tabbar]");
    if (!wrap) return;
    if (!("IntersectionObserver" in window)) return;
    var sentinel = document.createElement("div");
    sentinel.style.cssText = "position:absolute;top:0;height:1px;width:1px;pointer-events:none;";
    wrap.parentElement && wrap.parentElement.insertBefore(sentinel, wrap);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        wrap.classList.toggle("is-stuck", !e.isIntersecting);
      });
    }, { threshold: 0 });
    io.observe(sentinel);
  }

  /* ─── HUB v2 — Stage beat sequencer ───────────────────────────────
     Each [data-stage-sequencer] holds a column of [data-beat] elements
     that start hidden (CSS sets opacity 0). On IO entry, we reveal
     beats in order with per-kind dwell. Beat 1 (user-prompt) gets a
     typewriter pass; beat 2 (ai-text) gets a word-by-word stream-in.
     Sequence holds on beat 5, then loops after a tail-pause. */
  function initStageSequencer(root) {
    var stages = root.querySelectorAll("[data-stage-sequencer]");
    if (!stages.length) return;
    stages.forEach(setupStage);
  }
  function setupStage(stage) {
    var beats = stage.querySelectorAll("[data-beat]");
    if (!beats.length) return;
    var state = { active: false, idx: 0, timer: 0, raf: 0 };

    // Capture original text for typewriter / streamer, then clear it
    // so beats start blank when they reveal.
    var typedTargets = [];
    var streamTargets = [];
    beats.forEach(function (b) {
      var t = b.querySelector("[data-typewriter-target]");
      if (t) { typedTargets.push({ el: t, text: t.textContent }); t.textContent = ""; }
      var s = b.querySelector("[data-stream-target]");
      if (s) { streamTargets.push({ el: s, text: s.textContent }); s.textContent = ""; }
    });

    function dwellFor(beat) {
      var kind = beat.getAttribute("data-beat") || "";
      if (kind === "user-prompt")     return 1400;
      if (kind === "ai-text")         return 1600;
      if (kind === "rich-carousel")   return 2400;
      if (kind === "data-spec")       return 2800;
      if (kind === "data-chip")       return 1800;
      if (kind === "locator")         return 2400;
      if (kind === "lifestyle-image") return 2200;
      if (kind === "reviews")         return 2800;
      if (kind === "colorway")        return 2600;
      if (kind === "video-loop")      return 3200;
      if (kind === "brand-ticker")    return 2800;
      if (kind === "stat-billboard")  return 2400;
      if (kind === "stat-strip")      return 2400;
      if (kind === "africa-map")      return 3600;
      if (kind === "partner-grid")    return 3200;
      return 1600;
    }

    function typewrite(target, done) {
      var i = 0;
      var step = 26; // ms per char
      function tick() {
        if (!state.active) { done(); return; }
        i += 1;
        target.el.textContent = target.text.slice(0, i);
        if (i >= target.text.length) {
          target.el.parentElement && target.el.parentElement.parentElement
            && target.el.parentElement.parentElement.classList.add("is-typed");
          done();
        } else {
          state.timer = setTimeout(tick, step);
        }
      }
      tick();
    }
    function stream(target, done) {
      var words = target.text.split(/(\s+)/);
      var i = 0;
      var step = 48;
      function tick() {
        if (!state.active) { done(); return; }
        i += 1;
        target.el.textContent = words.slice(0, i).join("");
        if (i >= words.length) { done(); }
        else { state.timer = setTimeout(tick, step); }
      }
      tick();
    }

    function reset() {
      beats.forEach(function (b) { b.classList.remove("is-in"); b.classList.remove("is-out"); b.classList.remove("is-typed"); });
      typedTargets.forEach(function (t) { t.el.textContent = ""; });
      streamTargets.forEach(function (s) { s.el.textContent = ""; });
      state.idx = 0;
    }

    function showNext() {
      if (!state.active) return;
      if (state.idx >= beats.length) {
        // Hold the final beat, then loop after a tail-pause.
        state.timer = setTimeout(function () { reset(); showNext(); }, 4800);
        return;
      }
      var beat = beats[state.idx];
      var kind = beat.getAttribute("data-beat");
      var zone = beat.getAttribute("data-zone");
      // Dim the previous CHAT beat so the new one reads as latest.
      if (state.idx > 0) {
        var prev = beats[state.idx - 1];
        if (prev.getAttribute("data-zone") === "chat") {
          prev.classList.add("is-out");
        }
      }
      beat.classList.add("is-in");
      state.idx += 1;
      // Auto-scroll the canvas to keep the latest beat in view. Chat
      // and rich bubbles grow downward; scrolling to scrollHeight
      // keeps the latest at the bottom so older beats don't get
      // clipped under the frame's overflow:hidden.
      requestAnimationFrame(function () {
        try { stage.scrollTo({ top: stage.scrollHeight, behavior: "smooth" }); }
        catch (_) { stage.scrollTop = stage.scrollHeight; }
      });

      // Typewriter on user-prompt; stream on ai-text. Both advance the
      // sequencer after they complete.
      var tw  = beat.querySelector("[data-typewriter-target]");
      var stw = beat.querySelector("[data-stream-target]");
      if (tw) {
        var tgt = typedTargets.find(function (x) { return x.el === tw; });
        if (tgt) {
          typewrite(tgt, function () {
            state.timer = setTimeout(showNext, dwellFor(beat) - tgt.text.length * 26);
          });
          return;
        }
      }
      if (stw) {
        var stgt = streamTargets.find(function (x) { return x.el === stw; });
        if (stgt) {
          stream(stgt, function () {
            state.timer = setTimeout(showNext, 1100);
          });
          return;
        }
      }
      state.timer = setTimeout(showNext, dwellFor(beat));
    }

    function play() {
      if (state.active) return;
      state.active = true;
      reset();
      // Kick off almost immediately so the frame isn't blank on entry.
      state.timer = setTimeout(showNext, 120);
    }
    function pause() {
      state.active = false;
      clearTimeout(state.timer);
    }

    if (reduceMotion) {
      // Reveal everything statically.
      typedTargets.forEach(function (t) { t.el.textContent = t.text; });
      streamTargets.forEach(function (s) { s.el.textContent = s.text; });
      beats.forEach(function (b) { b.classList.add("is-in"); });
      return;
    }

    // Scroll-gated start: the sequence begins ONLY when the stage's
    // frame enters the viewport. We try IO first; if its callback
    // doesn't fire (some preview iframes block IO), a single shared
    // scroll listener picks up the slack.
    var hasFired = false;
    function maybePlay() {
      if (hasFired) return;
      var r = stage.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      // Trigger when any portion of the stage is in view (with a
      // 100px head-start below the fold so the first beat is already
      // visible by the time the user finishes scrolling).
      if (r.top < vh + 100 && r.bottom > 0) {
        hasFired = true;
        play();
      }
    }
    // Initial check on next frame in case the stage is already in view.
    requestAnimationFrame(maybePlay);
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !hasFired) {
            hasFired = true;
            play();
            io.unobserve(stage);
          }
        });
      }, { threshold: 0, rootMargin: "0px 0px 100px 0px" });
      io.observe(stage);
    }
    // Scroll fallback (also covers preview environments where IO
    // doesn't fire). One listener per stage is cheap; once the stage
    // has played, the listener removes itself.
    function onScroll() {
      if (hasFired) {
        window.removeEventListener("scroll", onScroll);
        return;
      }
      maybePlay();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    // Bulletproof poll fallback — covers iframes / sandboxes where
    // neither IO nor synthetic scroll events fire. Cheap (one poll
    // per stage; clears itself after firing).
    var pollId = setInterval(function () {
      if (hasFired) { clearInterval(pollId); return; }
      maybePlay();
    }, 250);
  }

  /* ─── HUB v2 — Pinned-section active tracking ────────────────────
     Watches [data-dc-hub-pin] sections and toggles .is-active on the
     entry whose center is closest to the viewport center. Also
     updates the matching [data-dc-rail-link] on the left rail. */
  function initStagePinTracking(root) {
    var pins = root.querySelectorAll("[data-dc-hub-pin]");
    if (!pins.length) return;
    var links = root.querySelectorAll("[data-dc-rail-link]");
    function update() {
      var center = window.innerHeight / 2;
      var best = null;
      var bestDist = Infinity;
      pins.forEach(function (p) {
        var r = p.getBoundingClientRect();
        var pc = (r.top + r.bottom) / 2;
        var d = Math.abs(pc - center);
        if (d < bestDist) { bestDist = d; best = p; }
      });
      pins.forEach(function (p) { p.classList.toggle("is-active", p === best); });
      if (best) {
        var slug = best.getAttribute("data-slug");
        links.forEach(function (l) {
          l.classList.toggle("is-active", l.getAttribute("data-dc-rail-link") === slug);
        });
      }
    }
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { update(); ticking = false; });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ─── HUB v3 — Page-name wipe between pinned entries ─────────────
     For each [data-dc-hub-wipe], play a curtain wipe when the parent
     pin section enters the viewport: curtain sweeps left→right at full
     bleed, the [NAME] plate is centered during the cover, then the
     curtain wipes off to the right revealing the section. */
  function initHubWipe(root) {
    var wipes = root.querySelectorAll("[data-dc-hub-wipe]");
    if (!wipes.length) return;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      wipes.forEach(function (w) { w.classList.add("is-revealed"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var wipe = e.target;
        // Two-phase animation. CSS transitions on .is-wiping bring the
        // curtain across; switching to .is-revealed slides it off.
        // The plate fades in mid-cover.
        wipe.classList.remove("is-revealed");
        wipe.classList.add("is-wiping");
        setTimeout(function () {
          wipe.classList.remove("is-wiping");
          wipe.classList.add("is-revealed");
        }, 850);
        io.unobserve(wipe);
      });
    }, { threshold: 0.25 });
    wipes.forEach(function (w) { io.observe(w); });
  }

  /* ─── HUB — Case-study video play on scroll-into-view ─────────────
     Diageo and Giant Eagle videos load their src + start playing only
     when their containing case-study stage enters the viewport. Same
     polling fallback as the use-case sequencer for preview environments
     where IO doesn't fire. */
  function initCaseStudyVideos(root) {
    var videos = root.querySelectorAll("[data-cs-video]");
    if (!videos.length) return;
    videos.forEach(function (vid) {
      var src = vid.getAttribute("data-asset-src");
      if (!src) return;
      var hasFired = false;
      function maybePlay() {
        if (hasFired) return;
        var r = vid.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight || 0;
        if (r.top < vh + 100 && r.bottom > 0) {
          hasFired = true;
          // Resolve the build-time placeholder against the asset
          // base. Server-rendered HTML uses __ASSETS__ which the WP
          // plugin and the preview wrapper both rewrite at load time;
          // when this JS runs after that rewrite the placeholder is
          // gone. Re-resolve by looking at any other img in the doc.
          var probe = document.querySelector("img[src*='/assets/uploads/']");
          var base = probe ? probe.src.split("/assets/uploads/")[0] + "/assets/uploads/" : "/assets/uploads/";
          vid.src = base + src;
          var p = vid.play && vid.play();
          if (p && p.catch) p.catch(function () { /* autoplay blocked — silent fail */ });
        }
      }
      requestAnimationFrame(maybePlay);
      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting && !hasFired) { maybePlay(); io.unobserve(vid); }
          });
        }, { threshold: 0, rootMargin: "0px 0px 100px 0px" });
        io.observe(vid);
      }
      var pollId = setInterval(function () {
        if (hasFired) { clearInterval(pollId); return; }
        maybePlay();
      }, 250);
      window.addEventListener("scroll", function onScroll() {
        if (hasFired) { window.removeEventListener("scroll", onScroll); return; }
        maybePlay();
      }, { passive: true });
    });
  }

  /* ─── Boot ────────────────────────────────────────────────────── */
  ready(function () {
    var roots = document.querySelectorAll(".dc-cs-main, .dc-cs-detail");
    roots.forEach(function (root) {
      initTabs(root);
      initReveal(root);
      initCountUp(root);
      initScrollers(root);
      initSideBySide(root);
      initChats(root);
      initCycler(root);
      initFilterStrip(root);
      initQuoteCarousel(root);
      initV2Callouts(root);
      initV2BgFlip(root);
      initV2World(root);
      initLpStrip(root);
      initChapterTower(root);
      initCapsTiles(root);
      initCharReveal(root);
      initTilt(root);
      initQuoteMarker(root);
      initOrbit(root);
      initHubDots(root);
      initHubScale(root);
      initHubSpine(root);
      initHubStickyTabs(root);
      initStageSequencer(root);
      initStagePinTracking(root);
      initCaseStudyVideos(root);
    });
  });
})();
