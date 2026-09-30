/**
 * PORTAL DE PACIENTES — CLÍNICA PASSO  (clinicapasso.com.ar/pacientes)
 *
 * Pantallas (por #ruta):
 *   #/ingresar  #/codigo  #/olvide              → sin sesión
 *   #/inicio  #/turnos  #/pedir  #/estudios  #/doc/:id  #/perfil   → con sesión
 *
 * Todo lo que se ve sale de /api/mi, que solo devuelve datos del paciente de la sesión.
 * Nada médico se guarda en el celular: solo el pase de la sesión.
 */
'use strict';

const API = 'https://clinica-passo-backend.onrender.com/api';
const CLAVE_SESION = 'passo_mi_sesion';
const WHATSAPP_CLINICA = '5491139511478';

const S = { sesion: null, perfil: null, turnos: null, docs: null, opciones: null, urls: new Map(), filtroDocs: 'todos', dniRecordado: '' };
const $ = (sel, raiz) => (raiz || document).querySelector(sel);

// ---------------------------------------------------------------- utilidades
function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function urlSegura(u) { const s = String(u || ''); return /^https:\/\//i.test(s) ? s : '#'; }
const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const capital = (s) => String(s || '').toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// "2026-10-05T14:00:00" → Date (sin corrimientos de zona horaria)
function fechaTurno(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return new Date(NaN);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(String(s)) && !/[+-]00:?00$|[zZ]$/.test(String(s))) return new Date(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
function fechaDoc(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const fmtLarga = (d) => `${capital(DIAS[d.getDay()])} ${d.getDate()} de ${MESES[d.getMonth()]}`;
const fmtCorta = (d) => d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
const fmtHora = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDni = (d) => soloDigitos(d).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function pintarIconos(raiz) {
  (raiz || document).querySelectorAll('[data-ico]').forEach(el => { el.outerHTML = icono(el.dataset.ico, el.dataset.icoClase); });
}

// ---------------------------------------------------------------- sesión
function leerSesion() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE_SESION) || 'null');
    if (s && s.token && s.exp > Date.now()) return s;
  } catch (e) {}
  return null;
}
function guardarSesion(d) {
  S.sesion = { token: d.token, exp: d.exp, nombre: d.paciente && d.paciente.nombre };
  try { localStorage.setItem(CLAVE_SESION, JSON.stringify(S.sesion)); } catch (e) {}
}
function borrarSesion() {
  S.sesion = null; S.perfil = null; S.turnos = null; S.docs = null; S.opciones = null; S.urls.clear();
  try { localStorage.removeItem(CLAVE_SESION); } catch (e) {}
}

// ---------------------------------------------------------------- servidor
let avisoLento = null;
async function api(ruta, { method = 'GET', body, publico } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (!publico && S.sesion) headers.Authorization = 'Bearer ' + S.sesion.token;
  // El servidor puede tardar en "despertar" la primera vez
  clearTimeout(avisoLento);
  avisoLento = setTimeout(() => { const c = $('.cargando-texto'); if (c) c.textContent = 'Conectando con la clínica… puede tardar unos segundos.'; }, 4000);
  let res;
  try {
    res = await fetch(API + ruta, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    throw new Error('No hay conexión. Revisá tu internet y volvé a intentar.');
  } finally {
    clearTimeout(avisoLento);
  }
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && !publico) {
    borrarSesion();
    irA('#/ingresar', datos.error || 'Tu sesión venció. Volvé a ingresar.');
    throw Object.assign(new Error(datos.error || 'Sesión vencida'), { sesion: true });
  }
  if (!res.ok) throw new Error(datos.error || 'Ocurrió un error. Intentá de nuevo.');
  return datos;
}

async function cargarPerfil(forzar) { if (!S.perfil || forzar) S.perfil = await api('/mi/perfil'); return S.perfil; }
async function cargarTurnos(forzar) { if (!S.turnos || forzar) S.turnos = await api('/mi/turnos'); return S.turnos; }
async function cargarDocs(forzar) { if (!S.docs || forzar) S.docs = await api('/mi/documentos'); return S.docs; }
async function cargarOpciones() { if (!S.opciones) S.opciones = await api('/mi/opciones-turno'); return S.opciones; }

async function firmar(paths) {
  const faltan = paths.filter(p => { const c = S.urls.get(p); return !c || c.hasta < Date.now(); });
  if (faltan.length) {
    const d = await api('/mi/archivos/firmar', { method: 'POST', body: { paths: faltan } });
    Object.entries(d.urls || {}).forEach(([p, u]) => S.urls.set(p, { url: u, hasta: Date.now() + 50 * 60000 }));
  }
  const r = {};
  paths.forEach(p => { const c = S.urls.get(p); if (c) r[p] = c.url; });
  return r;
}

// ---------------------------------------------------------------- interfaz común
let aviso = null;   // mensaje para mostrar en la próxima pantalla
function irA(hash, mensaje) { aviso = mensaje || null; if (location.hash === hash) render(); else location.hash = hash; }

function toast(txt) {
  const t = $('#toast');
  t.textContent = txt; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

function barra({ titulo, volver } = {}) {
  $('#barraMarca').classList.toggle('hidden', !!titulo);
  $('#barraTitulo').classList.toggle('hidden', !titulo);
  $('#barraTitulo').textContent = titulo || '';
  const v = $('#barraVolver');
  v.classList.toggle('hidden', !volver);
  v.innerHTML = icono('chevron-left');
  v.onclick = () => { if (history.length > 1 && volver === true) history.back(); else location.hash = volver === true ? '#/inicio' : volver; };
}

function nav(activa) {
  const n = $('#nav');
  n.classList.toggle('hidden', !activa);
  $('#vista').classList.toggle('sin-nav', !activa);
  n.querySelectorAll('a').forEach(a => a.classList.toggle('activo', a.dataset.nav === activa));
}

function quitarPantallaCarga() {
  const pc = document.getElementById('pantallaCarga');
  if (!pc || pc.classList.contains('saliendo')) return;
  pc.classList.add('saliendo');
  setTimeout(() => pc.remove(), 250);
}

function pintar(html) {
  if (!/^<div class="cargando">/.test(html)) quitarPantallaCarga();
  const v = $('#vista');
  v.innerHTML = html;
  pintarIconos(v);
  window.scrollTo(0, 0);
}

function cargando(texto) { pintar(`<div class="cargando"><span class="spinner"></span><span class="cargando-texto">${esc(texto || '')}</span></div>`); }

function errorPantalla(err, reintentar) {
  if (err && err.sesion) return;
  pintar(`<div class="aviso aviso-error" style="margin-top:16px"><span data-ico="circle-alert"></span><span>${esc(err.message)}</span></div>
    <button class="btn btn-borde" id="reintentar"><span data-ico="refresh-cw"></span> Reintentar</button>`);
  $('#reintentar').onclick = reintentar || render;
}

function htmlAviso() {
  if (!aviso) return '';
  const a = typeof aviso === 'string' ? { tipo: 'info', texto: aviso } : aviso;
  aviso = null;
  const ico = a.tipo === 'ok' ? 'check-circle-2' : a.tipo === 'error' ? 'circle-alert' : 'info';
  return `<div class="aviso aviso-${a.tipo}"><span data-ico="${ico}"></span><span>${esc(a.texto)}</span></div>`;
}

function mostrarError(form, msg) {
  let e = $('.aviso-error', form);
  if (!e) { e = document.createElement('div'); e.className = 'aviso aviso-error'; form.prepend(e); }
  e.innerHTML = icono('circle-alert') + `<span>${esc(msg)}</span>`;
  e.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function limpiarError(form) { const e = $('.aviso-error', form); if (e) e.remove(); }

async function conBoton(btn, tarea) {
  const antes = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
  try { return await tarea(); } finally { btn.disabled = false; btn.innerHTML = antes; }
}

// Diálogo inferior (reemplaza a confirm())
function preguntar({ titulo, texto, si = 'Aceptar', no = 'Volver', peligro, conClave }) {
  return new Promise((resolver) => {
    const capa = $('#capa');
    capa.innerHTML = `<div class="dialogo" role="dialog" aria-modal="true">
      <h3>${esc(titulo)}</h3><p>${esc(texto)}</p>
      ${conClave ? `<label class="campo" style="margin-top:16px"><span>Tu contraseña</span><input class="input" type="password" id="dlgClave" autocomplete="current-password"></label>` : ''}
      <div class="botones"><button class="btn ${peligro ? 'btn-peligro' : 'btn-primario'}" id="dlgSi">${esc(si)}</button><button class="btn btn-texto" id="dlgNo">${esc(no)}</button></div></div>`;
    capa.classList.remove('hidden');
    const cerrar = (v) => { capa.classList.add('hidden'); capa.innerHTML = ''; resolver(v); };
    $('#dlgSi').onclick = () => cerrar(conClave ? ($('#dlgClave').value || null) : true);
    $('#dlgNo').onclick = () => cerrar(false);
    capa.onclick = (e) => { if (e.target === capa) cerrar(false); };
    if (conClave) setTimeout(() => $('#dlgClave').focus(), 50);
  });
}

function campoClave(id, etiqueta, auto, ayuda) {
  return `<label class="campo"><span>${esc(etiqueta)}</span><div class="con-ojo">
    <input class="input" type="password" id="${id}" autocomplete="${auto}" required>
    <button type="button" class="ojo" data-ojo="${id}" aria-label="Mostrar contraseña">${icono('eye')}</button></div>
    ${ayuda ? `<small>${esc(ayuda)}</small>` : ''}</label>`;
}
function activarOjos() {
  document.querySelectorAll('[data-ojo]').forEach(b => {
    b.onclick = () => {
      const i = document.getElementById(b.dataset.ojo);
      const ver = i.type === 'password';
      i.type = ver ? 'text' : 'password';
      b.innerHTML = icono(ver ? 'eye-off' : 'eye');
    };
  });
}

// ---------------------------------------------------------------- INGRESO
function vistaIngresar() {
  barra(); nav(null);
  pintar(`<div class="ingreso">
    <div class="ingreso-hero">
      <div class="ingreso-logo"><img src="../assets/logo.jpg" alt="Clínica Passo" onerror="this.remove()"></div>
      <h2>Portal de pacientes</h2>
      <p>Tus turnos, estudios y resultados de Clínica Passo.</p>
    </div>
    ${htmlAviso()}
    <form id="fIngreso" novalidate>
      <label class="campo"><span>DNI</span><input class="input" id="dni" inputmode="numeric" autocomplete="username" placeholder="Sin puntos" maxlength="12" value="${esc(S.dniRecordado)}"></label>
      ${campoClave('clave', 'Contraseña', 'current-password')}
      <button class="btn btn-primario" type="submit">Ingresar</button>
    </form>
    <div class="separador">¿Es tu primera vez?</div>
    <a class="btn btn-secundario" href="#/codigo"><span data-ico="key-round"></span> Tengo un código</a>
    <div class="botones" style="margin-top:6px"><a class="btn btn-texto" href="#/olvide">Olvidé mi contraseña</a></div>
    <p class="ingreso-pie">¿Todavía no tenés acceso? Pedilo en recepción de la clínica con tu DNI: te mandamos un código a tu email.</p>
    <p class="ingreso-pie"><a href="../">${icono('chevron-left')} Volver a clinicapasso.com.ar</a></p>
  </div>`);
  activarOjos();
  const f = $('#fIngreso');
  f.onsubmit = async (e) => {
    e.preventDefault(); limpiarError(f);
    const dni = soloDigitos($('#dni').value), password = $('#clave').value;
    if (dni.length < 6) return mostrarError(f, 'Ingresá tu DNI (solo números).');
    if (!password) return mostrarError(f, 'Ingresá tu contraseña.');
    S.dniRecordado = dni;
    try {
      const d = await conBoton($('button[type=submit]', f), () => api('/mi/login', { method: 'POST', body: { dni, password }, publico: true }));
      guardarSesion(d);
      irA('#/inicio');
    } catch (err) { mostrarError(f, err.message); }
  };
}

function vistaCodigo() {
  barra({ titulo: 'Activar con código', volver: '#/ingresar' }); nav(null);
  pintar(`<div class="ingreso">
    ${htmlAviso()}
    <p class="bajada" style="margin-top:8px">Poné el código de 6 números que te llegó por email y elegí tu contraseña. Sirve para la primera vez y para recuperar tu contraseña.</p>
    <form id="fCodigo" novalidate>
      <label class="campo"><span>DNI</span><input class="input" id="dni" inputmode="numeric" autocomplete="username" placeholder="Sin puntos" maxlength="12" value="${esc(S.dniRecordado)}"></label>
      <label class="campo"><span>Código del email</span><input class="input input-codigo" id="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••"></label>
      ${campoClave('clave', 'Elegí tu contraseña', 'new-password', 'Mínimo 8 caracteres, con letras y números.')}
      ${campoClave('clave2', 'Repetila', 'new-password')}
      <button class="btn btn-primario" type="submit">Activar mi cuenta</button>
    </form>
    <p class="ingreso-pie">¿No te llegó? Revisá la carpeta de spam. El código vence a las 72 horas: podés pedir otro con <a href="#/olvide">Olvidé mi contraseña</a> o en recepción.</p>
  </div>`);
  activarOjos();
  const cod = $('#codigo');
  cod.oninput = () => { cod.value = soloDigitos(cod.value).slice(0, 6); };
  const f = $('#fCodigo');
  f.onsubmit = async (e) => {
    e.preventDefault(); limpiarError(f);
    const dni = soloDigitos($('#dni').value), codigo = soloDigitos(cod.value), password = $('#clave').value;
    if (dni.length < 6) return mostrarError(f, 'Ingresá tu DNI (solo números).');
    if (codigo.length !== 6) return mostrarError(f, 'El código tiene 6 números.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return mostrarError(f, 'La contraseña tiene que tener al menos 8 caracteres, con letras y números.');
    if (password !== $('#clave2').value) return mostrarError(f, 'Las contraseñas no coinciden.');
    S.dniRecordado = dni;
    try {
      const d = await conBoton($('button[type=submit]', f), () => api('/mi/activar', { method: 'POST', body: { dni, codigo, password }, publico: true }));
      guardarSesion(d);
      irA('#/inicio', { tipo: 'ok', texto: '¡Listo! Tu cuenta está activa. La próxima vez entrás con tu DNI y tu contraseña.' });
    } catch (err) { mostrarError(f, err.message); }
  };
}

function vistaOlvide() {
  barra({ titulo: 'Recuperar contraseña', volver: '#/ingresar' }); nav(null);
  pintar(`<div class="ingreso">
    <p class="bajada" style="margin-top:8px">Te mandamos un código al email que registraste en recepción. Con ese código elegís una contraseña nueva.</p>
    <form id="fOlvide" novalidate>
      <label class="campo"><span>DNI</span><input class="input" id="dni" inputmode="numeric" autocomplete="username" placeholder="Sin puntos" maxlength="12" value="${esc(S.dniRecordado)}"></label>
      <button class="btn btn-primario" type="submit"><span data-ico="mail"></span> Enviarme un código</button>
    </form>
    <div id="olvideOk"></div>
    <p class="ingreso-pie">¿Cambiaste de email? Actualizalo en recepción de la clínica.</p>
  </div>`);
  const f = $('#fOlvide');
  f.onsubmit = async (e) => {
    e.preventDefault(); limpiarError(f);
    const dni = soloDigitos($('#dni').value);
    if (dni.length < 6) return mostrarError(f, 'Ingresá tu DNI (solo números).');
    S.dniRecordado = dni;
    try {
      const d = await conBoton($('button[type=submit]', f), () => api('/mi/olvide', { method: 'POST', body: { dni }, publico: true }));
      f.classList.add('hidden');
      $('#olvideOk').innerHTML = `<div class="aviso aviso-ok">${icono('mail')}<span>${esc(d.mensaje)}</span></div>
        <a class="btn btn-primario" href="#/codigo">Ya tengo el código</a>`;
    } catch (err) { mostrarError(f, err.message); }
  };
}

// ---------------------------------------------------------------- TURNOS (datos)
const ESTADOS = {
  confirmado: { txt: 'Confirmado', ico: 'check' },
  pendiente: { txt: 'A confirmar', ico: 'clock' },
  cancelado: { txt: 'Cancelado', ico: 'x' },
  realizado: { txt: 'Realizado', ico: 'check-circle-2' }
};
function franjaDe(t) { const m = String(t.pedido || '').match(/Horario preferido: ([^.]+)\./); return m ? m[1] : ''; }
function esPedidoSinConfirmar(t) { return t.pedido_por_app && t.estado === 'pendiente'; }
function esProximo(t) {
  const d = fechaTurno(t.fecha_turno);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return d >= hoy && t.estado !== 'cancelado' && t.estado !== 'realizado';
}
function puedeCancelar(t) { return (t.estado === 'pendiente' || t.estado === 'confirmado') && fechaTurno(t.fecha_turno) > new Date(); }

function htmlTurno(t, { conAcciones = true } = {}) {
  const d = fechaTurno(t.fecha_turno);
  const e = ESTADOS[t.estado] || ESTADOS.pendiente;
  const pasado = !esProximo(t);
  const pedido = esPedidoSinConfirmar(t);
  // Pedidos viejos (antes de elegir horario) guardaban solo la preferencia mañana/tarde
  const cuando = pedido && franjaDe(t)
    ? `<div class="turno-linea">${icono('clock')} Preferencia: ${esc(franjaDe(t))}</div>`
    : `<div class="turno-linea">${icono('clock')} ${esc(fmtHora(d))} hs${pedido ? ' <span class="suave">(a confirmar)</span>' : ''}</div>`;
  const comentario = (String(t.pedido || '').match(/Comentario del paciente: (.*)$/) || [])[1];
  return `<article class="tarjeta turno ${pasado ? 'pasado' : ''}">
    <div class="turno-dia"><b>${d.getDate()}</b><span>${esc(MESES_C[d.getMonth()])}</span></div>
    <div class="turno-cuerpo">
      <div class="turno-esp">${esc(t.especialidad || 'Consulta')}</div>
      <div class="turno-linea">${esc(capital(DIAS[d.getDay()]))} ${d.getDate()} de ${esc(MESES[d.getMonth()])}${d.getFullYear() !== new Date().getFullYear() ? ' de ' + d.getFullYear() : ''}</div>
      ${cuando}
      ${t.medico ? `<div class="turno-linea">${icono('stethoscope')} ${esc(t.medico)}</div>` : ''}
      ${pedido ? `<div class="turno-nota">Pediste este turno desde la web. Recepción te lo va a confirmar por email.${comentario ? `<br><em>"${esc(comentario)}"</em>` : ''}</div>` : ''}
      <div class="turno-pie">
        <span class="chip chip-${esc(t.estado)}">${icono(e.ico)} ${esc(pedido ? 'Esperando confirmación' : e.txt)}</span>
        ${conAcciones && puedeCancelar(t) ? `<button class="btn-cancelar" data-cancelar="${esc(t.id)}">Cancelar turno</button>` : ''}
      </div>
    </div>
  </article>`;
}

function activarCancelar() {
  document.querySelectorAll('[data-cancelar]').forEach(b => {
    b.onclick = async () => {
      const t = (S.turnos || []).find(x => String(x.id) === b.dataset.cancelar);
      if (!t) return;
      const d = fechaTurno(t.fecha_turno);
      const ok = await preguntar({
        titulo: '¿Cancelar el turno?',
        texto: `${t.especialidad || 'Turno'} · ${fmtLarga(d)}${esPedidoSinConfirmar(t) ? '' : ' a las ' + fmtHora(d) + ' hs'}. Si lo cancelás, el horario queda libre para otro paciente.`,
        si: 'Sí, cancelar turno', no: 'No, mantenerlo', peligro: true
      });
      if (!ok) return;
      try {
        await conBoton(b, () => api('/mi/turnos/' + encodeURIComponent(t.id), { method: 'DELETE' }));
        await cargarTurnos(true);
        toast('Turno cancelado');
        render();
      } catch (err) { if (!err.sesion) toast(err.message); }
    };
  });
}

// ---------------------------------------------------------------- INICIO
const TIPOS_DOC = {
  laboratorio: { txt: 'Laboratorio', ico: 'flask-conical', tono: 'tono-verde' },
  adjunto: { txt: 'Estudio', ico: 'file-image', tono: 'tono-violeta' },
  epicrisis: { txt: 'Epicrisis', ico: 'file-check-2', tono: 'tono-ambar' },
  receta: { txt: 'Receta', ico: 'pill', tono: 'tono-rosa' }
};

function htmlFilaDoc(d) {
  const t = TIPOS_DOC[d.tipo] || TIPOS_DOC.adjunto;
  const f = fechaDoc(d.fecha);
  const sub = [d.tipo === 'adjunto' ? (d.categoria || 'Estudio') : t.txt, f ? fmtCorta(f) : ''].filter(Boolean).join(' · ');
  const titulo = d.tipo === 'laboratorio' ? 'Análisis de laboratorio'
    : d.tipo === 'epicrisis' ? (d.datos && d.datos.dx_egreso ? 'Epicrisis: ' + d.datos.dx_egreso : 'Epicrisis')
    : d.tipo === 'receta' ? (d.datos && d.datos.medico ? 'Receta de ' + d.datos.medico : 'Receta')
    : d.titulo;
  return `<a class="fila" href="#/doc/${encodeURIComponent(d.id)}">
    <span class="ic-caja ${t.tono}">${icono(t.ico)}</span>
    <span class="fila-txt"><span class="fila-tit" style="display:block">${esc(titulo)}</span><span class="fila-sub">${esc(sub)}</span></span>
    ${icono('chevron-right')}
  </a>`;
}

async function vistaInicio() {
  barra(); nav('inicio');
  cargando();
  try {
    const [perfil, turnos, docs] = await Promise.all([cargarPerfil(), cargarTurnos(), cargarDocs()]);
    const proximos = turnos.filter(esProximo).sort((a, b) => fechaTurno(a.fecha_turno) - fechaTurno(b.fecha_turno));
    const confirmado = proximos.find(t => t.estado === 'confirmado');
    const pedidos = proximos.filter(esPedidoSinConfirmar).length;
    const hora = new Date().getHours();
    const saludo = hora < 12 ? 'Buen día' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';

    let tarjetaTurno;
    if (confirmado) {
      const d = fechaTurno(confirmado.fecha_turno);
      tarjetaTurno = `<a class="tarjeta proximo" href="#/turnos" style="display:block;text-decoration:none">
        <div class="proximo-etq">Tu próximo turno</div>
        <div class="proximo-fecha">${esc(fmtLarga(d))}</div>
        <div class="proximo-hora">${icono('clock')} ${esc(fmtHora(d))} hs</div>
        <div class="proximo-det">${esc(confirmado.especialidad || 'Consulta')}${confirmado.medico ? ' · ' + esc(confirmado.medico) : ''}</div>
        <span class="chip">${icono('check')} Confirmado</span>
      </a>`;
    } else {
      tarjetaTurno = `<div class="tarjeta tarjeta-pad vacio-turno">
        <span class="ic-caja">${icono('calendar')}</span>
        <div class="fila-txt"><div class="fila-tit">No tenés turnos confirmados</div><div class="fila-sub">${pedidos ? `Tenés ${pedidos} pedido${pedidos > 1 ? 's' : ''} esperando confirmación.` : 'Pedí uno desde acá y te lo confirmamos por email.'}</div></div>
      </div>`;
    }

    const recientes = docs.slice(0, 3);
    pintar(`
      ${htmlAviso()}
      <div class="saludo"><h2>${esc(saludo)}, ${esc(capital(perfil.nombre).split(' ')[0])}</h2><p>¿Qué necesitás hoy?</p></div>
      ${tarjetaTurno}
      <div class="seccion">Accesos rápidos</div>
      <div class="accesos">
        <a class="tarjeta acceso" href="#/pedir"><span class="ic-caja tono-azul">${icono('calendar-plus')}</span>Pedir turno</a>
        <a class="tarjeta acceso" href="#/turnos"><span class="ic-caja tono-rosa">${icono('calendar-check')}</span>Mis turnos</a>
        <a class="tarjeta acceso" href="#/estudios" data-filtro="laboratorio"><span class="ic-caja tono-verde">${icono('flask-conical')}</span>Laboratorios</a>
        <a class="tarjeta acceso" href="#/estudios" data-filtro="adjunto"><span class="ic-caja tono-violeta">${icono('scan')}</span>Estudios e imágenes</a>
      </div>
      <div class="seccion">Últimos resultados ${docs.length ? '<a href="#/estudios">Ver todos</a>' : ''}</div>
      ${recientes.length ? `<div class="tarjeta lista">${recientes.map(htmlFilaDoc).join('')}</div>`
        : `<div class="tarjeta tarjeta-pad" style="color:var(--muted);font-size:15px">Todavía no hay estudios cargados. Cuando la clínica cargue un laboratorio, una imagen o una epicrisis, lo vas a ver acá.</div>`}
      <div class="seccion">¿Necesitás ayuda?</div>
      <a class="tarjeta fila" href="https://wa.me/${WHATSAPP_CLINICA}" target="_blank" rel="noopener">
        <span class="ic-caja tono-verde">${icono('smartphone')}</span>
        <span class="fila-txt"><span class="fila-tit" style="display:block">Escribirle a la clínica</span><span class="fila-sub">WhatsApp de turnos</span></span>
        ${icono('external-link')}
      </a>`);
    document.querySelectorAll('[data-filtro]').forEach(a => a.addEventListener('click', () => { S.filtroDocs = a.dataset.filtro; }));
  } catch (err) { errorPantalla(err); }
}

// ---------------------------------------------------------------- TURNOS
async function vistaTurnos() {
  barra({ titulo: 'Mis turnos' }); nav('turnos');
  cargando();
  try {
    const turnos = await cargarTurnos(true);
    const proximos = turnos.filter(esProximo).sort((a, b) => fechaTurno(a.fecha_turno) - fechaTurno(b.fecha_turno));
    const anteriores = turnos.filter(t => !esProximo(t)).sort((a, b) => fechaTurno(b.fecha_turno) - fechaTurno(a.fecha_turno));
    pintar(`
      ${htmlAviso()}
      <div class="seccion" style="margin-top:8px">Próximos</div>
      ${proximos.length ? proximos.map(t => htmlTurno(t)).join('')
        : `<div class="tarjeta tarjeta-pad" style="text-align:center;color:var(--muted)"><p style="margin:4px 0 14px">No tenés turnos próximos.</p><a class="btn btn-primario" href="#/pedir">${icono('calendar-plus')} Pedir un turno</a></div>`}
      ${anteriores.length ? `<details class="pasados"><summary class="seccion">Anteriores (${anteriores.length}) ${icono('chevron-right')}</summary>
        ${anteriores.slice(0, 30).map(t => htmlTurno(t, { conAcciones: false })).join('')}</details>` : ''}
      ${proximos.length ? `<a class="btn btn-primario flotante" href="#/pedir">${icono('plus')} Pedir turno</a>` : ''}
    `);
    activarCancelar();
  } catch (err) { errorPantalla(err); }
}

const NOMBRES_DIAS = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
function listaDias(dias) {
  const n = [1, 2, 3, 4, 5, 6, 0].filter(d => dias.includes(d)).map(d => NOMBRES_DIAS[d]);
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} y ${n[n.length - 1]}` : n[0] || '';
}

async function vistaPedir() {
  barra({ titulo: 'Pedir turno', volver: '#/turnos' }); nav('turnos');
  cargando();
  try {
    const op = await cargarOpciones();
    pintar(`
      <p class="bajada" style="margin-top:8px">Elegí la especialidad, el día y un horario libre. Recepción te confirma el turno por email.</p>
      <form id="fPedir" novalidate>
        <label class="campo"><span>Especialidad</span>
          <select class="input" id="esp"><option value="">Elegí una especialidad</option>${op.especialidades.map(e => `<option>${esc(e)}</option>`).join('')}</select></label>
        <label class="campo"><span>Médico (opcional)</span>
          <select class="input" id="med"><option value="">Cualquier médico disponible</option>${op.medicos.map(m => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('')}</select>
          <small class="ayuda" id="medDias"></small></label>
        <label class="campo"><span>¿Qué día?</span>
          <input class="input" type="date" id="fecha" min="${esc(op.desde)}" max="${esc(op.hasta)}" value="${esc(op.desde)}"></label>
        <div class="campo"><span>Horarios libres</span>
          <div class="horas" id="horas" aria-live="polite"><p class="horas-msg">Elegí la especialidad para ver los horarios.</p></div></div>
        <label class="campo"><span>Comentario (opcional)</span>
          <textarea class="input" id="coment" maxlength="300" placeholder="Ej: control anual, traigo estudios, primera consulta…"></textarea></label>
        <button class="btn btn-primario" type="submit">${icono('calendar-plus')} Pedir este turno</button>
      </form>`);

    let hora = '';
    let pedidoN = 0;
    const cajaHoras = $('#horas');
    const cargarHoras = async () => {
      hora = '';
      const especialidad = $('#esp').value, medico_id = $('#med').value, fecha = $('#fecha').value;
      const medico = op.medicos.find(m => String(m.id) === String(medico_id));
      $('#medDias').textContent = medico && medico.dias && medico.dias.length ? `Atiende los ${listaDias(medico.dias)}.` : '';
      if (!especialidad) { cajaHoras.innerHTML = '<p class="horas-msg">Elegí la especialidad para ver los horarios.</p>'; return; }
      if (!fecha) { cajaHoras.innerHTML = '<p class="horas-msg">Elegí el día.</p>'; return; }
      const n = ++pedidoN;
      cajaHoras.innerHTML = '<p class="horas-msg">Buscando horarios…</p>';
      try {
        const q = new URLSearchParams({ especialidad, fecha });
        if (medico_id) q.set('medico_id', medico_id);
        const d = await api(`/mi/horarios?${q}`);
        if (n !== pedidoN) return;
        if (!d.horarios.length) {
          cajaHoras.innerHTML = `<p class="horas-msg aviso">${icono('calendar-x')} ${esc(d.motivo || 'No quedan horarios libres ese día. Probá con otra fecha.')}</p>`;
          return;
        }
        const grupo = (titulo, lista) => lista.length ? `<div class="horas-grupo"><span>${titulo}</span><div class="horas-chips">${lista.map(h => `<button type="button" class="hora" data-h="${esc(h)}">${esc(h)}</button>`).join('')}</div></div>` : '';
        const mins = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
        cajaHoras.innerHTML = grupo('Mañana', d.horarios.filter(h => mins(h) < 780)) + grupo('Tarde', d.horarios.filter(h => mins(h) >= 780));
        cajaHoras.querySelectorAll('.hora').forEach(b => b.onclick = () => {
          hora = b.dataset.h;
          cajaHoras.querySelectorAll('.hora').forEach(x => { x.classList.toggle('activo', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        });
      } catch (err) {
        if (n === pedidoN && !err.sesion) cajaHoras.innerHTML = `<p class="horas-msg aviso">${esc(err.message)}</p>`;
      }
    };
    ['#esp', '#med', '#fecha'].forEach(sel => $(sel).addEventListener('change', cargarHoras));

    const f = $('#fPedir');
    f.onsubmit = async (e) => {
      e.preventDefault(); limpiarError(f);
      const body = { especialidad: $('#esp').value, medico_id: $('#med').value || null, fecha: $('#fecha').value, hora, comentario: $('#coment').value.trim() };
      if (!body.especialidad) return mostrarError(f, 'Elegí una especialidad.');
      if (!body.fecha) return mostrarError(f, 'Elegí el día.');
      if (!body.hora) return mostrarError(f, 'Elegí un horario de la lista.');
      try {
        await conBoton($('button[type=submit]', f), () => api('/mi/turnos', { method: 'POST', body }));
        await cargarTurnos(true);
        irA('#/turnos', { tipo: 'ok', texto: `¡Pedido enviado para las ${body.hora} hs! Recepción te lo va a confirmar por email.` });
      } catch (err) {
        if (err.sesion) return;
        mostrarError(f, err.message);
        if (/disponible/.test(err.message)) cargarHoras();     // alguien lo tomó recién: se actualiza la lista
      }
    };
  } catch (err) { errorPantalla(err); }
}

// ---------------------------------------------------------------- ESTUDIOS
async function vistaEstudios() {
  barra({ titulo: 'Mis estudios' }); nav('estudios');
  cargando();
  try {
    const docs = await cargarDocs(true);
    const filtros = [['todos', 'Todos'], ['laboratorio', 'Laboratorios'], ['adjunto', 'Estudios e imágenes'], ['receta', 'Recetas'], ['epicrisis', 'Epicrisis']];
    const dibujar = () => {
      const lista = docs.filter(d => S.filtroDocs === 'todos' || d.tipo === S.filtroDocs);
      const grupos = [];
      lista.forEach(d => {
        const f = fechaDoc(d.fecha);
        const clave = f ? `${MESES[f.getMonth()]} ${f.getFullYear()}` : 'Sin fecha';
        let g = grupos.find(x => x.clave === clave);
        if (!g) { g = { clave, docs: [] }; grupos.push(g); }
        g.docs.push(d);
      });
      pintar(`
        <div class="filtros" role="tablist">${filtros.map(([k, v]) => `<button role="tab" data-f="${k}" class="${S.filtroDocs === k ? 'activo' : ''}">${esc(v)}</button>`).join('')}</div>
        ${grupos.length ? grupos.map(g => `<div class="grupo-mes">${esc(g.clave)}</div><div class="tarjeta lista">${g.docs.map(htmlFilaDoc).join('')}</div>`).join('')
          : `<div class="tarjeta tarjeta-pad" style="text-align:center;color:var(--muted);margin-top:8px">
              <span class="ic-caja tono-azul" style="margin:6px auto 12px">${icono('file-text')}</span>
              ${docs.length ? 'No hay documentos de este tipo.' : 'Todavía no hay estudios cargados. Cuando la clínica cargue un laboratorio, una imagen o una epicrisis, lo vas a ver acá.'}</div>`}
        <p class="nota-legal">Acá ves tus laboratorios, estudios, imágenes, recetas y epicrisis. Si necesitás una copia completa de tu historia clínica, pedila en recepción.</p>`);
      document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.filtroDocs = b.dataset.f; dibujar(); });
    };
    dibujar();
  } catch (err) { errorPantalla(err); }
}

async function vistaDoc(id) {
  window.onresize = null;
  barra({ titulo: 'Documento', volver: true }); nav('estudios');
  cargando();
  try {
    const [docs] = await Promise.all([cargarDocs(), cargarPerfil().catch(() => null)]);
    const d = docs.find(x => String(x.id) === String(id));
    if (!d) { pintar(`<div class="aviso aviso-neutro" style="margin-top:16px">${icono('info')}<span>No encontramos este documento.</span></div><a class="btn btn-borde" href="#/estudios">Ver mis estudios</a>`); return; }
    const t = TIPOS_DOC[d.tipo] || TIPOS_DOC.adjunto;
    const f = fechaDoc(d.fecha);
    const nombre = S.perfil ? `${capital(S.perfil.apellido)}, ${capital(S.perfil.nombre)}` : '';
    const imprimir = `<button class="btn btn-borde no-imprimir" id="btnImprimir" style="margin-top:18px">${icono('download')} Guardar como PDF o imprimir</button>`;
    const cabImpresion = `<div class="solo-impresion" style="margin-bottom:12px"><b>Clínica Passo S.A.</b> — ${esc(nombre)}${S.perfil ? ' · DNI ' + esc(fmtDni(S.perfil.dni)) : ''}</div>`;

    const pacHoja = { nombre_completo: nombre, dni: S.perfil ? S.perfil.dni : '' };
    const conHoja = (cab, hojaHtml, nota) => {
      pintar(`${cab}
        <div class="hoja-marco" id="hojaMarco"><div class="hoja-escala">${hojaHtml}</div></div>
        <p class="nota-legal no-imprimir">${nota} En el celular podés ampliar la hoja con dos dedos.</p>
        ${imprimir}`);
      const marco = $('#hojaMarco');
      window.ajustarHoja(marco);
      const img = marco.querySelector('img');
      if (img && !img.complete) img.addEventListener('load', () => window.ajustarHoja(marco), { once: true });
      window.onresize = () => window.ajustarHoja(document.getElementById('hojaMarco'));
    };

    if (d.tipo === 'laboratorio') {
      barra({ titulo: 'Laboratorio', volver: true });
      conHoja(`<div class="doc-cab no-imprimir"><span class="chip ${t.tono}">${icono(t.ico)} Laboratorio</span><h2>Análisis de laboratorio</h2><p>Cargado el ${esc(fmtCorta(f))}</p></div>`,
        window.hojaLaboratorioHTML(d.planilla, nombre),
        'Los resultados los interpreta tu médico. Ante cualquier duda, consultalo en tu próximo turno.');
    } else if (d.tipo === 'epicrisis') {
      barra({ titulo: 'Epicrisis', volver: true });
      const x = d.datos || {};
      const fi = fechaDoc(x.fecha_ingreso), fe = fechaDoc(x.fecha_egreso);
      conHoja(`<div class="doc-cab no-imprimir"><span class="chip ${t.tono}">${icono(t.ico)} Epicrisis</span><h2>Resumen de tu internación</h2><p>${fi && fe ? `Del ${esc(fmtCorta(fi))} al ${esc(fmtCorta(fe))}` : esc(fmtCorta(f))}</p></div>`,
        window.hojaEpicrisisHTML(x, pacHoja),
        'Es el resumen que escribió tu médico al darte el alta.');
    } else if (d.tipo === 'receta') {
      barra({ titulo: 'Receta', volver: true });
      const x = d.datos || {};
      const mats = [x.mn ? 'M.N. ' + x.mn : '', x.mp ? 'M.P. ' + x.mp : ''].filter(Boolean).join(' - ');
      const os = [x.obra_social, x.nro_afiliado ? 'N° ' + x.nro_afiliado : ''].filter(Boolean).join(' · ');
      pintar(`
        <div class="doc-cab no-imprimir"><span class="chip ${t.tono}">${icono(t.ico)} Receta</span><h2>${esc(x.medico ? 'Receta de ' + x.medico : 'Receta')}</h2><p>${esc(fmtCorta(f))}</p></div>
        <article class="tarjeta receta">
          <header class="receta-cab">
            <div class="receta-clinica">Clínica Passo S.A.</div>
            <div class="receta-dir">EVA PERÓN 3097</div>
            ${x.medico || mats ? `<div class="receta-medico">${esc([x.medico, mats].filter(Boolean).join(' · '))}</div>` : ''}
          </header>
          <div class="receta-datos">
            <div><span>Paciente</span><b>${esc(nombre)}</b></div>
            ${os ? `<div><span>Obra social</span><b>${esc(os)}</b></div>` : ''}
            <div><span>Fecha</span><b>${esc(fmtCorta(f))}</b></div>
          </div>
          <div class="receta-rp">Rp.</div>
          <div class="receta-texto">${esc(x.rp || '').replace(/\n/g, '<br>')}</div>
          ${x.diagnostico ? `<div class="receta-dx"><span>Diagnóstico</span>${esc(x.diagnostico)}</div>` : ''}
        </article>
        <p class="nota-legal">Esta es una copia de tu receta para que la tengas a mano. Para comprar medicamentos en la farmacia usá la receta firmada que te entregó el médico.</p>
        ${imprimir}`);
    } else {
      barra({ titulo: d.categoria || 'Estudio', volver: true });
      const archivos = d.archivos || [];
      pintar(`
        <div class="doc-cab"><span class="chip ${t.tono}">${icono(t.ico)} ${esc(d.categoria || 'Estudio')}</span><h2>${esc(d.titulo)}</h2><p>${esc(fmtCorta(f))}</p></div>
        ${archivos.length ? `<div class="galeria" id="galeria">${archivos.map((a, i) => a.esLink
            ? `<a class="miniatura miniatura-pdf" href="${esc(urlSegura(a.path))}" target="_blank" rel="noopener">${icono('external-link')}<span>${esc(a.nombre || 'Abrir enlace')}</span></a>`
            : a.esPdf
              ? `<a class="miniatura miniatura-pdf" data-i="${i}" href="#" target="_blank" rel="noopener">${icono('file-text')}<span>${esc(a.nombre || 'Documento PDF')}</span></a>`
              : `<button class="miniatura" data-i="${i}" aria-label="Ver imagen ${i + 1}"><span class="spinner"></span></button>`).join('')}</div>`
          : `<div class="tarjeta tarjeta-pad" style="color:var(--muted)">Este estudio no tiene archivos adjuntos.</div>`}
        <p class="nota-legal">Tocá una imagen para verla en grande. Los enlaces son temporales y privados: se generan cada vez que abrís el estudio.</p>`);
      const propios = archivos.filter(a => !a.esLink);
      if (propios.length) {
        const urls = await firmar(propios.map(a => a.path));
        archivos.forEach((a, i) => {
          const el = document.querySelector(`#galeria [data-i="${i}"]`);
          if (!el) return;
          const u = urls[a.path];
          if (!u) { el.innerHTML = `${icono('circle-alert')}<span style="font-size:12px">No disponible</span>`; return; }
          if (a.esPdf) { el.href = u; return; }
          el.innerHTML = `<img src="${esc(u)}" alt="${esc(a.nombre || 'Imagen')}" loading="lazy">`;
          el.onclick = () => abrirVisor(u, a.nombre);
        });
      }
    }
    const bi = $('#btnImprimir');
    if (bi) bi.onclick = () => window.print();
  } catch (err) { errorPantalla(err); }
}

function abrirVisor(url, nombre) {
  const v = document.createElement('div');
  v.className = 'visor';
  v.innerHTML = `<div class="visor-barra"><button type="button" id="visorCerrar">${icono('x')} Cerrar</button>
    <a href="${esc(url)}" target="_blank" rel="noopener">${icono('external-link')} Abrir original</a></div>
    <div class="visor-img"><img src="${esc(url)}" alt="${esc(nombre || 'Imagen')}"></div>`;
  document.body.appendChild(v);
  const cerrar = () => { v.remove(); window.removeEventListener('popstate', cerrar); };
  $('#visorCerrar', v).onclick = cerrar;
  window.addEventListener('popstate', cerrar);
}

// ---------------------------------------------------------------- MI CUENTA
async function vistaPerfil() {
  barra({ titulo: 'Mi cuenta' }); nav('perfil');
  cargando();
  try {
    const p = await cargarPerfil(true);
    const fn = fechaDoc(p.fecha_nac);
    const dato = (k, v) => v ? `<div class="dato"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '';
    pintar(`
      ${htmlAviso()}
      <div class="seccion" style="margin-top:8px">Mis datos</div>
      <div class="tarjeta datos">
        ${dato('Nombre', `${capital(p.nombre)} ${capital(p.apellido)}`)}
        ${dato('DNI', fmtDni(p.dni))}
        ${dato('Nacimiento', fn ? fmtCorta(fn) : '')}
        ${dato('Obra social', p.obra_social)}
        ${dato('N° de afiliado', p.nro_afiliado)}
        ${dato('Teléfono', p.telefono)}
        ${dato('Email', p.email)}
      </div>
      <p class="nota-legal">¿Algún dato está mal o cambiaste de email? Avisá en recepción y lo corregimos.</p>

      <div class="seccion">Seguridad</div>
      <form class="tarjeta tarjeta-pad" id="fClave" novalidate>
        ${campoClave('actual', 'Contraseña actual', 'current-password')}
        ${campoClave('nueva', 'Contraseña nueva', 'new-password', 'Mínimo 8 caracteres, con letras y números.')}
        <button class="btn btn-secundario" type="submit">${icono('lock')} Cambiar contraseña</button>
      </form>
      <div class="botones">
        <button class="btn btn-borde" id="btnSalir">${icono('log-out')} Cerrar sesión</button>
        <button class="btn btn-texto" id="btnSalirTodos">Cerrar sesión en todos mis dispositivos</button>
      </div>

      <div class="seccion">Privacidad</div>
      <div class="tarjeta tarjeta-pad" style="font-size:14.5px;color:var(--text);line-height:1.55">
        <p style="margin:0 0 10px">Tus datos de salud son confidenciales (Ley 26.529 de Derechos del Paciente y Ley 25.326 de Protección de Datos Personales). Solo vos podés verlos en este portal, y cada ingreso queda registrado.</p>
        <p style="margin:0">Podés eliminar tu cuenta del portal cuando quieras. Tu historia clínica no se borra: la clínica tiene la obligación legal de conservarla.</p>
      </div>
      <div class="botones"><button class="btn btn-peligro" id="btnEliminar">${icono('trash-2')} Eliminar mi cuenta del portal</button></div>
    `);
    activarOjos();
    const f = $('#fClave');
    f.onsubmit = async (e) => {
      e.preventDefault(); limpiarError(f);
      const actual = $('#actual').value, nueva = $('#nueva').value;
      if (!actual) return mostrarError(f, 'Ingresá tu contraseña actual.');
      if (nueva.length < 8 || !/[A-Za-z]/.test(nueva) || !/\d/.test(nueva)) return mostrarError(f, 'La contraseña nueva tiene que tener al menos 8 caracteres, con letras y números.');
      try {
        const d = await conBoton($('button[type=submit]', f), () => api('/mi/password', { method: 'POST', body: { actual, nueva } }));
        guardarSesion(d);
        f.reset();
        toast('Contraseña cambiada. Se cerró la sesión en tus otros dispositivos.');
      } catch (err) { if (!err.sesion) mostrarError(f, err.message); }
    };
    $('#btnSalir').onclick = async () => {
      if (!(await preguntar({ titulo: '¿Cerrar sesión?', texto: 'Para volver a entrar vas a necesitar tu DNI y tu contraseña.', si: 'Cerrar sesión' }))) return;
      borrarSesion(); irA('#/ingresar', 'Cerraste la sesión.');
    };
    $('#btnSalirTodos').onclick = async () => {
      if (!(await preguntar({ titulo: '¿Cerrar todas las sesiones?', texto: 'Se cierra la sesión en todos los celulares y computadoras donde hayas entrado, incluido este.', si: 'Cerrar todas' }))) return;
      try { await api('/mi/salir-todos', { method: 'POST' }); } catch (e) { if (e.sesion) return; }
      borrarSesion(); irA('#/ingresar', 'Cerraste la sesión en todos tus dispositivos.');
    };
    $('#btnEliminar').onclick = async () => {
      const clave = await preguntar({
        titulo: '¿Eliminar tu cuenta del portal?',
        texto: 'Se borra tu acceso al portal. Tu historia clínica queda guardada en la clínica. Si más adelante querés volver a usarlo, pedí un código nuevo en recepción.',
        si: 'Eliminar mi cuenta', no: 'Cancelar', peligro: true, conClave: true
      });
      if (!clave) return;
      try {
        await api('/mi/cuenta', { method: 'DELETE', body: { password: clave } });
        borrarSesion(); irA('#/ingresar', { tipo: 'ok', texto: 'Tu cuenta del portal fue eliminada.' });
      } catch (err) { if (!err.sesion) toast(err.message); }
    };
  } catch (err) { errorPantalla(err); }
}

// ---------------------------------------------------------------- router
const PUBLICAS = { ingresar: vistaIngresar, codigo: vistaCodigo, olvide: vistaOlvide };
const PRIVADAS = { inicio: vistaInicio, turnos: vistaTurnos, pedir: vistaPedir, estudios: vistaEstudios, doc: vistaDoc, perfil: vistaPerfil };

function render() {
  const [, ruta = '', param] = (location.hash || '').split('/');
  if (!S.sesion) S.sesion = leerSesion();
  if (PUBLICAS[ruta]) {
    if (S.sesion && ruta === 'ingresar') { location.replace('#/inicio'); return; }
    return PUBLICAS[ruta]();
  }
  if (!S.sesion) { location.replace('#/ingresar'); return; }
  const vista = PRIVADAS[ruta];
  if (!vista) { location.replace('#/inicio'); return; }
  vista(param ? decodeURIComponent(param) : undefined);
}

window.addEventListener('hashchange', render);
window.addEventListener('scroll', () => $('#barra').classList.toggle('con-borde', window.scrollY > 4), { passive: true });
pintarIconos($('#nav'));
render();

// Instalable (Android/Chrome y "Agregar a inicio" en iPhone). Nunca guarda datos médicos.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
