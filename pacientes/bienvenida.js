// Bienvenida al entrar al portal: "PASSO" se escribe trazo a trazo, en arco, sobre un sol que sale,
// y al final el sol crece hasta tapar la pantalla y deja ver el inicio (que se carga por detrás).
// Adaptado del preloader "Amour Sunrise" (React) a JS sin librerías: mismo alfabeto de trazos y misma
// geometría del arco, sin el balanceo con el mouse. Dura ~3,5 s; tocar la pantalla lo saltea.
// Con "reducir movimiento" activado en el teléfono no anima: se ve quieto 1 s.
(function () {
  const PALABRA = 'PASSO';
  const LEYENDA = 'Tu portal médico';
  const COLOR = { fondo: '#F4F6FB', tinta: '#0A2540', sol: '#2F55D4', centro: '#1E3A8A', luz: '#FFFFFF' };
  const ESCRIBE_MS = 2300, LATIDO_MS = 600, SALIDA_MS = 850;

  // Letras de un solo trazo, en una caja de 100 de alto (renglón de y=12 a y=88): [ancho, trazos en orden de escritura]
  const GLIFOS = {
    P: [72, ['M17 88 V12 H35 C52 12 60 22 60 34 C60 47 51 56 35 56 H17']],
    A: [86, ['M14 88 C20 62 30 30 43 12 C56 30 66 62 72 88', 'M27 62 C38 60 50 60 60 62']],
    S: [70, ['M58 22 C52 15 45 12 36 12 C23 12 14 20 14 30 C14 42 24 46 36 50 C50 54 58 59 58 70 C58 82 48 88 36 88 C26 88 17 84 12 76']],
    O: [88, ['M44 12 C64 12 76 29 76 50 C76 72 63 88 44 88 C25 88 12 72 12 50 C12 29 25 12 44 12 Z']],
  };

  // Pasa un trazo (M/L/H/V/C/Z absolutos) por la transformación afín m = [a b c d e f].
  function trazo(d, m) {
    const tk = d.match(/[MLHVCZ]|-?\d*\.?\d+/g) || [];
    let out = '', cmd = '', x = 0, y = 0;
    const p = (px, py) => { x = px; y = py; return (m[0] * px + m[2] * py + m[4]).toFixed(1) + ' ' + (m[1] * px + m[3] * py + m[5]).toFixed(1); };
    for (let i = 0; i < tk.length;) {
      const t = tk[i];
      if (/[MLHVCZ]/.test(t)) { cmd = t; i++; if (t === 'Z') out += 'Z'; continue; }
      const n = k => parseFloat(tk[i + k]);
      if (cmd === 'M' || cmd === 'L') { out += (out ? ' ' : '') + (cmd === 'M' ? 'M' : 'L') + p(n(0), n(1)); if (cmd === 'M') cmd = 'L'; i += 2; }
      else if (cmd === 'H') { out += ' L' + p(n(0), y); i += 1; }
      else if (cmd === 'V') { out += ' L' + p(x, n(0)); i += 1; }
      else if (cmd === 'C') { out += ' C' + p(n(0), n(1)) + ' ' + p(n(2), n(3)) + ' ' + p(n(4), n(5)); i += 6; }
      else i++;
    }
    return out;
  }

  // El cartel: el sol apoyado en el borde de abajo y la palabra en arco encima, cada letra parada sobre
  // el borde del sol, inclinada con el arco y estirada hasta un mismo renglón de arriba.
  function armar(anchos, W, H) {
    const n = anchos.length;
    const F = Math.min(H, Math.max(W * 1.6, 260));
    const top = H - F;
    const R = Math.min(F * 0.6, W * (H > W * 1.1 ? 0.66 : 0.46));
    // en el celular (pantalla vertical) las letras se estiran menos: si no, quedan como fideos
    const alcance = H > W * 1.1 ? 2.3 : Math.max(3.6, Math.min(4.8, (F / W) * 2.6));
    const cx = W / 2, cy = H + R * 0.02, gap = 4;
    const unidades = anchos.reduce((a, b) => a + b, 0) + gap * (n - 1);
    const sx = Math.max(0.05, Math.min((W - W * 0.16) / unidades, F / 210)); // 8% de margen a cada lado
    const grosor = 22 * sx;
    const borde = R + F * 0.045, piso = H - F * 0.035;
    const letras = [];
    let cursor = cx - (unidades * sx) / 2;
    for (let i = 0; i < n; i++) {
      const w = anchos[i] * sx, quiere = cursor + w / 2;
      cursor += w + gap * sx;
      const rel = (quiere - cx) / (W / 2);
      const capY = top + F * (0.05 + 0.04 * rel * rel);
      let bx = quiere, by = piso, t = 0, L = 0;
      for (let k = 0; k < 4; k++) {
        const dx = bx - cx;
        const phi = Math.asin(Math.max(-1, Math.min(1, dx / borde)));
        t = Math.max(-0.62, Math.min(0.62, phi * 0.42));
        const alza = (w / 2) * Math.abs(Math.sin(phi - t));
        by = Math.min(cy - Math.sqrt(Math.max(0, borde * borde - dx * dx)) - alza, piso);
        L = (by - capY) / Math.cos(t);
        L = Math.max(grosor + 76 * sx * 0.6, Math.min(grosor + 76 * sx * alcance, L));
        bx += quiere - (bx + (Math.sin(t) * L) / 2);
      }
      const sy = (L - grosor) / 76, cos = Math.cos(t), sin = Math.sin(t);
      const u0 = (-anchos[i] / 2) * sx, v0 = -88 * sy - grosor / 2;
      letras.push({
        mx: bx + (sin * L) / 2, my: by - (cos * L) / 2, t,
        m: [sx * cos, sx * sin, -sy * sin, sy * cos, bx + u0 * cos - v0 * sin, by + u0 * sin + v0 * cos],
      });
    }
    const cubre = (Math.hypot(Math.max(cx, W - cx), cy) / R) * 1.04;
    return { cx, cy, R, grosor, letras, cubre };
  }

  window.bienvenidaPasso = function () {
    if (document.querySelector('.bv')) return;
    const quieto = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const W = window.innerWidth, H = window.innerHeight;
    const glifos = Array.from(PALABRA).map(c => GLIFOS[c]);
    const c = armar(glifos.map(g => g[0]), W, H);
    const porLetra = ESCRIBE_MS / glifos.length;
    const lanza = Math.max(W, H) * 0.75;

    const letras = c.letras.map((l, i) => {
      const dx = l.mx - c.cx, dy = l.my - c.cy, len = Math.hypot(dx, dy) || 1;
      const trazos = glifos[i][1];
      const paths = trazos.map((d, j) => {
        const dur = porLetra / trazos.length, desde = i * porLetra + j * dur;
        return `<path d="${trazo(d, l.m)}" pathLength="1" style="animation-delay:${desde.toFixed(0)}ms;animation-duration:${dur.toFixed(0)}ms"/>`;
      }).join('');
      return `<g class="bv-letra" style="--fx:${((dx / len) * lanza).toFixed(1)}px;--fy:${((dy / len) * lanza).toFixed(1)}px;--fr:${(l.t * 180 / Math.PI * 1.6).toFixed(1)}deg">${paths}</g>`;
    }).join('');

    const capa = document.createElement('div');
    capa.className = 'bv' + (quieto ? ' bv-quieto' : '');
    capa.setAttribute('role', 'status');
    capa.setAttribute('aria-label', 'Entrando a tu portal');
    capa.style.cssText = `--bv-fondo:${COLOR.fondo};--bv-tinta:${COLOR.tinta};--bv-luz:${COLOR.luz};--bv-r:${c.R.toFixed(1)}px;--bv-cubre:${c.cubre.toFixed(3)};--bv-escribe:${ESCRIBE_MS}ms`;
    capa.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><radialGradient id="bvSol" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="${COLOR.centro}"/><stop offset="0.55" stop-color="${COLOR.centro}" stop-opacity="0.55"/><stop offset="1" stop-color="${COLOR.centro}" stop-opacity="0"/>
      </radialGradient></defs>
      <g transform="translate(${c.cx.toFixed(1)} ${c.cy.toFixed(1)})"><g class="bv-sube">
        <g class="bv-sol"><circle r="${c.R.toFixed(1)}" fill="${COLOR.sol}"/><circle r="${c.R.toFixed(1)}" fill="url(#bvSol)"/></g>
        <text class="bv-leyenda" y="${(-c.R * 0.42).toFixed(1)}" text-anchor="middle" font-size="${Math.max(16, c.R * 0.09).toFixed(1)}">${LEYENDA}</text>
      </g></g>
      <g class="bv-palabra" stroke-width="${c.grosor.toFixed(2)}">${letras}</g>
    </svg>`;
    document.body.appendChild(capa);

    let terminado = false;
    const timers = [];
    const salir = () => {
      if (terminado) return;
      terminado = true;
      timers.forEach(clearTimeout);
      capa.classList.add('bv-sale');
      setTimeout(() => capa.remove(), SALIDA_MS + 150);
    };
    capa.addEventListener('click', salir);
    if (quieto) { timers.push(setTimeout(salir, 1000)); return; }
    timers.push(setTimeout(() => capa.classList.add('bv-listo'), ESCRIBE_MS + 100));
    timers.push(setTimeout(salir, ESCRIBE_MS + 100 + LATIDO_MS + 300));
  };
})();
