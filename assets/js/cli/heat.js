// The quiz's heat meter: ten pips in the terminal's title bar that warm from the site's blue to its
// pink, and a glow around the terminal that follows (--heat, 0 to 1, read by cli-lab.css). A right
// answer sends one of the site's light pulses along the pips; a streak of three or more lets the glow
// breathe; a miss cools it back down. Only classes and one custom property change, and only when you
// answer, never per frame. Reduced motion keeps the colors and drops the movement (in the CSS).
const clamp = (v) => Math.max(0, Math.min(1, v));

export class Heat {
  constructor(term, meter) {
    this.term = term;
    this.meter = meter;
    this.v = 0;
    for (let i = 0; i < 10; i++) {
      const pip = document.createElement('i');
      pip.style.setProperty('--i', i);
      meter.append(pip);
    }
    this.pips = [...meter.children];
  }
  show(on) {
    this.meter.hidden = !on;
    this.term.classList.toggle('has-heat', on);
    if (!on) this.term.classList.remove('is-hot', 'is-cool');
  }
  reset() { this.set(0); this.term.classList.remove('is-hot'); }
  set(v) {
    this.v = clamp(v);
    this.term.style.setProperty('--heat', this.v.toFixed(3));
    const lit = Math.round(this.v * 10);
    this.pips.forEach((p, i) => p.classList.toggle('on', i < lit));
  }
  nudge(dv) { this.set(this.v + dv); }
  hit(streak) {
    this.set(this.v + 0.12 + 0.04 * Math.min(streak, 5));
    this.term.classList.toggle('is-hot', streak >= 3);
    this.once(this.meter, 'is-run');
  }
  miss(dv = 0.15) {
    this.set(this.v - dv);
    this.term.classList.remove('is-hot');
    this.once(this.term, 'is-cool');
  }
  once(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    clearTimeout(node[`_${cls}`]);
    node[`_${cls}`] = setTimeout(() => node.classList.remove(cls), 1200);
  }
}
