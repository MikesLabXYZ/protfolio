(function () {
  var track = document.querySelector('.marquee-track');
  if (!track) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var x = 0;
  var setWidth = 0; // width of ONE copy of the logo set
  var copies = parseInt(track.dataset.copies, 10) || 2;
  var speed = 0.45; // px/frame, auto-scroll
  var dragging = false;
  var dragStartX = 0;
  var dragStartTranslate = 0;

  // The track renders several identical copies of the logo set back to
  // back (enough that even a very wide monitor never runs out of content
  // and shows the seam). Measuring the real, fully-loaded scrollWidth
  // (rather than assuming a fixed CSS %) is what makes the loop actually
  // seamless regardless of screen width or when images finish loading.
  function measure() {
    setWidth = track.scrollWidth / copies;
  }

  function apply() {
    if (setWidth > 0) {
      // wrap x into (-setWidth, 0]
      x = x % setWidth;
      if (x > 0) x -= setWidth;
    }
    track.style.transform = 'translateX(' + x + 'px)';
  }

  function tick() {
    if (!dragging && !reduceMotion) {
      x -= speed;
    }
    apply();
    requestAnimationFrame(tick);
  }

  function onPointerDown(e) {
    dragging = true;
    track.classList.add('dragging');
    dragStartX = e.clientX;
    dragStartTranslate = x;
    try { track.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onPointerMove(e) {
    if (!dragging) return;
    x = dragStartTranslate + (e.clientX - dragStartX);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    track.classList.remove('dragging');
    try { track.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  track.addEventListener('pointerdown', onPointerDown);
  track.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  track.addEventListener('pointercancel', onPointerUp);

  measure();
  var imgs = track.querySelectorAll('img');
  var pending = 0;
  imgs.forEach(function (img) {
    if (!img.complete) {
      pending++;
      var done = function () {
        pending--;
        measure();
      };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  });

  window.addEventListener('resize', measure);

  requestAnimationFrame(tick);
})();
