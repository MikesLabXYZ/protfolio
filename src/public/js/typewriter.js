(function () {
  var el = document.getElementById('hero-typewriter');
  if (!el) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var segments = [
    { text: 'Bridging business needs with ', gradient: false },
    { text: 'technical operations that scale', gradient: true },
    { text: '.', gradient: false },
  ];
  var fullLength = segments.reduce(function (sum, s) { return sum + s.text.length; }, 0);

  if (reduceMotion) return; // leave the server-rendered static sentence as-is

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildHTML(count) {
    var remaining = count;
    var html = '';
    for (var i = 0; i < segments.length; i++) {
      if (remaining <= 0) break;
      var seg = segments[i];
      var take = Math.min(remaining, seg.text.length);
      var slice = escapeHtml(seg.text.slice(0, take));
      html += seg.gradient ? '<span class="gradient-text">' + slice + '</span>' : slice;
      remaining -= take;
    }
    return html;
  }

  var cursor = document.createElement('span');
  cursor.className = 'type-cursor';

  function render(count) {
    el.innerHTML = buildHTML(count);
    el.appendChild(cursor);
  }

  // Human-ish typing: a base speed plus small per-character jitter, the way
  // real typewriter-effect libraries (e.g. Typed.js) avoid a robotic feel.
  function typeDelay() { return 58 + Math.random() * 46; }   // ~58-104ms
  function deleteDelay() { return 22 + Math.random() * 18; } // ~22-40ms

  var READ_PAUSE_MS = 1500;       // time to actually read the finished line
  var BLINK_MS = 300;
  var BLINK_COUNT = 6;            // 3 full on/off cycles
  var PAUSE_BEFORE_DELETE_MS = 250;
  var PAUSE_BEFORE_RETYPE_MS = 700;

  var count = 0;
  var timer = null;

  function typeStep() {
    count++;
    render(count);
    if (count >= fullLength) {
      timer = setTimeout(startBlink, READ_PAUSE_MS);
      return;
    }
    timer = setTimeout(typeStep, typeDelay());
  }

  function startBlink() {
    var blinks = 0;
    cursor.style.opacity = '1';
    timer = setInterval(function () {
      cursor.style.opacity = cursor.style.opacity === '0' ? '1' : '0';
      blinks++;
      if (blinks >= BLINK_COUNT) {
        clearInterval(timer);
        cursor.style.opacity = '1';
        timer = setTimeout(deleteStep, PAUSE_BEFORE_DELETE_MS);
      }
    }, BLINK_MS);
  }

  function deleteStep() {
    count--;
    render(count);
    if (count <= 0) {
      timer = setTimeout(typeStep, PAUSE_BEFORE_RETYPE_MS);
      return;
    }
    timer = setTimeout(deleteStep, deleteDelay());
  }

  render(0);
  timer = setTimeout(typeStep, typeDelay());
})();
