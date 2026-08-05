(function () {
  var visual = document.querySelector('.hero-visual');
  if (!visual) return;

  var badges = visual.querySelectorAll('.node-badge');

  badges.forEach(function (badge) {
    var dragging = false;
    var startX = 0, startY = 0;
    var curDx = 0, curDy = 0;

    function bounds() {
      var vr = visual.getBoundingClientRect();
      var br = badge.getBoundingClientRect();
      var half = br.width / 2;
      return { minX: -vr.width + half, maxX: vr.width - half, minY: -vr.height + half, maxY: vr.height - half };
    }

    function apply() {
      badge.style.transform = 'translate(-50%, -50%) translate(' + curDx + 'px, ' + curDy + 'px)';
    }

    function onPointerDown(e) {
      dragging = true;
      badge.classList.add('grabbed');
      startX = e.clientX - curDx;
      startY = e.clientY - curDy;
      try { badge.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;
      var b = bounds();
      curDx = Math.min(b.maxX, Math.max(b.minX, e.clientX - startX));
      curDy = Math.min(b.maxY, Math.max(b.minY, e.clientY - startY));
      apply();
    }

    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      badge.classList.remove('grabbed');
      badge.classList.add('springing');
      curDx = 0;
      curDy = 0;
      apply();
      try { badge.releasePointerCapture(e.pointerId); } catch (err) {}
      setTimeout(function () { badge.classList.remove('springing'); }, 550);
    }

    badge.addEventListener('pointerdown', onPointerDown);
    badge.addEventListener('pointermove', onPointerMove);
    badge.addEventListener('pointerup', onPointerUp);
    badge.addEventListener('pointercancel', onPointerUp);
  });
})();
