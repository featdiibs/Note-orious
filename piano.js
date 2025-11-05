// Pro Web Piano — Sustain-safe, mobile-safe, accurate geometry
(() => {
  // ------------------ AUDIO ENGINE ------------------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let started = false;

  const master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);

  // Active voices and key-tracking
  const active = new Map();      // key -> {osc, gain}
  const heldKeys = new Set();    // keys currently held physically (pointer/keyboard)
  let sustain = false;
  const sustainPool = new Set(); // keys released while sustain ON

  const state = {
    wave: 'triangle',
    volume: 0.7,
    attack: 12,
    release: 320,
    baseOct: 4,
    octaves: 2,
    velocityMode: 'ypos' // none | pressure | ypos
  };

  function now(){ return ctx.currentTime; }
  function midiToFreq(m){ return 440 * Math.pow(2, (m - 69) / 12); }

  // Stop and dispose voice immediately
  function stopVoiceNow(v){
    try { v.osc.stop(); v.osc.disconnect(); v.gain.disconnect(); } catch(e){}
  }

  function noteOn(key, freq, vel = 1){
    // If a voice already exists for the key, stop it first (prevent overlap)
    const prev = active.get(key);
    if (prev) stopVoiceNow(prev);

    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const attack = Math.max(0, state.attack/1000);
    const level = Math.max(0, Math.min(1, state.volume * vel));

    osc.type = state.wave;
    osc.frequency.value = freq;

    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);

    osc.connect(g).connect(master);
    osc.start();

    active.set(key, {osc, gain:g});
  }

  // Normal release (honors sustain)
  function noteOff(key){
    const v = active.get(key);
    if(!v) return;
    if(sustain){
      sustainPool.add(key);
      return;
    }
    const t = now();
    const rel = Math.max(0.02, state.release/1000);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, rel/3);
    setTimeout(()=> stopVoiceNow(v), rel*1000 + 50);
    active.delete(key);
  }

  // Force release (ignores sustain)
  function forceOff(key){
    const v = active.get(key);
    if(!v) return;
    const t = now();
    const rel = Math.max(0.02, state.release/1000);
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setTargetAtTime(0, t, rel/3);
    setTimeout(()=> stopVoiceNow(v), rel*1000 + 50);
    active.delete(key);
    sustainPool.delete(key);
    heldKeys.delete(key);
  }

  function allNotesOff(){
    for(const k of Array.from(active.keys())) noteOff(k);
    sustainPool.clear();
  }

  function forceAllOff(){
    for(const k of Array.from(active.keys())) forceOff(k);
    sustainPool.clear();
  }

  // ------------------ NOTE HELPERS ------------------
  const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  function noteToMidi(note){
    const m = note.match(/^([A-G])(#|b)?(\d)$/);
    if(!m) return null;
    const [, L, acc, o] = m; const octave = +o;
    const base = {C:0, D:2, E:4, F:5, G:7, A:9, B:11}[L];
    let v = base + (acc==='#'?1:acc==='b'?-1:0);
    return (octave+1)*12 + v;
  }
  function midiToNote(m){ return NAMES[m%12] + (Math.floor(m/12)-1); }

  // ------------------ DOM SETUP ------------------
  const piano = document.getElementById('piano');
  const whiteLayer = document.createElement('div');
  const blackLayer = document.createElement('div');
  whiteLayer.className = 'white-keys';
  blackLayer.className = 'black-keys';
  piano.appendChild(whiteLayer);
  piano.appendChild(blackLayer);

  // ------------------ BUILD PIANO ------------------
  function buildPiano(){
    whiteLayer.innerHTML = '';
    blackLayer.innerHTML = '';

    const notes = [];
    for(let o=0;o<state.octaves;o++){
      const oct = state.baseOct + o;
      notes.push(
        {n:`C${oct}`, c:'white'},
        {n:`C#${oct}`, c:'black'},
        {n:`D${oct}`, c:'white'},
        {n:`D#${oct}`, c:'black'},
        {n:`E${oct}`, c:'white'},
        {n:`F${oct}`, c:'white'},
        {n:`F#${oct}`, c:'black'},
        {n:`G${oct}`, c:'white'},
        {n:`G#${oct}`, c:'black'},
        {n:`A${oct}`, c:'white'},
        {n:`A#${oct}`, c:'black'},
        {n:`B${oct}`, c:'white'}
      );
    }

    const whites = notes.filter(n=>n.c==='white');
    whiteLayer.style.setProperty('--white-count', whites.length);

    // White keys
    for(const w of whites){
      const el = document.createElement('div');
      el.className = 'white-key';
      el.dataset.note = w.n;
      const lab = document.createElement('span');
      lab.className = 'label'; lab.textContent = w.n;
      el.appendChild(lab);
      whiteLayer.appendChild(el);
    }

    // Black keys — accurate geometry
    const whiteWidthPct = 100 / whites.length;
    let wIdx = 0;
    for(const n of notes){
      if(n.c === 'white'){
        const L = n.n[0];
        const oct = n.n.match(/\d+$/)[0];
        const local = wIdx % 7;
        const hasBlack = (local===0||local===1||local===3||local===4||local===5); // C D F G A
        if(hasBlack){
          const sharpName = `${L}#${oct}`;
          if(notes.find(x=>x.n===sharpName)){
            const b = document.createElement('div');
            b.className = 'black-key';
            b.dataset.note = sharpName;
            const centerPct = (wIdx + 0.5) * whiteWidthPct;
            const bw = whiteWidthPct * 0.6;
            b.style.width = `calc(${bw}% )`;
            b.style.left  = `calc(${centerPct}% - ${bw/2}% )`;
            blackLayer.appendChild(b);
          }
        }
        wIdx++;
      }
    }

    // -------- INTERACTION --------
    const allKeys = [...whiteLayer.querySelectorAll('[data-note]'), ...blackLayer.querySelectorAll('[data-note]')];

    function getVelocity(el, e){
      if(!e) return 1;
      if(state.velocityMode==='pressure' && typeof e.pressure === 'number'){
        return Math.max(0.05, Math.min(1, e.pressure));
      }
      if(state.velocityMode==='ypos'){
        const rect = el.getBoundingClientRect();
        const y = (e.clientY ?? rect.top) - rect.top;
        const r = Math.max(0, Math.min(1, 1 - (y/rect.height)));
        return 0.3 + 0.7 * r;
      }
      return 1;
    }

    function activate(el, e){
      if(!started){ ctx.resume(); started = true; }
      const note = el.dataset.note;
      const midi = noteToMidi(note);
      const freq = midiToFreq(midi);
      const key = 'm'+midi;
      heldKeys.add(key);
      el.classList.add('active');
      noteOn(key, freq, getVelocity(el, e));
    }

    function deactivate(el){
      const note = el.dataset.note;
      const midi = noteToMidi(note);
      const key = 'm'+midi;
      heldKeys.delete(key);
      el.classList.remove('active');
      noteOff(key);
    }

    allKeys.forEach(k=>{
      k.addEventListener('pointerdown', e=>{
        k.setPointerCapture(e.pointerId);
        activate(k, e);
      });
      k.addEventListener('pointerenter', e=>{
        if(e.buttons){ activate(k, e); }
      });
      const end = e=>{ deactivate(k); };
      k.addEventListener('pointerup', end);
      k.addEventListener('pointercancel', end);
      k.addEventListener('pointerleave', e=>{ if(e.buttons===1){ end(e); }});
    });
  }

  // ------------------ CONTROLS ------------------
  const wave      = document.getElementById('wave');
  const vol       = document.getElementById('volume');
  const atk       = document.getElementById('attack');
  const rel       = document.getElementById('release');
  const baseOct   = document.getElementById('baseOct');
  const octaves   = document.getElementById('octaves');
  const sustainCb = document.getElementById('sustain');
  const velMode   = document.getElementById('velocity');
  const themeToggle = document.getElementById('themeToggle');

  wave.onchange = ()=> state.wave = wave.value;
  vol.oninput   = ()=> { state.volume = +vol.value; master.gain.value = state.volume; };
  atk.oninput   = ()=> state.attack = +atk.value;
  rel.oninput   = ()=> state.release = +rel.value;

  baseOct.oninput = ()=> { state.baseOct = +baseOct.value; buildPiano(); };
  octaves.onchange= ()=> { state.octaves = +octaves.value; buildPiano(); };
  velMode.onchange= ()=> state.velocityMode = velMode.value;

  // Sustain pedal logic:
  // - When turning OFF: release any notes not physically held
  sustainCb.onchange = ()=>{
    const prev = sustain;
    sustain = sustainCb.checked;
    if(prev && !sustain){
      // Sustain OFF → release anything not held
      for(const key of Array.from(active.keys())){
        if(!heldKeys.has(key)) forceOff(key);
      }
      sustainPool.clear();
    }
  };

  // Theme toggle
  const root = document.documentElement;
  themeToggle.addEventListener('click', ()=> root.classList.toggle('light'));

  // ------------------ KEYBOARD SUPPORT ------------------
  const KEY_MAP = new Map([
    ['A',0], ['W',1], ['S',2], ['E',3], ['D',4], ['F',5],
    ['T',6], ['G',7], ['Y',8], ['H',9], ['U',10], ['J',11]
  ]);

  window.addEventListener('keydown', e=>{
    if(["INPUT","SELECT","TEXTAREA"].includes(e.target.tagName)) return;
    if(e.repeat) return;
    const k = e.key.toUpperCase();

    // quick base octave control
    if(k==='Z'){ state.baseOct=Math.max(2,state.baseOct-1); baseOct.value=state.baseOct; buildPiano(); return; }
    if(k==='X'){ state.baseOct=Math.min(6,state.baseOct+1); baseOct.value=state.baseOct; buildPiano(); return; }

    if(!KEY_MAP.has(k)) return;
    const base = state.baseOct + (e.shiftKey?1:0);
    const semis = KEY_MAP.get(k);
    const midi = (base+1)*12 + semis;
    const note = midiToNote(midi);
    const el = document.querySelector(`[data-note="${note}"]`);
    if(!el) return;

    if(!started){ ctx.resume(); started = true; }
    const key = 'm'+midi;
    heldKeys.add(key);
    el.classList.add('active');
    noteOn(key, midiToFreq(midi), 0.95);
  });

  window.addEventListener('keyup', e=>{
    const k = e.key.toUpperCase();
    if(!KEY_MAP.has(k)) return;
    const base = state.baseOct + (e.shiftKey?1:0);
    const semis = KEY_MAP.get(k);
    const midi = (base+1)*12 + semis;
    const note = midiToNote(midi);
    const el = document.querySelector(`[data-note="${note}"]`);
    if(el) el.classList.remove('active');
    const key = 'm'+midi;
    heldKeys.delete(key);
    noteOff(key);
  });

  // ------------------ MOBILE / SAFETY HANDLERS ------------------
  // These must BYPASS sustain (forced) so they truly silence everything.
  const forceSilence = ()=> forceAllOff();

  window.addEventListener('pointerup', forceSilence);
  window.addEventListener('touchend', forceSilence, {passive:true});
  window.addEventListener('touchcancel', forceSilence, {passive:true});
  window.addEventListener('orientationchange', ()=> setTimeout(forceSilence, 200));
  document.addEventListener('visibilitychange', ()=> { if(document.hidden) forceSilence(); });

  // Failsafe: kill any lingering voices every 3s
  setInterval(()=> forceSilence(), 3000);

  // ------------------ INIT ------------------
  buildPiano();
  window.addEventListener('beforeunload', ()=> forceAllOff());
})();
