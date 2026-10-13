// Project screenshots, bigger. With a mouse, resting on a picture shows a larger preview beside
// it; it's only a picture, so it never gets in the way of the pointer. A click or a tap opens the
// full-size view in a native <dialog>: Escape or the close button shuts it and focus goes back to
// the picture, and the arrow keys step through the other pictures in the same pile.

const HOVER = '(hover: hover) and (pointer: fine)';

export function initLightbox(imgs) {
  imgs = [...imgs].filter(img => img.getAttribute('src'));
  if (!imgs.length) return;

  // every picture becomes a button, so a keyboard can reach it too
  const items = imgs.map((img) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pcard-zoom';
    btn.setAttribute('aria-label', `Enlarge: ${img.alt || 'screenshot'}`);
    img.replaceWith(btn);
    btn.append(img);
    return { btn, img, group: img.closest('.ptrack') };
  });

  // ---- the hover preview (mouse only)
  const hover = matchMedia(HOVER);
  const peek = document.createElement('div');
  peek.className = 'peek';
  peek.setAttribute('aria-hidden', 'true');
  const peekImg = document.createElement('img');
  peekImg.alt = '';
  peekImg.decoding = 'async';
  peek.append(peekImg);
  document.body.append(peek);
  let peekT = 0, peeking = null;

  function place(btn) {
    const r = btn.getBoundingClientRect();
    const w = Math.min(720, innerWidth * 0.5, innerWidth - 24);
    const h = w * 10 / 16;
    // grown out of the picture itself, centered on it and kept on screen
    const x = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), innerWidth - w - 12);
    const y = Math.min(Math.max(76, r.top + r.height / 2 - h / 2), innerHeight - h - 12);
    peek.style.width = `${w}px`;
    peek.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function showPeek(item) {
    clearTimeout(peekT);
    peekT = setTimeout(() => {
      peeking = item;
      if (peekImg.getAttribute('src') !== item.img.currentSrc) peekImg.src = item.img.currentSrc || item.img.src;
      place(item.btn);
      peek.classList.add('on');
    }, 160);
  }
  function hidePeek() {
    clearTimeout(peekT);
    peeking = null;
    peek.classList.remove('on');
  }
  for (const item of items) {
    item.btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && hover.matches) showPeek(item); });
    item.btn.addEventListener('pointerleave', hidePeek);
  }
  addEventListener('scroll', () => { if (peeking) hidePeek(); }, { passive: true });
  items.forEach(it => it.group?.addEventListener('scroll', () => { if (peeking) hidePeek(); }, { passive: true }));

  // ---- the full-size view
  const dlg = document.createElement('dialog');
  dlg.className = 'lb';
  dlg.setAttribute('aria-label', 'Screenshot, full size');
  dlg.innerHTML =
    '<figure class="lb-fig"><img class="lb-img" alt=""><figcaption class="lb-cap"></figcaption></figure>' +
    '<button class="lb-btn lb-close" type="button" aria-label="Close">&times;</button>' +
    '<button class="lb-btn lb-prev" type="button" aria-label="Previous picture">&lsaquo;</button>' +
    '<button class="lb-btn lb-next" type="button" aria-label="Next picture">&rsaquo;</button>';
  document.body.append(dlg);
  const lbImg = dlg.querySelector('.lb-img');
  const lbCap = dlg.querySelector('.lb-cap');
  const prevBtn = dlg.querySelector('.lb-prev');
  const nextBtn = dlg.querySelector('.lb-next');
  let current = null;

  const siblings = (item) => items.filter(it => it.group === item.group);
  function show(item) {
    current = item;
    lbImg.src = item.img.currentSrc || item.img.src;
    lbImg.alt = item.img.alt;
    lbCap.textContent = item.img.alt;
    const list = siblings(item), i = list.indexOf(item);
    prevBtn.hidden = i <= 0;
    nextBtn.hidden = i >= list.length - 1;
  }
  function step(dir) {
    if (!current) return;
    const list = siblings(current), i = list.indexOf(current) + dir;
    if (list[i]) show(list[i]);
  }
  function open(item) {
    hidePeek();
    show(item);
    document.documentElement.classList.add('lb-open');
    dlg.showModal();
    dlg.querySelector('.lb-close').focus();
  }
  for (const item of items) item.btn.addEventListener('click', () => open(item));
  dlg.querySelector('.lb-close').addEventListener('click', () => dlg.close());
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  // a click on the dimmed backdrop (the dialog itself, outside the picture) closes it
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  dlg.addEventListener('close', () => {
    document.documentElement.classList.remove('lb-open');
    // land back on the picture that's showing, so the keyboard picks up where the eyes are
    current?.btn.focus({ preventScroll: true });
    current?.btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}
