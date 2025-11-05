// Pro Web Piano — Perfected Version (mobile-safe, accurate geometry)
(() => {

  // ------------------ AUDIO ENGINE ------------------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let started = false;

  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);

  const active = new Map();   // Stores active voices: key -> {osc, gain}
  let sustain = false;
  const sustainPool = new Set();

  const state = {
    wave: 'triangle',
    volume: 0.7,
    attack: 12,
    release: 320,
    baseOct: 4,
    octaves: 2,
    velocityMode: 'ypos' // none | pressure | ypos
  };

  function now() { return ctx.currentTime; }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function noteOn(key, freq, vel = 1) {
    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();

    osc.type = state.wave;
    osc.frequency.value = freq;

    const attack = Math.max(0, state.attack / 1000);
    const lvl = Math.max(0, Math.min(1, state.volume * vel));

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + attack);

    osc.connect(g).connect(master);
    osc.start();

    active.set(key, { osc, gain: g });
  }

  function noteOff(key) {
    const v = active.get(key);
    if (!v) return;

    if (sustain) {
      sustainPool.add(key);
      return;
    }

    const t = now();
    const rel = Math.max(0.02, state.release / 1000);

    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, rel / 3);

    setTimeout(() => {
      try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch (e) {}
    }, rel * 1000 + 50);

    active.delete(key);
  }

  function allNotesOff() {
    for (const k of active.keys()) noteOff(k);
    sustainPool.clear();
  }

  // ------------------ NOTE HELPERS ------------------
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  function noteToMidi(note) {
    const m = note.match(/^([A-G])(#|b)?(\d)$/);
    if (!m) return null;
    const [, L, acc, o] = m;
    const octave = +o;
    const base = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[L];
    let v = base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0);
    return (octave + 1) * 12 + v;
  }

  function midiToNote(m) {
    return NAMES[m % 12] + (Math.floor(m / 12) - 1);
  }

  // ------------------ DOM SETUP ------------------
  const piano = document.getElementById("piano");
  const whiteLayer = document.createElement("div");
  const blackLayer = document.createElement("div");
  whiteLayer.className = "white-keys";
  blackLayer.className = "black-keys";
  piano.appendChild(whiteLayer);
  piano.appendChild(blackLayer);

  // ------------------ BUILD PIANO ------------------
  function buildPiano() {
    whiteLayer.innerHTML = "";
    blackLayer.innerHTML = "";

    const notes = [];

    for (let o = 0; o < state.octaves; o++) {
      const oct = state.baseOct + o;
      notes.push(
        { n: `C${oct}`, c: "white" },
        { n: `C#${oct}`, c: "black" },
        { n: `D${oct}`, c: "white" },
        { n: `D#${oct}`, c: "black" },
        { n: `E${oct}`, c: "white" },
        { n: `F${oct}`, c: "white" },
        { n: `F#${oct}`, c: "black" },
        { n: `G${oct}`, c: "white" },
        { n: `G#${oct}`, c: "black" },
        { n: `A${oct}`, c: "white" },
        { n: `A#${oct}`, c: "black" },
        { n: `B${oct}`, c: "white" }
      );
    }

    const whites = notes.filter(n => n.c === "white");
    whiteLayer.style.setProperty("--white-count", whites.length);

    // White keys
    for (const w of whites) {
      const el = document.createElement("div");
      el.className = "white-key";
      el.dataset.note = w.n;
      const lab = document.createElement("span");
      lab.className = "label";
      lab.textContent = w.n;
      el.appendChild(lab);
      whiteLayer.appendChild(el);
    }

    // Accurate black key placement
    const whiteWidthPct = 100 / whites.length;
    let wIdx = 0;

    for (const n of notes) {
      if (n.c === "white") {
        const L = n.n[0];
        const oct = n.n.match(/\d+$/)[0];

        const localIdx = wIdx % 7;
        const hasBlack = (localIdx === 0 || localIdx === 1 || localIdx === 3 ||
                          localIdx === 4 || localIdx === 5);

        if (hasBlack) {
          const sharpName = `${L}#${oct}`;
          if (notes.find(x => x.n === sharpName)) {
            const b = document.createElement("div");
            b.className = "black-key";
            b.dataset.note = sharpName;

            const centerPct = (wIdx + 0.5) * whiteWidthPct;
            const bw = whiteWidthPct * 0.6;

            b.style.width = `calc(${bw}% )`;
            b.style.left = `calc(${centerPct}% - ${bw / 2}% )`;

            blackLayer.appendChild(b);
          }
        }
        wIdx++;
      }
    }

    // ------------------ INTERACTION ------------------
    const all = [...whiteLayer.querySelectorAll("[data-note]"), ...blackLayer.querySelectorAll("[data-note]")];
    const pressed = new Set();

    function getVelocity(el, e) {
      if (!e) return 1;

      if (state.velocityMode === "pressure" && typeof e.pressure === "number") {
        return Math.max(0.05, Math.min(1, e.pressure));
      }

      if (state.velocityMode === "ypos") {
        const rect = el.getBoundingClientRect();
        const y = (e.clientY ?? rect.top) - rect.top;
        const r = Math.max(0, Math.min(1, 1 - (y / rect.height)));
        return 0.3 + 0.7 * r;
      }

      return 1;
    }

    function activateKey(el, e) {
      if (!started) { ctx.resume(); started = true; }
      const note = el.dataset.note;
      const midi = noteToMidi(note);
      const freq = midiToFreq(midi);

      el.classList.add("active");
      noteOn("m" + midi, freq, getVelocity(el, e));
    }

    function deactivateKey(el) {
      const note = el.dataset.note;
      const midi = noteToMidi(note);
      el.classList.remove("active");
      noteOff("m" + midi);
    }

    all.forEach(k => {
      k.addEventListener("pointerdown", e => {
        k.setPointerCapture(e.pointerId);
        pressed.add(k);
        activateKey(k, e);
      });

      k.addEventListener("pointerenter", e => {
        if (e.buttons) {
          pressed.add(k);
          activateKey(k, e);
        }
      });

      const end = e => {
        if (pressed.has(k)) {
          pressed.delete(k);
          deactivateKey(k);
        }
      };

      k.addEventListener("pointerup", end);
      k.addEventListener("pointercancel", end);
      k.addEventListener("pointerleave", e => {
        if (e.buttons === 1) end(e);
      });
    });
  }

  // ------------------ CONTROLS ------------------
  const wave = document.getElementById("wave");
  const vol = document.getElementById("volume");
  const atk = document.getElementById("attack");
  const rel = document.getElementById("release");
  const baseOct = document.getElementById("baseOct");
  const octaves = document.getElementById("octaves");
  const sustainCb = document.getElementById("sustain");
  const velMode = document.getElementById("velocity");
  const themeToggle = document.getElementById("themeToggle");

  wave.onchange = () => state.wave = wave.value;
  vol.oninput = () => { state.volume = +vol.value; master.gain.value = state.volume; };
  atk.oninput = () => state.attack = +atk.value;
  rel.oninput = () => state.release = +rel.value;

  baseOct.oninput = () => { state.baseOct = +baseOct.value; buildPiano(); };
  octaves.onchange  = () => { state.octaves = +octaves.value; buildPiano(); };
  velMode.onchange  = () => state.velocityMode = velMode.value;

  sustainCb.onchange = () => {
    sustain = sustainCb.checked;
    if (!sustain) {
      for (const k of sustainPool) noteOff(k);
      sustainPool.clear();
    }
  };

  // Theme toggle
  const root = document.documentElement;
  themeToggle.addEventListener("click", () => {
    root.classList.toggle("light");
  });

  // ------------------ KEYBOARD SUPPORT ------------------
  const KEY_MAP = new Map([
    ["A",0],["W",1],["S",2],["E",3],["D",4],["F",5],
    ["T",6],["G",7],["Y",8],["H",9],["U",10],["J",11]
  ]);

  window.addEventListener("keydown", e => {
    if (["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
    if (e.repeat) return;

    const k = e.key.toUpperCase();

    if (k === "Z") {
      state.baseOct = Math.max(2, state.baseOct - 1);
      baseOct.value = state.baseOct;
      buildPiano();
      return;
    }
    if (k === "X") {
      state.baseOct = Math.min(6, state.baseOct + 1);
      baseOct.value = state.baseOct;
      buildPiano();
      return;
    }

    if (!KEY_MAP.has(k)) return;

    const base = state.baseOct + (e.shiftKey ? 1 : 0);
    const semis = KEY_MAP.get(k);
    const midi = (base + 1) * 12 + semis;
    const note = midiToNote(midi);

    const el = document.querySelector(`[data-note="${note}"]`);
    if (!el) return;

    if (!started) ctx.resume();

    el.classList.add("active");
    noteOn("m" + midi, midiToFreq(midi), 0.95);
  });

  window.addEventListener("keyup", e => {
    const k = e.key.toUpperCase();
    if (!KEY_MAP.has(k)) return;

    const base = state.baseOct + (e.shiftKey ? 1 : 0);
    const semis = KEY_MAP.get(k);
    const midi = (base + 1) * 12 + semis;

    const note = midiToNote(midi);
    const el = document.querySelector(`[data-note="${note}"]`);
    if (el) el.classList.remove("active");

    noteOff("m" + midi);
  });

  // ------------------ MOBILE SAFETY FIXES ------------------

  window.addEventListener("pointerup", () => {
    for (const k of active.keys()) noteOff(k);
  });

  window.addEventListener("touchend", () => {
    for (const k of active.keys()) noteOff(k);
  });

  window.addEventListener("touchcancel", () => {
    for (const k of active.keys()) noteOff(k);
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(() => {
      for (const k of active.keys()) noteOff(k);
    }, 200);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) for (const k of active.keys()) noteOff(k);
  });

  setInterval(() => {
    for (const [key, voice] of active) {
      if (voice.gain.gain.value > 0.0001) noteOff(key);
    }
  }, 3000);

  // ------------------ INIT ------------------
  buildPiano();

  window.addEventListener("beforeunload", () => allNotesOff());

})();
