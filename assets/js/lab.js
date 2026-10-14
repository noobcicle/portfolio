// The lab's system map: each machine is a box listing the services it runs, and below them a few
// real paths through the house, step by step. The boxes and paths are plain HTML; this only adds
// the light that walks each path, and runs it (and the faceplate LEDs) only while the map is on screen.

export function initSysmap(root, { reduceMotion = false } = {}) {
  if (!root) return;
  root.querySelectorAll('.sys-flow ol').forEach(ol => {
    [...ol.children].slice(1).forEach((li, i) => {
      const hop = document.createElement('i');
      hop.className = 'sys-hop';
      hop.setAttribute('aria-hidden', 'true');
      hop.style.setProperty('--i', i);
      li.prepend(hop);
    });
  });
  if (reduceMotion) return;
  new IntersectionObserver(([en]) => root.classList.toggle('play', en.isIntersecting)).observe(root);
}
