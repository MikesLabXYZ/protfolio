(function () {
  var canvas = document.getElementById('network-hero');
  if (!canvas) return;

  var visual = canvas.closest('.hero-visual');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var badgeEls = visual ? Array.prototype.slice.call(visual.querySelectorAll('.node-badge')) : [];
  var NODE_COUNT = badgeEls.length || 7;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0;
  var hoveredIndex = -1;

  function styleValue(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function resize() {
    var rect = canvas.parentElement.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Node positions are read live off the actual badge DOM elements on
  // every frame instead of computed once, so dragging a badge (see
  // hero-drag.js) naturally pulls its connecting line along too.
  function livePositions() {
    var canvasRect = canvas.getBoundingClientRect();
    return badgeEls.map(function (badge) {
      var r = badge.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - canvasRect.left,
        y: r.top + r.height / 2 - canvasRect.top,
      };
    });
  }

  // Whichever node (or the line running to it) is closest to the cursor
  // lights up - the hit area isn't just the badge itself.
  function setHoverFromPointer(clientX, clientY) {
    var hub = { x: w / 2, y: h / 2 };
    var canvasRect = canvas.getBoundingClientRect();
    var mx = clientX - canvasRect.left;
    var my = clientY - canvasRect.top;
    var nodes = livePositions();

    var best = -1, bestDist = Infinity;
    nodes.forEach(function (n, i) {
      var d = pointToSegmentDistance(mx, my, hub.x, hub.y, n.x, n.y);
      if (d < bestDist) { bestDist = d; best = i; }
    });

    // Only light something up while genuinely within the diagram's reach.
    var maxReach = Math.min(w, h) * 0.42;
    hoveredIndex = bestDist <= maxReach ? best : -1;

    badgeEls.forEach(function (badge, i) {
      badge.classList.toggle('js-hovered', i === hoveredIndex);
    });
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  function clearHover() {
    hoveredIndex = -1;
    badgeEls.forEach(function (badge) { badge.classList.remove('js-hovered'); });
  }

  if (visual) {
    visual.addEventListener('mousemove', function (e) { setHoverFromPointer(e.clientX, e.clientY); });
    visual.addEventListener('mouseleave', clearHover);
  }

  function draw(t) {
    if (!w) resize();
    ctx.clearRect(0, 0, w, h);

    var borderRgb = styleValue('--border') || '#24303d';
    var accent = styleValue('--accent') || '#e8934a';
    var accentRgb = styleValue('--accent-rgb') || '232,147,74';
    var accent2Rgb = styleValue('--accent-2-rgb') || '139,124,246';

    var cx = w / 2, cy = h / 2;
    var hub = { x: cx, y: cy };
    var nodes = livePositions();

    // outer rim connecting each node to its neighbor
    ctx.lineWidth = 1;
    ctx.strokeStyle = borderRgb;
    ctx.globalAlpha = 0.4;
    for (var j = 0; j < NODE_COUNT; j++) {
      var a = nodes[j], b = nodes[(j + 1) % NODE_COUNT];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // spokes hub -> each node
    nodes.forEach(function (n, i) {
      if (!n) return;
      var isHovered = i === hoveredIndex;
      var dim = hoveredIndex !== -1 && !isHovered;
      var alphaA = isHovered ? 0.9 : (dim ? 0.12 : 0.4);
      var alphaB = isHovered ? 0.5 : (dim ? 0.04 : 0.08);
      var grad = ctx.createLinearGradient(hub.x, hub.y, n.x, n.y);
      grad.addColorStop(0, 'rgba(' + accentRgb + ',' + alphaA + ')');
      grad.addColorStop(1, 'rgba(' + accentRgb + ',' + alphaB + ')');
      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = isHovered ? 2.6 : 1;
      ctx.moveTo(hub.x, hub.y);
      ctx.lineTo(n.x, n.y);
      ctx.stroke();
    });

    // traveling particles
    if (!reduceMotion) {
      nodes.forEach(function (n, i) {
        if (!n) return;
        if (hoveredIndex !== -1 && i !== hoveredIndex) return;
        var p = ((t * 0.00007 * (0.2 + (i % 3) * 0.09)) + (i / NODE_COUNT)) % 1;
        var x = hub.x + (n.x - hub.x) * p;
        var y = hub.y + (n.y - hub.y) * p;
        var rgb = i % 2 === 0 ? accentRgb : accent2Rgb;
        var size = i === hoveredIndex ? 3.6 : 2.6;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + rgb + ',0.95)';
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = 'rgba(' + rgb + ',0.25)';
        ctx.arc(x, y, size * 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // pulsing hub glow
    var pulse = reduceMotion ? 0.5 : (Math.sin(t * 0.0018) + 1) / 2;
    var glowR = 18 + pulse * 10;
    var grad2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad2.addColorStop(0, 'rgba(' + accentRgb + ',0.6)');
    grad2.addColorStop(1, 'rgba(' + accentRgb + ',0)');
    ctx.fillStyle = grad2;
    ctx.beginPath();
    ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = accent;
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.stroke();

    window.requestAnimationFrame(draw);
  }

  resize();
  window.requestAnimationFrame(draw);

  var resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
})();
