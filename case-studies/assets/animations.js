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
    });
  });
})();
