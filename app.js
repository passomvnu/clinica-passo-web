
/**
 * LÓGICA DEL PANEL DE GESTIÓN — CLÍNICA PASSO S.A.
 * Conectado a la API de Render & Supabase
 * Sistema de Seguridad & Control de Acceso Presencial
 */

// URL de la API en producción (Render)
const API_BASE = 'https://clinica-passo-backend.onrender.com/api';

// ========================================================
// AUTENTICACIÓN: las contraseñas se validan en el servidor.
// El panel solo guarda un "pase" firmado que vence a las 12 h.
// ========================================================
const SESION_KEY = 'passo_auth_session';

// Estado global de la aplicación
const state = {
  currentTab: 'calendario-tab',
  viewingAllTurnos: false,
  userRole: 'recepcion', // 'recepcion' o 'medico'
  isAuthenticated: false,
  token: null,
  user: null,
  intentosFallidos: 0,
  bloqueadoHasta: null,
  turnosList: [],
  pacientesList: [],
  selectedPacienteHistoria: null,
  historiasList: []
};

// Helper universal para pedidos a la API: agrega el pase de sesión
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const headers = {};
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });

  // Pase vencido, revocado o usuario desactivado: volver a la pantalla de acceso
  if (res.status === 401 && state.isAuthenticated && !endpoint.startsWith('/auth/')) {
    res.clone().json().then(d => sesionVencida(d && d.error)).catch(() => sesionVencida());
  }
  // Tiene que elegir su contraseña antes de seguir
  if (res.status === 403 && state.isAuthenticated) {
    res.clone().json().then(d => { if (d && d.debeCambiarPassword) abrirClaveObligatoria(); }).catch(() => {});
  }
  return res;
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();
  
  actualizarFechaActual();
  verificarConexionApi();
  verificarSesionExistente();
});

// ========================================================
// 0. AUTENTICACIÓN & PANTALLA DE BLOQUEO
// ========================================================
// ========================================================
// SESIÓN Y PERMISOS DEL USUARIO LOGUEADO
// Cada persona entra con su usuario. El servidor manda sus permisos
// (ver backend/permisos.js) y el panel muestra solo lo que corresponde.
// ========================================================
function tienePermiso(p) { return !!(state.user && (state.user.permisos || []).includes(p)); }
function puedeVerDoc(tipo) { return !!(state.user && (state.user.docsVer || []).includes(tipo)); }
function puedeEscribirDoc(tipo) { return !!(state.user && (state.user.docsEscribir || []).includes(tipo)); }

// Copia de la matriz del servidor: solo se usa para la vista previa al crear
// usuarios y para perfiles locales de prueba. La que manda es la del servidor.
const MATRIZ_PERFILES = {
  'ADM':             { etiqueta: 'Administración', permisos: ['calendario', 'pacientes.ver', 'pacientes.editar', 'sala_espera.ver', 'internacion.ver', 'internacion.editar', 'hc.acceso', 'archivos.ver', 'archivos.subir', 'admin'], docsVer: ['hc', 'consultorio', 'indicaciones', 'laboratorio', 'foja', 'epicrisis', 'adjunto', 'enfermeria'], docsEscribir: ['hc', 'consultorio', 'indicaciones', 'foja', 'epicrisis', 'adjunto'] },
  'REC':             { etiqueta: 'Recepción', permisos: ['calendario', 'pacientes.ver', 'pacientes.editar', 'sala_espera.ver', 'internacion.ver', 'internacion.editar'], docsVer: [], docsEscribir: [] },
  'MED:CONSULTORIO': { etiqueta: 'Médico Consultorio', soloSusTurnos: true, permisos: ['calendario', 'pacientes.ver', 'pacientes.editar', 'sala_espera.ver', 'internacion.ver', 'internacion.editar', 'hc.acceso', 'archivos.ver', 'archivos.subir'], docsVer: ['hc', 'consultorio', 'indicaciones', 'laboratorio', 'foja', 'epicrisis', 'adjunto', 'enfermeria'], docsEscribir: ['hc', 'consultorio', 'indicaciones', 'foja', 'epicrisis', 'adjunto'] },
  'MED:UTI':         { etiqueta: 'Médico UTI', permisos: ['pacientes.ver', 'pacientes.editar', 'internacion.ver', 'internacion.editar', 'hc.acceso', 'archivos.ver', 'archivos.subir'], docsVer: ['hc', 'consultorio', 'indicaciones', 'laboratorio', 'foja', 'epicrisis', 'adjunto', 'enfermeria'], docsEscribir: ['hc', 'consultorio', 'indicaciones', 'foja', 'epicrisis', 'adjunto'] },
  'MED:PISOS':       { etiqueta: 'Médico Pisos', permisos: ['pacientes.ver', 'pacientes.editar', 'internacion.ver', 'internacion.editar', 'hc.acceso', 'archivos.ver', 'archivos.subir'], docsVer: ['hc', 'consultorio', 'indicaciones', 'laboratorio', 'foja', 'epicrisis', 'adjunto', 'enfermeria'], docsEscribir: ['hc', 'consultorio', 'indicaciones', 'foja', 'epicrisis', 'adjunto'] },
  'MED:GUARDIA':     { etiqueta: 'Médico Guardia', soloSusTurnos: true, alcancePacientes: 'internados_y_sala', permisos: ['pacientes.ver', 'sala_espera.ver', 'internacion.ver', 'hc.acceso', 'archivos.ver'], docsVer: ['hc', 'consultorio', 'indicaciones', 'laboratorio', 'foja', 'epicrisis', 'adjunto', 'enfermeria'], docsEscribir: ['hc', 'indicaciones', 'epicrisis'] },
  'ENF':             { etiqueta: 'Enfermería', permisos: ['pacientes.ver', 'internacion.ver', 'internacion.editar', 'hc.acceso'], docsVer: ['enfermeria', 'indicaciones'], docsEscribir: ['enfermeria'] },
  'LAB':             { etiqueta: 'Laboratorio', permisos: ['pacientes.ver', 'internacion.ver', 'hc.acceso', 'archivos.ver', 'archivos.subir'], docsVer: ['laboratorio', 'adjunto'], docsEscribir: ['laboratorio', 'adjunto'] },
  'RAY':             { etiqueta: 'Rayos', permisos: ['internacion.ver', 'hc.acceso', 'archivos.ver', 'archivos.subir', 'rayos'], docsVer: ['adjunto'], docsEscribir: ['adjunto'], soloInternados: true }
};
const DESCRIPCION_PERMISOS_UI = {
  'calendario': 'Calendario y agenda de turnos', 'pacientes.ver': 'Ver datos de pacientes', 'pacientes.editar': 'Registrar y editar pacientes',
  'sala_espera.ver': 'Ver la sala de espera (pestaña Turnos)', 'internacion.ver': 'Ver la planilla de internación', 'internacion.editar': 'Asignar y liberar camas',
  'hc.acceso': 'Acceso a historias clínicas', 'archivos.ver': 'Ver estudios y archivos adjuntos', 'archivos.subir': 'Subir estudios y archivos',
  'rayos': 'Ver el control de placas de los internados', 'admin': 'Administrar usuarios y ver la auditoría'
};
const NOMBRE_TIPO_DOC = { hc: 'Historia Clínica', consultorio: 'Evolución', indicaciones: 'Indicaciones Médicas', laboratorio: 'Laboratorio', foja: 'Foja Quirúrgica', epicrisis: 'Epicrisis', adjunto: 'Adjuntos', enfermeria: 'Evolución de Enfermería' };
const ETIQUETA_ROL = { medico: 'Médico', recepcion: 'Recepción', enfermeria: 'Enfermería', laboratorio: 'Laboratorio', admin: 'Administración' };

function perfilClave(rol, servicio) { return rol === 'MED' ? `MED:${servicio || ''}` : rol; }

// Perfil local (compatibilidad: iniciarSesionExitosa('medico') en pruebas)
function usuarioDesdeRol(rol) {
  const clave = { medico: 'MED:CONSULTORIO', recepcion: 'REC', enfermeria: 'ENF', laboratorio: 'LAB', admin: 'ADM', rayos: 'RAY' }[rol] || 'REC';
  const [r, s] = clave.split(':');
  const m = MATRIZ_PERFILES[clave];
  return { id: null, numero: null, usuario: rol, nombre: m.etiqueta, rol: r, servicio: s || null, etiqueta: m.etiqueta,
    soloInternados: !!m.soloInternados, soloSusTurnos: !!m.soloSusTurnos, alcancePacientes: m.alcancePacientes || 'todos', permisos: m.permisos, docsVer: m.docsVer, docsEscribir: m.docsEscribir, permisosDescripcion: m.permisos.map(p => DESCRIPCION_PERMISOS_UI[p]) };
}

function guardarSesion(token, exp) {
  sessionStorage.setItem(SESION_KEY, JSON.stringify({ token, exp }));
}

async function verificarSesionExistente() {
  let data = null;
  try { data = JSON.parse(sessionStorage.getItem(SESION_KEY) || 'null'); } catch (e) {}
  if (data && data.token && data.exp > Date.now()) {
    state.token = data.token;
    try {
      const res = await apiFetch('/auth/sesion');
      if (res.ok) {
        const d = await res.json();
        iniciarSesionExitosa(d.usuario, false);
        return;
      }
    } catch (e) { /* sin conexión: se vuelve a pedir el ingreso */ }
  }
  borrarDatosLocales();
  state.token = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminLayout').classList.add('hidden');
  mostrarAvisoLogin();
}

// Mensaje que dejó la sesión anterior al salir (bloqueo, vencimiento, inactividad)
function mostrarAvisoLogin() {
  let aviso = null;
  try { aviso = JSON.parse(sessionStorage.getItem(AVISO_LOGIN_KEY) || 'null'); sessionStorage.removeItem(AVISO_LOGIN_KEY); } catch (e) {}
  if (!aviso || !aviso.texto) return;
  if (aviso.tipo === 'ok') { showToast(aviso.texto); return; }
  const errorBox = document.getElementById('loginErrorMsg');
  const errorText = document.getElementById('loginErrorText');
  if (errorBox && errorText) { errorText.textContent = aviso.texto; errorBox.classList.remove('hidden'); }
}

// ---------- Bloqueo automático por inactividad ----------
// Las computadoras de la clínica son compartidas: si nadie la usa durante este tiempo,
// la sesión se cierra sola (hay que volver a poner usuario y contraseña).
const INACTIVIDAD_MAX_MIN = 30;
let ultimaActividad = Date.now();
['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel'].forEach(ev =>
  document.addEventListener(ev, () => { ultimaActividad = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  if (state.isAuthenticated && Date.now() - ultimaActividad > INACTIVIDAD_MAX_MIN * 60000) {
    volverAPantallaDeAcceso({ tipo: 'error', texto: `La sesión se cerró por inactividad (${INACTIVIDAD_MAX_MIN} minutos). Volvé a ingresar.` });
  }
}, 60000);

function cambiarPlaceholderPassword() { /* ya no hay selector de perfil: se ingresa con usuario */ }

function toggleVisibilidadClave() {
  const input = document.getElementById('loginPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    if (eyeIcon) eyeIcon.setAttribute('data-lucide', 'eye');
  }
  if (window.lucide) window.lucide.createIcons();
}

async function ejecutarAutenticacion(e) {
  e.preventDefault();
  const errorBox = document.getElementById('loginErrorMsg');
  const errorText = document.getElementById('loginErrorText');
  const lockoutBox = document.getElementById('lockoutTimerMsg');
  const lockoutText = document.getElementById('lockoutTimerText');
  const btn = document.getElementById('btnLoginSubmit');

  const usuario = (document.getElementById('loginUsuario').value || '').trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  if (!usuario || !password) return;

  errorBox.classList.add('hidden');
  lockoutBox.classList.add('hidden');
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
  const avisoLento = setTimeout(() => { if (btn) btn.textContent = 'Despertando el servidor...'; }, 3000);

  try {
    const res = await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, password }) });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.token) {
      state.token = data.token;
      guardarSesion(data.token, data.exp);
      document.getElementById('loginPassword').value = '';
      state._claveIngresada = password;   // para no pedirla dos veces si hay que cambiarla
      iniciarSesionExitosa(data.usuario, true);
      return;
    }
    if (res.status === 429) {
      lockoutText.textContent = data.error || 'Demasiados intentos fallidos. Esperá unos minutos.';
      lockoutBox.classList.remove('hidden');
    } else {
      errorText.textContent = data.error || 'Usuario o contraseña incorrectos.';
      errorBox.classList.remove('hidden');
    }
  } catch (err) {
    errorText.textContent = 'No se pudo conectar con el servidor. Revisá la conexión e intentá de nuevo.';
    errorBox.classList.remove('hidden');
  } finally {
    clearTimeout(avisoLento);
    if (btn) { btn.disabled = false; btn.textContent = 'Ingresar al Panel'; }
    if (window.lucide) window.lucide.createIcons();
  }
}

function iniciarSesionExitosa(usuario, mostrarToast = true) {
  const u = typeof usuario === 'string' ? usuarioDesdeRol(usuario) : usuario;
  state.user = u;
  state.isAuthenticated = true;
  state.userRole = { MED: 'medico', ADM: 'medico', REC: 'recepcion', ENF: 'enfermeria', LAB: 'laboratorio', RAY: 'rayos' }[u.rol] || 'recepcion';

  // Quién está logueado: nombre, ID visible y perfil
  document.getElementById('sidebarRoleLabel').textContent = u.etiqueta || 'Panel de Gestión';
  document.getElementById('userProfileNombre').textContent = u.nombre || '—';
  document.getElementById('userProfileId').textContent = u.numero ? `ID ${u.numero}` : 'Compartido';
  document.getElementById('userProfileRole').textContent = u.etiqueta || '';

  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminLayout').classList.remove('hidden');

  // Primer ingreso o contraseña reseteada: primero tiene que elegir la suya
  if (u.debeCambiarPassword) {
    abrirClaveObligatoria();
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Pestañas según permisos
  const pestañas = [
    ['navCalendarioBtn', tienePermiso('calendario')],
    ['navAgendaBtn', tienePermiso('calendario') && (u.rol !== 'MED' || !!u.id)],
    ['navPacientesBtn', tienePermiso('pacientes.editar')],
    ['navHistoriasBtn', tienePermiso('hc.acceso')],
    ['navInternacionBtn', tienePermiso('internacion.ver')],
    ['navRayosBtn', tienePermiso('rayos')],
    ['navGuardiaBtn', tienePermiso('sala_espera.ver')],
    ['navAdminBtn', tienePermiso('admin')]
  ];
  pestañas.forEach(([id, ok]) => { const el = document.getElementById(id); if (el) el.classList.toggle('hidden', !ok); });
  const txtAgenda = document.getElementById('navAgendaTexto');
  if (txtAgenda) txtAgenda.textContent = u.soloSusTurnos ? 'Mi agenda' : 'Agenda médica';
  const boxFilterMedico = document.getElementById('boxFilterMedico');
  if (boxFilterMedico) boxFilterMedico.style.display = (u.rol === 'MED' || u.rol === 'ADM') ? 'inline-flex' : 'none';

  // "Cargar Documento": solo los tipos que este perfil puede cargar
  let algunoDoc = false;
  document.querySelectorAll('#menuCargarDocumento [data-doc-tipo]').forEach(el => {
    const ok = puedeEscribirDoc(el.dataset.docTipo);
    el.classList.toggle('hidden', !ok);
    if (ok && el.tagName === 'A') algunoDoc = true;
  });
  const grupoDoc = document.getElementById('btnGroupCargarDocumento');
  if (grupoDoc) grupoDoc.dataset.sinDocumentos = algunoDoc ? '' : '1';

  // Filtros del historial: solo los tipos que puede ver
  const visibles = (u.docsVer || []).length;
  document.querySelectorAll('#historiasFilters [data-doc-tipo]').forEach(el => el.classList.toggle('hidden', !puedeVerDoc(el.dataset.docTipo)));
  const filtros = document.getElementById('historiasFilters');
  if (filtros) filtros.classList.toggle('hidden', visibles <= 1);

  // Inicializar solo lo que este perfil usa
  verificarConexionApi();
  configurarTabs();
  if (tienePermiso('calendario')) cargarTodosLosTurnosParaCalendario();
  if (tienePermiso('pacientes.ver')) cargarPacientes();
  if (tienePermiso('internacion.ver')) inicializarInternacion();
  if (tienePermiso('rayos')) cargarRayos();   // marcas de "placa de hoy" también en Internación
  if (u.soloSusTurnos && tienePermiso('sala_espera.ver')) iniciarSalaEspera();   // avisos de llegada en segundo plano
  inicializarModalAdjunto();
  inicializarModalFoja();
  inicializarModalPlanilla();
  inicializarModalesCuenta();
  prepararHorariosTurno();
  iniciarNotificaciones();

  // Pestaña de inicio: la primera disponible para este perfil
  const inicio = ['navCalendarioBtn', 'navRayosBtn', 'navGuardiaBtn', 'navHistoriasBtn', 'navInternacionBtn', 'navAdminBtn']
    .map(id => document.getElementById(id)).find(el => el && !el.classList.contains('hidden'));
  const activa = document.querySelector('.nav-item.active');
  if (inicio && (!activa || activa.classList.contains('hidden') || !tienePermiso('calendario'))) inicio.click();

  if (mostrarToast) showToast(`Hola, ${u.nombre}${u.numero ? ' (ID ' + u.numero + ')' : ''}`);
  if (window.lucide) window.lucide.createIcons();
}

// ---------- Contraseña: cambio obligatorio y "Mi cuenta" ----------
function abrirClaveObligatoria() {
  const f = document.getElementById('formClaveObligatoria');
  if (f) f.reset();
  const actual = document.getElementById('obClaveActual');
  if (actual && state._claveIngresada) actual.value = state._claveIngresada;
  document.getElementById('obClaveError').classList.add('hidden');
  inicializarModalesCuenta();
  openModal('modalClaveObligatoria');
  setTimeout(() => { const n = document.getElementById('obClaveNueva'); if (n) n.focus(); }, 50);
}

async function enviarCambioClave(actual, nueva, repite, errorEl, btn) {
  errorEl.classList.add('hidden');
  if (nueva !== repite) { errorEl.textContent = 'Las dos contraseñas nuevas no coinciden.'; errorEl.classList.remove('hidden'); return null; }
  if (btn) btn.disabled = true;
  try {
    const res = await apiFetch('/auth/cambiar-password', { method: 'POST', body: JSON.stringify({ actual, nueva }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { errorEl.textContent = data.error || 'No se pudo cambiar la contraseña.'; errorEl.classList.remove('hidden'); return null; }
    state.token = data.token;
    guardarSesion(data.token, data.exp);
    return data.usuario;
  } catch (e) {
    errorEl.textContent = 'Sin conexión con el servidor.'; errorEl.classList.remove('hidden'); return null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function inicializarModalesCuenta() {
  const fOb = document.getElementById('formClaveObligatoria');
  if (fOb && !fOb.dataset.listo) {
    fOb.dataset.listo = '1';
    fOb.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = await enviarCambioClave(document.getElementById('obClaveActual').value, document.getElementById('obClaveNueva').value,
        document.getElementById('obClaveRepite').value, document.getElementById('obClaveError'), document.getElementById('btnClaveObligatoria'));
      if (!u) return;
      delete state._claveIngresada;
      closeModal('modalClaveObligatoria');
      iniciarSesionExitosa(u, true);
    });
  }
  const fMi = document.getElementById('formMiClave');
  if (fMi && !fMi.dataset.listo) {
    fMi.dataset.listo = '1';
    fMi.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = await enviarCambioClave(document.getElementById('miClaveActual').value, document.getElementById('miClaveNueva').value,
        document.getElementById('miClaveRepite').value, document.getElementById('miClaveError'), document.getElementById('btnMiClave'));
      if (!u) return;
      state.user = { ...state.user, ...u };
      fMi.reset();
      closeModal('modalMiCuenta');
      showToast('Contraseña cambiada. Tus otras sesiones quedaron cerradas.');
    });
  }
  const fUsr = document.getElementById('formUsuario');
  if (fUsr && !fUsr.dataset.listo) { fUsr.dataset.listo = '1'; fUsr.addEventListener('submit', guardarUsuarioAdmin); }
}

function abrirMiCuenta() {
  const u = state.user;
  if (!u) return;
  document.getElementById('cuentaId').textContent = u.numero ? `ID ${u.numero}` : 'Compartido';
  document.getElementById('cuentaNombre').textContent = u.nombre || '—';
  document.getElementById('cuentaMeta').textContent = [u.etiqueta, u.usuario ? `usuario: ${u.usuario}` : '', u.matricula ? `Mat. ${u.matricula}` : ''].filter(Boolean).join(' · ');
  const permisos = (u.permisosDescripcion || (u.permisos || []).map(p => DESCRIPCION_PERMISOS_UI[p] || p));
  const docs = (u.docsEscribir || []).map(t => NOMBRE_TIPO_DOC[t]);
  const docsSoloVer = (u.docsVer || []).filter(t => !(u.docsEscribir || []).includes(t)).map(t => NOMBRE_TIPO_DOC[t]);
  document.getElementById('cuentaPermisos').innerHTML =
    permisos.map(p => `<li><i data-lucide="check"></i> ${escInt(p)}</li>`).join('') +
    (docs.length ? `<li><i data-lucide="pencil"></i> Carga: ${escInt(docs.join(', '))}</li>` : '') +
    (docsSoloVer.length ? `<li><i data-lucide="eye"></i> Solo lectura: ${escInt(docsSoloVer.join(', '))}</li>` : '');
  const fMi = document.getElementById('formMiClave');
  if (fMi) { fMi.reset(); fMi.classList.toggle('hidden', !u.id); }
  document.getElementById('miClaveError').classList.add('hidden');
  inicializarModalesCuenta();
  openModal('modalMiCuenta');
  if (window.lucide) window.lucide.createIcons();
}

// Al salir se borra todo rastro del usuario en esta computadora (copias locales de la
// planilla de camas incluidas) y se recarga la página, así el próximo que se siente
// no encuentra datos de pacientes en memoria ni en pantallas ocultas.
const AVISO_LOGIN_KEY = 'passo_aviso_login';
function borrarDatosLocales() {
  try { sessionStorage.removeItem(SESION_KEY); } catch (e) {}
  try { localStorage.removeItem('passo_internacion_cache_v2'); } catch (e) {}
}
function volverAPantallaDeAcceso(aviso) {
  borrarDatosLocales();
  try { if (aviso) sessionStorage.setItem(AVISO_LOGIN_KEY, JSON.stringify(aviso)); } catch (e) {}
  state.isAuthenticated = false;
  state.token = null;
  state.user = null;
  location.reload();
}

function cerrarSesion() {
  if (!confirm('¿Deseas bloquear la terminal y cerrar la sesión actual?')) return;
  volverAPantallaDeAcceso({ tipo: 'ok', texto: 'Terminal bloqueada correctamente' });
}

// El servidor rechazó el pase (venció a las 12 h o se cambió la clave de firma)
let avisoSesionMostrado = false;
function sesionVencida(motivo) {
  if (!state.isAuthenticated) return;
  volverAPantallaDeAcceso({ tipo: 'error', texto: motivo || 'Tu sesión venció. Volvé a ingresar.' });
  if (!avisoSesionMostrado) { avisoSesionMostrado = true; setTimeout(() => { avisoSesionMostrado = false; }, 3000); }
}

// ==========================================
// 1. SALUD & CONEXIÓN DE LA API (AUTO-DESPERTAR)
// ==========================================
let healthCheckInterval = null;

async function verificarConexionApi(reintentar = true) {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const apiUrlLabel = document.getElementById('apiUrlLabel');

  if (!statusDot || !statusText) return false;

  try {
    const res = await apiFetch('/health');
    if (res.ok) {
      statusDot.className = 'status-dot online';
      statusText.textContent = 'En Línea';
      apiUrlLabel.textContent = 'Render (OK)';

      if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
      }

      // Si los datos no se habían cargado porque el servidor dormía, cargarlos ahora
      if (state.isAuthenticated && state.turnosList.length === 0) {
        cargarTodosLosTurnosParaCalendario();
        cargarPacientes();
      }
      return true;
    } else {
      throw new Error('Respuesta no exitosa');
    }
  } catch (err) {
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Despertando...';
    apiUrlLabel.textContent = 'Reintentando en 4s';

    // Si el servidor de Render estaba en reposo, reintentar automáticamente cada 4 segundos
    if (reintentar && !healthCheckInterval) {
      healthCheckInterval = setInterval(async () => {
        await verificarConexionApi(false);
      }, 4000);
    }
    return false;
  }
}

function actualizarFechaActual() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const fechaStr = new Date().toLocaleDateString('es-AR', options);
  const capitalizada = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
  const el = document.getElementById('currentDateText');
  if (el) el.textContent = `Hoy es ${capitalizada}`;
}

// ==========================================
// 2. NAVEGACIÓN ENTRE SECCIONES (TABS)
// ==========================================
let tabsConfiguradas = false;
function configurarTabs() {
  if (tabsConfiguradas) return;
  tabsConfiguradas = true;
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('pageTitle');
  const mainActionBtn = document.getElementById('mainActionBtn');
  const btnGroupCargarDocumento = document.getElementById('btnGroupCargarDocumento');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetTabId = item.getAttribute('data-tab');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) targetPane.classList.add('active');
      state.currentTab = targetTabId;

      if (btnGroupCargarDocumento) btnGroupCargarDocumento.style.display = 'none';
      if (mainActionBtn) mainActionBtn.style.display = 'none';

      if (targetTabId === 'calendario-tab') {
        pageTitle.textContent = 'Calendario';
        cargarTodosLosTurnosParaCalendario();
      } else if (targetTabId === 'pacientes-tab') {
        pageTitle.textContent = 'Pacientes';
        if (mainActionBtn) {
          mainActionBtn.style.display = 'inline-flex';
          mainActionBtn.innerHTML = '<i data-lucide="user-plus"></i> Registrar Paciente';
          mainActionBtn.onclick = openModalNuevoPaciente;
        }
      } else if (targetTabId === 'historias-tab') {
        pageTitle.textContent = 'Historias Clínicas';
        if (btnGroupCargarDocumento) btnGroupCargarDocumento.style.display = 'inline-flex';
      } else if (targetTabId === 'internacion-tab') {
        pageTitle.textContent = 'Internación';
        inicializarInternacion();
      } else if (targetTabId === 'rayos-tab') {
        pageTitle.textContent = 'Rayos';
        iniciarRayos();
      } else if (targetTabId === 'guardia-tab') {
        pageTitle.textContent = 'Turnos';
        iniciarSalaEspera();
      } else if (targetTabId === 'agenda-tab') {
        pageTitle.textContent = (state.user && state.user.soloSusTurnos) ? 'Mi agenda' : 'Agenda médica';
        iniciarAgenda();
      } else if (targetTabId === 'admin-tab') {
        pageTitle.textContent = 'Administración';
        mostrarVistaAdmin('usuarios');
      }
      if (targetTabId !== 'guardia-tab' && typeof detenerSalaEspera === 'function' && !(state.user && state.user.soloSusTurnos)) detenerSalaEspera();
      if (targetTabId !== 'rayos-tab' && typeof detenerRayos === 'function') detenerRayos();
      if (targetTabId === 'historias-tab' && btnGroupCargarDocumento && btnGroupCargarDocumento.dataset.sinDocumentos === '1') {
        btnGroupCargarDocumento.style.display = 'none';   // perfiles que solo leen
      }

      // Auto-cerrar menú lateral en móvil al cambiar de pestaña
      if (window.innerWidth <= 900) {
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (sidebar) sidebar.classList.remove('mobile-open');
        if (overlay) overlay.classList.add('hidden');
      }

      if (window.lucide) window.lucide.createIcons();
    });
  });
}

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) {
    sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('hidden');
    if (window.lucide) window.lucide.createIcons();
  }
}

function refreshCurrentTab() {
  const icon = document.getElementById('refreshIcon');
  if (icon) icon.classList.add('spin');

  verificarConexionApi();

  if (state.currentTab === 'calendario-tab') {
    cargarTodosLosTurnosParaCalendario();
  } else if (state.currentTab === 'turnos-tab') {
    cargarMetricasYTurnos();
  } else if (state.currentTab === 'pacientes-tab') {
    cargarPacientes();
  } else if (state.currentTab === 'historias-tab') {
    if (state.selectedPacienteHistoria) {
      cargarHistoriasDePaciente(state.selectedPacienteHistoria.id);
    }
  } else if (state.currentTab === 'internacion-tab') {
    if (tienePermiso('pacientes.ver')) cargarPacientes();
    inicializarInternacion();
  } else if (state.currentTab === 'guardia-tab') {
    cargarSalaEspera();
  } else if (state.currentTab === 'rayos-tab') {
    cargarRayos();
  } else if (state.currentTab === 'agenda-tab') {
    if (!agendaState.cambios) iniciarAgenda();
  } else if (state.currentTab === 'admin-tab') {
    const vista = document.querySelector('[data-admin-vista].active');
    mostrarVistaAdmin(vista ? vista.dataset.adminVista : 'usuarios');
  }

  setTimeout(() => {
    if (icon) icon.classList.remove('spin');
    showToast('Datos actualizados');
  }, 600);
}

// ==========================================
// 3. GESTIÓN DE TURNOS & MÉTRICAS (TAB 1)
// ==========================================
function actualizarMetricasCards(turnos = state.turnosList) {
  if (!turnos || !Array.isArray(turnos)) return;

  const total = turnos.length;
  const pendientes = turnos.filter(t => {
    const st = (t.estado || '').toLowerCase().trim();
    return st.startsWith('pend');
  }).length;

  const confirmados = turnos.filter(t => {
    const st = (t.estado || '').toLowerCase().trim();
    return ['aceptado', 'confirmado', 'aceptada', 'confirmada', 'aceptados', 'confirmados'].includes(st);
  }).length;

  const realizados = turnos.filter(t => {
    const st = (t.estado || '').toLowerCase().trim();
    return ['realizado', 'realizada', 'realizados', 'realizadas', 'atendido', 'atendida', 'completado'].includes(st);
  }).length;

  const elTotal = document.getElementById('kpiTotal');
  const elPend = document.getElementById('kpiPendientes');
  const elConf = document.getElementById('kpiConfirmados');
  const elReal = document.getElementById('kpiRealizados');

  if (elTotal) elTotal.textContent = total;
  if (elPend) elPend.textContent = pendientes;
  if (elConf) elConf.textContent = confirmados;
  if (elReal) elReal.textContent = realizados;
}

async function cargarMetricasYTurnos() {
  // La vista vieja de "tabla de turnos" ya no existe (se reemplazó por el calendario)
  if (!document.getElementById('turnosTableBody')) return;
  if (state.viewingAllTurnos) {
    await cargarTodosLosTurnos();
  } else {
    await cargarTurnosHoy();
  }
}

async function cargarTurnosHoy() {
  state.viewingAllTurnos = false;
  const tbody = document.getElementById('turnosTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center loading-row"><i data-lucide="loader-2" class="spin"></i> Cargando turnos de hoy...</td></tr>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await apiFetch('/turnos/hoy');
    if (!res.ok) throw new Error('Error al cargar turnos');
    const turnos = await res.json();
    state.turnosList = turnos;
    actualizarOpcionesMedicos();
    actualizarMetricasCards(turnos);
    renderTurnosTable(turnos);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--red); padding: 2rem;">Error al conectar con la base de datos: ${escInt(err.message)}</td></tr>`;
  }
}

async function cargarTodosLosTurnos() {
  state.viewingAllTurnos = true;
  const tbody = document.getElementById('turnosTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center loading-row"><i data-lucide="loader-2" class="spin"></i> Cargando todos los turnos...</td></tr>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await apiFetch('/turnos');
    if (!res.ok) throw new Error('Error al cargar todos los turnos');
    const turnos = await res.json();
    state.turnosList = turnos;
    actualizarOpcionesMedicos();
    actualizarMetricasCards(turnos);
    renderTurnosTable(turnos);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--red);">Error: ${escInt(err.message)}</td></tr>`;
  }
}

function toggleTodosLosTurnos() {
  const btn = document.getElementById('btnToggleTodosTurnos');
  const pageTitle = document.getElementById('pageTitle');
  if (state.viewingAllTurnos) {
    btn.innerHTML = '<i data-lucide="list"></i> Ver Todos los Turnos (Histórico)';
    pageTitle.textContent = 'Agenda de Turnos de Hoy';
    cargarTurnosHoy();
  } else {
    btn.innerHTML = '<i data-lucide="calendar"></i> Ver Solo Turnos de Hoy';
    pageTitle.textContent = 'Historial Completo de Turnos';
    cargarTodosLosTurnos();
  }
  if (window.lucide) window.lucide.createIcons();
}

function renderTurnosTable(turnos) {
  const tbody = document.getElementById('turnosTableBody');
  if (!tbody) return;
  if (!turnos || turnos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 3rem; color: var(--text-muted);"><i data-lucide="calendar-x"></i><br>No hay turnos registrados para mostrar.</td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = turnos.map(t => {
    const p = t.pacientes || {};
    const nombreCompleto = p.nombre ? `${p.apellido || ''}, ${p.nombre || ''}` : 'Paciente no asignado';
    const dni = p.dni || '-';
    const email = p.email ? `<small style="display:block; color: var(--text-muted); font-size:0.75rem;">${escInt(p.email)}</small>` : '';
    
    const fechaObj = new Date(t.fecha_turno);
    const horaStr = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const fechaCorta = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    const timeDisplay = state.viewingAllTurnos ? `${fechaCorta} · ${horaStr} hs` : `${horaStr} hs`;

    return `
      <tr>
        <td><strong>${timeDisplay}</strong></td>
        <td><strong>${escInt(nombreCompleto)}</strong>${email}</td>
        <td><strong>${escInt(dni)}</strong></td>
        <td><span class="timeline-pill">${escInt(t.especialidad || '-')}</span>${t.origen === 'app' ? ' <span class="turno-app-pill"><i data-lucide="globe"></i> Web</span>' : ''}</td>
        <td>${escInt(t.medico || 'A designar')}</td>
        <td>
          <select class="status-select badge-${escInt(t.estado)}" onchange="cambiarEstadoTurno('${escInt(t.id)}', this.value)">
            <option value="pendiente" ${t.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="confirmado" ${t.estado === 'aceptado' || t.estado === 'confirmado' ? 'selected' : ''}>Confirmado</option>
            <option value="cancelado" ${t.estado === 'rechazado' || t.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            <option value="realizado" ${t.estado === 'realizado' ? 'selected' : ''}>Realizado</option>
          </select>
        </td>
        <td>
          ${(t.pacientes?.email) ? `
            <button class="btn btn-outline btn-sm" onclick="enviarMailTurnoDirecto('${escInt(t.id)}', this)" title="Avisar por Email" style="color: var(--primary);">
              <i data-lucide="mail"></i>
            </button>
          ` : ''}
          ${tienePermiso('hc.acceso') ? `
            <button class="btn btn-outline btn-sm" onclick="irAHistoriaPacientePorId('${escInt(t.paciente_id)}')" title="Ver Historia Clínica">
              <i data-lucide="clipboard"></i>
            </button>
          ` : ''}
          <button class="btn btn-outline btn-sm" style="color: var(--red);" onclick="eliminarTurno('${escInt(t.id)}')" title="Eliminar Turno">
            <i data-lucide="trash-2"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

async function cambiarEstadoTurno(turnoId, nuevoEstado) {
  try {
    const turnoEncontrado = (state.turnosList || []).find(t => String(t.id) === String(turnoId));
    if (turnoEncontrado) turnoEncontrado.estado = nuevoEstado;
    actualizarMetricasCards(state.turnosList);

    const res = await apiFetch(`/turnos/${turnoId}/estado`, {
      method: 'PUT',
      body: JSON.stringify({ estado: nuevoEstado })
    });
    if (!res.ok) throw new Error('Error al actualizar estado');
    
    showToast(`Estado actualizado a "${nuevoEstado}"`);

    if (state.currentTab === 'turnos-tab') {
      cargarMetricasYTurnos();
    }
    renderizarCalendarioMensual();
    if (currentSelectedDay) {
      renderizarDrawerTurnos();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function enviarMailTurnoDirecto(turnoId, btnElement) {
  if (!turnoId) return;

  const originalHtml = btnElement ? btnElement.innerHTML : 'Email';
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = '<i data-lucide="loader-2" class="spin" style="width: 13px; height: 13px; margin-right: 4px;"></i> Enviando...';
    if (window.lucide) window.lucide.createIcons();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await apiFetch(`/turnos/${turnoId}/notificar-email`, {
      method: 'POST',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al enviar email');

    showToast(`Email de confirmación enviado a ${data.paciente || 'paciente'}`);
    if (btnElement) {
      btnElement.innerHTML = '<i data-lucide="check" style="width: 13px; height: 13px; margin-right: 4px;"></i> Enviado';
      btnElement.classList.add('enviado');
      if (window.lucide) window.lucide.createIcons();
      setTimeout(() => {
        btnElement.disabled = false;
        btnElement.innerHTML = '<i data-lucide="send" style="width: 13px; height: 13px; margin-right: 4px;"></i> Reenviar';
        if (window.lucide) window.lucide.createIcons();
        btnElement.classList.remove('enviado');
      }, 5000);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err.name === 'AbortError' ? 'Tiempo de espera agotado. El servidor tardó en responder.' : err.message;
    alert(`Aviso: ${msg}`);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = originalHtml;
    }
  }
}

async function eliminarTurno(turnoId, skipConfirm = false) {
  if (!skipConfirm && !confirm('¿Estás seguro de eliminar este turno?')) return;
  try {
    const res = await apiFetch(`/turnos/${turnoId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Error al eliminar turno');
    showToast('Turno eliminado correctamente');
    state.turnosList = (state.turnosList || []).filter(t => String(t.id) !== String(turnoId));
    actualizarMetricasCards(state.turnosList);
    if (state.currentTab === 'turnos-tab') {
      cargarMetricasYTurnos();
    }
    renderizarCalendarioMensual();
    if (currentSelectedDay) {
      renderizarDrawerTurnos();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function actualizarOpcionesMedicos() {
  const select = document.getElementById('turnosFilterMedico');
  if (!select) return;

  const currentVal = select.value;
  const medicosSet = new Set();

  (state.turnosList || []).forEach(t => {
    if (t.medico && t.medico.trim() && t.medico.trim().toLowerCase() !== 'a designar') {
      medicosSet.add(t.medico.trim());
    }
  });

  const medicos = Array.from(medicosSet).sort((a, b) => a.localeCompare(b));

  let html = '<option value="todos">Todos los Médicos</option>';
  medicos.forEach(m => {
    html += `<option value="${escInt(m.toLowerCase())}">Dr/a. ${escInt(m)}</option>`;
  });

  select.innerHTML = html;
  if (currentVal && (currentVal === 'todos' || medicos.some(m => m.toLowerCase() === currentVal.toLowerCase()))) {
    select.value = currentVal;
  }
}

function handleTurnosSearch() {
  if (!document.getElementById('turnosSearch') || !document.getElementById('turnosFilterState')) return;  // vista vieja, ya no existe
  const query = document.getElementById('turnosSearch').value.toLowerCase().trim();
  const filterState = document.getElementById('turnosFilterState').value;
  const filterMedicoEl = document.getElementById('turnosFilterMedico');
  const filterMedico = filterMedicoEl ? filterMedicoEl.value : 'todos';
  filtrarYRenderizarTurnos(query, filterState, filterMedico);
}

function handleTurnosFilterChange() {
  if (!document.getElementById('turnosSearch') || !document.getElementById('turnosFilterState')) return;  // vista vieja, ya no existe
  const query = document.getElementById('turnosSearch').value.toLowerCase().trim();
  const filterState = document.getElementById('turnosFilterState').value;
  const filterMedicoEl = document.getElementById('turnosFilterMedico');
  const filterMedico = filterMedicoEl ? filterMedicoEl.value : 'todos';
  filtrarYRenderizarTurnos(query, filterState, filterMedico);
}

function filtrarTurnosPorEstado(estado) {
  const selectState = document.getElementById('turnosFilterState');
  if (selectState) {
    selectState.value = estado;
    handleTurnosFilterChange();
  }
}
const filterTurnosByState = filtrarTurnosPorEstado;

function filtrarYRenderizarTurnos(query, filterState, filterMedico = 'todos') {
  let filtrados = state.turnosList || [];

  // 1. Filtro por Estado
  if (filterState && filterState !== 'todos') {
    filtrados = filtrados.filter(t => {
      const st = (t.estado || '').toLowerCase().trim();
      if (filterState === 'pendiente') return st.startsWith('pend');
      if (filterState === 'confirmado' || filterState === 'aceptado') {
        return ['aceptado', 'confirmado', 'aceptada', 'confirmada', 'aceptados', 'confirmados'].includes(st);
      }
      if (filterState === 'rechazado' || filterState === 'cancelado') {
        return ['rechazado', 'cancelado', 'rechazada', 'cancelada'].includes(st);
      }
      if (filterState === 'realizado') {
        return ['realizado', 'realizada', 'realizados', 'realizadas', 'atendido', 'atendida', 'completado'].includes(st);
      }
      return st === filterState.toLowerCase();
    });
  }

  // 2. Filtro Exclusivo por Médico
  if (filterMedico && filterMedico !== 'todos') {
    filtrados = filtrados.filter(t => t.medico && t.medico.toLowerCase().trim() === filterMedico.toLowerCase().trim());
  }

  // 3. Búsqueda por texto (paciente, DNI, médico, especialidad)
  if (query) {
    filtrados = filtrados.filter(t => {
      const p = t.pacientes || {};
      const full = `${p.nombre || ''} ${p.apellido || ''} ${p.dni || ''} ${p.email || ''} ${t.medico || ''} ${t.especialidad || ''}`.toLowerCase();
      return full.includes(query);
    });
  }

  renderTurnosTable(filtrados);
}

// ==========================================
// 4. GESTIÓN DE PACIENTES (TAB 2)
// ==========================================
async function cargarPacientes() {
  const tbody = document.getElementById('pacientesTableBody');
  const selectTurno = document.getElementById('turnoPacienteSelect');

  try {
    const res = await apiFetch('/pacientes');
    if (!res.ok) throw new Error('Error al cargar pacientes');
    const pacientes = await res.json();
    state.pacientesList = pacientes;

    renderPacientesTable(pacientes);

    if (selectTurno) {
      selectTurno.innerHTML = '<option value="">Seleccionar paciente...</option>' + 
        pacientes.map(p => `<option value="${escInt(p.id)}">${escInt(p.apellido)}, ${escInt(p.nombre)} (DNI: ${escInt(p.dni)})</option>`).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: var(--red);">Error: ${escInt(err.message)}</td></tr>`;
  }
}

function renderPacientesTable(pacientes) {
  const tbody = document.getElementById('pacientesTableBody');
  if (!tbody) return;

  if (!pacientes || pacientes.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="padding: 3rem;"><i data-lucide="user-x"></i><br>No hay pacientes registrados.</td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = pacientes.map(p => `
    <tr class="pac-fila">
      <td class="pac-td-nombre">
        <strong class="pac-nombre">${escInt(fmtNombrePersona(p.apellido || ''))}${p.nombre ? ', ' + escInt(fmtNombrePersona(p.nombre)) : ''}</strong>
        ${p.email ? `<small class="pac-email">${escInt(p.email)}</small>` : '<small class="pac-email pac-sin-dato">Sin email</small>'}
      </td>
      <td class="pac-num" data-label="DNI">${p.dni ? escInt(fmtDni(p.dni)) : '<span class="pac-sin-dato">—</span>'}</td>
      <td class="pac-num" data-label="Teléfono">${p.telefono ? escInt(p.telefono) : '<span class="pac-sin-dato">—</span>'}</td>
      <td data-label="Obra social">${escInt(fmtCobertura(p.obra_social))}</td>
      <td class="pac-num" data-label="N° afiliado">${p.nro_afiliado ? escInt(p.nro_afiliado) : '<span class="pac-sin-dato">—</span>'}</td>
      <td class="pac-td-acciones">
        <div class="pac-acciones">
          <button class="btn btn-outline btn-sm" onclick="openModalEditarPaciente('${escInt(p.id)}')" title="Editar datos del paciente">
            <i data-lucide="pencil"></i> Editar
          </button>
          <button class="btn btn-outline btn-sm" onclick="openModalTurnoConPaciente('${escInt(p.id)}')" title="Dar turno">
            <i data-lucide="calendar-plus"></i> Turno
          </button>
          ${tienePermiso('pacientes.editar') ? `
            <button class="btn btn-outline btn-sm" onclick="abrirAppPaciente(${jsArg(p.id)})" title="Habilitar el portal de pacientes (clinicapasso.com.ar)">
              <i data-lucide="globe"></i> Portal
            </button>
          ` : ''}
          ${tienePermiso('hc.acceso') ? `
            <button class="btn btn-primary btn-sm" onclick="irAHistoriaPacientePorId('${escInt(p.id)}')" title="Ver historia clínica">
              <i data-lucide="clipboard-list"></i> Historia
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');

  if (window.lucide) window.lucide.createIcons();
}

function openModalEditarPaciente(pacienteId) {
  const p = state.pacientesList.find(item => item.id === pacienteId);
  if (!p) {
    alert('Paciente no encontrado en la lista local.');
    return;
  }

  document.getElementById('editPacienteId').value = p.id;
  document.getElementById('editPacienteNombre').value = p.nombre || '';
  document.getElementById('editPacienteApellido').value = p.apellido || '';
  document.getElementById('editPacienteDni').value = p.dni || '';
  document.getElementById('editPacienteFechaNac').value = p.fecha_nac || '';
  document.getElementById('editPacienteTelefono').value = p.telefono || '';
  document.getElementById('editPacienteEmail').value = p.email || '';
  document.getElementById('editPacienteObraSocial').value = p.obra_social || '';
  document.getElementById('editPacienteNroAfiliado').value = p.nro_afiliado || '';
  const famNom = document.getElementById('editPacienteAcompNombre');
  const famTel = document.getElementById('editPacienteAcompTel');
  if (famNom) famNom.value = p.familiar_nombre || '';
  if (famTel) famTel.value = p.familiar_telefono || '';
  const tieneFamiliar = !!(p.familiar_nombre || p.familiar_telefono);
  const secFam = document.getElementById('familiarSectionEdit');
  const toggleFam = document.querySelector('#familiarToggleEditContainer a');
  if (secFam) secFam.style.display = tieneFamiliar ? 'block' : 'none';
  if (toggleFam) toggleFam.style.display = tieneFamiliar ? 'none' : '';

  openModal('modalEditarPaciente');
}

async function guardarEdicionPaciente(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarEdicionPaciente');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const id = document.getElementById('editPacienteId').value;
  const nombre = document.getElementById('editPacienteNombre').value.trim();
  const apellido = document.getElementById('editPacienteApellido').value.trim();
  const dni = document.getElementById('editPacienteDni').value.trim();
  const fecha_nac = document.getElementById('editPacienteFechaNac').value || null;
  const telefono = document.getElementById('editPacienteTelefono').value.trim();
  const email = document.getElementById('editPacienteEmail').value.trim();
  const obra_social = document.getElementById('editPacienteObraSocial').value.trim();
  const nro_afiliado = document.getElementById('editPacienteNroAfiliado').value.trim();
  const familiar_nombre = (document.getElementById('editPacienteAcompNombre') || {}).value?.trim() || '';
  const familiar_telefono = (document.getElementById('editPacienteAcompTel') || {}).value?.trim() || '';

  try {
    const res = await apiFetch(`/pacientes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, apellido, dni, fecha_nac, telefono, email, obra_social, nro_afiliado, familiar_nombre, familiar_telefono })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar paciente');

    showToast('Datos del paciente actualizados correctamente');
    closeModal('modalEditarPaciente');
    await cargarPacientes();
    if (state.selectedPacienteHistoria && state.selectedPacienteHistoria.id === id) {
      searchPacienteParaHistoria();
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar Cambios';
    if (window.lucide) window.lucide.createIcons();
  }
}

function handlePacientesSearch() {
  const query = document.getElementById('pacientesSearchInput').value.toLowerCase().trim();
  if (!query) {
    renderPacientesTable(state.pacientesList);
    return;
  }
  const filtrados = state.pacientesList.filter(p => {
    const full = `${p.nombre || ''} ${p.apellido || ''} ${p.dni || ''} ${p.email || ''} ${p.obra_social || ''}`.toLowerCase();
    return full.includes(query);
  });
  renderPacientesTable(filtrados);
}

// ==========================================
// 5. HISTORIAS CLÍNICAS & IMPRESIÓN (TAB 3)
// ==========================================
// Muestra un paciente en la pestaña Historias Clínicas y carga su historial
// (lo usan el buscador por DNI y la lista de Rayos)
function mostrarPacienteEnHistorias(paciente, irAPestaña = true) {
  if (!paciente) return;
  state.selectedPacienteHistoria = paciente;
  const card = document.getElementById('historiaPacienteInfoCard');
  document.getElementById('historiaNombrePaciente').textContent = `${fmtNombrePersona(paciente.apellido)}, ${fmtNombrePersona(paciente.nombre)}`;
  document.getElementById('historiaDniPaciente').textContent = `DNI ${fmtDni(paciente.dni)}`;
  document.getElementById('historiaObraSocial').textContent = fmtCobertura(paciente.obra_social);
  const afEl = document.getElementById('historiaAfiliado');
  afEl.textContent = paciente.nro_afiliado ? `N° de afiliado: ${paciente.nro_afiliado}` : '';
  if (afEl.parentElement) afEl.parentElement.style.display = paciente.nro_afiliado ? 'flex' : 'none';
  card.classList.remove('hidden');
  if (irAPestaña) {
    const input = document.getElementById('historiaDniSearch');
    if (input) input.value = paciente.dni || '';
    const nav = document.getElementById('navHistoriasBtn');
    if (nav && !nav.classList.contains('active')) nav.click();
  }
  cargarHistoriasDePaciente(paciente.id);
}

async function searchPacienteParaHistoria() {
  if (!tienePermiso('hc.acceso')) {
    alert('Tu perfil no tiene acceso a historias clínicas.');
    return;
  }

  const input = document.getElementById('historiaDniSearch');
  if (!input) return;

  // Sanitizar entrada: permitir únicamente búsqueda por DNI numérico (elimina letras, puntos y guiones)
  const dni = input.value.replace(/\D/g, '').trim();
  const card = document.getElementById('historiaPacienteInfoCard');
  const timeline = document.getElementById('historiasTimeline');

  if (dni.length < 3) {
    if (dni.length === 0) {
      card.classList.add('hidden');
      state.selectedPacienteHistoria = null;
      timeline.innerHTML = `
        <div class="empty-state-box">
          <i data-lucide="user-check"></i>
          <h4>Seleccioná un paciente para ver su historial médico</h4>
          <p>Escribí el DNI en el buscador de la izquierda.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
    }
    return;
  }

  // Rayos no accede al padrón: busca solo entre los pacientes internados
  if (state.user && state.user.soloInternados) {
    if (!rayosUI.internados.length) await cargarRayos();
    const fila = rayosUI.internados.find(f => f.paciente && String(f.paciente.dni || '').replace(/\D/g, '') === dni);
    if (fila) { mostrarPacienteEnHistorias(fila.paciente); return; }
    card.classList.add('hidden');
    timeline.innerHTML = `<div class="empty-state-box"><i data-lucide="bed-double"></i><h4>El DNI ${escInt(dni)} no corresponde a un paciente internado</h4><p>Tu perfil solo accede a pacientes internados. Buscalos desde la pestaña <strong>Rayos</strong>.</p></div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  try {
    const res = await apiFetch(`/pacientes/buscar?dni=${dni}`);
    if (res.ok) {
      const paciente = await res.json();
      mostrarPacienteEnHistorias(paciente, false);
    } else {
      card.classList.add('hidden');
      timeline.innerHTML = `<div class="empty-state-box"><i data-lucide="user-x"></i><h4>No se encontró ningún paciente con DNI: ${escInt(dni)}</h4><p>Verificá que el número de documento sea correcto.</p></div>`;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    showToast(err.message);
  }
}

// Lógica para el botón de borrar minimalista (NativeDelete)
window.handleTrashClick = function(id) {
  const btn = document.getElementById(`del-btn-${id}`);
  if (!btn) return;
  
  if (btn.classList.contains('confirm-mode')) {
    eliminarTurno(id, true);
  } else {
    btn.classList.add('confirm-mode');
    document.getElementById(`icon-trash-${id}`).classList.add('hidden');
    document.getElementById(`icon-check-${id}`).classList.remove('hidden');
    document.getElementById(`del-text-${id}`).style.display = 'inline-block';
    document.getElementById(`del-cancel-${id}`).classList.remove('hidden');
  }
};

window.cancelTrashClick = function(id) {
  const btn = document.getElementById(`del-btn-${id}`);
  if (!btn) return;
  
  btn.classList.remove('confirm-mode');
  document.getElementById(`icon-trash-${id}`).classList.remove('hidden');
  document.getElementById(`icon-check-${id}`).classList.add('hidden');
  document.getElementById(`del-text-${id}`).style.display = 'none';
  document.getElementById(`del-cancel-${id}`).classList.add('hidden');
};

async function cargarHistoriasDePaciente(pacienteId) {
  const timeline = document.getElementById('historiasTimeline');
  const countEl = document.getElementById('historiaTotalCount');
  timeline.innerHTML = `<div class="text-center p-4"><i data-lucide="loader-2" class="spin"></i> Cargando historial médico confidencial...</div>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await apiFetch(`/historias-clinicas/paciente/${pacienteId}`);
    if (!res.ok) {
      if (res.status === 403) {
        const d403 = await res.json().catch(() => ({}));
        timeline.innerHTML = `<div class="empty-state-box" style="color: var(--red);"><i data-lucide="shield-alert"></i><h4>Acceso restringido</h4><p>${escInt(d403.error || 'Tu perfil no tiene acceso a la historia clínica de este paciente.')}</p></div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
      }
      throw new Error('Error al cargar historias clínicas');
    }
    const historias = await res.json();
    state.historiasList = historias;
    countEl.textContent = historias.length === 1 ? '1 documento' : `${historias.length} documentos`;

    // Mostrar filtros
    const filtersEl = document.getElementById('historiasFilters');
    if (filtersEl) {
      filtersEl.style.display = 'flex';
      // Al recargar el historial, volver al filtro "Todos" para no mostrar un filtro desincronizado
      filtersEl.querySelectorAll('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
    }

    // Mostrar botón Imprimir Todo
    const btnImprimirTodo = document.getElementById('btnImprimirTodaHC');
    if (btnImprimirTodo) btnImprimirTodo.style.display = 'inline-flex';

    if (historias.length === 0) {
      timeline.innerHTML = `
        <div class="empty-state-box">
          <i data-lucide="file-question"></i>
          <h4>Este paciente todavía no tiene documentos cargados</h4>
          <p>Usá el botón <strong>Cargar Documento</strong> (arriba a la derecha) para cargar el primero.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Convertir todos los adjuntos a URLs firmadas temporales seguras (Signed URLs)
    for (let h of historias) {
      let rawImgs = [];

      // 1. Revisar si vienen en observaciones JSON
      if (h.observaciones && typeof h.observaciones === 'string' && h.observaciones.startsWith('{')) {
        try {
          const meta = JSON.parse(h.observaciones);
          if (meta.imagenes && Array.isArray(meta.imagenes) && meta.imagenes.length > 0) {
            rawImgs = meta.imagenes;
          }
        } catch (e) {}
      }

      // 2. Si no, revisar en la propiedad h.imagenes
      if (rawImgs.length === 0) {
        if (Array.isArray(h.imagenes)) {
          rawImgs = h.imagenes;
        } else if (typeof h.imagenes === 'string' && h.imagenes.startsWith('[')) {
          try { rawImgs = JSON.parse(h.imagenes); } catch (e) { rawImgs = [h.imagenes]; }
        } else if (typeof h.imagenes === 'string' && h.imagenes.length > 0) {
          rawImgs = [h.imagenes];
        }
      }

      h._rawImagenes = rawImgs;
    }

    // Pedir el acceso a TODOS los adjuntos del paciente en un solo pedido
    const todas = await obtenerUrlsFirmadas(historias.flatMap(h => h._rawImagenes || []));
    let idx = 0;
    for (const h of historias) {
      const n = (h._rawImagenes || []).filter(Boolean).length;
      h._signedImagenes = todas.slice(idx, idx + n).filter(Boolean);
      idx += n;
    }

    timeline.innerHTML = historias.map(construirTarjetaHistoria).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    timeline.innerHTML = `<div class="text-center text-red p-4">Error: ${escInt(err.message)}</div>`;
  }
}

// Devuelve el meta (JSON de observaciones) de un registro, o {} si no tiene.
function obtenerMetaHistoria(h) {
  if (h && h.observaciones && typeof h.observaciones === 'string' && h.observaciones.trim().startsWith('{')) {
    try { return JSON.parse(h.observaciones) || {}; } catch (e) { return {}; }
  }
  return {};
}

// ÚNICA fuente de verdad para saber qué tipo de documento es un registro.
// Prioriza el tipo guardado dentro de la planilla (meta.tipo_planilla), que lo
// escribe el propio formulario al guardar; recién después mira h.tipo.
// Devuelve: 'laboratorio' | 'consultorio' | 'hc'
function clasificarHistoria(h) {
  const meta = obtenerMetaHistoria(h);
  const tp = (meta.tipo_planilla || '').toLowerCase();
  if (tp === 'laboratorio') return 'laboratorio';
  if (tp === 'evolucion_consultorio') return 'consultorio';
  if (tp === 'adjunto') return 'adjunto';
  if (tp === 'foja_quirurgica') return 'foja';
  if (tp === 'epicrisis' || tp === 'enfermeria' || tp === 'indicaciones') return tp;
  if (tp) return 'hc';
  const t = (h && h.tipo ? String(h.tipo) : '').toLowerCase();
  if (t === 'laboratorio') return 'laboratorio';
  if (t === 'evolucion_consultorio' || t === 'consultorio' || t === 'evolucion') return 'consultorio';
  return 'hc';
}

// Construye la tarjeta del historial para UN registro, según su tipo real
// (Laboratorio / Evolución de Consultorio / H.C. Oficial). Se usa en la carga
// inicial y en los filtros, para que ambas vistas muestren exactamente lo mismo.
// Autoría visible + botones de edición solo para quien puede modificar ese tipo
function construirTarjetaHistoria(h) {
  let html = construirTarjetaHistoriaBase(h);
  const tipo = clasificarHistoria(h);
  if (!puedeEscribirDoc(tipo)) {
    html = html.replace(/<button[^>]*onclick="(?:editarHistoriaLaboratorio|openModalFoja|openModalPlanilla)\([^"]*\)"[^>]*>[\s\S]*?<\/button>/g, '');
  }
  const autor = h.autor ? `Cargado por <strong>${escInt(h.autor.nombre)}</strong>${h.autor.numero ? ` <span class="autor-id">ID ${escInt(h.autor.numero)}</span>` : ''}` : '';
  const editor = h.editor && (!h.autor || h.editor.numero !== h.autor.numero)
    ? ` · editado por <strong>${escInt(h.editor.nombre)}</strong>${h.editor.numero ? ` <span class="autor-id">ID ${escInt(h.editor.numero)}</span>` : ''}` : '';
  if (autor || editor) {
    html = html.replace('class="timeline-body">', `class="timeline-body"><p class="autor-linea"><i data-lucide="user-pen"></i> ${autor}${editor}</p>`);
  }
  return html;
}

function construirTarjetaHistoriaBase(h) {
    const fechaFormat = new Date(h.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const signedArray = h._signedImagenes || [];
    
    // Parsear observaciones si es JSON
    let obsTexto = h.observaciones || '';
    let meta = null;
    if (obsTexto && obsTexto.startsWith('{')) {
      try {
        meta = JSON.parse(obsTexto);
      } catch (e) {
        meta = null;
      }
    }

    const tipoDoc = clasificarHistoria(h);
    const esConsultorio = tipoDoc === 'consultorio';
    const esLaboratorio = tipoDoc === 'laboratorio';
    let badgeTipo;
    if (PLANILLAS[tipoDoc]) return tarjetaPlanillaHTML(h, tipoDoc);
    if (tipoDoc === 'foja') {
      const f = (meta && meta.foja) || {};
      const horas = f.hora_inicio ? ` · ${escInt(f.hora_inicio)}${f.hora_fin ? '–' + escInt(f.hora_fin) : ''} hs` : '';
      return `
        <div class="timeline-card timeline-card-foja">
          <div class="timeline-card-header">
            <span class="timeline-date"><i data-lucide="calendar"></i> ${fmtFechaDoc(f.fecha) || fechaFormat}${horas}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="timeline-doctor"><strong>Cirujano:</strong> ${escInt(f.cirujano || h.medico || '-')}</span>
              <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')" title="Ver foja"><i data-lucide="eye"></i> Ver</button>
              <button class="btn btn-outline btn-sm btn-print" onclick="imprimirFoja('${escInt(h.id)}')" title="Imprimir foja y anestesia (2 hojas)"><i data-lucide="printer"></i> Imprimir</button>
              <button class="btn btn-outline btn-sm" onclick="openModalFoja('${escInt(h.id)}')" title="Editar foja"><i data-lucide="pencil"></i> Editar</button>
            </div>
          </div>
          <div class="timeline-body">
            <div style="margin-bottom: 8px;"><span class="badge-foja"><i data-lucide="scissors"></i> Foja Quirúrgica</span></div>
            <h4>${escInt(f.procedimiento || h.motivo_consulta || 'Cirugía')}</h4>
            ${f.dx_post || f.dx_pre ? `<p><strong>Diagnóstico:</strong> ${escInt(f.dx_post || f.dx_pre)}</p>` : ''}
            ${f.ayudante1 ? `<p style="color: var(--text-muted); font-size: 0.85rem;">Ayudantes: ${escInt([f.ayudante1, f.ayudante2, f.ayudante3].filter(Boolean).join(', '))}</p>` : ''}
          </div>
        </div>`;
    }
    if (tipoDoc === 'adjunto') {
      const cat = (meta && meta.categoria) || 'Documento';
      const n = archivosDeAdjunto(meta).length;
      return `
        <div class="timeline-card timeline-card-adjunto">
          <div class="timeline-card-header">
            <span class="timeline-date"><i data-lucide="calendar"></i> ${fmtFechaDoc(meta && meta.fecha_documento) || fechaFormat}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')" title="Ver documento" style="display: inline-flex; align-items: center; gap: 5px;">
                <i data-lucide="eye"></i> Ver
              </button>
            </div>
          </div>
          <div class="timeline-body">
            <div style="margin-bottom: 8px;">
              <span class="badge-adjunto"><i data-lucide="paperclip"></i> Adjunto · ${escInt(cat)}</span>
            </div>
            <h4>${escInt((meta && meta.titulo) || h.motivo_consulta || 'Documento')}</h4>
            ${meta && meta.notas ? `<p style="white-space: pre-wrap;">${escInt(meta.notas)}</p>` : ''}
            <div class="adj-card-archivos">${htmlArchivosAdjunto(meta)}</div>
            <p class="adj-card-pie">${n} archivo(s) · cargado el ${fechaFormat}</p>
          </div>
        </div>`;
    }
    if (esLaboratorio) {
      badgeTipo = `<span class="badge-consultorio badge-lab"><i data-lucide="microscope"></i> Laboratorio</span>`;
    } else if (esConsultorio) {
      badgeTipo = `<span class="badge-consultorio"><i data-lucide="clipboard-pen"></i> Planilla de Consultorio</span>`;
    } else {
      badgeTipo = `<span class="badge-hc-completa"><i data-lucide="file-text"></i> H.C. Frente y Dorso</span>`;
    }

    const renderImagenes = signedArray.length > 0 ? `
      <div style="margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--border);">
        <strong style="font-size: 0.85rem; color: var(--text-dark); display: block; margin-bottom: 6px;">
          <i data-lucide="paperclip" style="width: 14px; height: 14px; color: var(--primary); vertical-align: middle;"></i> Estudios adjuntos:
        </strong>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
          ${signedArray.map((fileUrl, idx) => {
            const autorTxt = textoAutorArchivo(urlAPathArchivo.get(fileUrl) || fileUrl);
            const pie = autorTxt ? `<span class="adj-autor" title="${escInt(autorTxt)}"><i data-lucide="upload"></i> ${escInt(autorTxt)}</span>` : '';
            const envolver = (html) => autorTxt ? `<div class="adj-con-autor">${html}${pie}</div>` : html;
            const isPdf = fileUrl.toLowerCase().includes('.pdf');
            const isExternalPortal = fileUrl.startsWith('http') && !fileUrl.includes('ktyzjbntowcudhmiocdp.supabase.co') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(fileUrl.split('?')[0]);

            if (isPdf) {
              return envolver(`
                <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="pdf-attached-link">
                  <i data-lucide="file-text"></i> Ver Documento PDF #${idx + 1}
                </a>
              `);
            }
            if (isExternalPortal) {
              return `
                <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="portal-attached-link">
                  <i data-lucide="external-link"></i> Abrir Portal RDA / Estudio #${idx + 1}
                </a>
              `;
            }
            return envolver(`
              <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" title="Ver imagen en tamaño completo">
                <img src="${escInt(urlSegura(fileUrl))}" alt="Estudio" style="width: 75px; height: 75px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);" onerror="this.src='assets/logo.jpg'">
              </a>
            `);
          }).join('')}
        </div>
      </div>
    ` : '';

    if (esLaboratorio) {
      const nDatos = (meta && Array.isArray(meta.cell_values)) ? meta.cell_values.filter(v => v && v.trim() !== '').length : 0;
      const nFechas = (meta && Array.isArray(meta.date_values)) ? meta.date_values.filter(v => v && v.trim() !== '').length : 0;
      return `
        <div class="timeline-card timeline-card-lab">
          <div class="timeline-card-header">
            <span class="timeline-date"><i data-lucide="calendar"></i> ${fechaFormat}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')" title="Ver Planilla de Laboratorio en Pantalla" style="display: inline-flex; align-items: center; gap: 5px;">
                <i data-lucide="eye"></i> Ver
              </button>
              <button class="btn btn-outline btn-sm btn-print" onclick="imprimirHistoriaClinica('${escInt(h.id)}')" title="Imprimir Planilla de Laboratorio (1 Hoja)">
                <i data-lucide="printer"></i> Imprimir
              </button>
              <button onclick="editarHistoriaLaboratorio('${escInt(h.id)}')" title="Editar Laboratorio" style="display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border: 1px solid var(--border); background: #FEF3C7; color: #92400E; border-radius: 6px; cursor: pointer; font-size: 0.78rem; font-weight: 600;"><i data-lucide="edit-2" style="width:14px;height:14px"></i> Editar</button>
            </div>
          </div>
          <div class="timeline-body">
            <div style="margin-bottom: 8px;">
              ${badgeTipo}
            </div>
            <h4>Planilla de Laboratorio</h4>
            <p>Cama: <strong>${escInt((meta && meta.cama) || '-')}</strong> · ${nDatos} valor(es) cargado(s) · ${nFechas} fecha(s) registrada(s)</p>
            ${renderImagenes}
          </div>
        </div>
      `;
    }

    if (esConsultorio) {
      return `
        <div class="timeline-card timeline-card-consultorio">
          <div class="timeline-card-header">
            <span class="timeline-date"><i data-lucide="calendar"></i> ${fechaFormat}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="timeline-doctor"><strong>Médico:</strong> ${escInt(h.medico)} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
              <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')" title="Ver Planilla de Consultorio en Pantalla" style="display: inline-flex; align-items: center; gap: 5px;">
                <i data-lucide="eye"></i> Ver Planilla
              </button>
              <button class="btn btn-outline btn-sm btn-print" onclick="imprimirHistoriaClinica('${escInt(h.id)}')" title="Imprimir Planilla de Evolución Médica (1 Hoja)">
                <i data-lucide="printer"></i> Imprimir Planilla
              </button>
            </div>
          </div>
          <div class="timeline-body">
            <div style="margin-bottom: 8px;">
              ${badgeTipo}
            </div>
            <h4>— Evolución Médica:</h4>
            <p style="white-space: pre-wrap; font-size: 0.92rem; line-height: 1.5;">${escInt(meta.evolucion || h.motivo_consulta || '-')}</p>

            <h4>— Indicaciones & Tratamiento:</h4>
            <p style="white-space: pre-wrap; color: var(--primary-dark); font-weight: 600; font-size: 0.92rem; line-height: 1.5;">${escInt(meta.indicaciones || h.tratamiento || '-')}</p>
            ${renderImagenes}
          </div>
        </div>
      `;
    }

    return `
      <div class="timeline-card timeline-card-hc">
        <div class="timeline-card-header">
          <span class="timeline-date"><i data-lucide="calendar"></i> ${fechaFormat}</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <span class="timeline-doctor"><strong>Médico:</strong> ${escInt(h.medico)} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
            <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')" title="Ver Historia Clínica Completa en Pantalla" style="display: inline-flex; align-items: center; gap: 5px;">
              <i data-lucide="eye"></i> Ver
            </button>
            <button class="btn btn-outline btn-sm btn-print" onclick="imprimirHistoriaClinica('${escInt(h.id)}')" title="Imprimir Historia Clínica Oficial (2 Páginas Frente y Dorso)">
              <i data-lucide="printer"></i> Imprimir Oficial
            </button>
          </div>
        </div>
        <div class="timeline-body">
          <div style="margin-bottom: 8px;">
            ${badgeTipo}
          </div>
          <h4>Motivo de Consulta / Internación:</h4>
          <p>${escInt(h.motivo_consulta || '-')}</p>

          ${(meta && meta.diagnostico_ingreso) ? `<h4>Diagnóstico de Ingreso:</h4><p><strong>${escInt(meta.diagnostico_ingreso)}</strong></p>` : (h.diagnostico ? `<h4>Diagnóstico:</h4><p><strong>${escInt(h.diagnostico)}</strong></p>` : '')}
          ${(meta && meta.diagnostico_egreso) ? `<h4>Diagnóstico de Egreso:</h4><p><strong>${escInt(meta.diagnostico_egreso)}</strong></p>` : ''}
          ${(meta && meta.motivo_egreso && meta.motivo_egreso !== 'ninguno') ? `<h4>Estado / Motivo de Egreso:</h4><p><span class="badge" style="background:#E0E7FF; color:#3730A3; font-weight:700; text-transform:uppercase;">${escInt(meta.motivo_egreso)}</span></p>` : ''}
          
          ${h.tratamiento ? `<h4>Tratamiento / Indicaciones:</h4><p>${escInt(h.tratamiento)}</p>` : ''}
          ${h.medicacion ? `<h4>Medicación:</h4><p style="color: var(--primary-dark); font-weight: 600;">${escInt(h.medicacion)}</p>` : ''}
          ${(!meta && h.observaciones) ? `<h4>Observaciones:</h4><p style="color: var(--text-muted); font-size: 0.85rem;">${escInt(h.observaciones)}</p>` : ''}
          ${renderImagenes}
        </div>
      </div>
    `;
}

// Generador de líneas punteadas para impresión oficial
function generarLineasPunteadas(cantidad) {
  let html = '';
  for (let i = 0; i < cantidad; i++) {
    html += '<div class="hc-dot-line"></div>';
  }
  return html;
}

// Disparar directamente la ventana de impresión con la Historia Clínica Oficial (Frente y Dorso)
// Dispara la impresión de #printArea de forma robusta.
// La limpieza se hace en 'afterprint' (no inmediatamente), porque en varios
// navegadores window.print() no bloquea y, si se quita la clase enseguida,
// sale una hoja en blanco o con otro contenido.
function lanzarImpresion(titulo) {
  const printArea = document.getElementById('printArea');
  const originalTitle = document.title;
  if (titulo) document.title = titulo;

  // Cerrar modales abiertos para que no se mezclen con la impresión
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  document.body.classList.remove('printing-internacion');
  document.body.classList.add('printing-hc');

  let limpiado = false;
  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    document.body.classList.remove('printing-hc');
    document.title = originalTitle;
    if (printArea) printArea.innerHTML = '';
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);

  // Pequeña espera para que el navegador aplique el DOM/CSS antes de imprimir
  setTimeout(() => {
    try {
      window.print();
    } catch (err) {
      console.error('Error al imprimir:', err);
      alert('No se pudo abrir la impresión: ' + err.message);
      limpiar();
      return;
    }
    // Respaldo por si el navegador no dispara 'afterprint'
    setTimeout(limpiar, 60000);
  }, 150);
}

function imprimirHistoriaClinica(historiaId) {
  try {
  // CRITICAL: Close all modals before printing to prevent CSS conflicts
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));

    // 1. Obtener datos directamente desde el estado local
    let h = (state.historiasList || []).find(item => String(item.id) === String(historiaId));
    if (!h) {
      alert('No se encontró el documento a imprimir. Actualizá el historial e intentá de nuevo.');
      return;
    }

    // Normalizar datos de paciente
    const p = state.selectedPacienteHistoria || (h && h.pacientes) || {};
    
    // Calcular edad si está disponible la fecha de nacimiento
    let edadCalculada = p.edad || '';
    if (!edadCalculada && (p.fecha_nacimiento || p.fecha_nac)) {
      const birth = new Date((p.fecha_nacimiento || p.fecha_nac));
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        edadCalculada = `${age} años`;
      }
    }

    const pac = {
      nombre_completo: `${fmtNombrePersona(p.apellido || '')}, ${fmtNombrePersona(p.nombre || '')}`.replace(/^,\s*|,\s*$/g, '').trim() || 'Paciente Registrado',
      dni: p.dni || '................',
      sexo: p.sexo || '................',
      edad: edadCalculada || '................',
      obra_social: p.obra_social || 'Particular',
      nro_afiliado: p.nro_afiliado || '................',
      telefono: p.telefono || '-',
      email: p.email || '-'
    };

    // Parsear metadata estructurada si está guardada en observaciones
    let meta = {};
    if (h.observaciones && typeof h.observaciones === 'string' && h.observaciones.startsWith('{')) {
      try {
        meta = JSON.parse(h.observaciones);
      } catch (e) {
        meta = {};
      }
    }

    const tipoDoc = clasificarHistoria(h);

    // FOJA QUIRÚRGICA: 2 hojas (foja + anestesia)
    if (tipoDoc === 'foja') {
      imprimirFoja(h.id);
      return;
    }

    // EPICRISIS / ENFERMERÍA / INDICACIONES
    if (PLANILLAS[tipoDoc]) {
      imprimirPlanilla(h.id);
      return;
    }

    // DOCUMENTO ADJUNTO: se imprime desde el propio archivo (PDF / imagen)
    if (tipoDoc === 'adjunto') {
      verHistoriaCompletaVirtual(h.id);
      showToast('Abrí el archivo y usá la impresión del navegador');
      return;
    }

    // SI ES PLANILLA DE LABORATORIO (1 SOLA HOJA A4)
    if (tipoDoc === 'laboratorio') {
      const printArea = document.getElementById('printArea');
      if (printArea) {
        printArea.innerHTML = `<div class="lab-print-sheet">${construirPlanillaLabHTML(h, pac.nombre_completo)}</div>`;
      }
      lanzarImpresion(pac.nombre_completo + ' — Laboratorio');
      return;
    }

    // SI ES PLANILLA DE CONSULTORIO (1 HOJA SEGÚN FORMATO MANUSCRITO)
    if (tipoDoc === 'consultorio') {
      const fechaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleDateString('es-AR') : new Date(h.fecha).toLocaleDateString('es-AR');
      const horaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '................';
      const evolucionTexto = meta.evolucion || h.motivo_consulta || '';
      const indicacionesTexto = meta.indicaciones || h.tratamiento || '';

      const printArea = document.getElementById('printArea');
      if (printArea) {
        printArea.innerHTML = `
          <!-- PÁGINA: PLANILLA DE EVOLUCIÓN MÉDICA (CONSULTORIO) -->
          <div class="hc-page hc-page-consultorio">
            
            <!-- Encabezado Membrete -->
            <div class="hc-top-header">
              <div class="hc-header-institution">
                <strong>Clínica Passo S.A.</strong>
                <span>Av. Eva Perón 3097 - Témperley</span>
                <span>Tel: 4264-0056 / 1652 · Guardia 24 hs</span>
              </div>
              <div class="hc-header-hcnum">
                <span class="hc-num-label">H.C. N°:</span>
                <span class="hc-num-val">${escInt((meta && meta.numero_hc) || pac.dni)}</span>
              </div>
            </div>

            <!-- Título Oficial -->
            <div class="hc-title-container">
              <h1 class="hc-main-heading">Evolución Médica</h1>
              <p style="font-size: 11px; text-transform: uppercase; color: #475569; margin: 2px 0 0 0; letter-spacing: 0.05em; font-weight: 600;">Atención de Consultorio Externo</p>
            </div>

            <!-- Ficha de Datos del Paciente e Información (Idéntica al Manuscrito) -->
            <div class="hc-patient-table" style="margin-bottom: 15px;">
              <div class="hc-row">
                <div class="hc-col hc-col-left">
                  <span class="hc-lbl">Nombre Paciente:</span>
                  <span class="hc-val">${escInt(pac.nombre_completo)}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">Médico Tratante:</span>
                  <span class="hc-val">${escInt(h.medico || 'Médico Tratante')} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
                </div>
              </div>

              <div class="hc-row">
                <div class="hc-col hc-col-left">
                  <span class="hc-lbl">DNI:</span>
                  <span class="hc-val">${escInt(pac.dni)}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">Obra Social:</span>
                  <span class="hc-val">${escInt(pac.obra_social)}</span>
                </div>
              </div>

              <div class="hc-row">
                <div class="hc-col hc-col-left">
                  <span class="hc-lbl">Especialidad:</span>
                  <span class="hc-val">${escInt(h.especialidad || 'Consultorio Externo')}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">N° Beneficio / Afiliado:</span>
                  <span class="hc-val">${escInt(pac.nro_afiliado)}</span>
                </div>
              </div>
            </div>

            <!-- SECCIÓN 1: EVOLUCIÓN -->
            <div class="hc-section-item" style="margin-bottom: 18px;">
              <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                — Evolución:
              </div>
              <div class="hc-sec-content" style="min-height: 260px;">
                <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${escInt(evolucionTexto)}</div>
                ${generarLineasPunteadas(8)}
              </div>
            </div>

            <!-- SECCIÓN 2: INDICACIONES -->
            <div class="hc-section-item" style="margin-bottom: 18px;">
              <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                — Indicaciones:
              </div>
              <div class="hc-sec-content" style="min-height: 200px;">
                <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${escInt(indicacionesTexto)}</div>
                ${generarLineasPunteadas(6)}
              </div>
            </div>

            <!-- PIE DE FIRMA Y FECHA (ALINEADO A LA DERECHA COMO EN EL MANUSCRITO) -->
            <div class="hc-signature-footer" style="margin-top: auto; padding-top: 25px; display: flex; justify-content: space-between; align-items: flex-end;">
              <div style="font-size: 10px; color: #64748B;">
                <span>Registro Oficial de Consultorio · Clínica Passo S.A.</span>
              </div>
              <div class="hc-sig-line" style="width: 240px; text-align: center;">
                <div style="border-top: 1.5px solid #0F172A; padding-top: 5px; margin-bottom: 3px;">
                  <strong>${escInt(h.medico || 'Médico Tratante')}</strong> ${h.matricula ? `(${escInt(h.matricula)})` : ''}<br>
                  <span>Firma y Sello Profesional</span>
                </div>
                <div style="font-size: 11px; color: #334155; margin-top: 4px;">
                  Fecha: <strong>${fechaAtencion}</strong> · ${horaAtencion} hs
                </div>
              </div>
            </div>

          </div>
        `;
      }

      lanzarImpresion(`${pac.nombre_completo} — Evolución Médica Consultorio`);
      return;
    }

    const motivo_egreso = meta.motivo_egreso || 'ninguno';
    const fecha_ingreso = meta.fecha_hora_ingreso ? new Date(meta.fecha_hora_ingreso).toLocaleDateString('es-AR') : ((h && h.fecha) ? new Date(h.fecha).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR'));
    const hora_ingreso = meta.fecha_hora_ingreso ? new Date(meta.fecha_hora_ingreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '................';
    const fecha_egreso = meta.fecha_hora_egreso ? new Date(meta.fecha_hora_egreso).toLocaleDateString('es-AR') : '................................';
    const hora_egreso = meta.fecha_hora_egreso ? new Date(meta.fecha_hora_egreso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '................';

    const diag_ingreso = meta.diagnostico_ingreso || h.diagnostico || '';
    const diag_egreso = meta.diagnostico_egreso || '';
    const enfermedad_actual = meta.enfermedad_actual || (h.observaciones && !h.observaciones.startsWith('{') ? h.observaciones : '');
    const vitals = meta.signos_vitales || {};
    const sist = meta.sistemas || {};

    // Normalizar datos de la consulta
    const consulta = {
      id: h.id || historiaId,
      fecha: h.fecha || new Date().toISOString(),
      fecha_ingreso,
      hora_ingreso,
      fecha_egreso,
      hora_egreso,
      motivo_egreso,
      medico: h.medico || 'Médico Tratante',
      especialidad: h.especialidad || 'Consulta Médica',
      matricula: h.matricula || '',
      motivo_consulta: h.motivo_consulta || '',
      diagnostico_ingreso: diag_ingreso,
      diagnostico_egreso: diag_egreso,
      enfermedad_actual: enfermedad_actual,
      tratamiento: h.tratamiento || '',
      medicacion: h.medicacion || ''
    };

    const printArea = document.getElementById('printArea');
    if (printArea) {
      printArea.innerHTML = `
        <!-- ========================================== -->
        <!-- PÁGINA 1: FRENTE — HISTORIA CLÍNICA OFICIAL -->
        <!-- ========================================== -->
        <div class="hc-page hc-page-frente">
          
          <!-- Encabezado Membrete + H.C. N° (DNI) -->
          <div class="hc-top-header">
            <div class="hc-header-institution">
              <strong>Clínica Passo S.A.</strong>
              <span>Av. Eva Perón 3097 - Témperley</span>
              <span>Tel:4264-0056/1652</span>
            </div>
            <div class="hc-header-hcnum">
              <span class="hc-num-label">H.C. N°:</span>
              <span class="hc-num-val">${escInt((meta && meta.numero_hc) || pac.dni)}</span>
            </div>
          </div>

          <!-- Título Centrado Subrayado -->
          <div class="hc-title-container">
            <h1 class="hc-main-heading">Historia Clínica</h1>
          </div>

          <!-- Ficha de Datos del Paciente e Ingreso/Egreso -->
          <div class="hc-patient-table">
            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Apellido y Nombre:</span>
                <span class="hc-val">${escInt(pac.nombre_completo)}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Sexo:</span>
                <span class="hc-val">${escInt((meta && meta.sexo) || pac.sexo)}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Edad:</span>
                <span class="hc-val">${escInt((meta && meta.edad) ? meta.edad + (/años/.test(meta.edad) ? '' : ' años') : pac.edad)}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">N° Afiliado:</span>
                <span class="hc-val">${escInt(pac.nro_afiliado)}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Obra Social:</span>
                <span class="hc-val">${escInt(pac.obra_social)}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Hora:</span>
                <span class="hc-val">${escInt(consulta.hora_ingreso)}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Fecha de Ingreso:</span>
                <span class="hc-val">${escInt(consulta.fecha_ingreso)}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Hora:</span>
                <span class="hc-val">${escInt(consulta.hora_egreso)}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left" style="flex: 1;">
                <span class="hc-lbl">Fecha de Egreso:</span>
                <span class="hc-val">${escInt(consulta.fecha_egreso)}</span>
              </div>
            </div>

            <div class="hc-row hc-egreso-row">
              <span class="hc-lbl">Motivo de Egreso:</span>
              <div class="hc-egreso-options">
                <span class="hc-opt"><span class="hc-box ${consulta.motivo_egreso === 'alta' ? 'hc-box-checked' : ''}"></span> Alta</span>
                <span class="hc-opt"><span class="hc-box ${consulta.motivo_egreso === 'traslado' ? 'hc-box-checked' : ''}"></span> Traslado</span>
                <span class="hc-opt"><span class="hc-box ${consulta.motivo_egreso === 'alta_transitoria' ? 'hc-box-checked' : ''}"></span> Alta Transitoria</span>
                <span class="hc-opt"><span class="hc-box ${consulta.motivo_egreso === 'defuncion' ? 'hc-box-checked' : ''}"></span> Defunción</span>
              </div>
            </div>
          </div>

          <!-- Secciones Clínicas Frente -->
          <div class="hc-section-group">
            <div class="hc-section-item">
              <div class="hc-sec-title">Diagnóstico de Ingreso:</div>
              <div class="hc-sec-content">
                ${consulta.diagnostico_ingreso ? `<div class="hc-text-filled">${escInt(consulta.diagnostico_ingreso)}</div>` : ''}
                ${generarLineasPunteadas(consulta.diagnostico_ingreso ? 2 : 3)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Diagnóstico de Egreso:</div>
              <div class="hc-sec-content">
                ${consulta.diagnostico_egreso ? `<div class="hc-text-filled">${escInt(consulta.diagnostico_egreso)}</div>` : ''}
                ${generarLineasPunteadas(consulta.diagnostico_egreso ? 2 : 3)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Motivo de Internación:</div>
              <div class="hc-sec-content">
                ${consulta.motivo_consulta ? `<div class="hc-text-filled">${escInt(consulta.motivo_consulta)}</div>` : ''}
                ${generarLineasPunteadas(consulta.motivo_consulta ? 2 : 4)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Enfermedad Actual:</div>
              <div class="hc-sec-content">
                ${consulta.enfermedad_actual ? `<div class="hc-text-filled">${escInt(consulta.enfermedad_actual)}</div>` : ''}
                ${generarLineasPunteadas(consulta.enfermedad_actual ? 2 : 4)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Medicación que recibe y dosis:</div>
              <div class="hc-sec-content">
                ${consulta.medicacion ? `<div class="hc-text-filled">${escInt(consulta.medicacion)}</div>` : ''}
                ${generarLineasPunteadas(consulta.medicacion ? 2 : 3)}
              </div>
            </div>
          </div>
        </div>

        <!-- ========================================== -->
        <!-- PÁGINA 2: DORSO — EXAMEN FÍSICO Y SISTEMAS -->
        <!-- ========================================== -->
        <div class="hc-page hc-page-dorso">
          
          <!-- Examen Físico General & Signos Vitales -->
          <div class="hc-dorso-vitals-box">
            <div class="hc-vital-row">
              <div class="hc-vital-main"><strong>Examen Físico General:</strong></div>
              <div class="hc-vital-cell"><strong>Peso:</strong> <span class="hc-dots">${escInt(vitals.peso || '..............')}</span></div>
              <div class="hc-vital-cell"><strong>Talla:</strong> <span class="hc-dots">${escInt(vitals.talla || '..............')}</span></div>
              <div class="hc-vital-cell"><strong>Saturación:</strong> <span class="hc-dots">${escInt(vitals.saturacion || '..............')}</span></div>
            </div>
            <div class="hc-vital-row">
              <div class="hc-vital-main"><strong>Signos Vitales:</strong></div>
              <div class="hc-vital-cell"><strong>Pulso:</strong> <span class="hc-dots">${escInt(vitals.pulso || '..............')}</span></div>
              <div class="hc-vital-cell"><strong>T.A.:</strong> <span class="hc-dots">${escInt(vitals.ta || '..............')}</span></div>
              <div class="hc-vital-cell"><strong>F.R.:</strong> <span class="hc-dots">${escInt(vitals.fr || '..............')}</span></div>
            </div>
            <div class="hc-vital-row">
              <div class="hc-vital-cell" style="flex: 1.1;"><strong>Temperatura axilar:</strong> <span class="hc-dots">${escInt(vitals.temp_axilar || '..............')}</span></div>
              <div class="hc-vital-cell" style="flex: 1.8;"><strong>Temperatura Rectal:</strong> <span class="hc-dots">${escInt(vitals.temp_rectal || '............................')}</span></div>
            </div>
          </div>

          <!-- Secciones del Dorso -->
          <div class="hc-section-group">
            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Cardiovascular:</div>
              <div class="hc-sec-content">
                ${sist.cardiovascular ? `<div class="hc-text-filled">${escInt(sist.cardiovascular)}</div>` : ''}
                ${generarLineasPunteadas(sist.cardiovascular ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Aparato Respiratorio:</div>
              <div class="hc-sec-content">
                ${sist.respiratorio ? `<div class="hc-text-filled">${escInt(sist.respiratorio)}</div>` : ''}
                ${generarLineasPunteadas(sist.respiratorio ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Abdomen:</div>
              <div class="hc-sec-content">
                ${sist.abdomen ? `<div class="hc-text-filled">${escInt(sist.abdomen)}</div>` : ''}
                ${generarLineasPunteadas(sist.abdomen ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Urogenital:</div>
              <div class="hc-sec-content">
                ${sist.urogenital ? `<div class="hc-text-filled">${escInt(sist.urogenital)}</div>` : ''}
                ${generarLineasPunteadas(sist.urogenital ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Ginecológico:</div>
              <div class="hc-sec-content">
                ${sist.ginecologico ? `<div class="hc-text-filled">${escInt(sist.ginecologico)}</div>` : ''}
                ${generarLineasPunteadas(sist.ginecologico ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Aparato Locomotor:</div>
              <div class="hc-sec-content">
                ${sist.locomotor ? `<div class="hc-text-filled">${escInt(sist.locomotor)}</div>` : ''}
                ${generarLineasPunteadas(sist.locomotor ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Neurológico:</div>
              <div class="hc-sec-content">
                ${sist.neurologico ? `<div class="hc-text-filled">${escInt(sist.neurologico)}</div>` : ''}
                ${generarLineasPunteadas(sist.neurologico ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Radiografía de Tórax/ LAB/ECG/TAC:</div>
              <div class="hc-sec-content">
                ${sist.estudios_rx ? `<div class="hc-text-filled">${escInt(sist.estudios_rx)}</div>` : ''}
                ${generarLineasPunteadas(sist.estudios_rx ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Indicaciones de Ingreso:</div>
              <div class="hc-sec-content">
                ${consulta.tratamiento ? `<div class="hc-text-filled">${escInt(consulta.tratamiento)}</div>` : ''}
                ${generarLineasPunteadas(consulta.tratamiento ? 2 : 3)}
              </div>
            </div>
          </div>

          <!-- Firma del Profesional al pie del Dorso -->
          <div class="hc-signature-footer">
            <div class="hc-sig-line">
              <strong>${escInt(consulta.medico)}</strong> ${consulta.matricula ? `(${escInt(consulta.matricula)})` : ''}<br>
              <span>Firma y Sello Profesional</span>
            </div>
          </div>
        </div>
      `;
    }

    // Título = Apellido y Nombre del paciente; imprimir con limpieza en 'afterprint'
    lanzarImpresion(`${pac.nombre_completo} — Historia Clínica`);

  } catch (err) {
    alert(`Error al abrir impresión: ${err.message}`);
  }
}

function irAHistoriaPacientePorId(pacienteId) {
  const navItem = document.querySelector('[data-tab="historias-tab"]');
  if (navItem) navItem.click();

  const paciente = state.pacientesList.find(p => p.id === pacienteId);
  if (paciente) {
    document.getElementById('historiaDniSearch').value = paciente.dni;
    searchPacienteParaHistoria();
  }
}

// ==========================================
// 6. FORMULARIOS & MODALES DE CREACIÓN
// ==========================================
let returningToModalTurno = false;

function openCreateModal() {
  if (state.currentTab === 'calendario-tab' || state.currentTab === 'turnos-tab') {
    if (!state.pacientesList || state.pacientesList.length === 0) {
      cargarPacientes();
    }
    deseleccionarPacienteTurno();
    openModal('modalTurno');
    const fechaInput = document.getElementById('turnoFecha');
    if (fechaInput && currentSelectedDay && state.currentTab === 'calendario-tab') {
      fechaInput.value = `${currentSelectedDay}T09:00`;
    }
  } else if (state.currentTab === 'pacientes-tab') {
    openModalNuevoPaciente();
  } else if (state.currentTab === 'historias-tab') {
    openModalNuevaEvolucion();
  }
}

function openModal(modalId) {
  if (modalId === 'modalTurno') prepararSelectorMedico().then(() => cargarHorariosTurno(true));
  const m = document.getElementById(modalId);
  if (m) m.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function closeModal(modalId) {
  const m = document.getElementById(modalId);
  if (m) m.classList.add('hidden');
  if (modalId === 'modalPaciente' && returningToModalTurno) {
    returningToModalTurno = false;
    openModal('modalTurno');
  }
}

function openModalNuevoPaciente() {
  document.getElementById('formNuevoPaciente').reset();
  openModal('modalPaciente');
}

function openModalNuevoPacienteFromTurno(e) {
  if (e && e.preventDefault) e.preventDefault();
  returningToModalTurno = true;
  closeModal('modalTurno');
  openModalNuevoPaciente();
}

function openModalTurnoConPaciente(pacienteId) {
  openModal('modalTurno');
  seleccionarPacienteParaTurno(pacienteId);
}

// ========================================================
// AUTOCOMPLETE & BÚSQUEDA RÁPIDA DE PACIENTES POR DNI/NOMBRE
// ========================================================

function mostrarListaPacientesTurno() {
  const searchInput = document.getElementById('turnoPacienteSearch');
  filtrarPacientesParaTurno(searchInput ? searchInput.value : '');
}

function filtrarPacientesParaTurno(query = '') {
  const dropdown = document.getElementById('patientDropdownList');
  if (!dropdown) return;

  const pacientes = state.pacientesList || [];
  const q = query.toLowerCase().trim();
  const qCleanDni = q.replace(/\D/g, '');

  let filtrados = [];
  if (!q) {
    filtrados = pacientes.slice(0, 10);
  } else {
    filtrados = pacientes.filter(p => {
      const nombreCompleto = `${p.apellido || ''} ${p.nombre || ''}`.toLowerCase();
      const dni = (p.dni || '').replace(/\D/g, '');
      const obra = (p.obra_social || '').toLowerCase();
      return (
        nombreCompleto.includes(q) ||
        (qCleanDni && dni.includes(qCleanDni)) ||
        obra.includes(q)
      );
    }).slice(0, 12);
  }

  if (filtrados.length === 0) {
    dropdown.innerHTML = `
      <div class="patient-dropdown-empty">
        <i data-lucide="user-x" style="width: 24px; height: 24px; margin: 0 auto 6px; color: #94A3B8;"></i>
        <div>No se encontró ningún paciente con: <strong>${escInt(query)}</strong></div>
      </div>
      <button type="button" class="patient-dropdown-create-btn" onclick="crearPacienteDesdeSearch(${jsArg(qCleanDni || query)})">
        <i data-lucide="user-plus"></i> + Registrar nuevo paciente con este dato
      </button>
    `;
    dropdown.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  let html = '';
  filtrados.forEach(p => {
    const nombre = `${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente';
    const dni = p.dni || 'S/D';
    const obra = p.obra_social || 'Particular';

    html += `
      <div class="patient-dropdown-item" onclick="seleccionarPacienteParaTurno('${escInt(p.id)}')">
        <div>
          <div class="patient-item-name">${escInt(nombre)}</div>
          <div style="margin-top: 2px;">
            <span class="patient-item-dni">DNI: ${escInt(dni)}</span>
            <span class="patient-item-cov">${escInt(obra)}</span>
          </div>
        </div>
        <i data-lucide="check" style="width: 16px; height: 16px; color: var(--primary); opacity: 0.6;"></i>
      </div>
    `;
  });

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function seleccionarPacienteParaTurno(pacienteId) {
  const p = (state.pacientesList || []).find(item => String(item.id) === String(pacienteId));
  if (!p) return;

  const hiddenInput = document.getElementById('turnoPacienteSelect');
  const searchBox = document.getElementById('patientSearchBoxWrap');
  const selectedCard = document.getElementById('patientSelectedCard');
  const dropdown = document.getElementById('patientDropdownList');
  const nameEl = document.getElementById('selectedPatientName');
  const metaEl = document.getElementById('selectedPatientMeta');

  if (hiddenInput) hiddenInput.value = p.id;
  if (nameEl) nameEl.textContent = `${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente';
  if (metaEl) metaEl.textContent = `DNI: ${p.dni || 'S/D'} · ${p.obra_social || 'Particular'} ${p.telefono ? `· Tel: ${p.telefono}` : ''}`;

  if (searchBox) searchBox.classList.add('hidden');
  if (selectedCard) selectedCard.classList.remove('hidden');
  if (dropdown) dropdown.classList.add('hidden');
}

function deseleccionarPacienteTurno() {
  const hiddenInput = document.getElementById('turnoPacienteSelect');
  const searchBox = document.getElementById('patientSearchBoxWrap');
  const selectedCard = document.getElementById('patientSelectedCard');
  const searchInput = document.getElementById('turnoPacienteSearch');

  if (hiddenInput) hiddenInput.value = '';
  if (selectedCard) selectedCard.classList.add('hidden');
  if (searchBox) searchBox.classList.remove('hidden');
  if (searchInput) {
    searchInput.value = '';
  }
}

function limpiarSeleccionPacienteTurno() {
  deseleccionarPacienteTurno();
}

function crearPacienteDesdeSearch(dato) {
  const dropdown = document.getElementById('patientDropdownList');
  if (dropdown) dropdown.classList.add('hidden');
  
  openModalNuevoPacienteFromTurno();
  
  const isNumeric = /^\d+$/.test(dato);
  if (isNumeric) {
    const dniInput = document.getElementById('pacienteDni');
    if (dniInput) dniInput.value = dato;
  } else if (dato) {
    const apeInput = document.getElementById('pacienteApellido');
    if (apeInput) apeInput.value = dato;
  }
}

// Cerrar dropdown de búsqueda si se hace clic afuera
document.addEventListener('click', (e) => {
  const picker = document.getElementById('patientPickerWrap');
  const dropdown = document.getElementById('patientDropdownList');
  if (dropdown && picker && !picker.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// Archivos adjuntos (fotos / PDFs / Rx) en Supabase Storage.
// El panel NO tiene ninguna clave de Supabase: le pide al backend permisos
// temporales (URLs firmadas) para subir y para ver cada archivo.

// Sube un archivo y devuelve su nombre dentro del bucket
async function subirArchivoAlStorage(file, prefijo = '') {
  const res = await apiFetch('/archivos/subida', {
    method: 'POST',
    body: JSON.stringify({ nombre: file.name, tipo: file.type, prefijo })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo preparar la subida');

  const form = new FormData();
  form.append('cacheControl', '3600');
  form.append('', file);
  const subida = await fetch(data.signedUrl, { method: 'PUT', headers: { 'x-upsert': 'false' }, body: form });
  if (!subida.ok) throw new Error('El almacenamiento rechazó el archivo');
  return data.path;
}

// Cache de URLs firmadas (valen 2 h en el servidor; acá se reusan 90 min)
const cacheUrlsFirmadas = new Map();
const cacheAutoresArchivos = new Map();   // archivo → { nombre, numero, fecha } de quien lo subió
const urlAPathArchivo = new Map();         // URL firmada → archivo (para encontrar su autor)

function textoAutorArchivo(pathOUrl) {
  const a = cacheAutoresArchivos.get(pathOUrl);
  if (!a || !a.nombre) return '';
  const f = a.fecha ? new Date(a.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  return `Subido por ${a.nombre}${a.numero ? ' (ID ' + a.numero + ')' : ''}${f ? ' · ' + f : ''}`;
}

let attachedFilesState = [];

// Prevenir que el navegador abra archivos si se arrastran fuera del área
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => e.preventDefault(), false);

function handleDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('histDropzone');
  if (dropzone) dropzone.classList.add('dragover');
}

function handleDragLeave(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('histDropzone');
  if (dropzone) dropzone.classList.remove('dragover');
}

function handleFileDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('histDropzone');
  if (dropzone) dropzone.classList.remove('dragover');

  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    subirArchivosASupabase(Array.from(e.dataTransfer.files));
  }
}

function handleFileUpload(event) {
  if (event.target.files && event.target.files.length > 0) {
    subirArchivosASupabase(Array.from(event.target.files));
  }
  event.target.value = '';
}

// Firma varios archivos en UN solo pedido. Devuelve las URLs en el mismo orden
// (vacío si alguno no se pudo firmar). Los links externos se devuelven tal cual.
async function obtenerUrlsFirmadas(lista) {
  const entradas = (lista || []).filter(Boolean);
  const esNuestro = (u) => !u.startsWith('http') || u.includes('.supabase.co');
  const faltan = [...new Set(entradas.filter(u => esNuestro(u) && !(cacheUrlsFirmadas.get(u) && cacheUrlsFirmadas.get(u).vence > Date.now())))];

  for (let i = 0; i < faltan.length; i += 50) {
    const lote = faltan.slice(i, i + 50);
    try {
      const res = await apiFetch('/archivos/firmar', { method: 'POST', body: JSON.stringify({ paths: lote }) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      Object.entries(data.urls || {}).forEach(([orig, url]) => {
        cacheUrlsFirmadas.set(orig, { url, vence: Date.now() + 90 * 60 * 1000 });
      });
      Object.entries(data.autores || {}).forEach(([orig, autor]) => cacheAutoresArchivos.set(orig, autor));
      Object.entries(data.urls || {}).forEach(([orig, url]) => urlAPathArchivo.set(url, orig));
    } catch (err) {
      console.warn('No se pudo obtener acceso a los adjuntos:', err.message);
    }
  }
  return entradas.map(u => esNuestro(u) ? ((cacheUrlsFirmadas.get(u) || {}).url || '') : u);
}

// Devuelve una URL temporal para ver un archivo adjunto (links externos se devuelven tal cual)
async function obtenerUrlFirmada(fileUrlOrPath) {
  if (!fileUrlOrPath) return '';
  const esNuestro = !fileUrlOrPath.startsWith('http') || fileUrlOrPath.includes('.supabase.co');
  if (!esNuestro) return fileUrlOrPath;

  const cache = cacheUrlsFirmadas.get(fileUrlOrPath);
  if (cache && cache.vence > Date.now()) return cache.url;

  try {
    const res = await apiFetch('/archivos/firmar', {
      method: 'POST',
      body: JSON.stringify({ paths: [fileUrlOrPath] })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const url = data.urls && data.urls[fileUrlOrPath];
    if (!url) throw new Error('Archivo no encontrado');
    cacheUrlsFirmadas.set(fileUrlOrPath, { url, vence: Date.now() + 90 * 60 * 1000 });
    return url;
  } catch (err) {
    console.warn('No se pudo obtener el acceso al archivo:', err.message);
    return '';
  }
}

// Subir directamente a Supabase Storage con bucket privado y firma temporal
async function subirArchivosASupabase(files) {
  const listContainer = document.getElementById('histAttachedFilesList');
  if (!listContainer) return;

  for (const file of files) {
    const tempId = 'file_' + Math.random().toString(36).substr(2, 9);
    
    // Renderizar estado de carga inmediato
    const loadingChip = document.createElement('div');
    loadingChip.id = tempId;
    loadingChip.className = 'attached-file-chip';
    loadingChip.innerHTML = `
      <i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px; color: var(--primary);"></i>
      <span class="chip-name">Cifrando y subiendo ${escInt(file.name)}...</span>
    `;
    listContainer.appendChild(loadingChip);
    if (window.lucide) window.lucide.createIcons();

    try {
      const uniqueFileName = await subirArchivoAlStorage(file, '');

      // Obtener URL firmada segura para la vista previa del médico
      const signedUrl = await obtenerUrlFirmada(uniqueFileName);

      attachedFilesState.push({
        id: tempId,
        name: file.name,
        storagePath: uniqueFileName,
        url: signedUrl,
        isPdf: file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')
      });

      syncAttachedFilesUI();
      showToast(`Archivo "${file.name}" protegido y subido a la nube`);
    } catch (err) {
      alert(`Error al subir ${file.name}: ${err.message}`);
      const el = document.getElementById(tempId);
      if (el) el.remove();
    }
  }
}

function removeAttachedFile(fileId) {
  attachedFilesState = attachedFilesState.filter(f => f.id !== fileId);
  syncAttachedFilesUI();
}

function syncAttachedFilesUI() {
  const listContainer = document.getElementById('histAttachedFilesList');
  const textarea = document.getElementById('histImagenes');
  if (!listContainer) return;

  listContainer.innerHTML = '';
  const urls = [];

  attachedFilesState.forEach(f => {
    urls.push(f.url);
    const chip = document.createElement('div');
    chip.className = 'attached-file-chip';
    chip.innerHTML = `
      ${f.isPdf 
        ? '<i data-lucide="file-text" style="width: 20px; height: 20px; color: #EF4444;"></i>'
        : `<img src="${escInt(urlSegura(f.url))}" alt="${escInt(f.name)}">`
      }
      <span class="chip-name" title="${escInt(f.name)}">${escInt(f.name)}</span>
      <button type="button" class="btn-chip-remove" onclick="removeAttachedFile('${f.id}')" title="Eliminar adjunto">
        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
      </button>
    `;
    listContainer.appendChild(chip);
  });

  if (textarea) textarea.value = urls.join('\n');
  if (window.lucide) window.lucide.createIcons();
}

// --- FUNCIONES MINIMALISTAS DE ADJUNTOS ---

function toggleLinkInput() {
  const wrap = document.getElementById('histLinkInputWrap');
  if (wrap) {
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) {
      document.getElementById('histLinkSingle').focus();
    }
  }
}

function agregarLinkManual() {
  const input = document.getElementById('histLinkSingle');
  const url = input.value.trim();
  if (!url) return;

  const id = 'link_' + Date.now();
  const isPortal = url.startsWith('http');
  attachedFilesState.push({
    id,
    name: url.length > 40 ? url.substring(0, 37) + '...' : url,
    url,
    storagePath: url,
    isPdf: url.toLowerCase().includes('.pdf'),
    isLink: true
  });
  syncAttachedFilesUI();
  input.value = '';
  showToast('Link agregado ✓');
}

async function pegarDesdePortapapeles() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], `captura_${Date.now()}.png`, { type: imageType });
        // Reutilizar la función existente de subida
        await subirArchivosASupabase([file]);
        showToast('Imagen pegada y subida ✓');
        return;
      }
    }
    showToast('No hay imagen en el portapapeles');
  } catch (err) {
    showToast('No se pudo acceder al portapapeles');
  }
}

// ========================================================
// MANEJO DE PLANILLA DE EVOLUCIÓN MÉDICA (CONSULTORIO)
// ========================================================
let attachedFilesConsulState = [];

function handleDragOverConsul(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('consulDropzone');
  if (dropzone) dropzone.classList.add('dragover');
}

function handleDragLeaveConsul(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('consulDropzone');
  if (dropzone) dropzone.classList.remove('dragover');
}

function handleFileDropConsul(e) {
  e.preventDefault();
  e.stopPropagation();
  const dropzone = document.getElementById('consulDropzone');
  if (dropzone) dropzone.classList.remove('dragover');

  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    subirArchivosConsulASupabase(Array.from(e.dataTransfer.files));
  }
}

function handleFileUploadConsul(event) {
  if (event.target.files && event.target.files.length > 0) {
    subirArchivosConsulASupabase(Array.from(event.target.files));
  }
  event.target.value = '';
}

async function subirArchivosConsulASupabase(files) {
  const listContainer = document.getElementById('consulAttachedFilesList');
  if (!listContainer) return;

  for (const file of files) {
    const tempId = 'consul_file_' + Math.random().toString(36).substr(2, 9);
    
    const loadingChip = document.createElement('div');
    loadingChip.id = tempId;
    loadingChip.className = 'attached-file-chip';
    loadingChip.innerHTML = `
      <i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px; color: var(--primary);"></i>
      <span class="chip-name">Subiendo ${escInt(file.name)}...</span>
    `;
    listContainer.appendChild(loadingChip);
    if (window.lucide) window.lucide.createIcons();

    try {
      const uniqueFileName = await subirArchivoAlStorage(file, 'consul_');

      const signedUrl = await obtenerUrlFirmada(uniqueFileName);

      attachedFilesConsulState.push({
        id: tempId,
        name: file.name,
        storagePath: uniqueFileName,
        url: signedUrl,
        isPdf: file.type.includes('pdf') || file.name.toLowerCase().endsWith('.pdf')
      });

      syncAttachedFilesConsulUI();
      showToast(`Archivo "${file.name}" subido a la nube`);
    } catch (err) {
      alert(`Error al subir ${file.name}: ${err.message}`);
      const el = document.getElementById(tempId);
      if (el) el.remove();
    }
  }
}

function removeAttachedFileConsul(fileId) {
  attachedFilesConsulState = attachedFilesConsulState.filter(f => f.id !== fileId);
  syncAttachedFilesConsulUI();
}

function syncAttachedFilesConsulUI() {
  const listContainer = document.getElementById('consulAttachedFilesList');
  if (!listContainer) return;

  listContainer.innerHTML = '';
  attachedFilesConsulState.forEach(f => {
    const chip = document.createElement('div');
    chip.className = 'attached-file-chip';
    chip.innerHTML = `
      ${f.isPdf 
        ? '<i data-lucide="file-text" style="width: 20px; height: 20px; color: #EF4444;"></i>'
        : `<img src="${escInt(urlSegura(f.url))}" alt="${escInt(f.name)}">`
      }
      <span class="chip-name" title="${escInt(f.name)}">${escInt(f.name)}</span>
      <button type="button" class="btn-chip-remove" onclick="removeAttachedFileConsul('${f.id}')" title="Eliminar adjunto">
        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
      </button>
    `;
    listContainer.appendChild(chip);
  });

  if (window.lucide) window.lucide.createIcons();
}

function openModalEvolucionConsultorio() {
  if (!state.selectedPacienteHistoria) {
    alert('Por favor primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.');
    return;
  }
  const p = state.selectedPacienteHistoria;
  document.getElementById('formEvolucionConsultorio').reset();
  attachedFilesConsulState = [];
  syncAttachedFilesConsulUI();

  // Precargar resumen de paciente
  document.getElementById('consulNombrePaciente').textContent = `${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente';
  document.getElementById('consulDniPaciente').textContent = p.dni || '-';
  document.getElementById('consulObraSocial').textContent = p.obra_social || 'Particular';
  document.getElementById('consulNroAfiliado').textContent = p.nro_afiliado || '-';

  // Precargar fecha y hora actual
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const localIso = `${year}-${month}-${day}T${hours}:${minutes}`;

  const fechaInput = document.getElementById('consulFechaHora');
  if (fechaInput) fechaInput.value = localIso;

  openModal('modalEvolucionConsultorio');
}

async function guardarEvolucionConsultorio(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarConsul');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const paciente_id = state.selectedPacienteHistoria.id;
  const medico = document.getElementById('consulMedico').value.trim();
  const especialidad = document.getElementById('consulEspecialidad').value.trim();
  const matricula = document.getElementById('consulMatricula').value.trim();
  const fecha_hora = document.getElementById('consulFechaHora').value;
  const evolucion = document.getElementById('consulEvolucion').value.trim();
  const indicaciones = document.getElementById('consulIndicaciones').value.trim();

  let imagenesArray = [];
  if (attachedFilesConsulState && attachedFilesConsulState.length > 0) {
    imagenesArray = attachedFilesConsulState.map(f => f.storagePath || f.url);
  }

  const metadataConsul = {
    tipo_planilla: 'evolucion_consultorio',
    fecha_hora,
    medico,
    especialidad,
    matricula,
    evolucion,
    indicaciones,
    imagenes: imagenesArray
  };

  try {
    const res = await apiFetch('/historias-clinicas', {
      method: 'POST',
      body: JSON.stringify({
        paciente_id,
        medico,
        matricula: matricula || null,
        especialidad: especialidad || 'Consultorio Externo',
        motivo_consulta: evolucion.slice(0, 120) || 'Evolución de Consultorio',
        diagnostico: 'Atención en Consultorio',
        tratamiento: indicaciones || null,
        medicacion: indicaciones || null,
        observaciones: JSON.stringify(metadataConsul),
        imagenes: imagenesArray
      })
    });
    if (!res.ok) throw new Error('Error al guardar la planilla de evolución médica');

    showToast('Planilla de evolución médica guardada con éxito');
    closeModal('modalEvolucionConsultorio');
    document.getElementById('formEvolucionConsultorio').reset();
    attachedFilesConsulState = [];
    syncAttachedFilesConsulUI();
    cargarHistoriasDePaciente(paciente_id);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar Evolución de Consultorio';
    if (window.lucide) window.lucide.createIcons();
  }
}

function openModalNuevaEvolucion() {
  if (!state.selectedPacienteHistoria) {
    alert('Por favor primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.');
    return;
  }
  document.getElementById('formNuevaEvolucion').reset();
  attachedFilesState = [];
  syncAttachedFilesUI();

  // Precargar fecha y hora de ingreso con la actual
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const localIso = `${year}-${month}-${day}T${hours}:${minutes}`;

  const ingresoInput = document.getElementById('histFechaHoraIngreso');
  if (ingresoInput) ingresoInput.value = localIso;

  // Edad calculada con la fecha de nacimiento del padrón (se puede corregir a mano)
  const pac = state.selectedPacienteHistoria;
  const edadInput = document.getElementById('histEdad');
  if (edadInput) edadInput.value = edadDesdeNacimiento(pac.fecha_nac || pac.fecha_nacimiento);
  const sexoInput = document.getElementById('histSexo');
  if (sexoInput && pac.sexo) sexoInput.value = String(pac.sexo).charAt(0).toUpperCase();

  openModal('modalEvolucion');
}

// Guardar Turno
async function guardarNuevoTurno(e, forzar = false) {
  if (e) e.preventDefault();
  const btn = document.getElementById('btnGuardarTurno');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const paciente_id = document.getElementById('turnoPacienteSelect').value;
  const especialidad = document.getElementById('turnoEspecialidad').value;
  const selMedico = document.getElementById('turnoMedicoId');
  const medico_id = selMedico ? selMedico.value : '';
  const medico = medico_id && selMedico.selectedOptions[0] ? selMedico.selectedOptions[0].dataset.nombre : '';
  const fecha_turno = document.getElementById('turnoFecha').value;
  let estado = document.getElementById('turnoEstado').value;
  if (estado === 'aceptado') estado = 'confirmado';
  if (estado === 'rechazado') estado = 'cancelado';
  const notas = document.getElementById('turnoNotas').value.trim();

  if (!paciente_id) {
    alert('Por favor seleccioná un paciente de la lista. Si es un paciente nuevo, podés registrarlo haciendo clic en "¿No está registrado? Crear paciente nuevo aquí".');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Agendar Turno';
    return;
  }

  if (!especialidad) {
    alert('Por favor seleccioná una especialidad médica.');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Agendar Turno';
    return;
  }

  if (!fecha_turno) {
    alert('Por favor seleccioná la fecha y hora para el turno.');
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Agendar Turno';
    return;
  }

  try {
    const res = await apiFetch('/turnos', {
      method: 'POST',
      body: JSON.stringify({ paciente_id, especialidad, medico, medico_id: medico_id || null, fecha_turno, estado, notas, forzar: forzar || undefined })
    });
    const data = await res.json().catch(() => ({}));
    // Horario encimado o fuera de la agenda del médico: se pregunta si va como sobreturno
    if (res.status === 409 && data.conflicto) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="save"></i> Agendar Turno';
      if (confirmarSobreturno(data)) return guardarNuevoTurno(null, true);
      cargarHorariosTurno(false);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'Error al agendar turno');
    
    showToast('Turno agendado con éxito');
    closeModal('modalTurno');
    document.getElementById('formNuevoTurno').reset();
    deseleccionarPacienteTurno();
    await cargarTodosLosTurnosParaCalendario();   // recarga el calendario y el panel del día
  } catch (err) {
    alert(`Error al agendar turno: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Agendar Turno';
    if (window.lucide) window.lucide.createIcons();
  }
}

// Guardar Paciente
async function guardarNuevoPaciente(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarPaciente');
  btn.disabled = true;
  btn.textContent = 'Registrando...';

  const nombre = document.getElementById('pacienteNombre').value.trim();
  const apellido = document.getElementById('pacienteApellido').value.trim();
  const dni = document.getElementById('pacienteDni').value.trim();
  const fecha_nac = document.getElementById('pacienteFechaNac').value || null;
  const telefono = document.getElementById('pacienteTelefono').value.trim();
  const email = document.getElementById('pacienteEmail').value.trim();
  const obra_social = document.getElementById('pacienteObraSocial').value.trim();
  const nro_afiliado = document.getElementById('pacienteNroAfiliado').value.trim();
  const familiar_nombre = (document.getElementById('pacienteAcompNombre') || {}).value?.trim() || '';
  const familiar_telefono = (document.getElementById('pacienteAcompTel') || {}).value?.trim() || '';

  try {
    const res = await apiFetch('/pacientes', {
      method: 'POST',
      body: JSON.stringify({ nombre, apellido, dni, fecha_nac, telefono, email, obra_social, nro_afiliado, familiar_nombre, familiar_telefono })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al registrar paciente');
    }

    showToast('Paciente registrado con éxito');
    closeModal('modalPaciente');
    document.getElementById('formNuevoPaciente').reset();
    await cargarPacientes();

    // Si veníamos desde el modal de turnos, seleccionamos automáticamente al nuevo paciente y reabrimos el modal
    if (returningToModalTurno && data && data.id) {
      returningToModalTurno = false;
      const sel = document.getElementById('turnoPacienteSelect');
      if (sel) {
        sel.value = data.id;
      }
      openModal('modalTurno');
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Registrar Paciente';
    if (window.lucide) window.lucide.createIcons();
  }
}

// Guardar Historia Clínica Oficial con soporte completo de Frente y Dorso
async function guardarNuevaEvolucion(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarEvolucion');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const paciente_id = state.selectedPacienteHistoria.id;
  const medico = document.getElementById('histMedico').value.trim();
  const especialidad = document.getElementById('histEspecialidad').value.trim();
  const matricula = document.getElementById('histMatricula').value.trim();
  const motivo_egreso = document.getElementById('histMotivoEgreso').value;
  const fecha_hora_ingreso = document.getElementById('histFechaHoraIngreso').value;
  const fecha_hora_egreso = document.getElementById('histFechaHoraEgreso').value;

  const motivo_consulta = document.getElementById('histMotivo').value.trim();
  const diagnostico_ingreso = document.getElementById('histDiagnosticoIngreso').value.trim();
  const diagnostico_egreso = document.getElementById('histDiagnosticoEgreso').value.trim();
  const enfermedad_actual = document.getElementById('histEnfermedadActual').value.trim();
  const medicacion = document.getElementById('histMedicacion').value.trim();

  // Signos Vitales (Dorso)
  const signos_vitales = {
    peso: document.getElementById('histPeso').value.trim(),
    talla: document.getElementById('histTalla').value.trim(),
    saturacion: document.getElementById('histSaturacion').value.trim(),
    pulso: document.getElementById('histPulso').value.trim(),
    ta: document.getElementById('histTA').value.trim(),
    fr: document.getElementById('histFR').value.trim(),
    temp_axilar: document.getElementById('histTempAxilar').value.trim(),
    temp_rectal: document.getElementById('histTempRectal').value.trim()
  };

  // Exámenes por Sistemas (Dorso)
  const sistemas = {
    cardiovascular: document.getElementById('histCardiovascular').value.trim(),
    respiratorio: document.getElementById('histRespiratorio').value.trim(),
    abdomen: document.getElementById('histAbdomen').value.trim(),
    urogenital: document.getElementById('histUrogenital').value.trim(),
    ginecologico: document.getElementById('histGinecologico').value.trim(),
    locomotor: document.getElementById('histLocomotor').value.trim(),
    neurologico: document.getElementById('histNeurologico').value.trim(),
    estudios_rx: document.getElementById('histEstudiosRx').value.trim()
  };

  const tratamiento = document.getElementById('histIndicacionesIngreso').value.trim();

  // Combinar archivos adjuntos subidos con links externos de RDA/Portales pegados manualmente
  let imagenesArray = [];
  if (attachedFilesState && attachedFilesState.length > 0) {
    imagenesArray = attachedFilesState.map(f => f.storagePath || f.url);
  }
  const imagenesRaw = document.getElementById('histImagenes').value.trim();
  if (imagenesRaw) {
    const manualLinks = imagenesRaw.split(/[\n,]+/).map(url => url.trim()).filter(url => url.length > 0);
    imagenesArray = [...imagenesArray, ...manualLinks];
  }
  // Eliminar duplicados
  imagenesArray = [...new Set(imagenesArray)];

  // Empaquetar metadata estructurada
  const metadataHC = {
    tipo: 'hc_oficial_v2',
    numero_hc: (document.getElementById('histNumeroHC') || {}).value?.trim() || '',
    edad: (document.getElementById('histEdad') || {}).value?.trim() || '',
    sexo: (document.getElementById('histSexo') || {}).value || '',
    motivo_egreso,
    fecha_hora_ingreso,
    fecha_hora_egreso,
    diagnostico_ingreso,
    diagnostico_egreso,
    enfermedad_actual,
    signos_vitales,
    sistemas,
    imagenes: imagenesArray
  };

  try {
    const res = await apiFetch('/historias-clinicas', {
      method: 'POST',
      body: JSON.stringify({
        paciente_id,
        medico,
        matricula: matricula || null,
        especialidad: especialidad || null,
        motivo_consulta,
        diagnostico: diagnostico_ingreso || diagnostico_egreso || 'Evaluación médica',
        tratamiento: tratamiento || null,
        medicacion: medicacion || null,
        observaciones: JSON.stringify(metadataHC),
        imagenes: imagenesArray
      })
    });
    if (!res.ok) throw new Error('Error al registrar historia clínica');

    showToast('Historia clínica oficial guardada con éxito');
    closeModal('modalEvolucion');
    document.getElementById('formNuevaEvolucion').reset();
    attachedFilesState = [];
    syncAttachedFilesUI();
    cargarHistoriasDePaciente(paciente_id);
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i> Guardar Historia Clínica Completa';
    if (window.lucide) window.lucide.createIcons();
  }
}

// ========================================================
// VISOR VIRTUAL DE HISTORIA CLÍNICA COMPLETA
// ========================================================
async function verHistoriaCompletaVirtual(historiaId) {
  let h = (state.historiasList || []).find(item => String(item.id) === String(historiaId));
  if (!h) {
    alert('Historia clínica no encontrada.');
    return;
  }

  const p = state.selectedPacienteHistoria || h.pacientes || {};
  const pacNombre = `${fmtNombrePersona(p.apellido || '')}, ${fmtNombrePersona(p.nombre || '')}`.replace(/^,\s*|,\s*$/g, '').trim() || 'Paciente Registrado';

  const subtitleEl = document.getElementById('viewerHcSubtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `Paciente: ${pacNombre} (DNI: ${p.dni || '-'}) — Consulta del ${new Date(h.fecha).toLocaleDateString('es-AR')}`;
  }

  const btnPrint = document.getElementById('btnViewerImprimir');
  if (btnPrint) {
    btnPrint.onclick = () => {
      closeModal('modalVerHistoriaVirtual');
      imprimirHistoriaClinica(h.id);
    };
  }

  let meta = {};
  if (h.observaciones && typeof h.observaciones === 'string' && h.observaciones.startsWith('{')) {
    try { meta = JSON.parse(h.observaciones); } catch (e) { meta = {}; }
  }

  const vitals = meta.signos_vitales || {};
  const sist = meta.sistemas || {};
  
  let signedImgs = h._signedImagenes || [];
  if (signedImgs.length === 0) {
    const rawList = h._rawImagenes || (meta && meta.imagenes) || [];
    if (rawList && rawList.length > 0) {
      signedImgs = (await obtenerUrlsFirmadas(rawList)).filter(Boolean);
      h._signedImagenes = signedImgs;
    }
  }

  const content = document.getElementById('viewerHcContent');
  if (!content) return;

  const tipoDoc = clasificarHistoria(h);

  // EPICRISIS / ENFERMERÍA / INDICACIONES: la hoja tal como se imprime
  if (PLANILLAS[tipoDoc]) {
    if (subtitleEl) subtitleEl.textContent = `${PLANILLAS[tipoDoc].titulo} — Paciente: ${pacNombre} (DNI: ${p.dni || '-'})`;
    content.innerHTML = `<div class="foja-visor">${hojaPlanillaHTML(h, tipoDoc, { nombre_completo: pacNombre, dni: p.dni })}</div>`;
    const btnImp = document.getElementById('btnViewerImprimir');
    if (btnImp) btnImp.style.display = '';
    openModal('modalVerHistoriaVirtual');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // FOJA QUIRÚRGICA: las 2 hojas tal como se imprimen
  if (tipoDoc === 'foja') {
    if (subtitleEl) subtitleEl.textContent = `Foja Quirúrgica — Paciente: ${pacNombre} (DNI: ${p.dni || '-'})`;
    content.innerHTML = `<div class="foja-visor">${construirFojaHTML(h, { nombre_completo: pacNombre, dni: p.dni })}</div>`;
    const btnImp = document.getElementById('btnViewerImprimir');
    if (btnImp) btnImp.style.display = '';
    openModal('modalVerHistoriaVirtual');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // DOCUMENTO ADJUNTO: título, datos y archivos en grande
  if (tipoDoc === 'adjunto') {
    await obtenerUrlsFirmadas((meta.archivos || []).filter(x => !x.esLink).map(x => x.path).concat(meta.archivos ? [] : (meta.imagenes || [])));
    if (subtitleEl) subtitleEl.textContent = `Documento adjunto — Paciente: ${pacNombre} (DNI: ${p.dni || '-'})`;
    content.innerHTML = `
      <div class="adj-visor">
        <span class="badge-adjunto"><i data-lucide="paperclip"></i> ${escInt(meta.categoria || 'Documento')}</span>
        <h2>${escInt(meta.titulo || h.motivo_consulta || 'Documento')}</h2>
        <p class="adj-visor-meta">Fecha del documento: <strong>${fmtFechaDoc(meta.fecha_documento) || '-'}</strong> · Cargado el ${new Date(h.fecha).toLocaleDateString('es-AR')}</p>
        ${meta.notas ? `<div class="adj-visor-notas">${escInt(meta.notas)}</div>` : ''}
        ${htmlArchivosAdjunto(meta, true)}
      </div>`;
    const btnImp = document.getElementById('btnViewerImprimir');
    if (btnImp) btnImp.style.display = 'none';
    openModal('modalVerHistoriaVirtual');
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  { const btnImp = document.getElementById('btnViewerImprimir'); if (btnImp) btnImp.style.display = ''; }

  // SI ES PLANILLA DE LABORATORIO: mostrar la planilla real con los valores cargados
  if (tipoDoc === 'laboratorio') {
    if (subtitleEl) {
      subtitleEl.textContent = `Laboratorio — Paciente: ${pacNombre} (DNI: ${p.dni || '-'}) — Registro del ${new Date(h.fecha).toLocaleDateString('es-AR')}`;
    }
    content.innerHTML = `
      <div class="lab-viewer-wrap">
        <div class="lab-print-sheet lab-sheet-screen">${construirPlanillaLabHTML(h, pacNombre)}</div>
      </div>
    `;
    openModal('modalVerHistoriaVirtual');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // SI ES PLANILLA DE CONSULTORIO
  if (tipoDoc === 'consultorio') {
    const fechaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleDateString('es-AR') : new Date(h.fecha).toLocaleDateString('es-AR');
    const horaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
    const evolucionTexto = meta.evolucion || h.motivo_consulta || '-';
    const indicacionesTexto = meta.indicaciones || h.tratamiento || '-';

    content.innerHTML = `
      <!-- PLANILLA DIGITAL DE CONSULTORIO -->
      <div class="hc-virtual-sheet">
        <div class="hc-virtual-sheet-title">
          <i data-lucide="clipboard-pen" style="color: var(--primary);"></i> Planilla de Evolución Médica — Consultorio Externo
        </div>
        
        <div class="hc-virtual-grid">
          <div class="hc-virtual-item">
            <strong>Paciente</strong>
            <span>${escInt(pacNombre)}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>DNI</strong>
            <span>${escInt(p.dni || '-')}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Médico Tratante</strong>
            <span>${escInt(h.medico)} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Especialidad</strong>
            <span>${escInt(h.especialidad || 'Consultorio Externo')}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Obra Social</strong>
            <span>${escInt(p.obra_social || 'Particular')}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>N° Beneficio / Afiliado</strong>
            <span>${escInt(p.nro_afiliado || '-')}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Fecha de Atención</strong>
            <span>${fechaAtencion} ${horaAtencion ? `· ${horaAtencion} hs` : ''}</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
          <div class="hc-virtual-item" style="border-left: 3.5px solid var(--primary);">
            <strong>— Evolución Médica:</strong>
            <p style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.6; margin: 4px 0 0 0;">${escInt(evolucionTexto)}</p>
          </div>
          <div class="hc-virtual-item" style="border-left: 3.5px solid #16A34A;">
            <strong>— Indicaciones & Tratamiento Prescripto:</strong>
            <p style="white-space: pre-wrap; color: var(--primary-dark); font-weight: 600; font-size: 0.95rem; line-height: 1.6; margin: 4px 0 0 0;">${escInt(indicacionesTexto)}</p>
          </div>
        </div>
      </div>

      <!-- ARCHIVOS ADJUNTOS / MULTIMEDIA -->
      <div class="hc-virtual-sheet">
        <div class="hc-virtual-sheet-title">
          <i data-lucide="paperclip"></i> Estudios Adjuntos, Radiografías y Fotos del Consultorio (${signedImgs.length})
        </div>
        
        ${signedImgs.length === 0 ? '<p style="color: var(--text-muted); margin:0;">No se adjuntaron fotos ni documentos PDF en esta evolución.</p>' : `
          <div style="display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start;">
            ${signedImgs.map((fileUrl, idx) => {
              const isPdf = fileUrl.toLowerCase().includes('.pdf');
              const isExternalPortal = fileUrl.startsWith('http') && !fileUrl.includes('ktyzjbntowcudhmiocdp.supabase.co') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(fileUrl.split('?')[0]);

              if (isPdf) {
                return `
                  <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 150px;">
                    <i data-lucide="file-text" style="width: 36px; height: 36px; color: #DC2626;"></i>
                    <span style="font-size: 0.8rem; font-weight: 700; color: #991B1B;">Documento PDF #${idx + 1}</span>
                    <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                      <i data-lucide="external-link"></i> Abrir PDF
                    </a>
                  </div>
                `;
              }
              if (isExternalPortal) {
                return `
                  <div style="background: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 160px;">
                    <i data-lucide="globe" style="width: 36px; height: 36px; color: var(--primary);"></i>
                    <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">Portal RDA / Externo #${idx + 1}</span>
                    <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                      <i data-lucide="external-link"></i> Abrir Portal
                    </a>
                  </div>
                `;
              }
              return `
                <div style="position: relative;">
                  <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" title="Ver estudio protegido">
                    <img src="${escInt(urlSegura(fileUrl))}" alt="Estudio Médico Protegido" style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);" onerror="this.src='assets/logo.jpg'">
                  </a>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    openModal('modalVerHistoriaVirtual');
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  content.innerHTML = `
    <!-- PÁGINA 1: FRENTE DIGITAL -->
    <div class="hc-virtual-sheet">
      <div class="hc-virtual-sheet-title">
        <i data-lucide="clipboard-list"></i> Página 1 (Frente) — Admisión & Evolución Clínica
      </div>
      
      <div class="hc-virtual-grid">
        <div class="hc-virtual-item">
          <strong>Paciente</strong>
          <span>${escInt(pacNombre)}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>H.C. N° (DNI)</strong>
          <span>${escInt(p.dni || '-')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Médico Tratante</strong>
          <span>${escInt(h.medico)} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Especialidad</strong>
          <span>${escInt(h.especialidad || 'Clínica General')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Fecha y Hora de Ingreso</strong>
          <span>${meta.fecha_hora_ingreso ? new Date(meta.fecha_hora_ingreso).toLocaleString('es-AR') : new Date(h.fecha).toLocaleDateString('es-AR')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Motivo / Estado de Egreso</strong>
          <span style="color: var(--primary); text-transform: uppercase; font-weight: 700;">${escInt(meta.motivo_egreso && meta.motivo_egreso !== 'ninguno' ? meta.motivo_egreso : 'En Curso / Sin Egreso')}</span>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="hc-virtual-item">
          <strong>Motivo de Internación / Consulta:</strong>
          <span>${escInt(h.motivo_consulta || '-')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Diagnóstico de Ingreso:</strong>
          <span>${escInt(meta.diagnostico_ingreso || h.diagnostico || '-')}</span>
        </div>
        ${meta.diagnostico_egreso ? `
        <div class="hc-virtual-item">
          <strong>Diagnóstico de Egreso:</strong>
          <span>${escInt(meta.diagnostico_egreso)}</span>
        </div>` : ''}
        <div class="hc-virtual-item">
          <strong>Enfermedad Actual:</strong>
          <span>${escInt(meta.enfermedad_actual || (h.observaciones && !h.observaciones.startsWith('{') ? h.observaciones : '-'))}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Medicación que recibe y dosis:</strong>
          <span style="font-weight: 600; color: var(--primary-dark);">${escInt(h.medicacion || '-')}</span>
        </div>
      </div>
    </div>

    <!-- PÁGINA 2: DORSO DIGITAL -->
    <div class="hc-virtual-sheet">
      <div class="hc-virtual-sheet-title">
        <i data-lucide="activity"></i> Página 2 (Dorso) — Signos Vitales & Examen por Sistemas
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div class="hc-virtual-item"><strong>Peso:</strong> <span>${escInt(vitals.peso || '-')}</span></div>
        <div class="hc-virtual-item"><strong>Talla:</strong> <span>${escInt(vitals.talla || '-')}</span></div>
        <div class="hc-virtual-item"><strong>Saturación:</strong> <span>${escInt(vitals.saturacion || '-')}</span></div>
        <div class="hc-virtual-item"><strong>Pulso:</strong> <span>${escInt(vitals.pulso || '-')}</span></div>
        <div class="hc-virtual-item"><strong>T.A.:</strong> <span>${escInt(vitals.ta || '-')}</span></div>
        <div class="hc-virtual-item"><strong>F.R.:</strong> <span>${escInt(vitals.fr || '-')}</span></div>
        <div class="hc-virtual-item"><strong>Temp. Axilar:</strong> <span>${escInt(vitals.temp_axilar || '-')}</span></div>
        <div class="hc-virtual-item"><strong>Temp. Rectal:</strong> <span>${escInt(vitals.temp_rectal || '-')}</span></div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="hc-virtual-item"><strong>Examen Cardiovascular:</strong> <span>${escInt(sist.cardiovascular || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Aparato Respiratorio:</strong> <span>${escInt(sist.respiratorio || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Abdomen:</strong> <span>${escInt(sist.abdomen || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Examen Urogenital:</strong> <span>${escInt(sist.urogenital || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Examen Ginecológico:</strong> <span>${escInt(sist.ginecologico || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Aparato Locomotor:</strong> <span>${escInt(sist.locomotor || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Examen Neurológico:</strong> <span>${escInt(sist.neurologico || 'Sin particularidades')}</span></div>
        <div class="hc-virtual-item"><strong>Radiografía / LAB / ECG / TAC:</strong> <span>${escInt(sist.estudios_rx || 'Sin estudios adicionales')}</span></div>
        <div class="hc-virtual-item" style="border-left: 3.5px solid var(--primary);"><strong>Indicaciones de Ingreso / Tratamiento:</strong> <span style="font-weight: 600;">${escInt(h.tratamiento || '-')}</span></div>
      </div>
    </div>

    <!-- ARCHIVOS ADJUNTOS / MULTIMEDIA -->
    <div class="hc-virtual-sheet">
      <div class="hc-virtual-sheet-title">
        <i data-lucide="paperclip"></i> Estudios Adjuntos, Radiografías y Documentos PDF (${signedImgs.length})
      </div>
      
      ${signedImgs.length === 0 ? '<p style="color: var(--text-muted); margin:0;">No se adjuntaron fotos ni documentos PDF en esta evolución médica.</p>' : `
        <div style="display: flex; gap: 14px; flex-wrap: wrap; align-items: flex-start;">
          ${signedImgs.map((fileUrl, idx) => {
            const isPdf = fileUrl.toLowerCase().includes('.pdf');
            const isExternalPortal = fileUrl.startsWith('http') && !fileUrl.includes('ktyzjbntowcudhmiocdp.supabase.co') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(fileUrl.split('?')[0]);

            if (isPdf) {
              return `
                <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 150px;">
                  <i data-lucide="file-text" style="width: 36px; height: 36px; color: #DC2626;"></i>
                  <span style="font-size: 0.8rem; font-weight: 700; color: #991B1B;">Documento PDF #${idx + 1}</span>
                  <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                    <i data-lucide="external-link"></i> Abrir PDF
                  </a>
                </div>
              `;
            }
            if (isExternalPortal) {
              return `
                <div style="background: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 8px; padding: 12px 16px; display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 160px;">
                  <i data-lucide="globe" style="width: 36px; height: 36px; color: var(--primary);"></i>
                  <span style="font-size: 0.8rem; font-weight: 700; color: var(--primary);">Portal RDA / Externo #${idx + 1}</span>
                  <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                    <i data-lucide="external-link"></i> Abrir Visor RDA
                  </a>
                </div>
              `;
            }
            return `
              <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; box-shadow: var(--shadow-sm);">
                <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener">
                  <img src="${escInt(urlSegura(fileUrl))}" alt="Estudio Adjunto" style="max-width: 180px; max-height: 180px; object-fit: contain; border-radius: 6px;">
                </a>
                <a href="${escInt(urlSegura(fileUrl))}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size: 0.72rem; padding: 2px 8px;">
                  <i data-lucide="maximize-2"></i> Ver en grande
                </a>
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  openModal('modalVerHistoriaVirtual');
  if (window.lucide) window.lucide.createIcons();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMsg');
  if (toast && msgEl) {
    msgEl.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}

// ==========================================================================
// 10. CALENDARIO MENSUAL & DASHBOARD INTERACTIVO (BASE DE DATOS REAL)
// ==========================================================================

const CALENDAR_ESPECIALIDADES = {
  'Cardiología': { color: 'cardiologia', dotBg: '#B83A3A' },
  'Urología': { color: 'urologia', dotBg: '#12837F' },
  'Ginecología': { color: 'ginecologia', dotBg: '#A8385F' },
  'Cirugía Ginecológica': { color: 'ginecologia', dotBg: '#A8385F' },
  'Neurología': { color: 'clinica', dotBg: '#6B4FBB' },
  'Cirugía General': { color: 'cirugia', dotBg: '#2A35B5' },
  'Cirugía': { color: 'cirugia', dotBg: '#2A35B5' },
  'Oncología': { color: 'cirugia', dotBg: '#6B4FBB' },
  'Flebología': { color: 'urologia', dotBg: '#12837F' },
  'Nutrición': { color: 'urologia', dotBg: '#3E8A45' },
  'Traumatología': { color: 'traumatologia', dotBg: '#B07A1E' },
  'Gastroenterología': { color: 'traumatologia', dotBg: '#B07A1E' },
  'DBT (Diabetes)': { color: 'clinica', dotBg: '#1F7EAA' },
  'DBT': { color: 'clinica', dotBg: '#1F7EAA' },
  'Nefrología': { color: 'clinica', dotBg: '#1F7EAA' },
  'Endocrinología': { color: 'ginecologia', dotBg: '#6B4FBB' },
  'Clínica Médica': { color: 'clinica', dotBg: '#4F6B8F' },
  'Clínica': { color: 'clinica', dotBg: '#4F6B8F' },
  'Guardia 24 hs': { color: 'cardiologia', dotBg: '#B83A3A' },
  'Consultorio': { color: 'cirugia', dotBg: '#2A35B5' }
};

const _nowCal = new Date();
let calYear = _nowCal.getFullYear();
let calMonth = _nowCal.getMonth();
let currentSelectedDay = '';
let currentDrawerSpecFilter = 'all';

// Eliminar residuos de datos de demostración anteriores
try {
  localStorage.removeItem('passo_extra_cal_turnos');
} catch (e) {}

function getFechaKeyDeTurno(t) {
  const f = t.fecha_turno || t.fecha || '';
  if (!f) return '';
  if (typeof f === 'string') {
    return f.split('T')[0].split(' ')[0];
  }
  try {
    const d = new Date(f);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  return '';
}

function getHoraStrDeTurno(t) {
  if (t.hora) return t.hora;
  const f = t.fecha_turno || t.fecha || '';
  if (!f) return '08:00';
  if (typeof f === 'string' && f.includes('T')) {
    const timePart = f.split('T')[1];
    if (timePart) {
      const hhmm = timePart.substring(0, 5);
      if (hhmm) return hhmm;
    }
  }
  try {
    const d = new Date(f);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }
  } catch (e) {}
  return '08:00';
}

async function cargarTodosLosTurnosParaCalendario() {
  try {
    const res = await apiFetch('/turnos');
    if (res.ok) {
      state.turnosList = await res.json();
    }
  } catch (e) {
    console.warn('Error al cargar turnos para calendario:', e);
  }
  renderizarCalendarioMensual();
  if (currentSelectedDay) {
    renderizarDrawerTurnos();
  }
}

function cambiarMesCalendario(delta) {
  calMonth += delta;
  if (calMonth < 0) {
    calMonth = 11;
    calYear -= 1;
  } else if (calMonth > 11) {
    calMonth = 0;
    calYear += 1;
  }
  renderizarCalendarioMensual();
}

function renderizarCalendarioMensual() {
  const grid = document.getElementById('calendarMonthlyGrid');
  const monthLabel = document.getElementById('calCurrentMonthLabel');
  const totalLabel = document.getElementById('calMonthTotalCount');
  if (!grid) return;

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  if (monthLabel) monthLabel.textContent = `${meses[calMonth]} ${calYear}`;

  grid.innerHTML = '';

  const turnos = state.turnosList || [];

  // Calcular primer día y cantidad de días del mes
  const firstDayObj = new Date(calYear, calMonth, 1);
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  
  // Offset lunes=0 (0=Dom -> 6, 1=Lun -> 0, etc.)
  let startDayOffset = firstDayObj.getDay() - 1;
  if (startDayOffset === -1) startDayOffset = 6;

  // Días previos de relleno del mes anterior
  for (let i = 0; i < startDayOffset; i++) {
    const prevDate = new Date(calYear, calMonth, 0).getDate() - startDayOffset + i + 1;
    const emptyCard = document.createElement('div');
    emptyCard.className = 'calendar-day-card inactive prev-month';
    emptyCard.innerHTML = `
      <div class="card-top-row">
        <span class="card-day-num" style="color: #94A3B8;">${prevDate}</span>
      </div>
      <div style="font-size: 0.72rem; color: #94A3B8; text-align: center; margin: auto;">Mes anterior</div>
    `;
    grid.appendChild(emptyCard);
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  let monthTotal = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = String(day).padStart(2, '0');
    const monthStr = String(calMonth + 1).padStart(2, '0');
    const dateKey = `${calYear}-${monthStr}-${dayStr}`;

    const dayAppts = turnos.filter(t => getFechaKeyDeTurno(t) === dateKey);

    const count = dayAppts.length;
    monthTotal += count;

    // Conteo por especialidades
    const specCounts = {};
    dayAppts.forEach(t => {
      const spec = t.especialidad || 'Consultorio';
      specCounts[spec] = (specCounts[spec] || 0) + 1;
    });

    const isToday = (dateKey === todayStr);
    const dayOfWeek = (startDayOffset + day - 1) % 7;
    const isSunday = (dayOfWeek === 6);
    const isSaturday = (dayOfWeek === 5);

    const isPast = dateKey < todayStr;
    const card = document.createElement('div');
    card.className = `calendar-day-card ${isToday ? 'today' : ''} ${isSunday ? 'inactive' : ''} ${isPast ? 'past' : ''} ${count === 0 ? 'is-empty' : ''}`;
    card.onclick = () => abrirDetalleDia(dateKey);

    let badgesHtml = '';
    if (count > 0) {
      Object.keys(specCounts).forEach(spec => {
        const specConfig = CALENDAR_ESPECIALIDADES[spec] || { color: 'cirugia' };
        badgesHtml += `
          <div class="badge-spec ${specConfig.color}" style="--spec: ${colorEspecialidad(spec)};">
            <span>${escInt(spec)}</span>
            <strong>${specCounts[spec]}</strong>
          </div>
        `;
      });
    }

    const dotsHtml = Object.keys(specCounts).map(spec =>
      `<span style="background:${colorEspecialidad(spec)}" title="${escInt(spec)}: ${specCounts[spec]}"></span>`).join('');

    card.innerHTML = `
      ${count > 0 ? `<div class="card-mobile-resumen"><span class="card-mobile-count">${count}</span><span class="card-dots">${dotsHtml}</span></div>` : ''}
      <div class="card-top-row">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="card-day-num" style="${isSaturday ? 'color: var(--primary);' : ''}">${dayStr}</span>
          ${isToday ? '<span class="tag-today-badge">HOY</span>' : ''}
        </div>
      </div>

      ${count > 0 ? `
      <div class="card-turnos-main">
        <div class="card-turnos-count">
          ${count}
          <small>${count === 1 ? 'Turno' : 'Turnos'}</small>
        </div>
      </div>` : ''}

      <div class="card-badges-list">
        ${badgesHtml}
      </div>
    `;

    grid.appendChild(card);
  }

  if (totalLabel) totalLabel.textContent = `${monthTotal} ${monthTotal === 1 ? 'Turno' : 'Turnos'}`;
  if (window.lucide) window.lucide.createIcons();
}

// ==========================================
// DRAWER LATERAL DE DETALLE DE DÍA
// ==========================================

function abrirDetalleDia(dateKey) {
  currentSelectedDay = dateKey;
  currentDrawerSpecFilter = 'all';

  const overlay = document.getElementById('dayDrawerOverlay');
  const drawer = document.getElementById('dayDrawerPanel');
  const title = document.getElementById('drawerDayTitle');
  
  if (!overlay || !drawer) return;

  const [y, m, d] = dateKey.split('-');
  const dateObj = new Date(parseInt(y), parseInt(m)-1, parseInt(d));
  const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const isToday = (dateKey === todayStr);

  if (title) {
    title.innerHTML = `${diasSemana[dateObj.getDay()]} ${parseInt(d)} de ${meses[parseInt(m)-1]} ${isToday ? '<span class="tag-today-badge" style="margin-left: 6px;">HOY</span>' : ''}`;
  }

  renderizarDrawerTurnos();

  overlay.classList.add('active');
  drawer.classList.add('active');
  iniciarAutoRefrescoTurnosDelDia();
  if (window.lucide) window.lucide.createIcons();
}

function cerrarDetalleDia() {
  const overlay = document.getElementById('dayDrawerOverlay');
  const drawer = document.getElementById('dayDrawerPanel');
  if (overlay) overlay.classList.remove('active');
  if (drawer) drawer.classList.remove('active');
  detenerAutoRefrescoTurnosDelDia();
}

function abrirModalNuevoTurnoEnDia() {
  cerrarDetalleDia();
  if (!state.pacientesList || state.pacientesList.length === 0) {
    cargarPacientes();
  }
  deseleccionarPacienteTurno();
  openModal('modalTurno');
  const fechaInput = document.getElementById('turnoFecha');
  if (fechaInput && currentSelectedDay) {
    fechaInput.value = `${currentSelectedDay}T09:00`;
    cargarHorariosTurno(true);    // pasa al primer horario libre de ese día
  }
}

function filtrarDrawerPorEspecialidad(spec) {
  currentDrawerSpecFilter = spec;
  renderizarDrawerTurnos();
}

// ==========================================================================
// TARJETA DE TURNO (drawer del día) — helpers de formato
// ==========================================================================
const PARTICULAS_NOMBRE = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'di'];

// "VIcenta CARRASCAL" -> "Vicenta Carrascal"; "juan de la fuente" -> "Juan de la Fuente"
function fmtNombrePersona(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
    const low = w.toLowerCase();
    if (i > 0 && PARTICULAS_NOMBRE.includes(low)) return low;
    return low.replace(/(^|[-'’])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());
  }).join(' ');
}

// "11819786" -> "11.819.786"
function fmtDni(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// "particular" -> "Particular"; respeta siglas como "OSDE 210" o "PAMI"
function fmtCobertura(v) {
  const s = String(v || '').trim();
  if (!s) return 'Particular';
  return s === s.toLowerCase() ? s.replace(/(^|\s)(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase()) : s;
}

// "2026-09-11" -> "11/09"
function fmtDiaCorto(fechaKey) {
  const m = String(fechaKey || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : String(fechaKey || '');
}

function estadoTurnoClave(estado) {
  const st = String(estado || 'pendiente').toLowerCase().trim();
  if (st.includes('atend') || st.includes('realiz')) return 'realizado';
  if (st.includes('cancel') || st.includes('rechaz')) return 'cancelado';
  if (st.includes('acept') || st.includes('conf')) return 'confirmado';
  return 'pendiente';
}

function colorEspecialidad(spec) {
  const cfg = CALENDAR_ESPECIALIDADES[spec];
  return (cfg && cfg.dotBg) || '#64748B';
}

// Convierte un teléfono argentino como se agenda ("011 15 2222-3333", "15-2222-3333",
// "+54 9 11 2222 3333", "(0221) 15 444-5555") al formato que pide WhatsApp: 549 + área + número
// (10 dígitos, sin el 0 ni el 15). Devuelve '' si no parece un celular válido.
function telefonoWhatsApp(telefono) {
  let d = String(telefono || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);                 // 0054...
  if (d.startsWith('54')) d = d.slice(2);                 // +54
  if (d.startsWith('9') && d.length === 11) d = d.slice(1); // 9 de celular internacional
  d = d.replace(/^0/, '');                                // 0 de larga distancia
  // 12 dígitos: tiene el "15" después del código de área (2, 3 o 4 dígitos)
  if (d.length === 12) {
    if (d.startsWith('1115')) d = '11' + d.slice(4);
    else for (const a of [3, 4, 2]) { if (d.substr(a, 2) === '15') { d = d.slice(0, a) + d.slice(a + 2); break; } }
  }
  if (d.length === 10 && d.startsWith('15')) d = '11' + d.slice(2);  // "15 2222-3333" sin característica
  if (d.length === 8) d = '11' + d;                                   // sin característica: se asume AMBA
  return d.length === 10 ? '549' + d : '';
}

function linkWhatsApp(telefono, texto) {
  const tel = telefonoWhatsApp(telefono);
  if (!tel) return '';
  return `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(texto)}`;
}

// Familiar / acompañante del paciente (viene del padrón)
function familiarDePaciente(p, pacienteId) {
  const desdePadron = (state.pacientesList || []).find(x => String(x.id) === String(pacienteId || (p && p.id)));
  const f = Object.assign({}, desdePadron || {}, p || {});
  return { nombre: (f.familiar_nombre || '').trim(), telefono: (f.familiar_telefono || '').trim() };
}

function construirTarjetaTurno(t) {
  const spec = t.especialidad || 'Consultorio';
  const color = colorEspecialidad(spec);
  const p = t.pacientes || {};
  const nombreRaw = p.nombre ? `${p.nombre} ${p.apellido || ''}` : (t.nombre || 'Paciente');
  const nombre = fmtNombrePersona(nombreRaw) || 'Paciente';
  const dniRaw = String(p.dni || t.dni || '').replace(/\D/g, '');
  const dni = fmtDni(dniRaw);
  const telefono = p.telefono || t.telefono || '';
  const email = p.email || t.email || '';
  const cobertura = fmtCobertura(p.obra_social || p.cobertura || t.obra_social || t.cobertura);
  const medico = t.medico ? fmtNombrePersona(t.medico) : '';
  const obs = t.motivo_consulta || t.notas || '';
  const horaStr = getHoraStrDeTurno(t);
  const estado = estadoTurnoClave(t.estado);
  const esMedico = tienePermiso('hc.acceso');
  const id = escInt(t.id);

  const opcionesEstado = [
    ['pendiente', 'Pendiente'], ['confirmado', 'Confirmado'], ['realizado', 'Realizado'], ['cancelado', 'Cancelado']
  ].map(([v, txt]) => `<option value="${v}" ${estado === v ? 'selected' : ''}>${txt}</option>`).join('');

  const meta = [
    dni ? `DNI ${escInt(dni)}` : 'Sin DNI',
    escInt(cobertura),
    medico ? escInt(conTituloMedico(medico)) : ''
  ].filter(Boolean).join('<span class="turno-meta-sep">·</span>');

  // Nombre: para Médico abre la historia clínica; para Recepción es solo texto
  const nombreHtml = (esMedico && dniRaw)
    ? `<button type="button" class="turno-nombre turno-nombre-link" onclick="verHCDesdeTurno('${escInt(dniRaw)}')" title="Ver historia clínica">${escInt(nombre)}</button>`
    : `<span class="turno-nombre">${escInt(nombre)}</span>`;

  // ---- Acciones según el estado del turno ----
  const acciones = [];
  if (t.llamado && estado !== 'realizado' && estado !== 'cancelado' && state.user && state.user.soloSusTurnos) {
    acciones.push(`<span class="turno-accion turno-accion-llamado" title="El médico lo llamó"><i data-lucide="door-open"></i> En consultorio ${escInt(t.llamado)}</span>`);
  } else if (estado !== 'cancelado') {
    if (t.llegada) {
      acciones.push(t._guardandoLlegada
        ? `<button type="button" class="turno-accion" disabled><i data-lucide="loader-2" class="spin"></i> Guardando…</button>`
        : `<button type="button" class="turno-accion turno-accion-llego" onclick="marcarLlegada('${id}')" title="Deshacer llegada"><i data-lucide="check-circle-2"></i> Llegó ${escInt(String(t.llegada).replace(/\s*hs$/, ''))}</button>`);
    } else if (estado !== 'realizado') {
      acciones.push(t._guardandoLlegada
        ? `<button type="button" class="turno-accion" disabled><i data-lucide="loader-2" class="spin"></i> Guardando…</button>`
        : `<button type="button" class="turno-accion turno-accion-primaria" onclick="marcarLlegada('${id}')"><i data-lucide="map-pin"></i> Marcar llegada</button>`);
    }
  }
  const fechaTxt = fmtDiaCorto(currentSelectedDay);
  const telPaciente = telefonoWhatsApp(telefono);
  if (telPaciente) {
    const texto = `Hola ${nombre.split(' ')[0]}, te recordamos tu turno en Clínica Passo el ${fechaTxt} a las ${horaStr} hs.`;
    acciones.push(`<a class="turno-accion turno-accion-whatsapp" href="${escInt(linkWhatsApp(telefono, texto))}" target="_blank" rel="noopener" title="WhatsApp al paciente (${escInt(telefono)})"><i data-lucide="message-circle"></i> WhatsApp</a>`);
  } else if (telefono.replace(/\D/g, '')) {
    acciones.push(`<button type="button" class="turno-accion" disabled title="El teléfono cargado (${escInt(telefono)}) no es un celular válido. Corregilo en Pacientes."><i data-lucide="message-circle"></i> Tel. inválido</button>`);
  }
  const fam = familiarDePaciente(p, t.paciente_id);
  if (telefonoWhatsApp(fam.telefono)) {
    const saludo = fam.nombre ? `Hola ${fam.nombre.replace(/\s*\(.*\)\s*/g, ' ').trim().split(' ')[0]}` : 'Hola';
    const textoFam = `${saludo}, te recordamos el turno de ${nombre} en Clínica Passo el ${fechaTxt} a las ${horaStr} hs.`;
    acciones.push(`<a class="turno-accion turno-accion-whatsapp" href="${escInt(linkWhatsApp(fam.telefono, textoFam))}" target="_blank" rel="noopener" title="WhatsApp al familiar${fam.nombre ? ' ' + escInt(fam.nombre) : ''} (${escInt(fam.telefono)})"><i data-lucide="users"></i> WhatsApp familiar</a>`);
  }
  if (email) {
    acciones.push(`<button type="button" class="turno-accion turno-accion-email" onclick="enviarMailTurnoDirecto('${id}', this)" title="Enviar confirmación a ${escInt(email)}"><i data-lucide="mail"></i> Email</button>`);
  }

  return `
    <article class="turno-card estado-${estado}" style="--spec: ${color};">
      <header class="turno-card-head">
        <span class="turno-hora">${escInt(horaStr)}</span>
        <span class="turno-spec">${escInt(spec)}</span>
        <div class="turno-head-actions">
          <label class="turno-estado estado-${estado}">
            <span class="turno-estado-dot"></span>
            <select aria-label="Estado del turno" onchange="cambiarEstadoTurno('${id}', this.value)">${opcionesEstado}</select>
            <i data-lucide="chevron-down"></i>
          </label>
          <div class="turno-menu-wrap">
            <button type="button" class="turno-menu-btn" onclick="toggleMenuTurno(event, '${id}')" aria-label="Más opciones" title="Más opciones"><i data-lucide="more-horizontal"></i></button>
            <div class="turno-menu hidden" id="turno-menu-${id}" role="menu">
              ${(esMedico && dniRaw) ? `<button type="button" role="menuitem" onclick="verHCDesdeTurno('${escInt(dniRaw)}')"><i data-lucide="file-text"></i> Ver historia clínica</button>` : ''}
              ${estado !== 'realizado' ? `<button type="button" role="menuitem" onclick="abrirReprogramar('${id}')"><i data-lucide="calendar-clock"></i> Reprogramar</button>` : ''}
              <button type="button" role="menuitem" class="turno-menu-danger" onclick="confirmarEliminarTurno(event, '${id}', this)"><i data-lucide="trash-2"></i> <span>Eliminar turno</span></button>
            </div>
          </div>
        </div>
      </header>

      <div class="turno-card-body">
        ${nombreHtml}
        ${t.origen === 'app' ? '<span class="turno-app-pill" title="El paciente lo pidió desde la web de pacientes: revisá la fecha y la hora y confirmalo"><i data-lucide="globe"></i> Pedido por la web</span>' : ''}
        <div class="turno-meta">${meta}</div>
        ${obs ? `<p class="turno-obs"><i data-lucide="sticky-note"></i> ${escInt(obs)}</p>` : ''}
      </div>

      ${acciones.length ? `<footer class="turno-card-actions">${acciones.join('')}</footer>` : ''}
    </article>`;
}

// Abrir la historia clínica desde una tarjeta de turno (solo perfil Médico)
function verHCDesdeTurno(dni) {
  cerrarMenusTurno();
  if (!tienePermiso('hc.acceso')) {
    showToast('Tu perfil no tiene acceso a historias clínicas');
    return;
  }
  if (typeof cerrarDetalleDia === 'function') cerrarDetalleDia();
  const nav = document.getElementById('navHistoriasBtn');
  if (nav) nav.click();
  const search = document.getElementById('historiaDniSearch');
  if (search) {
    search.value = dni;
    searchPacienteParaHistoria();
  }
}

// Menú "⋯" de cada tarjeta
function cerrarMenusTurno(excepto) {
  document.querySelectorAll('.turno-menu:not(.hidden)').forEach(m => {
    if (m !== excepto) {
      m.classList.add('hidden');
      const del = m.querySelector('.turno-menu-danger');
      if (del) { delete del.dataset.confirmar; del.querySelector('span').textContent = 'Eliminar turno'; }
    }
  });
}

function toggleMenuTurno(e, id) {
  e.stopPropagation();
  const menu = document.getElementById(`turno-menu-${id}`);
  if (!menu) return;
  cerrarMenusTurno(menu);
  menu.classList.toggle('hidden');
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.turno-menu-wrap')) cerrarMenusTurno();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarMenusTurno();
});

// Eliminar con doble confirmación dentro del menú (evita borrados accidentales)
function confirmarEliminarTurno(e, id, btn) {
  e.stopPropagation();
  if (btn.dataset.confirmar) {
    cerrarMenusTurno();
    eliminarTurno(id, true);
    return;
  }
  btn.dataset.confirmar = '1';
  btn.querySelector('span').textContent = '¿Seguro? Tocá de nuevo';
  clearTimeout(btn._timer);
  btn._timer = setTimeout(() => {
    if (btn.isConnected) { delete btn.dataset.confirmar; btn.querySelector('span').textContent = 'Eliminar turno'; }
  }, 4000);
}

function renderizarDrawerTurnos() {
  const container = document.getElementById('drawerAppointmentsList');
  const filterTabs = document.getElementById('drawerFilterTabs');
  const subtitle = document.getElementById('drawerTotalTurnos');
  if (!container) return;

  const turnos = state.turnosList || [];
  const dayAppts = turnos.filter(t => getFechaKeyDeTurno(t) === currentSelectedDay);

  const total = dayAppts.length;
  if (subtitle) subtitle.textContent = total === 0 ? 'Sin turnos' : `${total} ${total === 1 ? 'turno programado' : 'turnos programados'}`;

  // Contar especialidades
  const specCounts = {};
  dayAppts.forEach(t => {
    const s = t.especialidad || 'Consultorio';
    specCounts[s] = (specCounts[s] || 0) + 1;
  });

  // Pestañas
  if (filterTabs) {
    let tabsHtml = `
      <button onclick="filtrarDrawerPorEspecialidad('all')" class="drawer-filter-btn ${currentDrawerSpecFilter === 'all' ? 'active' : ''}">
        Todos (${total})
      </button>
    `;
    Object.keys(specCounts).forEach(spec => {
      const active = (currentDrawerSpecFilter === spec);
      tabsHtml += `
        <button onclick="filtrarDrawerPorEspecialidad(${jsArg(spec)})" class="drawer-filter-btn ${active ? 'active' : ''}">
          ${spec} (${specCounts[spec]})
        </button>
      `;
    });
    filterTabs.innerHTML = tabsHtml;
  }

  // Filtrar
  const filtered = (currentDrawerSpecFilter === 'all') 
    ? dayAppts 
    : dayAppts.filter(t => (t.especialidad || 'Consultorio') === currentDrawerSpecFilter);

  // Ordenar por hora
  filtered.sort((a, b) => getHoraStrDeTurno(a).localeCompare(getHoraStrDeTurno(b)));

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 2.5rem 1rem;">
        <i data-lucide="calendar-x" style="width: 44px; height: 44px; color: #94A3B8; margin: 0 auto 10px;"></i>
        <h4 style="font-weight: 800; color: var(--text-dark); margin-bottom: 4px;">No hay turnos para esta fecha</h4>
        <p style="font-size: 0.78rem; color: var(--text-muted);">Los turnos asignados en la agenda de turnos aparecerán aquí automáticamente.</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const html = filtered.map(construirTarjetaTurno).join('');
  
  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}



// ==========================================================================
// LABORATORIO (PLANILLA)
// ==========================================================================
function openModalLaboratorio() {
  if (!state.selectedPacienteHistoria) {
    alert('Por favor primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.');
    return;
  }
  const p = state.selectedPacienteHistoria;
  
  // Nuevo registro: salir de cualquier modo edición previo y limpiar campos
  resetLabEditState();
  limpiarPlanillaLab();

  // Precargar nombre del paciente
  document.getElementById('labNombrePacienteTxt').textContent = `${p.apellido || ''}, ${p.nombre || ''}`.trim();

  openModal('modalLaboratorio');
}

// ==========================================================================
// PLANILLA DE LABORATORIO — GENERADOR ÚNICO (visor, imprimir, imprimir todo)
// Toma la tabla del modal (#printLabArea) como plantilla, la clona y la llena
// con los valores guardados (meta.cell_values / meta.date_values por posición).
// Los inputs se reemplazan por texto, y se quitan los IDs para no duplicarlos.
// ==========================================================================
function escapeHtmlLab(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function construirPlanillaLabHTML(h, pacienteNombre) {
  const template = document.getElementById('printLabArea');
  if (!template) return '<p>No se encontró la plantilla de laboratorio.</p>';

  const meta = obtenerMetaHistoria(h);
  const cellValues = Array.isArray(meta.cell_values) ? meta.cell_values : [];
  const dateValues = Array.isArray(meta.date_values) ? meta.date_values : [];

  const clone = template.cloneNode(true);

  // Nombre del paciente
  const nombreEl = clone.querySelector('#labNombrePacienteTxt');
  if (nombreEl) nombreEl.textContent = pacienteNombre || '';

  const reemplazarInput = (input, valor, extraClass) => {
    const span = document.createElement('span');
    span.className = 'lab-val' + (extraClass ? ' ' + extraClass : '');
    span.innerHTML = escapeHtmlLab(valor);
    input.replaceWith(span);
  };

  // Encabezado: Labo y Cama
  const dirInput = clone.querySelector('#labDirector');
  if (dirInput) reemplazarInput(dirInput, meta.director || '', 'lab-val-inline');
  const camaInput = clone.querySelector('#labCama');
  if (camaInput) reemplazarInput(camaInput, meta.cama || '', 'lab-val-inline');

  // Fechas (mismo orden en que se guardaron)
  clone.querySelectorAll('.lab-date-input').forEach((inp, i) => reemplazarInput(inp, dateValues[i] || '', 'lab-val-date'));

  // Valores de la tabla (mismo orden en que se guardaron)
  clone.querySelectorAll('.lab-input-cell input').forEach((inp, i) => reemplazarInput(inp, cellValues[i] || ''));

  // Quitar IDs del clon para no duplicar IDs del documento
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));

  return clone.outerHTML;
}

// Reset lab editing state
function resetLabEditState() {
  state._editingLabHistoriaId = null;
  state._editingLabFechaOriginal = null;
  const titulo = document.querySelector('#modalLaboratorio .modal-header h3');
  if (titulo) titulo.innerHTML = '<i data-lucide="microscope" style="color: var(--primary);"></i> Planilla de Laboratorio';
  const btn = document.getElementById('btnGuardarLab');
  if (btn) btn.innerHTML = '<i data-lucide="save"></i> Guardar Cambios';
  if (window.lucide) window.lucide.createIcons();
}

function limpiarPlanillaLab() {
  const dirEl = document.getElementById('labDirector'); if (dirEl) dirEl.value = '';
  const camaEl = document.getElementById('labCama'); if (camaEl) camaEl.value = '';
  
  const dateInputs = document.querySelectorAll('#printLabArea .lab-date-input');
  dateInputs.forEach(input => input.value = '');
  
  const cellInputs = document.querySelectorAll('#printLabArea .lab-input-cell input');
  cellInputs.forEach(input => input.value = '');
}

function imprimirLaboratorio(e) {
  e.preventDefault();
  
  // Clean printArea to prevent ghost content
  const pa = document.getElementById('printArea');
  if (pa) pa.innerHTML = '';
  
  // Guardamos el title original
  const originalTitle = document.title;
  const p = state.selectedPacienteHistoria;
  if(p) {
    document.title = 'Planilla_Laboratorio_' + p.apellido + '_' + p.nombre;
  }

  document.body.classList.add('printing-hc');
  window.print();
  document.body.classList.remove('printing-hc');

  // Restaurar title
  document.title = originalTitle;
}

// Editar un registro de laboratorio existente: abre el mismo modal de carga
// con todos los datos guardados (fechas por columna, valores, labo y cama).
function editarHistoriaLaboratorio(historiaId) {
  if (!puedeEscribirDoc('laboratorio')) { showToast('Los laboratorios solo los modifica el personal de Laboratorio.'); return; }
  const h = (state.historiasList || []).find(item => String(item.id) === String(historiaId));
  if (!h) {
    alert('Registro de laboratorio no encontrado. Actualizá el historial e intentá de nuevo.');
    return;
  }
  const meta = obtenerMetaHistoria(h);
  const cellValues = Array.isArray(meta.cell_values) ? meta.cell_values : [];
  const dateValues = Array.isArray(meta.date_values) ? meta.date_values : [];

  limpiarPlanillaLab();

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('labDirector', meta.director);
  setVal('labCama', meta.cama);

  const pNameEl = document.getElementById('labNombrePacienteTxt');
  if (pNameEl) {
    const p = state.selectedPacienteHistoria;
    pNameEl.textContent = p ? `${p.apellido || ''}, ${p.nombre || ''}`.trim() : (h.paciente_nombre || '');
  }

  document.querySelectorAll('#printLabArea .lab-date-input').forEach((inp, i) => { inp.value = dateValues[i] || ''; });
  document.querySelectorAll('#printLabArea .lab-input-cell input').forEach((inp, i) => { inp.value = cellValues[i] || ''; });

  // Modo edición: guardarLaboratorio actualiza este registro en vez de crear otro
  state._editingLabHistoriaId = h.id;
  state._editingLabFechaOriginal = h.fecha || null;

  const titulo = document.querySelector('#modalLaboratorio .modal-header h3');
  if (titulo) titulo.innerHTML = '<i data-lucide="microscope" style="color: var(--primary);"></i> Editar Planilla de Laboratorio';
  const btnGuardar = document.getElementById('btnGuardarLab');
  if (btnGuardar) btnGuardar.innerHTML = '<i data-lucide="save"></i> Actualizar Laboratorio';

  openModal('modalLaboratorio');
}

async function guardarLaboratorio(event) {
  if (event && event.preventDefault) event.preventDefault();

  if (!state.selectedPacienteHistoria) {
    alert('Por favor primero seleccioná un paciente.');
    return;
  }

  const p = state.selectedPacienteHistoria;
  const btn = document.getElementById('btnGuardarLab');
  const editandoId = state._editingLabHistoriaId || null;
  if (btn) { btn.disabled = true; btn.textContent = editandoId ? 'Actualizando...' : 'Guardando...'; }

  try {
    const getValue = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

    const meta = {
      tipo_planilla: 'laboratorio',
      director: getValue('labDirector'),
      cama: getValue('labCama'),
      cell_values: Array.from(document.querySelectorAll('#printLabArea .lab-input-cell input')).map(inp => inp.value.trim()),
      date_values: Array.from(document.querySelectorAll('#printLabArea .lab-date-input')).map(inp => inp.value.trim())
    };

    const body = {
      paciente_id: p.id,
      fecha: editandoId && state._editingLabFechaOriginal ? state._editingLabFechaOriginal : new Date().toISOString(),
      medico: 'Labo',
      especialidad: 'Laboratorio',
      motivo_consulta: 'Planilla de Laboratorio',
      observaciones: JSON.stringify(meta)
    };

    const res = editandoId
      ? await apiFetch(`/historias-clinicas/${editandoId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await apiFetch('/historias-clinicas', { method: 'POST', body: JSON.stringify(body) });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (editandoId && (res.status === 404 || res.status === 405)) {
        throw new Error('El servidor todavía no permite editar historias clínicas (falta la ruta PUT /historias-clinicas/:id en el backend). No se guardó ningún cambio.');
      }
      throw new Error(data.error || (editandoId ? 'Error al actualizar laboratorio' : 'Error al guardar laboratorio'));
    }

    showToast(editandoId ? 'Planilla de laboratorio actualizada' : 'Planilla de laboratorio guardada con éxito');
    closeModal('modalLaboratorio');
    resetLabEditState();
    await cargarHistoriasDePaciente(p.id);

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = state._editingLabHistoriaId
        ? '<i data-lucide="save"></i> Actualizar Laboratorio'
        : '<i data-lucide="save"></i> Guardar Cambios';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}


// ===============================================
// MARCAR LLEGADA DEL PACIENTE
// ===============================================
window.marcarLlegada = async function(turnoId) {
  const turno = (state.turnosList || []).find(t => String(t.id) === String(turnoId));
  if (!turno || turno._guardandoLlegada) return;

  const nuevaLlegada = turno.llegada
    ? null
    : (() => { const a = new Date(); return String(a.getHours()).padStart(2, '0') + ':' + String(a.getMinutes()).padStart(2, '0'); })();

  turno._guardandoLlegada = true;
  renderizarDrawerTurnos(); // muestra el botón como "guardando..." mientras esperamos al servidor

  try {
    const res = await apiFetch(`/turnos/${turnoId}/llegada`, { method: 'PUT', body: JSON.stringify({ llegada: nuevaLlegada }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar');
    Object.assign(turno, data.turno); // toma la llegada confirmada por el servidor
  } catch (err) {
    showToast('No se pudo guardar la llegada: ' + err.message);
  } finally {
    delete turno._guardandoLlegada;
    renderizarDrawerTurnos();
  }
};

// Refresco automático de los turnos del día mientras el panel está abierto,
// para que Recepción y el consultorio vean la misma llegada sin recargar.
let turnosDrawerTimer = null;
function iniciarAutoRefrescoTurnosDelDia() {
  detenerAutoRefrescoTurnosDelDia();
  turnosDrawerTimer = setInterval(async () => {
    const drawer = document.getElementById('dayDrawerPanel');
    const hayModalAbierto = document.querySelector('.modal-backdrop:not(.hidden)');
    if (!drawer || !drawer.classList.contains('active') || hayModalAbierto || document.hidden) return;
    try {
      const res = await apiFetch('/turnos');
      if (!res.ok) return;
      const frescos = await res.json();
      (frescos || []).forEach(fresco => {
        const local = (state.turnosList || []).find(t => String(t.id) === String(fresco.id));
        if (local && !local._guardandoLlegada) Object.assign(local, fresco);
        else if (!local) state.turnosList.push(fresco);
      });
      renderizarDrawerTurnos();
      renderizarCalendarioMensual();
    } catch (e) { /* sin conexión momentánea: se reintenta en el próximo ciclo */ }
  }, 20000);
}
function detenerAutoRefrescoTurnosDelDia() {
  if (turnosDrawerTimer) { clearInterval(turnosDrawerTimer); turnosDrawerTimer = null; }
}
document.addEventListener('visibilitychange', () => {
  const drawer = document.getElementById('dayDrawerPanel');
  if (!document.hidden && drawer && drawer.classList.contains('active')) iniciarAutoRefrescoTurnosDelDia();
});

// ==========================================
// MÓDULO INTERNACIÓN (BOCETO FRONTEND)
// ==========================================
// Los datos de camas ahora viven en Supabase (tabla public.camas) → ver /api/internacion

// ========================================================
// FILE UPLOAD CONSUL COMPACT UI
// ========================================================
function toggleLinkInputConsul() {
  const wrap = document.getElementById('consulLinkInputWrap');
  if (wrap) {
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) {
      document.getElementById('consulLinkSingle').focus();
    }
  }
}

function agregarLinkManualConsul() {
  const input = document.getElementById('consulLinkSingle');
  const url = input.value.trim();
  if (!url) return;

  const id = 'link_' + Date.now();
  attachedFilesConsulState.push({
    id,
    name: url.length > 40 ? url.substring(0, 37) + '...' : url,
    url,
    storagePath: url,
    isPdf: url.toLowerCase().includes('.pdf'),
    isLink: true
  });
  syncAttachedFilesConsulUI();
  input.value = '';
  showToast('Link agregado ✓');
}

async function pegarDesdePortapapelesConsul() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        const file = new File([blob], `captura_${Date.now()}.png`, { type: imageType });
        await subirArchivosConsulASupabase([file]);
        showToast('Imagen pegada y subida ✓');
        return;
      }
    }
    showToast('No hay imagen en el portapapeles');
  } catch (err) {
    showToast('No se pudo acceder al portapapeles');
  }
}


// ==========================================================================
// DOCUMENTO ADJUNTO — PDFs, imágenes o links externos (informes, estudios,
// laboratorios de otros centros, interconsultas). Se guarda como un documento
// propio del historial. Los archivos se suben por el backend (URLs firmadas).
// ==========================================================================
const CATEGORIAS_ADJUNTO = [
  'Estudio por imágenes', 'Laboratorio externo', 'Informe médico',
  'Interconsulta', 'Receta / Indicación', 'Otro'
];
const MAX_MB_ADJUNTO = 25;
let adjuntoArchivos = [];      // { id, nombre, path, url, esPdf, esLink }
let adjuntoSubiendo = 0;

function openModalAdjunto() {
  if (!state.selectedPacienteHistoria) {
    alert('Primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.');
    return;
  }
  const p = state.selectedPacienteHistoria;
  document.getElementById('formAdjunto').reset();
  document.getElementById('adjFecha').value = hoyISO();
  document.getElementById('adjPaciente').textContent =
    `${fmtNombrePersona(p.apellido)}, ${fmtNombrePersona(p.nombre)} · DNI ${fmtDni(p.dni)}`;
  document.getElementById('adjLinkWrap').classList.add('hidden');
  if (tienePermiso('rayos')) {   // Rayos: siempre son estudios por imágenes
    document.getElementById('adjCategoria').value = 'Estudio por imágenes';
    document.getElementById('adjTitulo').value = 'Radiografía';
  }
  adjuntoArchivos = [];
  adjuntoSubiendo = 0;
  renderAdjuntoArchivos();
  openModal('modalAdjunto');
  setTimeout(() => document.getElementById('adjTitulo').focus(), 50);
}

function esArchivoPermitido(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return file.type.startsWith('image/') || file.type === 'application/pdf' ||
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'pdf'].includes(ext);
}

async function subirArchivosAdjunto(files) {
  for (const file of files) {
    if (!esArchivoPermitido(file)) {
      showToast(`"${file.name}": solo se aceptan PDF o imágenes`);
      continue;
    }
    if (file.size > MAX_MB_ADJUNTO * 1024 * 1024) {
      showToast(`"${file.name}" pesa más de ${MAX_MB_ADJUNTO} MB`);
      continue;
    }
    const item = {
      id: 'adj_' + Math.random().toString(36).slice(2, 10),
      nombre: file.name,
      esPdf: file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
      subiendo: true
    };
    adjuntoArchivos.push(item);
    adjuntoSubiendo++;
    renderAdjuntoArchivos();

    try {
      item.path = await subirArchivoAlStorage(file, '');
      item.url = item.esPdf ? '' : await obtenerUrlFirmada(item.path);
      item.subiendo = false;
      // Si el título está vacío, sugerir el nombre del archivo
      const titulo = document.getElementById('adjTitulo');
      if (titulo && !titulo.value.trim()) titulo.value = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    } catch (err) {
      adjuntoArchivos = adjuntoArchivos.filter(a => a !== item);
      alert(`No se pudo subir "${file.name}": ${err.message}`);
    } finally {
      adjuntoSubiendo--;
      renderAdjuntoArchivos();
    }
  }
}

function renderAdjuntoArchivos() {
  const lista = document.getElementById('adjArchivos');
  const vacio = document.getElementById('adjDropzoneVacio');
  if (!lista) return;
  if (vacio) vacio.classList.toggle('hidden', adjuntoArchivos.length > 0);

  lista.innerHTML = adjuntoArchivos.map(a => `
    <div class="adj-item ${a.subiendo ? 'is-subiendo' : ''}">
      <div class="adj-item-thumb">
        ${a.subiendo ? '<i data-lucide="loader-2" class="spin"></i>'
          : a.esLink ? '<i data-lucide="link"></i>'
          : a.esPdf ? '<i data-lucide="file-text"></i>'
          : (a.url ? `<img src="${escInt(urlSegura(a.url))}" alt="">` : '<i data-lucide="image"></i>')}
      </div>
      <div class="adj-item-info">
        <span class="adj-item-nombre" title="${escInt(a.nombre)}">${escInt(a.nombre)}</span>
        <span class="adj-item-estado">${a.subiendo ? 'Subiendo…' : a.esLink ? 'Link externo' : a.esPdf ? 'PDF · subido' : 'Imagen · subida'}</span>
      </div>
      ${a.subiendo ? '' : `<button type="button" class="adj-item-quitar" onclick="quitarArchivoAdjunto('${a.id}')" title="Quitar"><i data-lucide="x"></i></button>`}
    </div>`).join('');

  const btn = document.getElementById('btnGuardarAdjunto');
  if (btn) {
    btn.disabled = adjuntoSubiendo > 0;
    btn.innerHTML = adjuntoSubiendo > 0
      ? '<i data-lucide="loader-2" class="spin"></i> Esperando subida…'
      : '<i data-lucide="save"></i> Guardar documento';
  }
  if (window.lucide) window.lucide.createIcons();
}

function quitarArchivoAdjunto(id) {
  adjuntoArchivos = adjuntoArchivos.filter(a => a.id !== id);
  renderAdjuntoArchivos();
}

function toggleLinkAdjunto() {
  const wrap = document.getElementById('adjLinkWrap');
  wrap.classList.toggle('hidden');
  if (!wrap.classList.contains('hidden')) document.getElementById('adjLinkInput').focus();
}

function agregarLinkAdjunto() {
  const input = document.getElementById('adjLinkInput');
  const url = input.value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    showToast('El link tiene que empezar con http:// o https://');
    return;
  }
  adjuntoArchivos.push({
    id: 'lnk_' + Date.now(),
    nombre: url.length > 60 ? url.slice(0, 57) + '…' : url,
    path: url, url, esLink: true, esPdf: /\.pdf(\?|$)/i.test(url)
  });
  input.value = '';
  renderAdjuntoArchivos();
}

async function pegarImagenAdjunto() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const tipo = item.types.find(t => t.startsWith('image/'));
      if (tipo) {
        const blob = await item.getType(tipo);
        await subirArchivosAdjunto([new File([blob], `captura_${Date.now()}.png`, { type: tipo })]);
        return;
      }
    }
    showToast('No hay ninguna imagen copiada');
  } catch (err) {
    showToast('No se pudo leer el portapapeles (probá con Ctrl+V dentro de la ventana)');
  }
}

// Arrastrar y soltar / Ctrl+V dentro del modal
function inicializarModalAdjunto() {
  const modal = document.getElementById('modalAdjunto');
  const zona = document.getElementById('adjDropzone');
  if (!modal || !zona || modal.dataset.listo) return;
  modal.dataset.listo = '1';

  ['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); zona.classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, (e) => {
    e.preventDefault(); e.stopPropagation(); zona.classList.remove('is-drag');
  }));
  zona.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files.length) subirArchivosAdjunto(Array.from(e.dataTransfer.files));
  });
  modal.addEventListener('paste', (e) => {
    if (modal.classList.contains('hidden')) return;
    const archivos = Array.from((e.clipboardData && e.clipboardData.files) || []);
    if (archivos.length) { e.preventDefault(); subirArchivosAdjunto(archivos); }
  });
  document.getElementById('adjFileInput').addEventListener('change', (e) => {
    if (e.target.files.length) subirArchivosAdjunto(Array.from(e.target.files));
    e.target.value = '';
  });
  document.getElementById('formAdjunto').addEventListener('submit', guardarAdjunto);
}

async function guardarAdjunto(e) {
  e.preventDefault();
  if (adjuntoSubiendo > 0) return;
  const p = state.selectedPacienteHistoria;
  const titulo = document.getElementById('adjTitulo').value.trim();
  const categoria = document.getElementById('adjCategoria').value;
  const fecha = document.getElementById('adjFecha').value || hoyISO();
  const notas = document.getElementById('adjNotas').value.trim();
  const archivos = adjuntoArchivos.filter(a => !a.subiendo && a.path);

  if (!titulo) { alert('Poné un título para el documento (por ejemplo: "Resonancia de rodilla").'); return; }
  if (archivos.length === 0) { alert('Adjuntá al menos un archivo o link.'); return; }

  const meta = {
    tipo_planilla: 'adjunto',
    titulo, categoria, fecha_documento: fecha, notas,
    archivos: archivos.map(a => ({ path: a.path, nombre: a.nombre, esPdf: !!a.esPdf, esLink: !!a.esLink })),
    imagenes: archivos.map(a => a.path)
  };

  const btn = document.getElementById('btnGuardarAdjunto');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const res = await apiFetch('/historias-clinicas', {
      method: 'POST',
      body: JSON.stringify({
        paciente_id: p.id,
        fecha,
        medico: 'Documento adjunto',
        especialidad: categoria,
        motivo_consulta: titulo,
        observaciones: JSON.stringify(meta)
      })
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'No se pudo guardar el documento');
    }
    showToast(tienePermiso('rayos') ? 'Placa cargada' : 'Documento adjuntado al historial');
    closeModal('modalAdjunto');
    if (tienePermiso('rayos')) cargarRayos();
    adjuntoArchivos = [];
    cargarHistoriasDePaciente(p.id);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    renderAdjuntoArchivos();
  }
}

// Lista de archivos de un documento adjunto, con nombre y URL firmada (desde la cache)
function archivosDeAdjunto(meta) {
  const lista = Array.isArray(meta && meta.archivos) ? meta.archivos
    : (Array.isArray(meta && meta.imagenes) ? meta.imagenes.map(pth => ({ path: pth, nombre: String(pth).split('/').pop(), esPdf: /\.pdf/i.test(pth) })) : []);
  return lista.map(a => {
    const cache = cacheUrlsFirmadas.get(a.path);
    return { ...a, url: a.esLink ? a.path : (cache && cache.url) || '' };
  });
}

function fmtFechaDoc(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

function htmlArchivosAdjunto(meta, grande = false) {
  const archivos = archivosDeAdjunto(meta);
  if (archivos.length === 0) return '<p class="adj-sin-archivos">Sin archivos</p>';
  return `<div class="adj-galeria ${grande ? 'is-grande' : ''}">${archivos.map(a => {
    const icono = a.esLink ? 'external-link' : a.esPdf ? 'file-text' : 'image';
    const esImg = !a.esLink && !a.esPdf && a.url;
    const cuerpo = esImg
      ? `<img src="${escInt(urlSegura(a.url))}" alt="${escInt(a.nombre)}" loading="lazy">`
      : `<span class="adj-galeria-icono is-${a.esLink ? 'link' : a.esPdf ? 'pdf' : 'img'}"><i data-lucide="${icono}"></i></span>`;
    return a.url
      ? `<a class="adj-galeria-item" href="${escInt(urlSegura(a.url))}" target="_blank" rel="noopener" title="Abrir ${escInt(a.nombre)}">${cuerpo}<span class="adj-galeria-nombre">${escInt(a.nombre)}</span>${textoAutorArchivo(a.path) ? `<span class="adj-autor">${escInt(textoAutorArchivo(a.path))}</span>` : ''}</a>`
      : `<span class="adj-galeria-item is-error" title="No se pudo acceder al archivo">${cuerpo}<span class="adj-galeria-nombre">${escInt(a.nombre)} (no disponible)</span></span>`;
  }).join('')}</div>`;
}

// ==========================================================================
// FOJA QUIRÚRGICA + ANESTESIA (frente y dorso de la hoja de quirófano)
// Se guarda como un documento del historial (tipo_planilla: 'foja_quirurgica').
// Se imprime en 2 hojas A4 con el mismo diseño que el papel de la clínica.
// ==========================================================================
const FOJA_EVENTOS = ['', 'Inicio anestesia', 'Inicio operación', 'Fin operación', 'Fin anestesia', 'Otro'];
const FOJA_CAMPOS = {
  hc: 'fjHc', fecha: 'fjFecha', cirujano: 'fjCirujano', ayudante1: 'fjAyud1', ayudante2: 'fjAyud2', ayudante3: 'fjAyud3',
  hora_inicio: 'fjHoraInicio', hora_fin: 'fjHoraFin', dx_pre: 'fjDxPre', dx_post: 'fjDxPost',
  procedimiento: 'fjProcedimiento', hallazgos: 'fjHallazgos', firma_cirujano: 'fjFirmaCirujano'
};
const ANEST_CAMPOS = {
  visita: 'anVisita', servicio: 'anServicio', sala: 'anSala', cama: 'anCama', hora: 'anHora', edad: 'anEdad',
  sexo: 'anSexo', peso: 'anPeso', premedicacion: 'anPremedicacion', agentes: 'anAgentes', metodos: 'anMetodos',
  recuperacion: 'anRecuperacion', observaciones: 'anObservaciones', anestesista: 'anAnestesista',
  sangre: 'anSangre', plasma: 'anPlasma', suero: 'anSuero', otro: 'anOtro', hemo_obs: 'anHemoObs'
};
let fojaEditandoId = null;

function edadDesdeNacimiento(fecha) {
  const d = fecha ? new Date(fecha) : null;
  if (!d || isNaN(d)) return '';
  const hoy = new Date();
  let e = hoy.getFullYear() - d.getFullYear();
  if (hoy.getMonth() < d.getMonth() || (hoy.getMonth() === d.getMonth() && hoy.getDate() < d.getDate())) e--;
  return e >= 0 && e < 130 ? String(e) : '';
}

// Si el paciente está internado, precargar cama y servicio desde la planilla de camas
function camaDePaciente(p) {
  if (!internacionUI.datos || !p) return null;
  const dni = String(p.dni || '').replace(/\D/g, '');
  for (const s of INTERNACION_SECTORES) {
    const b = (internacionUI.datos[s.key] || []).find(x => camaOcupada(x) &&
      ((x.paciente_id && String(x.paciente_id) === String(p.id)) || (dni && String(x.dni).replace(/\D/g, '') === dni)));
    if (b) return { cama: b.cama, servicio: s.titulo };
  }
  return null;
}

function mostrarTabFoja(tab) {
  document.querySelectorAll('#modalFoja .foja-tab').forEach(b => b.classList.toggle('is-active', b.dataset.fojaTab === tab));
  document.querySelectorAll('#modalFoja .foja-panel').forEach(p => p.classList.toggle('hidden', p.dataset.fojaPanel !== tab));
  const body = document.querySelector('#modalFoja .modal-body');
  if (body) body.scrollTop = 0;
}

function filaObsFoja(o = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td data-label="Hora"><input type="time" data-k="hora" value="${escInt(o.hora || '')}"></td>
    <td data-label="Pulso"><input type="text" data-k="pulso" inputmode="numeric" maxlength="3" value="${escInt(o.pulso || '')}" placeholder="lpm"></td>
    <td data-label="Resp."><input type="text" data-k="resp" inputmode="numeric" maxlength="3" value="${escInt(o.resp || '')}" placeholder="rpm"></td>
    <td data-label="T.A."><input type="text" data-k="ta" maxlength="9" value="${escInt(o.ta || '')}" placeholder="120/80"></td>
    <td data-label="Sat O₂"><input type="text" data-k="sat" inputmode="numeric" maxlength="3" value="${escInt(o.sat || '')}" placeholder="%"></td>
    <td data-label="Fluidos"><input type="text" data-k="fluidos" maxlength="40" value="${escInt(o.fluidos || '')}"></td>
    <td data-label="Evento" class="td-evento"><select data-k="evento">${FOJA_EVENTOS.map(ev => `<option ${ev === (o.evento || '') ? 'selected' : ''} value="${escInt(ev)}">${ev || '—'}</option>`).join('')}</select></td>
    <td class="td-quitar"><button type="button" class="foja-obs-quitar" title="Quitar fila"><i data-lucide="x"></i></button></td>`;
  tr.querySelector('.foja-obs-quitar').addEventListener('click', () => { tr.remove(); });
  return tr;
}

function agregarObsFoja(o) {
  const body = document.getElementById('anObsBody');
  if (body.children.length >= 40) { showToast('Máximo 40 observaciones'); return; }
  body.appendChild(filaObsFoja(o));
  if (window.lucide) window.lucide.createIcons();
}

function leerObsFoja() {
  return Array.from(document.querySelectorAll('#anObsBody tr')).map(tr => {
    const o = {};
    tr.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.value.trim(); });
    return o;
  }).filter(o => Object.values(o).some(v => v));
}

function inicializarModalFoja() {
  const modal = document.getElementById('modalFoja');
  if (!modal || modal.dataset.listo) return;
  modal.dataset.listo = '1';
  modal.querySelectorAll('.foja-tab').forEach(b => b.addEventListener('click', () => mostrarTabFoja(b.dataset.fojaTab)));
  document.getElementById('anObsAgregar').addEventListener('click', () => agregarObsFoja());
  document.getElementById('formFoja').addEventListener('submit', guardarFoja);
}

function cerrarModalFoja() {
  closeModal('modalFoja');
  fojaEditandoId = null;
}

function openModalFoja(historiaId) {
  const p = state.selectedPacienteHistoria;
  if (!p) {
    alert('Primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.');
    return;
  }
  inicializarModalFoja();
  document.getElementById('formFoja').reset();
  document.getElementById('anObsBody').innerHTML = '';
  mostrarTabFoja('cirugia');

  const h = historiaId ? (state.historiasList || []).find(x => String(x.id) === String(historiaId)) : null;
  const meta = h ? obtenerMetaHistoria(h) : null;
  fojaEditandoId = h ? h.id : null;

  document.getElementById('fojaTituloModal').textContent = h ? 'Editar Foja Quirúrgica' : 'Foja Quirúrgica';
  document.getElementById('fojaPaciente').textContent = `${fmtNombrePersona(p.apellido)}, ${fmtNombrePersona(p.nombre)} · DNI ${fmtDni(p.dni)}`;
  document.getElementById('btnGuardarFoja').innerHTML = `<i data-lucide="save"></i> ${h ? 'Actualizar' : 'Guardar'} Foja Quirúrgica`;

  if (meta) {
    const fq = meta.foja || {}, an = meta.anestesia || {};
    Object.entries(FOJA_CAMPOS).forEach(([k, id]) => { document.getElementById(id).value = fq[k] || ''; });
    Object.entries(ANEST_CAMPOS).forEach(([k, id]) => { document.getElementById(id).value = an[k] || ''; });
    const rad = document.querySelector(`input[name="anInduccion"][value="${an.induccion || ''}"]`);
    if (rad) rad.checked = true;
    (an.registro || []).forEach(o => agregarObsFoja(o));
  } else {
    document.getElementById('fjFecha').value = hoyISO();
    document.getElementById('anEdad').value = edadDesdeNacimiento(p.fecha_nac);
    const cama = camaDePaciente(p);
    if (cama) {
      document.getElementById('anCama').value = cama.cama;
      document.getElementById('anServicio').value = cama.servicio;
    }
  }
  if (document.getElementById('anObsBody').children.length === 0) {
    for (let i = 0; i < 4; i++) agregarObsFoja();
  }
  openModal('modalFoja');
  if (window.lucide) window.lucide.createIcons();
}

async function guardarFoja(e) {
  e.preventDefault();
  const p = state.selectedPacienteHistoria;
  const val = (id) => document.getElementById(id).value.trim();

  const foja = {}, anestesia = {};
  Object.entries(FOJA_CAMPOS).forEach(([k, id]) => { foja[k] = val(id); });
  Object.entries(ANEST_CAMPOS).forEach(([k, id]) => { anestesia[k] = val(id); });
  const rad = document.querySelector('input[name="anInduccion"]:checked');
  anestesia.induccion = rad ? rad.value : '';
  anestesia.registro = leerObsFoja();

  const faltan = [];
  if (!foja.fecha) faltan.push('Fecha');
  if (!foja.cirujano) faltan.push('Cirujano');
  if (!foja.procedimiento) faltan.push('Procedimiento quirúrgico');
  if (faltan.length) {
    mostrarTabFoja('cirugia');
    alert('Completá: ' + faltan.join(', '));
    return;
  }

  const meta = { tipo_planilla: 'foja_quirurgica', foja, anestesia };
  const body = {
    paciente_id: p.id,
    fecha: foja.fecha,
    medico: foja.cirujano,
    especialidad: 'Cirugía',
    motivo_consulta: foja.procedimiento.slice(0, 250),
    diagnostico: foja.dx_post || foja.dx_pre || null,
    observaciones: JSON.stringify(meta)
  };

  const btn = document.getElementById('btnGuardarFoja');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const res = fojaEditandoId
      ? await apiFetch(`/historias-clinicas/${fojaEditandoId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await apiFetch('/historias-clinicas', { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || 'No se pudo guardar la foja');
    }
    showToast(fojaEditandoId ? 'Foja quirúrgica actualizada' : 'Foja quirúrgica guardada');
    cerrarModalFoja();
    cargarHistoriasDePaciente(p.id);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save"></i> ${fojaEditandoId ? 'Actualizar' : 'Guardar'} Foja Quirúrgica`;
    if (window.lucide) window.lucide.createIcons();
  }
}

// ---------- Gráfico de la grilla de anestesia (SVG, igual que el papel) ----------
function svgGrillaAnestesia(registro) {
  const obs = registro || [];
  const cols = Math.max(24, obs.length);
  const L = 120, W = 880, colW = W / cols;       // columna de rótulos + grilla
  const topBand = 22, chartH = 390, rowH = 24;
  const filas = [['Hora de las observ.', 'hora'], ['T.A.', 'ta'], ['Sat O₂ %', 'sat'], ['Fluidos', 'fluidos']];
  const H = topBand + chartH + filas.length * rowH;
  const yVal = (v) => topBand + chartH - (Math.max(0, Math.min(200, v)) / 200) * chartH;
  const num = (v) => { const n = parseFloat(String(v || '').replace(',', '.')); return isNaN(n) ? null : n; };
  const cx = (i) => L + colW * i + colW / 2;
  let s = `<svg class="foja-svg" viewBox="0 0 ${L + W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, Helvetica, sans-serif">`;

  // Grilla fina (como el papel cuadriculado)
  for (let i = 0; i <= cols; i++) s += `<line x1="${L + colW * i}" y1="${topBand}" x2="${L + colW * i}" y2="${H}" stroke="#000" stroke-width="${i % 4 === 0 ? 0.8 : 0.35}"/>`;
  for (let v = 0; v <= 200; v += 10) s += `<line x1="${L}" y1="${yVal(v)}" x2="${L + W}" y2="${yVal(v)}" stroke="#000" stroke-width="${v % 50 === 0 ? 0.8 : 0.35}"/>`;
  for (let r = 0; r <= filas.length; r++) s += `<line x1="0" y1="${topBand + chartH + r * rowH}" x2="${L + W}" y2="${topBand + chartH + r * rowH}" stroke="#000" stroke-width="0.8"/>`;
  s += `<line x1="${L}" y1="${topBand}" x2="${L + W}" y2="${topBand}" stroke="#000" stroke-width="0.8"/>`;
  s += `<line x1="${L}" y1="0" x2="${L}" y2="${H}" stroke="#000" stroke-width="0.8"/>`;

  // Escala y rótulos izquierdos
  for (let v = 0; v <= 200; v += 50) s += `<text x="${L - 4}" y="${yVal(v) + 3}" font-size="9" text-anchor="end">${v}</text>`;
  s += `<text x="4" y="${topBand + 30}" font-size="10" font-weight="bold">PLANO DE</text><text x="4" y="${topBand + 43}" font-size="10" font-weight="bold">3ER ESTUDIO</text>`;
  s += `<text x="4" y="${topBand + 150}" font-size="10" font-weight="bold">RESP. ●</text><text x="4" y="${topBand + 163}" font-size="10" font-weight="bold">PULSO ○</text>`;
  s += `<text x="4" y="${topBand + 262}" font-size="10" font-weight="bold">OPERAC. ⁞</text><text x="4" y="${topBand + 275}" font-size="10" font-weight="bold">ANESTES. ✕</text>`;
  filas.forEach(([lbl], r) => { s += `<text x="4" y="${topBand + chartH + r * rowH + 16}" font-size="9.5" font-weight="bold">${lbl}</text>`; });

  // Eventos (banda superior): anestesia ✕, operación línea punteada
  obs.forEach((o, i) => {
    const ev = (o.evento || '').toLowerCase();
    if (ev.includes('anestesia')) s += `<text x="${cx(i)}" y="16" font-size="13" text-anchor="middle" font-weight="bold">✕</text>`;
    if (ev.includes('operación') || ev.includes('operacion')) {
      s += `<line x1="${cx(i)}" y1="${topBand}" x2="${cx(i)}" y2="${topBand + chartH}" stroke="#000" stroke-width="1.2" stroke-dasharray="3 3"/>`;
      s += `<text x="${cx(i)}" y="16" font-size="12" text-anchor="middle" font-weight="bold">⁞</text>`;
    }
  });

  // Curvas: pulso (○) y respiración (●)
  const serie = (k) => obs.map((o, i) => ({ i, v: num(o[k]) })).filter(p => p.v !== null);
  const puls = serie('pulso'), resp = serie('resp');
  if (puls.length > 1) s += `<polyline fill="none" stroke="#000" stroke-width="1.1" points="${puls.map(p => `${cx(p.i)},${yVal(p.v)}`).join(' ')}"/>`;
  if (resp.length > 1) s += `<polyline fill="none" stroke="#000" stroke-width="1" stroke-dasharray="4 2" points="${resp.map(p => `${cx(p.i)},${yVal(p.v)}`).join(' ')}"/>`;
  puls.forEach(p => { s += `<circle cx="${cx(p.i)}" cy="${yVal(p.v)}" r="3.4" fill="#fff" stroke="#000" stroke-width="1.2"/>`; });
  resp.forEach(p => { s += `<circle cx="${cx(p.i)}" cy="${yVal(p.v)}" r="2.6" fill="#000"/>`; });

  // Filas inferiores: hora, TA, Sat, fluidos (texto rotado si no entra)
  obs.forEach((o, i) => {
    filas.forEach(([, k], r) => {
      const t = String(o[k] || '');
      if (!t) return;
      const fs = t.length > 5 ? Math.max(5.5, 8.5 - (t.length - 5) * 0.6) : 8.5;
      s += `<text x="${cx(i)}" y="${topBand + chartH + r * rowH + 15.5}" font-size="${fs}" text-anchor="middle">${escInt(t)}</text>`;
    });
  });
  return s + '</svg>';
}

// Membrete de la clínica (común a todas las planillas impresas)
function membreteClinicaHTML() {
  return `
    <div class="foja-membrete">
      <img src="assets/logo.jpg" alt="" class="foja-logo">
      <div>
        <div class="foja-membrete-nombre">CLÍNICA PASSO S.A.</div>
        <div class="foja-membrete-dir">Av. Eva Perón 3097 (1834) Temperley - Bs. As. - Tel/Fax 4264-0056 / 1652</div>
        <div class="foja-membrete-inst">INSTITUTO PRIVADO DE CIRUGÍA</div>
      </div>
    </div>`;
}

// ---------- Las 2 hojas (frente: Foja quirúrgica / dorso: Anestesia) ----------
function construirFojaHTML(h, pac) {
  const meta = obtenerMetaHistoria(h);
  const f = meta.foja || {}, a = meta.anestesia || {};
  const v = (x) => escInt(x || '');
  const fecha = fmtFechaDoc(f.fecha);
  const nombre = v(pac.nombre_completo);
  const cabecera = membreteClinicaHTML();
  const campo = (lbl, val, cls = '') => `<div class="foja-campo ${cls}"><span class="foja-lbl">${lbl}</span><span class="foja-val">${val}</span></div>`;
  const parrafo = (t) => v(t).replace(/\n/g, '<br>');
  const chk = (op) => `<span class="foja-chk">${a.induccion === op ? '☒' : '☐'}</span>`;

  const hoja1 = `
    <div class="foja-page">
      ${cabecera}
      <h2 class="foja-titulo">FOJA QUIRÚRGICA</h2>
      <div class="foja-fila">${campo('APELLIDOS Y NOMBRES', nombre, 'flex3')}${campo('H.C. N°', v(f.hc))}</div>
      <div class="foja-fila">${campo('CIRUJANO', v(f.cirujano), 'flex2')}${campo('1ER AYUDANTE', v(f.ayudante1), 'flex2')}</div>
      <div class="foja-fila">${campo('2DO AYUDANTE', v(f.ayudante2), 'flex2')}${campo('3ER AYUDANTE', v(f.ayudante3), 'flex2')}</div>
      <div class="foja-fila">${campo('FECHA', fecha)}${campo('HORA OPERACIÓN COMENZÓ', v(f.hora_inicio))}${campo('TERMINÓ', v(f.hora_fin))}</div>
      <div class="foja-cuerpo">
        <div class="foja-informe">
          <h4>1. Diagnóstico preoperatorio</h4><p>${parrafo(f.dx_pre) || '&nbsp;'}</p>
          <h4>2. Diagnóstico posoperatorio</h4><p>${parrafo(f.dx_post) || '&nbsp;'}</p>
          <h4>3. Procedimiento quirúrgico</h4><p>${parrafo(f.procedimiento) || '&nbsp;'}</p>
          <h4>4. Operación y hallazgos</h4><p class="foja-hallazgos">${parrafo(f.hallazgos) || '&nbsp;'}</p>
          <div class="foja-firma"><div class="foja-firma-linea"></div><div>5. Firma — ${v(f.firma_cirujano || f.cirujano)}</div></div>
        </div>
        <div class="foja-orden">
          <strong>ORDENAMIENTO</strong>
          <ol><li>Diagnóstico preoperatorio</li><li>Diagnóstico posoperatorio</li><li>Procedimiento quirúrgico</li><li>Operación y hallazgos</li><li>Firma</li></ol>
        </div>
      </div>
    </div>`;

  const hoja2 = `
    <div class="foja-page">
      ${cabecera}
      <div class="foja-bloque">${campo('VISITA PREANESTÉSICA', parrafo(a.visita), 'flex3 foja-multilinea')}</div>
      <div class="foja-fila foja-fila-titulo"><h2 class="foja-titulo foja-titulo-izq">ANESTESIA</h2>${campo('H.C. N°', v(f.hc))}</div>
      <div class="foja-fila">${campo('APELLIDO Y NOMBRES', nombre, 'flex3')}${campo('CAMA N°', v(a.cama))}</div>
      <div class="foja-fila">${campo('SERVICIO', v(a.servicio), 'flex2')}${campo('SALA', v(a.sala))}${campo('PESO', v(a.peso) + (a.peso ? ' kg' : ''))}</div>
      <div class="foja-fila">${campo('FECHA', fecha)}${campo('EDAD', v(a.edad))}${campo('SEXO', v(a.sexo))}${campo('HORA', v(a.hora))}</div>
      <div class="foja-fila">${campo('PREMEDICACIÓN', v(a.premedicacion), 'flex3')}</div>
      <div class="foja-fila foja-induccion"><span class="foja-lbl">INDUCCIÓN</span>
        <span>SATISFACTORIA ${chk('Satisfactoria')}</span><span>PROLONGADA ${chk('Prolongada')}</span><span>TORMENTOSA ${chk('Tormentosa')}</span></div>
      <div class="foja-grafico">${svgGrillaAnestesia(a.registro)}</div>
      <div class="foja-fila">${campo('AGENTES ANESTÉSICOS', v(a.agentes), 'flex3')}</div>
      <div class="foja-fila">${campo('MÉTODOS ANESTÉSICOS', v(a.metodos), 'flex3')}</div>
      <div class="foja-fila">${campo('RECUPERACIÓN', v(a.recuperacion), 'flex3')}</div>
      <div class="foja-bloque">${campo('OBSERVACIONES', parrafo(a.observaciones), 'flex3 foja-multilinea')}</div>
      <div class="foja-firma foja-firma-der"><div class="foja-firma-linea"></div><div>FIRMA DEL ANESTESISTA${a.anestesista ? ' — ' + v(a.anestesista) : ''}</div></div>
      <div class="foja-hemo">
        <div class="foja-hemo-izq">
          <strong>HEMOTERAPIA:</strong>
          <table><tr><td>SANGRE</td><td>${v(a.sangre)}</td><td>Cm³</td></tr><tr><td>PLASMA</td><td>${v(a.plasma)}</td><td>Cm³</td></tr>
          <tr><td>SUERO</td><td>${v(a.suero)}</td><td>Cm³</td></tr><tr><td>OTRO</td><td>${v(a.otro)}</td><td>Cm³</td></tr></table>
        </div>
        <div class="foja-hemo-der"><strong>OBSERVACIONES</strong><p>${parrafo(a.hemo_obs)}</p></div>
      </div>
    </div>`;
  return hoja1 + hoja2;
}

function pacienteParaImprimir() {
  const p = state.selectedPacienteHistoria || {};
  return { nombre_completo: `${fmtNombrePersona(p.apellido)}, ${fmtNombrePersona(p.nombre)}`, dni: p.dni || '' };
}

function imprimirFoja(historiaId) {
  const h = (state.historiasList || []).find(x => String(x.id) === String(historiaId));
  if (!h) return;
  document.getElementById('printArea').innerHTML = `<div class="foja-print">${construirFojaHTML(h, pacienteParaImprimir())}</div>`;
  lanzarImpresion(`${pacienteParaImprimir().nombre_completo} — Foja Quirúrgica`);
}

// ==========================================================================
// PLANILLAS CLÍNICAS: EPICRISIS · EVOLUCIÓN DE ENFERMERÍA · INDICACIONES MÉDICAS
// --------------------------------------------------------------------------
// Motor común: cada planilla se describe con una lista de campos (esquema).
// A partir del esquema se arma el formulario, se guarda en el historial,
// se muestra la tarjeta, se edita y se imprime con el membrete de la clínica.
// ==========================================================================
const VIAS_ADMIN = ['VO', 'EV', 'IM', 'SC', 'SL', 'Inhalatoria', 'Tópica', 'SNG', 'Rectal'];

const PLANILLAS = {
  // -------------------------------------------------------------- EPICRISIS
  epicrisis: {
    titulo: 'Epicrisis', tituloImpreso: 'EPICRISIS — RESUMEN DE INTERNACIÓN',
    icono: 'file-check-2', badge: 'badge-epicrisis', tarjeta: 'timeline-card-epicrisis',
    campoFecha: 'fecha_egreso', campoProfesional: 'medico', etiquetaProfesional: 'Médico',
    inmodificable: true,   // se guarda una sola vez: no se edita ni se borra (lo controla también el servidor)
    requeridos: ['fecha_ingreso', 'fecha_egreso', 'medico', 'dx_egreso'],
    esquema: [
      { tipo: 'aviso', icono: 'lock', texto: 'Revisá bien la epicrisis antes de guardarla: una vez guardada no se puede modificar.' },
      { tipo: 'seccion', titulo: 'Internación', icono: 'bed-double' },
      { tipo: 'fila', campos: [
        { k: 'fecha_ingreso', label: 'Fecha de ingreso *', tipo: 'date' },
        { k: 'fecha_egreso', label: 'Fecha de egreso *', tipo: 'date' },
        { k: 'servicio', label: 'Servicio' },
        { k: 'cama', label: 'Cama' }
      ] },
      { tipo: 'fila', campos: [
        { k: 'medico', label: 'Médico responsable *' },
        { k: 'matricula', label: 'Matrícula' },
        { k: 'hc', label: 'H.C. N°' }
      ] },
      { tipo: 'seccion', titulo: 'Diagnósticos', icono: 'stethoscope' },
      { k: 'motivo', label: 'Motivo de internación', tipo: 'textarea', filas: 2 },
      { k: 'dx_ingreso', label: 'Diagnóstico de ingreso', tipo: 'textarea', filas: 2 },
      { k: 'dx_egreso', label: 'Diagnóstico de egreso (principal) *', tipo: 'textarea', filas: 2 },
      { k: 'dx_secundarios', label: 'Diagnósticos secundarios / comorbilidades', tipo: 'textarea', filas: 2 },
      { tipo: 'seccion', titulo: 'Resumen de la internación', icono: 'file-text' },
      { k: 'antecedentes', label: 'Antecedentes relevantes', tipo: 'textarea', filas: 2 },
      { k: 'evolucion', label: 'Evolución durante la internación', tipo: 'textarea', filas: 7 },
      { k: 'procedimientos', label: 'Cirugías y procedimientos realizados', tipo: 'textarea', filas: 3,
        accion: { texto: 'Traer cirugías de esta internación', icono: 'scissors', fn: 'traerCirugiasEpicrisis' } },
      { k: 'estudios', label: 'Estudios complementarios relevantes', tipo: 'textarea', filas: 3 },
      { k: 'tratamiento', label: 'Tratamiento recibido', tipo: 'textarea', filas: 3 },
      { tipo: 'seccion', titulo: 'Alta', icono: 'log-out' },
      { tipo: 'fila', campos: [
        { k: 'condicion', label: 'Condición al alta', tipo: 'select',
          opciones: ['', 'Mejorado', 'Curado', 'Sin cambios', 'Derivado a otro centro', 'Alta voluntaria', 'Óbito'] }
      ] },
      { k: 'indicaciones_alta', label: 'Indicaciones al alta (medicación, dieta, reposo, curaciones)', tipo: 'textarea', filas: 4 },
      { k: 'seguimiento', label: 'Controles y seguimiento', tipo: 'textarea', filas: 2 }
    ],
    resumen: (m) => ({
      titulo: m.dx_egreso || 'Epicrisis',
      detalle: [
        m.fecha_ingreso && m.fecha_egreso ? `Internación ${fmtFechaDoc(m.fecha_ingreso)} → ${fmtFechaDoc(m.fecha_egreso)} (${diasEntre(m.fecha_ingreso, m.fecha_egreso)} días)` : '',
        m.condicion ? `Condición al alta: ${m.condicion}` : ''
      ].filter(Boolean).join(' · ')
    })
  },

  // -------------------------------------------------- EVOLUCIÓN DE ENFERMERÍA
  enfermeria: {
    titulo: 'Evolución de Enfermería', tituloImpreso: 'EVOLUCIÓN DE ENFERMERÍA',
    icono: 'heart-pulse', badge: 'badge-enfermeria', tarjeta: 'timeline-card-enfermeria',
    campoFecha: 'fecha', campoProfesional: 'enfermero', etiquetaProfesional: 'Enfermero/a',
    inmodificable: true,   // una vez registrada no se edita ni se borra (lo controla también el servidor)
    requeridos: ['turno', 'enfermero', 'evolucion'],
    esquema: [
      { tipo: 'aviso', icono: 'lock', texto: 'La fecha y la hora se registran automáticamente al guardar. Una vez guardada, la evolución no se puede modificar.' },
      { tipo: 'fila', campos: [
        { k: 'fecha', label: 'Fecha', tipo: 'sello' },
        { k: 'hora', label: 'Hora', tipo: 'sello' },
        { k: 'turno', label: 'Turno *', tipo: 'select', opciones: ['', 'Mañana', 'Tarde', 'Noche'] },
        { k: 'cama', label: 'Cama' }
      ] },
      { tipo: 'fila', campos: [
        { k: 'enfermero', label: 'Enfermero/a *' },
        { k: 'matricula', label: 'Matrícula' }
      ] },
      { tipo: 'seccion', titulo: 'Controles', icono: 'activity' },
      { tipo: 'fila', campos: [
        { k: 'ta', label: 'T.A.', ph: '120/80' },
        { k: 'fc', label: 'F.C. (lpm)', num: true },
        { k: 'fr', label: 'F.R. (rpm)', num: true },
        { k: 'temp', label: 'Temp. (°C)', num: true },
        { k: 'sat', label: 'Sat O₂ (%)', num: true },
        { k: 'hgt', label: 'Glucemia (HGT)', num: true },
        { k: 'dolor', label: 'Dolor (0-10)', tipo: 'select', opciones: ['', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] }
      ] },
      { tipo: 'seccion', titulo: 'Balance', icono: 'droplets' },
      { tipo: 'fila', campos: [
        { k: 'ingresos', label: 'Ingresos', ph: 'VO 500 · EV 1500 ml' },
        { k: 'diuresis', label: 'Diuresis', ph: 'ml' },
        { k: 'drenajes', label: 'Drenajes', ph: 'ml / aspecto' },
        { k: 'catarsis', label: 'Catarsis', tipo: 'select', opciones: ['', 'Sí', 'No'] }
      ] },
      { tipo: 'seccion', titulo: 'Cuidados realizados', icono: 'check-square' },
      { k: 'cuidados', tipo: 'checks', opciones: [
        'Higiene y confort', 'Rotación de decúbito', 'Curación', 'Control de vía periférica', 'Cambio de vía',
        'Control de sondas', 'Control de drenajes', 'Medicación según indicación', 'Extracción de muestras', 'Deambulación asistida'
      ] },
      { tipo: 'seccion', titulo: 'Evolución', icono: 'notebook-pen' },
      { k: 'evolucion', label: 'Evolución de enfermería *', tipo: 'textarea', filas: 6,
        ph: 'Estado general, conciencia, tolerancia, descanso, novedades del turno...' }
    ],
    resumen: (m) => ({
      titulo: `Turno ${m.turno || '-'}${m.hora ? ' · ' + m.hora + ' hs' : ''}`,
      detalle: [
        m.ta ? `TA ${m.ta}` : '', m.fc ? `FC ${m.fc}` : '', m.fr ? `FR ${m.fr}` : '',
        m.temp ? `T ${m.temp}°` : '', m.sat ? `Sat ${m.sat}%` : '', m.hgt ? `HGT ${m.hgt}` : ''
      ].filter(Boolean).join(' · '),
      texto: m.evolucion
    })
  },

  // ---------------------------------------------------- INDICACIONES MÉDICAS
  indicaciones: {
    titulo: 'Indicaciones Médicas', tituloImpreso: 'INDICACIONES MÉDICAS', plural: true,
    icono: 'pill', badge: 'badge-indicaciones', tarjeta: 'timeline-card-indicaciones',
    campoFecha: 'fecha', campoProfesional: 'medico', etiquetaProfesional: 'Médico',
    inmodificable: true,   // son las del día: se guardan una vez y no se editan (lo controla también el servidor)
    requeridos: ['fecha', 'medico'],
    esquema: [
      { tipo: 'aviso', icono: 'lock', texto: 'Las indicaciones son del día: una vez guardadas no se pueden modificar. Mañana se cargan nuevas (podés copiar las anteriores).' },
      { tipo: 'accion', texto: 'Copiar las indicaciones anteriores', icono: 'copy', fn: 'copiarIndicacionesAnteriores' },
      { tipo: 'fila', campos: [
        { k: 'fecha', label: 'Fecha *', tipo: 'date' },
        { k: 'hora', label: 'Hora', tipo: 'time' },
        { k: 'cama', label: 'Cama' },
        { k: 'peso', label: 'Peso (kg)', num: true }
      ] },
      { tipo: 'fila', campos: [
        { k: 'medico', label: 'Médico *' },
        { k: 'matricula', label: 'Matrícula' }
      ] },
      { tipo: 'seccion', titulo: 'Plan', icono: 'clipboard-list' },
      { k: 'dieta', label: '1. Dieta', ph: 'Ej: Dieta general hiposódica · Ayuno desde las 00 h' },
      { k: 'hidratacion', label: '2. Hidratación / PHP', ph: 'Ej: Solución fisiológica 1500 ml/24 h a 21 gotas/min' },
      { tipo: 'seccion', titulo: '3. Medicación', icono: 'pill' },
      { k: 'medicacion', tipo: 'tabla', minFilas: 0, maxFilas: 40, numerada: true,
        entradaRapida: {
          placeholder: 'Escribí el medicamento y apretá Enter (ej: Clonazepam 0,5 mg VO c/12 h)',
          vacio: 'Todavía no agregaste medicamentos. Escribilos arriba, uno por uno, y apretá Enter.',
          parsear: 'parsearMedicamento'
        },
        columnas: [
        { k: 'droga', label: 'Droga', ancho: '30%' },
        { k: 'dosis', label: 'Dosis', ancho: '14%' },
        { k: 'via', label: 'Vía', tipo: 'select', opciones: [''].concat(VIAS_ADMIN), ancho: '12%' },
        { k: 'frecuencia', label: 'Frecuencia', ancho: '16%', ph: 'c/8 h' },
        { k: 'obs', label: 'Observaciones', ancho: '28%' }
      ] },
      { tipo: 'seccion', titulo: 'Otras indicaciones', icono: 'list-checks' },
      { k: 'controles', label: '4. Controles', tipo: 'textarea', filas: 2, ph: 'Signos vitales c/6 h · Diuresis · HGT c/8 h' },
      { k: 'cuidados', label: '5. Cuidados de enfermería', tipo: 'textarea', filas: 2, ph: 'Cabecera a 30° · Rotación de decúbito c/2 h · Curación diaria' },
      { k: 'estudios', label: '6. Estudios solicitados', tipo: 'textarea', filas: 2 },
      { k: 'interconsultas', label: '7. Interconsultas', tipo: 'textarea', filas: 2 },
      { k: 'otras', label: '8. Otras', tipo: 'textarea', filas: 2 }
    ],
    resumen: (m) => {
      const meds = (m.medicacion || []).filter(x => x.droga);
      return {
        titulo: `Indicaciones del ${fmtFechaDoc(m.fecha)}${m.hora ? ' · ' + m.hora + ' hs' : ''}`,
        detalle: [m.dieta ? `Dieta: ${m.dieta}` : '', m.hidratacion ? `PHP: ${m.hidratacion}` : ''].filter(Boolean).join(' · '),
        lista: meds.slice(0, 5).map(x => [x.droga, x.dosis, x.via, x.frecuencia].filter(Boolean).join(' ')),
        mas: Math.max(0, meds.length - 5)
      };
    }
  }
};

let planillaActual = { tipo: null, editandoId: null };

function diasEntre(a, b) {
  const d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return '';
  return Math.max(0, Math.round((d2 - d1) / 86400000));
}

// ---------- Construcción del formulario desde el esquema ----------
function htmlCampoPlanilla(c) {
  const id = `pl_${c.k}`;
  if (c.tipo === 'sello') {
    return `<div class="form-group"><label>${c.label}</label><div class="pl-sello" id="${id}"><i data-lucide="clock"></i> Al guardar</div></div>`;
  }
  const ph = c.ph ? ` placeholder="${escInt(c.ph)}"` : '';
  let control;
  if (c.tipo === 'textarea') control = `<textarea id="${id}" rows="${c.filas || 3}" maxlength="8000"${ph}></textarea>`;
  else if (c.tipo === 'select') control = `<select id="${id}">${c.opciones.map(o => `<option value="${escInt(o)}">${o || '—'}</option>`).join('')}</select>`;
  else control = `<input type="${c.tipo || 'text'}" id="${id}" maxlength="300"${c.num ? ' inputmode="decimal"' : ''}${ph}>`;
  const accion = c.accion ? `<button type="button" class="pl-accion-mini" onclick="${c.accion.fn}()"><i data-lucide="${c.accion.icono}"></i> ${c.accion.texto}</button>` : '';
  return `<div class="form-group">${c.label ? `<label for="${id}">${c.label}</label>` : ''}${control}${accion}</div>`;
}

function htmlEsquemaPlanilla(esquema) {
  return esquema.map(item => {
    if (item.tipo === 'seccion') return `<div class="form-section-title mt-2"><i data-lucide="${item.icono || 'dot'}"></i> ${item.titulo}</div>`;
    if (item.tipo === 'aviso') return `<div class="pl-aviso"><i data-lucide="${item.icono || 'info'}"></i><span>${item.texto}</span></div>`;
    if (item.tipo === 'accion') return `<div class="pl-accion-barra"><button type="button" class="btn btn-outline btn-sm" onclick="${item.fn}()"><i data-lucide="${item.icono}"></i> ${item.texto}</button></div>`;
    if (item.tipo === 'fila') return `<div class="pl-fila pl-fila-${Math.min(item.campos.length, 4)}">${item.campos.map(htmlCampoPlanilla).join('')}</div>`;
    if (item.tipo === 'checks') return `<div class="pl-checks" id="pl_${item.k}">${item.opciones.map(o => `<label><input type="checkbox" value="${escInt(o)}"> ${o}</label>`).join('')}</div>`;
    if (item.tipo === 'tabla') {
      const er = item.entradaRapida;
      return `
      ${er ? `
      <div class="pl-rapida">
        <i data-lucide="plus-circle"></i>
        <input type="text" id="pl_${item.k}_rapida" data-tabla="${item.k}" class="pl-rapida-input" maxlength="200" autocomplete="off" enterkeyhint="done" placeholder="${escInt(er.placeholder)}">
        <button type="button" class="btn btn-primary btn-sm" onclick="agregarDesdeEntradaRapida('${item.k}')">Agregar</button>
      </div>` : ''}
      <div class="foja-obs-wrap"><table class="foja-obs-tabla pl-tabla ${item.numerada ? 'pl-tabla-numerada' : ''}" id="pl_${item.k}">
        <thead><tr>${item.numerada ? '<th style="width:36px">N°</th>' : ''}${item.columnas.map(c => `<th style="width:${c.ancho || 'auto'}">${c.label}</th>`).join('')}<th style="width:34px"></th></tr></thead>
        <tbody></tbody></table></div>
      ${er ? `<p class="pl-tabla-vacia" id="pl_${item.k}_vacia">${escInt(er.vacio)}</p>` : `<button type="button" class="btn btn-outline btn-sm" onclick="agregarFilaTablaPlanilla('${item.k}')"><i data-lucide="plus"></i> ${item.agregar || 'Agregar fila'}</button>`}`;
    }
    return htmlCampoPlanilla(item);
  }).join('');
}

function itemsPlanilla(esquema) {
  const out = [];
  esquema.forEach(it => { if (it.tipo === 'fila') out.push(...it.campos); else if (it.k) out.push(it); });
  return out;
}

// Busca la definición de una tabla por su clave (en la planilla abierta o en cualquiera)
function defTablaPlanilla(k) {
  const tipos = [planillaActual.tipo].concat(Object.keys(PLANILLAS)).filter(Boolean);
  for (const tp of tipos) {
    const d = itemsPlanilla(PLANILLAS[tp].esquema).find(x => x.k === k && x.tipo === 'tabla');
    if (d) return d;
  }
  return null;
}

function actualizarTablaPlanilla(k) {
  const tabla = document.getElementById(`pl_${k}`);
  if (!tabla) return;
  const filas = tabla.querySelectorAll('tbody tr');
  filas.forEach((tr, i) => { const n = tr.querySelector('.td-num'); if (n) n.textContent = i + 1; });
  const vacio = document.getElementById(`pl_${k}_vacia`);
  if (vacio) vacio.classList.toggle('hidden', filas.length > 0);
  tabla.closest('.foja-obs-wrap').classList.toggle('hidden', filas.length === 0 && !!vacio);
}

function agregarFilaTablaPlanilla(k, valores = {}, enfocar = false) {
  const def = defTablaPlanilla(k);
  const tbody = document.querySelector(`#pl_${k} tbody`);
  if (!def || !tbody) return null;
  if (tbody.children.length >= (def.maxFilas || 30)) { showToast('Se alcanzó el máximo de filas'); return null; }
  const tr = document.createElement('tr');
  tr.innerHTML = (def.numerada ? '<td class="td-num"></td>' : '') + def.columnas.map(c => c.tipo === 'select'
    ? `<td data-label="${escInt(c.label)}"><select data-k="${c.k}">${c.opciones.map(o => `<option ${o === (valores[c.k] || '') ? 'selected' : ''} value="${escInt(o)}">${o || '—'}</option>`).join('')}</select></td>`
    : `<td data-label="${escInt(c.label)}"><input type="text" data-k="${c.k}" maxlength="200" value="${escInt(valores[c.k] || '')}"${c.ph ? ` placeholder="${escInt(c.ph)}"` : ''}></td>`
  ).join('') + '<td class="td-quitar"><button type="button" class="foja-obs-quitar" title="Quitar"><i data-lucide="x"></i></button></td>';
  tr.querySelector('.foja-obs-quitar').addEventListener('click', () => { tr.remove(); actualizarTablaPlanilla(k); });
  // Enter dentro de una fila: volver a la entrada rápida para seguir la lista
  tr.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
    const rapida = document.getElementById(`pl_${k}_rapida`);
    if (rapida) rapida.focus();
  });
  tbody.appendChild(tr);
  actualizarTablaPlanilla(k);
  if (window.lucide) window.lucide.createIcons();
  if (enfocar) { const i = tr.querySelector('input'); if (i) i.focus(); }
  return tr;
}

// "Clonazepam 0,5 mg VO c/12 h si ansiedad" → { droga, dosis, via, frecuencia, obs }
// El nombre es lo que va antes del primer dato reconocido; lo que sobra va a observaciones.
function parsearMedicamento(texto) {
  const original = String(texto || '').replace(/\s+/g, ' ').trim();
  const r = { droga: '', dosis: '', via: '', frecuencia: '', obs: '' };
  const vias = { vo: 'VO', oral: 'VO', ev: 'EV', iv: 'EV', endovenosa: 'EV', im: 'IM', sc: 'SC', subcutanea: 'SC', 'subcutánea': 'SC',
    sl: 'SL', sublingual: 'SL', inhalatoria: 'Inhalatoria', 'tópica': 'Tópica', topica: 'Tópica', sng: 'SNG', rectal: 'Rectal' };
  const patrones = [
    ['dosis', /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:mg|g|gr|mcg|µg|ml|cc|ui|u|gotas?|comp(?:rimidos?)?|amp(?:ollas?)?|puff|%)(?:\/\w+)?)(?=\s|$)/i],
    ['via', new RegExp(`(?:^|\\s)(${Object.keys(vias).join('|')})(?=\\s|$)`, 'i')],
    ['frecuencia', /(?:^|\s)((?:c\/|cada\s*)\d+\s*(?:h|hs|hrs|horas?)?|dosis\s+únic[ao]|dosis\s+unic[ao]|únic[ao]\s+dosis|si\s+dolor|sos|prn|semanal|quincenal|mensual|diari[oa]|c\/día|\d+\s*veces?\s+(?:al|por)\s+día)(?=\s|$)/i]
  ];
  // Ubicar el primer dato reconocido: antes de eso está el nombre de la droga
  let corte = original.length;
  patrones.forEach(([, re]) => { const m = original.match(re); if (m && m.index < corte) corte = m.index; });
  r.droga = original.slice(0, corte).trim();
  let resto = ' ' + original.slice(corte) + ' ';
  patrones.forEach(([campo, re]) => {
    const m = resto.match(re);
    if (m) { r[campo] = campo === 'via' ? vias[m[1].toLowerCase()] : m[1].trim(); resto = resto.replace(m[0], ' '); }
  });
  r.obs = resto.replace(/\s+/g, ' ').trim();
  if (!r.droga) { r.droga = r.obs; r.obs = ''; }
  if (r.droga) r.droga = r.droga.charAt(0).toUpperCase() + r.droga.slice(1);
  return r;
}

function agregarDesdeEntradaRapida(k) {
  const input = document.getElementById(`pl_${k}_rapida`);
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) { input.focus(); return; }
  const def = defTablaPlanilla(k);
  const fn = def && def.entradaRapida && window[def.entradaRapida.parsear];
  const valores = fn ? fn(texto) : { [def.columnas[0].k]: texto };
  if (agregarFilaTablaPlanilla(k, valores)) {
    input.value = '';
    input.focus();
    const tbody = document.querySelector(`#pl_${k} tbody`);
    if (tbody && tbody.lastElementChild) tbody.lastElementChild.classList.add('fila-nueva');
  }
}

// Enter en los campos de una planilla no debe enviar el formulario
function evitarEnvioConEnter(form) {
  if (!form || form.dataset.sinEnter) return;
  form.dataset.sinEnter = '1';
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON') return;
    e.preventDefault();
    if (el.classList && el.classList.contains('pl-rapida-input')) agregarDesdeEntradaRapida(el.dataset.tabla);
  });
}

function escribirValoresPlanilla(esquema, valores) {
  itemsPlanilla(esquema).forEach(c => {
    const el = document.getElementById(`pl_${c.k}`);
    if (!el || c.tipo === 'sello') return;
    if (c.tipo === 'checks') {
      const marcados = valores[c.k] || [];
      el.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = marcados.includes(cb.value); });
    } else if (c.tipo === 'tabla') {
      el.querySelector('tbody').innerHTML = '';
      const filas = Array.isArray(valores[c.k]) ? valores[c.k] : [];
      filas.forEach(f => agregarFilaTablaPlanilla(c.k, f));
      for (let i = filas.length; i < (c.minFilas || 0); i++) agregarFilaTablaPlanilla(c.k);
      actualizarTablaPlanilla(c.k);
    } else {
      el.value = valores[c.k] || '';
    }
  });
}

function leerValoresPlanilla(esquema) {
  const v = {};
  itemsPlanilla(esquema).forEach(c => {
    const el = document.getElementById(`pl_${c.k}`);
    if (!el || c.tipo === 'sello') return;
    if (c.tipo === 'checks') v[c.k] = Array.from(el.querySelectorAll('input:checked')).map(cb => cb.value);
    else if (c.tipo === 'tabla') {
      v[c.k] = Array.from(el.querySelectorAll('tbody tr')).map(tr => {
        const f = {}; tr.querySelectorAll('[data-k]').forEach(x => { f[x.dataset.k] = x.value.trim(); }); return f;
      }).filter(f => Object.values(f).some(Boolean));
    } else v[c.k] = el.value.trim();
  });
  return v;
}

// ---------- Abrir / guardar ----------
function openModalPlanilla(tipo, historiaId) {
  const cfg = PLANILLAS[tipo];
  const p = state.selectedPacienteHistoria;
  if (!cfg) return;
  if (!p) { alert('Primero seleccioná un paciente buscando por su DNI en el buscador de la izquierda.'); return; }

  const h = historiaId ? (state.historiasList || []).find(x => String(x.id) === String(historiaId)) : null;
  if (h && cfg.inmodificable) {
    showToast(`Las ${cfg.titulo.toLowerCase()} no se pueden modificar una vez registradas.`);
    return;
  }
  planillaActual = { tipo, editandoId: h ? h.id : null };

  document.getElementById('planillaIcono').innerHTML = `<i data-lucide="${cfg.icono}"></i>`;
  document.getElementById('planillaTitulo').textContent = (h ? 'Editar ' : '') + cfg.titulo;
  document.getElementById('planillaPaciente').textContent = `${fmtNombrePersona(p.apellido)}, ${fmtNombrePersona(p.nombre)} · DNI ${fmtDni(p.dni)}`;
  document.getElementById('planillaCuerpo').innerHTML = htmlEsquemaPlanilla(cfg.esquema);
  document.getElementById('btnGuardarPlanilla').innerHTML = `<i data-lucide="save"></i> ${h ? 'Actualizar' : 'Guardar'} ${cfg.titulo}`;

  let valores = h ? (obtenerMetaHistoria(h).datos || {}) : valoresInicialesPlanilla(tipo, p);
  escribirValoresPlanilla(cfg.esquema, valores);

  openModal('modalPlanilla');
  const body = document.querySelector('#modalPlanilla .modal-body');
  if (body) body.scrollTop = 0;
  if (window.lucide) window.lucide.createIcons();
}

// Datos que se completan solos al crear una planilla nueva
function valoresInicialesPlanilla(tipo, p) {
  const v = {};
  const ahora = new Date();
  const hora = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
  const cama = typeof camaDePaciente === 'function' ? camaDePaciente(p) : null;
  if (cama) { v.cama = cama.cama; v.servicio = cama.servicio; }

  if (tipo === 'epicrisis') {
    v.fecha_egreso = hoyISO();
    // Fecha de ingreso desde la planilla de camas, si el paciente está internado
    const b = cama && internacionUI.datos ? INTERNACION_SECTORES.map(s => (internacionUI.datos[s.key] || []).find(x => x.cama === cama.cama && s.titulo === cama.servicio)).find(Boolean) : null;
    if (b && b.fecha) v.fecha_ingreso = fechaIntAISO(b.fecha);
  } else if (tipo === 'enfermeria') {
    v.fecha = hoyISO(); v.hora = hora;
    const hh = ahora.getHours();
    v.turno = hh >= 6 && hh < 14 ? 'Mañana' : (hh >= 14 && hh < 22 ? 'Tarde' : 'Noche');
  } else if (tipo === 'indicaciones') {
    v.fecha = hoyISO(); v.hora = hora;
  }
  return v;
}

function cerrarModalPlanilla() {
  closeModal('modalPlanilla');
  planillaActual = { tipo: null, editandoId: null };
}

async function guardarPlanilla(e) {
  e.preventDefault();
  const { tipo, editandoId } = planillaActual;
  const cfg = PLANILLAS[tipo];
  const p = state.selectedPacienteHistoria;
  if (!cfg || !p) return;

  const datos = leerValoresPlanilla(cfg.esquema);
  const nombres = Object.fromEntries(itemsPlanilla(cfg.esquema).map(c => [c.k, (c.label || c.k).replace(/\s*\*$/, '').replace(/^\d+\.\s*/, '')]));
  const faltan = cfg.requeridos.filter(k => !datos[k] || (Array.isArray(datos[k]) && !datos[k].length));
  if (faltan.length) { alert('Completá: ' + faltan.map(k => nombres[k] || k).join(', ')); return; }
  if (tipo === 'epicrisis' && datos.fecha_ingreso > datos.fecha_egreso) { alert('La fecha de egreso no puede ser anterior a la de ingreso.'); return; }

  if (cfg.inmodificable && !editandoId && tipo !== 'enfermeria' &&
      !confirm(`Vas a guardar ${cfg.plural ? 'las' : 'la'} ${cfg.titulo.toLowerCase()}. Una vez guardada${cfg.plural ? 's' : ''} no se podrá${cfg.plural ? 'n' : ''} modificar. ¿Guardar?`)) return;

  const res = cfg.resumen(datos);
  const body = {
    paciente_id: p.id,
    fecha: datos[cfg.campoFecha] || hoyISO(),
    medico: datos[cfg.campoProfesional],
    especialidad: cfg.titulo,
    motivo_consulta: String(res.titulo || cfg.titulo).slice(0, 250),
    observaciones: JSON.stringify({ tipo_planilla: tipo, datos })
  };

  const btn = document.getElementById('btnGuardarPlanilla');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    const r = editandoId
      ? await apiFetch(`/historias-clinicas/${editandoId}`, { method: 'PUT', body: JSON.stringify(body) })
      : await apiFetch('/historias-clinicas', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'No se pudo guardar'); }
    showToast(`${cfg.titulo} ${editandoId ? 'actualizada' : 'guardada'}${cfg.plural ? 's' : ''}`);
    cerrarModalPlanilla();
    cargarHistoriasDePaciente(p.id);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<i data-lucide="save"></i> ${editandoId ? 'Actualizar' : 'Guardar'} ${cfg.titulo}`;
    if (window.lucide) window.lucide.createIcons();
  }
}

// ---------- Acciones especiales ----------
// Indicaciones: copiar las más recientes del paciente (se renuevan casi siempre iguales)
function copiarIndicacionesAnteriores() {
  const previas = (state.historiasList || [])
    .filter(h => clasificarHistoria(h) === 'indicaciones' && String(h.id) !== String(planillaActual.editandoId))
    .map(h => ({ h, d: obtenerMetaHistoria(h).datos || {} }))
    .sort((a, b) => `${b.d.fecha || ''} ${b.d.hora || ''}`.localeCompare(`${a.d.fecha || ''} ${a.d.hora || ''}`));
  if (!previas.length) { showToast('Este paciente no tiene indicaciones anteriores'); return; }
  const d = { ...previas[0].d };
  const actual = leerValoresPlanilla(PLANILLAS.indicaciones.esquema);
  // Se conservan fecha, hora y médico de hoy; se copia el plan
  ['fecha', 'hora', 'medico', 'matricula'].forEach(k => { d[k] = actual[k] || d[k]; });
  escribirValoresPlanilla(PLANILLAS.indicaciones.esquema, d);
  showToast(`Copiadas las indicaciones del ${fmtFechaDoc(previas[0].d.fecha)}. Revisalas antes de guardar.`);
}

// Epicrisis: traer las fojas quirúrgicas cargadas entre ingreso y egreso
function traerCirugiasEpicrisis() {
  const ing = (document.getElementById('pl_fecha_ingreso') || {}).value || '0000-00-00';
  const egr = (document.getElementById('pl_fecha_egreso') || {}).value || '9999-12-31';
  const fojas = (state.historiasList || [])
    .filter(h => clasificarHistoria(h) === 'foja')
    .map(h => (obtenerMetaHistoria(h).foja || {}))
    .filter(f => f.fecha && f.fecha >= ing && f.fecha <= egr)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!fojas.length) { showToast('No hay fojas quirúrgicas cargadas en esas fechas'); return; }
  const el = document.getElementById('pl_procedimientos');
  const lineas = fojas.map(f => `${fmtFechaDoc(f.fecha)} — ${f.procedimiento}${f.cirujano ? ' (Cirujano: ' + f.cirujano + ')' : ''}${f.dx_post ? '. Dx: ' + f.dx_post : ''}`);
  el.value = (el.value.trim() ? el.value.trim() + '\n' : '') + lineas.join('\n');
  showToast(`${fojas.length} cirugía(s) agregada(s)`);
}

// ---------- Tarjeta del historial ----------
function tarjetaPlanillaHTML(h, tipo) {
  const cfg = PLANILLAS[tipo];
  const d = obtenerMetaHistoria(h).datos || {};
  const r = cfg.resumen(d);
  return `
    <div class="timeline-card ${cfg.tarjeta}">
      <div class="timeline-card-header">
        <span class="timeline-date"><i data-lucide="calendar"></i> ${fmtFechaDoc(d[cfg.campoFecha]) || new Date(h.fecha).toLocaleDateString('es-AR')}</span>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <span class="timeline-doctor"><strong>${cfg.etiquetaProfesional}:</strong> ${escInt(d[cfg.campoProfesional] || h.medico || '-')}</span>
          <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${escInt(h.id)}')"><i data-lucide="eye"></i> Ver</button>
          <button class="btn btn-outline btn-sm btn-print" onclick="imprimirPlanilla('${escInt(h.id)}')"><i data-lucide="printer"></i> Imprimir</button>
          ${cfg.inmodificable ? '' : `<button class="btn btn-outline btn-sm" onclick="openModalPlanilla('${tipo}', '${escInt(h.id)}')"><i data-lucide="pencil"></i> Editar</button>`}
        </div>
      </div>
      <div class="timeline-body">
        <div style="margin-bottom: 8px;"><span class="${cfg.badge}"><i data-lucide="${cfg.icono}"></i> ${cfg.titulo}</span></div>
        <h4>${escInt(r.titulo)}</h4>
        ${r.detalle ? `<p class="pl-card-detalle">${escInt(r.detalle)}</p>` : ''}
        ${r.lista && r.lista.length ? `<ul class="pl-card-lista">${r.lista.map(x => `<li>${escInt(x)}</li>`).join('')}${r.mas ? `<li class="pl-card-mas">+ ${r.mas} más</li>` : ''}</ul>` : ''}
        ${r.texto ? `<p class="pl-card-texto">${escInt(r.texto.length > 260 ? r.texto.slice(0, 257) + '…' : r.texto)}</p>` : ''}
        ${cfg.inmodificable ? `<p class="pl-card-sello"><i data-lucide="lock"></i> ${d.fecha ? `Registrada el ${fmtFechaDoc(d.fecha)}${d.hora ? ' a las ' + escInt(d.hora) + ' hs' : ''}` : 'Guardada'} · no modificable</p>` : ''}
      </div>
    </div>`;
}

// ---------- Hoja impresa (también se usa en el visor) ----------
function hojaPlanillaHTML(h, tipo, pac) {
  const cfg = PLANILLAS[tipo];
  const d = obtenerMetaHistoria(h).datos || {};
  const v = (x) => escInt(x || '');
  const parrafo = (t) => v(t).replace(/\n/g, '<br>');
  const campo = (lbl, val, cls = '') => `<div class="foja-campo ${cls}"><span class="foja-lbl">${escInt(lbl.toUpperCase())}</span><span class="foja-val">${val}</span></div>`;
  const limpio = (c) => (c.label || '').replace(/\s*\*$/, '');
  const valCampo = (c) => (c.tipo === 'date' || (c.tipo === 'sello' && c.k === 'fecha')) ? fmtFechaDoc(d[c.k]) : v(d[c.k]);

  let cuerpo = '';
  cfg.esquema.forEach(it => {
    if (it.tipo === 'accion' || it.tipo === 'aviso') return;
    if (it.tipo === 'seccion') { cuerpo += `<div class="pl-imp-seccion">${escInt(it.titulo.toUpperCase())}</div>`; return; }
    if (it.tipo === 'fila') {
      cuerpo += `<div class="foja-fila">${it.campos.map(c => campo(limpio(c), valCampo(c))).join('')}</div>`;
      return;
    }
    if (it.tipo === 'checks') {
      const marcados = d[it.k] || [];
      cuerpo += `<div class="pl-imp-checks">${it.opciones.map(o => `<span>${marcados.includes(o) ? '☒' : '☐'} ${escInt(o)}</span>`).join('')}</div>`;
      return;
    }
    if (it.tipo === 'tabla') {
      const filas = (d[it.k] || []);
      const total = Math.max(filas.length, it.minFilas || 0, 8);
      cuerpo += `<table class="pl-imp-tabla"><thead><tr><th style="width:5%">N°</th>${it.columnas.map(c => `<th style="width:${c.ancho}">${escInt(c.label)}</th>`).join('')}</tr></thead><tbody>
        ${Array.from({ length: total }, (_, i) => `<tr><td>${i + 1}</td>${it.columnas.map(c => `<td>${v((filas[i] || {})[c.k])}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
      return;
    }
    if (it.tipo === 'textarea') {
      cuerpo += `<div class="pl-imp-bloque"><div class="foja-lbl">${escInt(limpio(it).toUpperCase())}</div><div class="pl-imp-texto" style="min-height:${Math.max(1, it.filas || 2) * 11}px">${parrafo(d[it.k]) || '&nbsp;'}</div></div>`;
      return;
    }
    cuerpo += `<div class="foja-fila">${campo(limpio(it), valCampo(it), 'flex3')}</div>`;
  });

  const prof = d[cfg.campoProfesional];
  return `
    <div class="foja-page pl-page">
      ${membreteClinicaHTML()}
      <h2 class="foja-titulo">${escInt(cfg.tituloImpreso)}</h2>
      <div class="foja-fila">${campo('Apellido y nombres', v(pac.nombre_completo), 'flex3')}${campo('DNI', v(fmtDni(pac.dni)))}</div>
      ${cuerpo}
      <div class="foja-firma foja-firma-der"><div class="foja-firma-linea"></div>
        <div>FIRMA Y SELLO — ${escInt(cfg.etiquetaProfesional.toUpperCase())}${prof ? ': ' + v(prof) : ''}${d.matricula ? ' · M.P. ' + v(d.matricula) : ''}</div>
      </div>
    </div>`;
}

function imprimirPlanilla(historiaId) {
  const h = (state.historiasList || []).find(x => String(x.id) === String(historiaId));
  if (!h) return;
  const tipo = clasificarHistoria(h);
  document.getElementById('printArea').innerHTML = `<div class="foja-print">${hojaPlanillaHTML(h, tipo, pacienteParaImprimir())}</div>`;
  lanzarImpresion(`${pacienteParaImprimir().nombre_completo} — ${PLANILLAS[tipo].titulo}`);
}

function inicializarModalPlanilla() {
  const f = document.getElementById('formPlanilla');
  if (f && !f.dataset.listo) { f.dataset.listo = '1'; f.addEventListener('submit', guardarPlanilla); }
  ['formPlanilla', 'formFoja', 'formAdjunto', 'formEvolucionConsultorio', 'formLaboratorio'].forEach(id => evitarEnvioConEnter(document.getElementById(id)));
}

// ========================================================
// IMPRIMIR TODA LA HISTORIA CLÍNICA (TODOS LOS REGISTROS Y ADJUNTOS)
// ========================================================
async function imprimirTodaHistoriaClinica() {
  const p = state.selectedPacienteHistoria;
  if (!p) return;
  if (!state.historiasList || state.historiasList.length === 0) {
    alert("No hay registros para imprimir.");
    return;
  }

  const btn = document.getElementById('btnImprimirTodaHC');
  if (btn) {
    btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Preparando...';
    btn.disabled = true;
  }

  try {
    let printHTML = '';

    // Portada
    printHTML += `
      <div class="hc-page" style="page-break-after: always; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
        <h1 style="font-size: 2rem; color: var(--primary-dark); margin-bottom: 20px;">Historia Clínica Completa</h1>
        <h2 style="font-size: 1.5rem; margin-bottom: 10px;">${escInt(p.apellido || '')}, ${escInt(p.nombre || '')}</h2>
        <h3 style="font-size: 1.2rem; color: var(--text-muted); margin-bottom: 30px;">DNI: ${escInt(p.dni || 'S/D')}</h3>
        <p style="font-size: 1.1rem; margin-bottom: 10px;">Total de registros médicos: ${state.historiasList.length}</p>
        <p style="font-size: 1rem; color: var(--text-light);">Documento generado el: ${new Date().toLocaleString('es-AR')}</p>
      </div>
    `;

    // Helpers
    let edadCalculada = p.edad || '';
    if (!edadCalculada && (p.fecha_nacimiento || p.fecha_nac)) {
      const birth = new Date((p.fecha_nacimiento || p.fecha_nac));
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        edadCalculada = `${age} años`;
      }
    }

    const pac = {
      nombre_completo: `${fmtNombrePersona(p.apellido || '')}, ${fmtNombrePersona(p.nombre || '')}`.replace(/^,\s*|,\s*$/g, '').trim() || 'Paciente Registrado',
      dni: p.dni || '................',
      sexo: p.sexo || '................',
      edad: edadCalculada || '................',
      obra_social: p.obra_social || 'Particular',
      nro_afiliado: p.nro_afiliado || '................',
      telefono: p.telefono || '-',
      email: p.email || '-',
    };

    // Recorremos orden cronológico? Por defecto historiasList viene más nueva primero. Para la HC a veces se prefiere cronológico (la más vieja primero).
    // Lo dejamos como viene (más nueva a más vieja) para que lo más reciente esté primero.
    for (const h of state.historiasList) {
      let meta = {};
      if (h.observaciones && typeof h.observaciones === 'string' && h.observaciones.startsWith('{')) {
        try { meta = JSON.parse(h.observaciones); } catch (e) { meta = {}; }
      }

      const tipoDoc = clasificarHistoria(h);
      if (tipoDoc === 'laboratorio') {
        printHTML += `<div class="lab-print-sheet lab-print-sheet-multi">${construirPlanillaLabHTML(h, pac.nombre_completo)}</div>`;
      } 
      
      else if (PLANILLAS[tipoDoc]) {
        printHTML += `<div class="foja-print foja-print-multi">${hojaPlanillaHTML(h, tipoDoc, { nombre_completo: pac.nombre_completo, dni: p.dni })}</div>`;
      }
      else if (tipoDoc === 'foja') {
        printHTML += `<div class="foja-print foja-print-multi">${construirFojaHTML(h, { nombre_completo: pac.nombre_completo, dni: pac.dni })}</div>`;
      }
      else if (tipoDoc === 'adjunto') {
        await obtenerUrlsFirmadas(meta.imagenes || []);
        const archivos = archivosDeAdjunto(meta);
        const imgs = archivos.filter(a => a.url && !a.esPdf && !a.esLink);
        const otros = archivos.filter(a => !(a.url && !a.esPdf && !a.esLink));
        printHTML += `
          <div class="hc-page adj-print-page" style="page-break-after: always;">
            <div class="adj-print-head">
              <div><strong>Clínica Passo S.A.</strong> — Documento adjunto</div>
              <div>${escInt(pac.nombre_completo)} · DNI ${escInt(pac.dni || '')}</div>
            </div>
            <h2>${escInt(meta.titulo || h.motivo_consulta || 'Documento')}</h2>
            <p>${escInt(meta.categoria || '')} · Fecha del documento: ${fmtFechaDoc(meta.fecha_documento) || '-'}</p>
            ${meta.notas ? `<p style="white-space: pre-wrap;">${escInt(meta.notas)}</p>` : ''}
            ${otros.length ? `<p><em>Archivos que se imprimen por separado:</em> ${otros.map(a => escInt(a.nombre)).join(', ')}</p>` : ''}
            ${imgs.map(a => `<img src="${escInt(urlSegura(a.url))}" class="adj-print-img">`).join('')}
          </div>`;
      }
      else if (tipoDoc === 'consultorio') {
          const fechaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleDateString('es-AR') : new Date(h.fecha).toLocaleDateString('es-AR');
          const horaAtencion = meta.fecha_hora ? new Date(meta.fecha_hora).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '................';
          const evolucionTexto = meta.evolucion || h.motivo_consulta || '';
          const indicacionesTexto = meta.indicaciones || h.tratamiento || '';

          printHTML += `
            <!-- PÁGINA: PLANILLA DE EVOLUCIÓN MÉDICA (CONSULTORIO) -->
            <div class="hc-page hc-page-consultorio" style="page-break-after: always; zoom: 0.85;">
              
              <!-- Encabezado Membrete -->
              <div class="hc-top-header">
                <div class="hc-header-institution">
                  <strong>Clínica Passo S.A.</strong>
                  <span>Av. Eva Perón 3097 - Témperley</span>
                  <span>Tel: 4264-0056 / 1652 · Guardia 24 hs</span>
                </div>
                <div class="hc-header-hcnum">
                  <span class="hc-num-label">H.C. N°:</span>
                  <span class="hc-num-val">${escInt(p.dni || "-")}</span>
                </div>
              </div>

              <!-- Título Oficial -->
              <div class="hc-title-container">
                <h1 class="hc-main-heading">Evolución Médica</h1>
                <p style="font-size: 11px; text-transform: uppercase; color: #475569; margin: 2px 0 0 0; letter-spacing: 0.05em; font-weight: 600;">Atención de Consultorio Externo</p>
              </div>

              <div class="hc-patient-table" style="margin-bottom: 15px;">
                <div class="hc-row">
                  <div class="hc-col hc-col-left">
                    <span class="hc-lbl">Nombre Paciente:</span>
                    <span class="hc-val">${escInt(p.nombre_completo || (p.apellido + ", " + p.nombre))}</span>
                  </div>
                  <div class="hc-col hc-col-right">
                    <span class="hc-lbl">Médico Tratante:</span>
                    <span class="hc-val">${escInt(h.medico || 'Médico Tratante')} ${h.matricula ? `(${escInt(h.matricula)})` : ''}</span>
                  </div>
                </div>
                <div class="hc-row">
                  <div class="hc-col hc-col-left">
                    <span class="hc-lbl">DNI:</span>
                    <span class="hc-val">${escInt(p.dni || "-")}</span>
                  </div>
                  <div class="hc-col hc-col-right">
                    <span class="hc-lbl">Obra Social:</span>
                    <span class="hc-val">${escInt(p.obra_social || "Particular")}</span>
                  </div>
                </div>
                <div class="hc-row">
                  <div class="hc-col hc-col-left">
                    <span class="hc-lbl">Especialidad:</span>
                    <span class="hc-val">${escInt(h.especialidad || 'Consultorio Externo')}</span>
                  </div>
                  <div class="hc-col hc-col-right">
                    <span class="hc-lbl">N° Beneficio / Afiliado:</span>
                    <span class="hc-val">${escInt(p.nro_afiliado || "-")}</span>
                  </div>
                </div>
              </div>

              <div class="hc-section-item" style="margin-bottom: 18px;">
                <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                  — Evolución:
                </div>
                <div class="hc-sec-content" style="min-height: 260px;">
                  <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${escInt(evolucionTexto)}</div>
                  ${generarLineasPunteadas(8)}
                </div>
              </div>

              <div class="hc-section-item" style="margin-bottom: 18px;">
                <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                  — Indicaciones:
                </div>
                <div class="hc-sec-content" style="min-height: 200px;">
                  <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${escInt(indicacionesTexto)}</div>
                  ${generarLineasPunteadas(6)}
                </div>
              </div>

              <div class="hc-signature-footer" style="margin-top: auto; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="font-size: 10px; color: #64748B;">
                  <span>Registro Oficial de Consultorio · Clínica Passo S.A.</span>
                </div>
                <div class="hc-sig-line" style="width: 200px; text-align: center; font-size: 11px;">
                  <div style="border-top: 1.5px solid #0F172A; padding-top: 3px; margin-bottom: 2px;">
                    <strong>${escInt(h.medico || 'Médico Tratante')}</strong> ${h.matricula ? `(${escInt(h.matricula)})` : ''}<br>
                    <span>Firma y Sello Profesional</span>
                  </div>
                  <div style="font-size: 10px; color: #334155; margin-top: 2px;">
                    Fecha: <strong>${fechaAtencion}</strong> · ${horaAtencion} hs
                  </div>
                </div>
              </div>
            </div>
          `;
      } 
      else {
          // HC OFICIAL FRENTE Y DORSO
          const motivo_egreso = meta.motivo_egreso || '';
          const diag_ing = meta.diagnostico_ingreso || h.diagnostico || '';
          const diag_egr = meta.diagnostico_egreso || '';
          const enf_act = meta.enfermedad_actual || '';
          
          const sig = meta.signos_vitales || {};
          const sist = meta.sistemas || {};
          const fechaAtencion = h.fecha ? new Date(h.fecha).toLocaleDateString('es-AR') : new Date().toLocaleDateString('es-AR');

          printHTML += `
            <!-- FRENTE -->
            <div class="hc-page hc-page-front" style="page-break-after: always;">
              <div class="hc-top-header">
                <div class="hc-header-institution">
                  <strong>Clínica Passo S.A.</strong>
                  <span>Av. Eva Perón 3097 - Témperley</span>
                  <span>Tel: 4264-0056 / 1652 · Guardia 24 hs</span>
                </div>
                <div class="hc-header-hcnum">
                  <span class="hc-num-label">H.C. N°:</span>
                  <span class="hc-num-val">${escInt(p.dni || "-")}</span>
                </div>
              </div>

              <div class="hc-title-container">
                <h1 class="hc-main-heading">Historia Clínica</h1>
                <p style="font-size: 11px; text-transform: uppercase; color: #475569; margin: 2px 0 0 0; letter-spacing: 0.05em; font-weight: 600;">Planilla Oficial Frente</p>
              </div>

              <div class="hc-patient-table">
                <div class="hc-row">
                  <div class="hc-col hc-col-left"><span class="hc-lbl">Nombre:</span><span class="hc-val">${escInt(p.nombre_completo || (p.apellido + ", " + p.nombre))}</span></div>
                  <div class="hc-col hc-col-right"><span class="hc-lbl">DNI:</span><span class="hc-val">${escInt(p.dni || "-")}</span></div>
                </div>
                <div class="hc-row">
                  <div class="hc-col hc-col-left"><span class="hc-lbl">Edad:</span><span class="hc-val">${escInt((meta && meta.edad) ? meta.edad + (/años/.test(meta.edad) ? '' : ' años') : pac.edad)}</span></div>
                  <div class="hc-col hc-col-right"><span class="hc-lbl">Sexo:</span><span class="hc-val">${escInt((meta && meta.sexo) || pac.sexo)}</span></div>
                </div>
                <div class="hc-row">
                  <div class="hc-col hc-col-left"><span class="hc-lbl">Obra Social:</span><span class="hc-val">${escInt(p.obra_social || "Particular")}</span></div>
                  <div class="hc-col hc-col-right"><span class="hc-lbl">Afiliado:</span><span class="hc-val">${escInt(p.nro_afiliado || "-")}</span></div>
                </div>
              </div>

              <div class="hc-meta-table" style="margin-top: 5px;">
                <div class="hc-row">
                  <div class="hc-col hc-col-full"><span class="hc-lbl">Médico Tratante:</span><span class="hc-val">${escInt(h.medico || '')}</span></div>
                </div>
                <div class="hc-row">
                  <div class="hc-col hc-col-left"><span class="hc-lbl">Especialidad:</span><span class="hc-val">${escInt(h.especialidad || '')}</span></div>
                  <div class="hc-col hc-col-right"><span class="hc-lbl">Matrícula:</span><span class="hc-val">${escInt(h.matricula || '')}</span></div>
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">MOTIVO DE CONSULTA</div>
                <div class="hc-sec-content" style="min-height: 80px;">
                  <div class="hc-text-filled">${escInt(h.motivo_consulta || '')}</div>
                  ${generarLineasPunteadas(3)}
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">ANTECEDENTES DE LA ENFERMEDAD ACTUAL</div>
                <div class="hc-sec-content" style="min-height: 200px;">
                  <div class="hc-text-filled">${escInt(enf_act)}</div>
                  ${generarLineasPunteadas(8)}
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">MEDICACIÓN HABITUAL</div>
                <div class="hc-sec-content" style="min-height: 60px;">
                  <div class="hc-text-filled">${escInt(h.medicacion || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
              </div>

              <div class="hc-signature-footer" style="margin-top: auto; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="font-size: 10px; color: #64748B;">Frente — Clínica Passo S.A.</div>
                <div class="hc-sig-line" style="width: 200px; text-align: center; font-size: 11px;">
                  <div style="border-top: 1.5px solid #0F172A; padding-top: 3px; margin-bottom: 2px;">
                    <strong>${escInt(h.medico || 'Médico Tratante')}</strong> ${h.matricula ? `(${escInt(h.matricula)})` : ''}<br>
                    <span>Firma y Sello Profesional</span>
                  </div>
                  <div style="font-size: 10px; color: #334155; margin-top: 2px;">Fecha: <strong>${fechaAtencion}</strong></div>
                </div>
              </div>
            </div>

            <!-- DORSO -->
            <div class="hc-page hc-page-back" style="page-break-after: always;">
              <div class="hc-title-container" style="border-bottom: 2px solid #001FD1; padding-bottom: 5px; margin-bottom: 10px;">
                <h1 class="hc-main-heading" style="font-size: 16px;">Examen Físico y Evolución</h1>
                <p style="font-size: 10px; color: #475569; margin: 2px 0 0 0; text-transform: uppercase;">Planilla Oficial Dorso — ${escInt(p.nombre_completo || (p.apellido + ", " + p.nombre))}</p>
              </div>

              <div class="hc-vital-signs" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 15px; border: 1px solid #E2E8F0; padding: 10px; border-radius: 6px; background: #F8FAFC;">
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>Peso:</strong> ${escInt(sig.peso || '.........')} kg</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>Talla:</strong> ${escInt(sig.talla || '.........')} cm</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>Sat. O2:</strong> ${escInt(sig.saturacion || '.........')} %</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>Pulso:</strong> ${escInt(sig.pulso || '.........')} lpm</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>T.A.:</strong> ${escInt(sig.ta || '.........')} mmHg</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>F.R.:</strong> ${escInt(sig.fr || '.........')} rpm</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>T. Axilar:</strong> ${escInt(sig.temp_axilar || '.........')} °C</div>
                <div style="flex: 1 1 calc(25% - 8px); min-width: 120px;"><strong>T. Rectal:</strong> ${escInt(sig.temp_rectal || '.........')} °C</div>
              </div>

              <div class="hc-systems-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                <div class="hc-system-box">
                  <div class="hc-system-title">Ap. Cardiovascular</div>
                  <div class="hc-text-filled">${escInt(sist.cardiovascular || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
                <div class="hc-system-box">
                  <div class="hc-system-title">Ap. Respiratorio</div>
                  <div class="hc-text-filled">${escInt(sist.respiratorio || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
                <div class="hc-system-box">
                  <div class="hc-system-title">Abdomen</div>
                  <div class="hc-text-filled">${escInt(sist.abdomen || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
                <div class="hc-system-box">
                  <div class="hc-system-title">Examen Urogenital</div>
                  <div class="hc-text-filled">${escInt(sist.urogenital || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">EXAMEN NEUROLÓGICO Y OTROS</div>
                <div class="hc-sec-content" style="min-height: 80px;">
                  <div class="hc-text-filled">${escInt(sist.neurologico || '')} ${escInt(sist.locomotor || '')} ${escInt(sist.ginecologico || '')}</div>
                  ${generarLineasPunteadas(3)}
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">ESTUDIOS COMPLEMENTARIOS</div>
                <div class="hc-sec-content" style="min-height: 60px;">
                  <div class="hc-text-filled">${escInt(sist.estudios_rx || '')}</div>
                  ${generarLineasPunteadas(2)}
                </div>
              </div>

              <div class="hc-section-item">
                <div class="hc-sec-title">INDICACIONES DE INGRESO / TRATAMIENTO</div>
                <div class="hc-sec-content" style="min-height: 100px;">
                  <div class="hc-text-filled">${escInt(h.tratamiento || '')}</div>
                  ${generarLineasPunteadas(4)}
                </div>
              </div>

              <div class="hc-signature-footer" style="margin-top: auto; padding-top: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="font-size: 10px; color: #64748B;">Dorso — Clínica Passo S.A.</div>
                <div class="hc-sig-line" style="width: 200px; text-align: center; font-size: 11px;">
                  <div style="border-top: 1.5px solid #0F172A; padding-top: 3px; margin-bottom: 2px;">
                    <strong>${escInt(h.medico || 'Médico Tratante')}</strong> ${h.matricula ? `(${escInt(h.matricula)})` : ''}<br>
                    <span>Firma y Sello Profesional</span>
                  </div>
                  <div style="font-size: 10px; color: #334155; margin-top: 2px;">Fecha: <strong>${fechaAtencion}</strong></div>
                </div>
              </div>
            </div>
          `;
      }

      // AGREGAR IMÁGENES/ADJUNTOS
      if (h._signedImagenes && h._signedImagenes.length > 0) {
        for (const imgUrl of h._signedImagenes) {
            if (imgUrl.toLowerCase().includes('.pdf')) {
                printHTML += `
                  <div class="hc-page" style="page-break-after: always; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center;">
                     <h3 style="margin-bottom: 20px;">[Archivo PDF Adjunto]</h3>
                     <p>El siguiente enlace corresponde a un PDF que no se puede imprimir automáticamente de forma completa:</p>
                     <a href="${escInt(urlSegura(imgUrl))}" target="_blank" style="word-break: break-all; color: blue;">${escInt(urlSegura(imgUrl))}</a>
                  </div>
                `;
            } else {
                printHTML += `
                  <div class="hc-page" style="page-break-after: always; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#fff; padding: 10mm;">
                     <div style="margin-bottom: 10px; font-weight: bold; width: 100%; text-align: left;">Adjunto de la evolución del ${new Date(h.fecha).toLocaleDateString('es-AR')}</div>
                     <img src="${escInt(urlSegura(imgUrl))}" style="max-width: 100%; max-height: 250mm; object-fit: contain;">
                  </div>
                `;
            }
        }
      }
    }

    const printArea = document.getElementById('printArea');
    printArea.innerHTML = printHTML;

    // Esperar a que carguen las imágenes para que no salgan en blanco
    const images = printArea.querySelectorAll('img');
    const promises = Array.from(images).map(img => {
       if (img.complete) return Promise.resolve();
       return new Promise(resolve => {
           img.onload = resolve;
           img.onerror = resolve; // Continue on error
       });
    });

    // Máximo 8 s de espera: si alguna imagen no responde, se imprime igual
    await Promise.race([Promise.all(promises), new Promise(r => setTimeout(r, 8000))]);

    const originalTitle = document.title;
    document.title = `Historia_Clinica_Completa_${p.apellido}_${p.nombre}`;
    
    // Ocultar modal si hubiera
    document.body.classList.remove('modal-open');

    // Imprimir (limpieza en 'afterprint', igual que la impresión individual)
    document.title = originalTitle;
    lanzarImpresion(`Historia_Clinica_Completa_${p.apellido}_${p.nombre}`);

  } catch (err) {
    console.error(err);
    alert('Error al generar la impresión completa: ' + err.message);
  } finally {
    if (btn) {
      btn.innerHTML = '<i data-lucide="printer"></i> Imprimir Todo';
      btn.disabled = false;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}


// ==========================================================================
// MÓDULO INTERNACIÓN — habitaciones, camas, búsqueda, asignación e impresión
// ==========================================================================
// - La planilla se guarda en el servidor (/api/internacion → Supabase):
//   todas las terminales ven y editan la misma planilla.
// - Cada cama tiene una "version": si dos personas editan la misma cama a la
//   vez, la segunda recibe un aviso en lugar de pisar el cambio.
// - Los botones de cada cama usan data-atributos + un único listener
//   (delegación de eventos): no se rompen con nombres que tienen apóstrofes
//   ni se cruzan datos entre sectores.

const INTERNACION_STORAGE_KEY = 'passo_internacion_cache_v2'; // solo copia de respaldo

// Orden y columna en la que se muestra cada sector
const INTERNACION_SECTORES = [
  { key: 'terapiaIntensiva', titulo: 'Terapia Intensiva (UTI)', color: '#A8385F', columna: 1 },
  { key: 'plantaBaja',       titulo: 'Planta Baja (Guardia)',   color: '#B07A1E', columna: 1 },
  { key: 'segundoPiso',      titulo: 'Segundo Piso',            color: '#2A35B5', columna: 2 },
  { key: 'salaTerapiaInt',   titulo: 'Sala Terapia Int',        color: '#6B4FBB', columna: 2 },
  { key: 'primerPiso',       titulo: 'Primer Piso',             color: '#12837F', columna: 3 }
];

const internacionUI = {
  datos: null,             // { sectorKey: [ {cama, paciente, fecha, dni, paciente_id} ] }
  abiertos: new Set(),     // sectores desplegados
  busqueda: '',
  filtroEstado: 'todas',
  inicializado: false,
  conexion: 'pendiente',   // 'ok' | 'error' | 'pendiente'
  ultimaSync: null,
  obs: null,               // { texto, version }
  obsPendiente: false,
  guardandoObs: false,
  timer: null
};

// Solo deja pasar direcciones seguras para href/src (bloquea javascript:, data:text/html, etc.)
function urlSegura(u) {
  const s = String(u == null ? '' : u).trim();
  if (/^(https?:|blob:)/i.test(s)) return s;
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(s)) return s;
  if (/^[\w.-]+$/.test(s)) return s;            // nombre de archivo del almacenamiento (se firma aparte)
  return '#';
}

// Valor seguro para usar como argumento de una función dentro de onclick="..."
function jsArg(v) {
  return escInt(JSON.stringify(String(v == null ? '' : v)));
}

function escInt(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Normaliza texto para comparar: minúsculas, sin acentos, sin comas/puntos extra
function normInt(v) {
  return String(v == null ? '' : v)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Datos (API compartida: /api/internacion) ----------
// La planilla vive en Supabase, así todas las terminales ven lo mismo.
// En este navegador solo se guarda una copia de respaldo para poder
// mostrarla (en modo solo lectura) si se corta la conexión con el servidor.

function filaAPICama(r) {
  return {
    cama: r.cama,
    paciente: r.paciente || '',
    fecha: r.fecha_ingreso || '',
    dni: r.dni || '',
    paciente_id: r.paciente_id || '',
    version: r.version || 1
  };
}

function aplicarFilasCamas(filas) {
  if (!internacionUI.datos) internacionUI.datos = {};
  const nuevos = {};
  INTERNACION_SECTORES.forEach(s => { nuevos[s.key] = []; });
  filas
    .slice()
    .sort((a, b) => (a.orden || 0) - (b.orden || 0))
    .forEach(r => { if (nuevos[r.sector]) nuevos[r.sector].push(filaAPICama(r)); });
  internacionUI.datos = nuevos;
}

function actualizarFilaCama(r) {
  const lista = internacionUI.datos && internacionUI.datos[r.sector];
  if (!lista) return;
  const i = lista.findIndex(b => String(b.cama) === String(r.cama));
  if (i >= 0) lista[i] = filaAPICama(r);
}

async function cargarDatosInternacion() {
  try {
    const res = await apiFetch('/internacion');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    aplicarFilasCamas(data.camas || []);
    internacionUI.obs = data.observaciones || { texto: '', version: 1 };
    internacionUI.conexion = 'ok';
    internacionUI.ultimaSync = new Date();
    guardarDatosInternacion();
    return true;
  } catch (err) {
    console.warn('Internación: no se pudo cargar desde el servidor:', err.message);
    internacionUI.conexion = 'error';
    if (!internacionUI.datos) {
      try {
        const raw = localStorage.getItem(INTERNACION_STORAGE_KEY);
        const copia = raw ? JSON.parse(raw) : null;
        if (copia && copia.datos) {
          internacionUI.datos = copia.datos;
          internacionUI.obs = copia.obs || { texto: '', version: 1 };
          internacionUI.ultimaSync = copia.fecha ? new Date(copia.fecha) : null;
        }
      } catch (e) {}
    }
    return false;
  }
}

// Copia de respaldo local (no es la fuente de verdad)
function guardarDatosInternacion() {
  try {
    localStorage.setItem(INTERNACION_STORAGE_KEY, JSON.stringify({
      datos: internacionUI.datos, obs: internacionUI.obs, fecha: new Date().toISOString()
    }));
  } catch (e) {}
}

// Envía uno o más cambios de camas. Devuelve true si se guardaron.
async function enviarCambiosCamas(cambios, { silencioso = false } = {}) {
  if (internacionUI.conexion !== 'ok') {
    if (!silencioso) alert('Sin conexión con el servidor: la planilla está en modo solo lectura. Tocá "Actualizar" e intentá de nuevo.');
    return false;
  }
  try {
    const res = await apiFetch('/internacion/camas', { method: 'PUT', body: JSON.stringify({ cambios }) });
    const data = await res.json().catch(() => ({}));

    // Aplicar lo que sí se guardó (aunque después haya fallado otro cambio)
    (data.camas || data.actualizadas || []).forEach(actualizarFilaCama);

    if (res.ok) {
      guardarDatosInternacion();
      return true;
    }
    if (!silencioso) {
      alert(res.status === 409
        ? (data.error || 'Otra persona modificó esta cama. Se recargó la planilla.')
        : 'No se pudo guardar: ' + (data.error || 'error del servidor'));
    }
  } catch (err) {
    if (!silencioso) alert('No se pudo guardar (sin conexión con el servidor).');
  }
  await refrescarInternacion();
  return false;
}

// Recarga desde el servidor y vuelve a dibujar (conserva búsqueda y sectores abiertos)
async function refrescarInternacion() {
  await cargarDatosInternacion();
  renderInternacion();
  sincronizarObservacionesUI();
}

// Refresco automático cada 30 s mientras la pestaña está visible,
// para ver los cambios que hacen otras terminales
function iniciarAutoRefrescoInternacion() {
  if (internacionUI.timer) return;
  internacionUI.timer = setInterval(() => {
    const enTab = state.currentTab === 'internacion-tab';
    const modal = document.getElementById('modalAsignarCama');
    const modalAbierto = modal && !modal.classList.contains('hidden');
    if (enTab && !modalAbierto && !document.hidden && !internacionUI.guardandoObs) {
      refrescarInternacion();
    }
  }, 30000);
  window.addEventListener('focus', () => {
    if (state.currentTab === 'internacion-tab' && !internacionUI.guardandoObs) refrescarInternacion();
  });
}

// ---------- Observaciones generales (compartidas, se guardan solas) ----------
function sincronizarObservacionesUI() {
  const obs = document.getElementById('internacionObsTextarea');
  if (!obs || !internacionUI.obs) return;
  // No pisar lo que el usuario está escribiendo
  if (document.activeElement === obs || internacionUI.obsPendiente) return;
  obs.value = internacionUI.obs.texto || '';
  obs.readOnly = internacionUI.conexion !== 'ok' || !tienePermiso('internacion.editar');
}

function estadoObservaciones(txt, tipo) {
  const el = document.getElementById('internacionObsEstado');
  if (!el) return;
  el.textContent = txt;
  el.className = 'internacion-obs-estado' + (tipo ? ' is-' + tipo : '');
}

async function guardarObservacionesInternacion() {
  const obs = document.getElementById('internacionObsTextarea');
  if (!obs || !internacionUI.obs) return;
  internacionUI.obsPendiente = false;
  internacionUI.guardandoObs = true;
  estadoObservaciones('Guardando…');
  try {
    const res = await apiFetch('/internacion/observaciones', {
      method: 'PUT',
      body: JSON.stringify({ texto: obs.value, version: internacionUI.obs.version })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      internacionUI.obs = data.observaciones;
      estadoObservaciones('Guardado ✓', 'ok');
    } else if (res.status === 409) {
      internacionUI.obs = data.observaciones || internacionUI.obs;
      obs.value = internacionUI.obs.texto || '';
      estadoObservaciones('Otra persona editó las observaciones: se cargó su versión', 'error');
    } else {
      estadoObservaciones('No se pudo guardar', 'error');
    }
  } catch (e) {
    estadoObservaciones('Sin conexión: no se guardó', 'error');
  } finally {
    internacionUI.guardandoObs = false;
    guardarDatosInternacion();
  }
}

function buscarCama(sectorKey, camaNum) {
  const lista = (internacionUI.datos && internacionUI.datos[sectorKey]) || [];
  return lista.find(b => String(b.cama) === String(camaNum)) || null;
}

function camaOcupada(b) {
  return !!(b && b.paciente && String(b.paciente).trim() !== '');
}

// Fecha: guardamos 'YYYY-MM-DD'; aceptamos formatos viejos ('05-09-26', '05/09/2026 - 10:30')
function fechaIntAISO(f) {
  if (!f) return '';
  const s = String(f).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (!m) return '';
  let [, d, mo, y] = m;
  if (y.length === 2) y = '20' + y;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function fechaIntMostrar(f) {
  const iso = fechaIntAISO(f);
  if (!iso) return f ? String(f) : '';
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y.slice(2)}`;
}

function hoyISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

// ---------- Inicialización ----------
function inicializarInternacion() {
  if (!internacionUI.inicializado) {
    internacionUI.inicializado = true;

    const grid = document.getElementById('internacionGrid');
    if (grid) grid.addEventListener('click', manejarClickInternacion);

    const buscar = document.getElementById('internacionBuscar');
    const limpiar = document.getElementById('internacionBuscarLimpiar');
    if (buscar) {
      buscar.addEventListener('input', () => {
        internacionUI.busqueda = buscar.value;
        if (limpiar) limpiar.classList.toggle('hidden', !buscar.value);
        renderInternacion();
      });
      buscar.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { buscar.value = ''; buscar.dispatchEvent(new Event('input')); }
      });
    }
    if (limpiar) limpiar.addEventListener('click', () => {
      if (buscar) { buscar.value = ''; buscar.dispatchEvent(new Event('input')); buscar.focus(); }
    });

    const filtro = document.getElementById('internacionFiltroEstado');
    if (filtro) filtro.addEventListener('change', () => {
      internacionUI.filtroEstado = filtro.value;
      renderInternacion();
    });

    const toggleTodo = document.getElementById('internacionToggleTodo');
    if (toggleTodo) toggleTodo.addEventListener('click', () => {
      const todosAbiertos = INTERNACION_SECTORES.every(s => internacionUI.abiertos.has(s.key));
      internacionUI.abiertos = todosAbiertos ? new Set() : new Set(INTERNACION_SECTORES.map(s => s.key));
      renderInternacion();
    });

    const imprimirBtn = document.getElementById('internacionImprimirBtn');
    if (imprimirBtn) imprimirBtn.addEventListener('click', imprimirPlanillaInternacion);

    const obs = document.getElementById('internacionObsTextarea');
    if (obs) {
      obs.addEventListener('input', () => {
        internacionUI.obsPendiente = true;
        estadoObservaciones('Cambios sin guardar…');
        clearTimeout(internacionUI.obsTimer);
        internacionUI.obsTimer = setTimeout(guardarObservacionesInternacion, 1000);
      });
      obs.addEventListener('blur', () => {
        if (internacionUI.obsPendiente) {
          clearTimeout(internacionUI.obsTimer);
          guardarObservacionesInternacion();
        }
      });
    }

    const aviso = document.getElementById('internacionAvisoConexion');
    if (aviso) aviso.addEventListener('click', manejarClickInternacion);

    inicializarModalCama();
    iniciarAutoRefrescoInternacion();
  }

  // Primera vez: mostrar "cargando"; después, refrescar sin parpadeo
  if (!internacionUI.datos) {
    const grid = document.getElementById('internacionGrid');
    if (grid) grid.innerHTML = '<div class="empty-state-box" style="grid-column: 1 / -1;"><i data-lucide="loader-2" class="spin"></i><h4>Cargando planilla de internación…</h4></div>';
    if (window.lucide) window.lucide.createIcons();
  }
  return refrescarInternacion();
}

// Compatibilidad con el nombre anterior
function inicializarBocetoInternacion() { inicializarInternacion(); }

// ---------- Render ----------
function camaCoincide(b, q) {
  if (!q) return true;
  const texto = normInt(`${b.cama} ${b.paciente} ${b.dni}`);
  return q.split(' ').every(tok => texto.includes(tok));
}

function renderInternacion() {
  const grid = document.getElementById('internacionGrid');
  if (!grid) return;

  const sinConexion = internacionUI.conexion === 'error';
  const soloLectura = sinConexion || !tienePermiso('internacion.editar');
  const aviso = document.getElementById('internacionAvisoConexion');
  if (aviso) {
    aviso.classList.toggle('hidden', !sinConexion);
    aviso.innerHTML = sinConexion
      ? `<i data-lucide="wifi-off"></i> <span>Sin conexión con el servidor. ${internacionUI.datos ? 'Se muestra la última copia guardada' + (internacionUI.ultimaSync ? ' (' + internacionUI.ultimaSync.toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) + ')' : '') + ' en <strong>solo lectura</strong>.' : ''}</span> <button type="button" class="btn btn-secondary btn-sm" data-accion="reintentar">Reintentar</button>`
      : '';
  }

  if (!internacionUI.datos) {
    grid.innerHTML = sinConexion
      ? `<div class="empty-state-box" style="grid-column: 1 / -1;"><i data-lucide="server-crash"></i><h4>No se pudo cargar la planilla</h4><p>Revisá la conexión e intentá de nuevo.</p><button type="button" class="btn btn-primary" data-accion="reintentar">Reintentar</button></div>`
      : '';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  const q = normInt(internacionUI.busqueda);
  const filtro = internacionUI.filtroEstado;
  let totalCamas = 0, totalOcupadas = 0, totalCoincidencias = 0;

  const columnas = { 1: '', 2: '', 3: '' };

  INTERNACION_SECTORES.forEach(s => {
    const camas = internacionUI.datos[s.key] || [];
    const ocupadas = camas.filter(camaOcupada).length;
    totalCamas += camas.length;
    totalOcupadas += ocupadas;

    const visibles = camas.filter(b => {
      if (filtro === 'ocupadas' && !camaOcupada(b)) return false;
      if (filtro === 'libres' && camaOcupada(b)) return false;
      return camaCoincide(b, q);
    });
    totalCoincidencias += visibles.length;

    // Al buscar/filtrar: se ocultan los sectores sin resultados y se despliegan los que tienen
    const hayFiltro = !!q || filtro !== 'todas';
    if (hayFiltro && visibles.length === 0) return;
    const abierto = hayFiltro ? true : internacionUI.abiertos.has(s.key);

    const filas = visibles.map(b => {
      const ocupada = camaOcupada(b);
      const fecha = fechaIntMostrar(b.fecha);
      return `
        <li class="bed-item ${ocupada ? 'occupied' : 'free'}">
          <div class="bed-number">${escInt(b.cama)}</div>
          <div class="bed-info">
            ${ocupada
              ? `<span class="bed-patient">${escInt(b.paciente)}${tienePermiso('rayos') && estadoPlacaDeCama(s.key, b.cama) && estadoPlacaDeCama(s.key, b.cama).paciente ? (estadoPlacaDeCama(s.key, b.cama).placasHoy ? ' <span class="rx-mini ok" title="Placa de hoy cargada">RX ✓</span>' : ' <span class="rx-mini falta" title="Falta la placa de hoy">RX falta</span>') : ''}</span>
                 <span class="bed-date">${fecha ? 'Ingreso: ' + escInt(fecha) : 'Sin fecha de ingreso'}${b.dni ? ' · DNI ' + escInt(b.dni) : ''}</span>`
              : `<span class="bed-empty">Cama libre</span>`}
          </div>
          <div class="bed-actions">
            ${ocupada && tienePermiso('hc.acceso') ? `<button type="button" class="bed-action" data-accion="ver-hc" data-sector="${s.key}" data-cama="${escInt(b.cama)}" title="Ver Historia Clínica"><i data-lucide="eye"></i></button>` : ''}
            ${soloLectura ? '' : `<button type="button" class="bed-action" data-accion="editar" data-sector="${s.key}" data-cama="${escInt(b.cama)}" title="${ocupada ? 'Editar / cambiar paciente' : 'Asignar paciente'}"><i data-lucide="${ocupada ? 'edit-2' : 'user-plus'}"></i></button>`}
          </div>
        </li>`;
    }).join('');

    columnas[s.columna] += `
      <div class="sector-card ${abierto ? 'is-open' : ''}" data-sector-card="${s.key}">
        <button type="button" class="sector-header" data-accion="toggle-sector" data-sector="${s.key}" aria-expanded="${abierto}" style="--sector: ${s.color};">
          <span class="sector-header-title">
            <i data-lucide="chevron-down" class="sector-toggle-icon"></i>
            <span>${escInt(s.titulo)}</span>
          </span>
          <span class="bed-count">${ocupadas}/${camas.length} ocupadas</span>
        </button>
        <ul class="bed-list" ${abierto ? '' : 'hidden'}>
          ${filas || '<li class="bed-item bed-item-empty">Sin camas para mostrar</li>'}
        </ul>
      </div>`;
  });

  const hayFiltro = !!q || filtro !== 'todas';
  if (hayFiltro && totalCoincidencias === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1;">
        <i data-lucide="search-x"></i>
        <h4>No se encontraron camas ni pacientes</h4>
        <p>Probá con otro apellido, DNI o número de cama.</p>
      </div>`;
  } else {
    grid.innerHTML = [1, 2, 3]
      .map(c => `<div class="internacion-col">${columnas[c]}</div>`)
      .join('');
  }

  const resumen = document.getElementById('internacionResumen');
  if (resumen) {
    const base = hayFiltro
      ? `${totalCoincidencias} cama(s) encontrada(s) · ${totalOcupadas}/${totalCamas} camas ocupadas`
      : `${totalOcupadas} de ${totalCamas} camas ocupadas · ${totalCamas - totalOcupadas} libres`;
    const sync = (!sinConexion && internacionUI.ultimaSync)
      ? ` · Actualizado ${internacionUI.ultimaSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
      : '';
    resumen.textContent = base + sync;
  }

  const toggleTodo = document.getElementById('internacionToggleTodo');
  if (toggleTodo) {
    const todosAbiertos = INTERNACION_SECTORES.every(s => internacionUI.abiertos.has(s.key));
    toggleTodo.innerHTML = todosAbiertos
      ? '<i data-lucide="chevrons-up"></i> <span>Colapsar todo</span>'
      : '<i data-lucide="chevrons-down"></i> <span>Desplegar todo</span>';
    toggleTodo.disabled = hayFiltro;
  }

  if (window.lucide) window.lucide.createIcons();
}

// Un solo listener para todos los botones de la grilla
function manejarClickInternacion(e) {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const accion = el.getAttribute('data-accion');
  const sector = el.getAttribute('data-sector');
  const cama = el.getAttribute('data-cama');

  if (accion === 'reintentar') {
    inicializarInternacion();
    return;
  }
  if (accion === 'toggle-sector') {
    if (internacionUI.abiertos.has(sector)) internacionUI.abiertos.delete(sector);
    else internacionUI.abiertos.add(sector);
    renderInternacion();
  } else if (accion === 'editar') {
    abrirModalCama(sector, cama);
  } else if (accion === 'ver-hc') {
    verHCDeCama(sector, cama);
  }
}

// Compatibilidad: si algún HTML viejo todavía llama toggleSector(this)
function toggleSector(headerEl) {
  const card = headerEl && headerEl.closest ? headerEl.closest('[data-sector-card]') : null;
  const key = card ? card.getAttribute('data-sector-card') : null;
  if (!key) return;
  if (internacionUI.abiertos.has(key)) internacionUI.abiertos.delete(key);
  else internacionUI.abiertos.add(key);
  renderInternacion();
}

// ---------- Pacientes del padrón ----------
async function asegurarPacientesCargados() {
  if (Array.isArray(state.pacientesList) && state.pacientesList.length > 0) return state.pacientesList;
  try { await cargarPacientes(); } catch (e) {}
  return state.pacientesList || [];
}

// Busca al paciente de una cama en el padrón: por id, por DNI o por nombre
// (sin importar el orden "Apellido Nombre" / "Nombre Apellido", acentos o comas)
function encontrarPacienteDeCama(b) {
  const lista = state.pacientesList || [];
  if (b.paciente_id) {
    const p = lista.find(x => String(x.id) === String(b.paciente_id));
    if (p) return p;
  }
  const dniCama = String(b.dni || '').replace(/\D/g, '');
  if (dniCama) {
    const p = lista.find(x => String(x.dni || '').replace(/\D/g, '') === dniCama);
    if (p) return p;
  }
  const tokensCama = normInt(b.paciente).split(' ').filter(Boolean).sort().join(' ');
  if (!tokensCama) return null;
  return lista.find(x => normInt(`${x.apellido || ''} ${x.nombre || ''}`).split(' ').filter(Boolean).sort().join(' ') === tokensCama) || null;
}

// ---------- Ojito: ir a la historia clínica del paciente ----------
async function verHCDeCama(sectorKey, camaNum) {
  const b = buscarCama(sectorKey, camaNum);
  if (!camaOcupada(b)) return;

  if (!tienePermiso('hc.acceso')) {
    showToast('Tu perfil no tiene acceso a historias clínicas');
    return;
  }

  // Rayos no accede al padrón: usa la lista de internados del control de placas
  if (state.user && state.user.soloInternados) {
    if (!rayosUI.internados.length) await cargarRayos();
    const fila = estadoPlacaDeCama(sectorKey, camaNum);
    if (fila && fila.paciente) mostrarPacienteEnHistorias(fila.paciente, true);
    else showToast('Este paciente no está vinculado al padrón. Pedí a Recepción que lo registre.');
    return;
  }

  await asegurarPacientesCargados();
  const p = encontrarPacienteDeCama(b);
  const dni = p && p.dni ? String(p.dni) : String(b.dni || '').replace(/\D/g, '');

  // Si lo encontramos, guardamos el vínculo en la cama para la próxima vez
  if (p && (!b.paciente_id || !b.dni) && internacionUI.conexion === 'ok') {
    enviarCambiosCamas([{
      sector: sectorKey, cama: b.cama, version: b.version,
      paciente: b.paciente, dni: p.dni || b.dni || '', paciente_id: p.id,
      fecha_ingreso: fechaIntAISO(b.fecha) || null
    }], { silencioso: true });
  }

  const navHistoriasBtn = document.getElementById('navHistoriasBtn');
  if (navHistoriasBtn) navHistoriasBtn.click();

  const search = document.getElementById('historiaDniSearch');
  if (!dni) {
    if (search) { search.value = ''; search.focus(); }
    showToast(`"${b.paciente}" no está en el padrón con DNI. Buscalo por DNI o editá la cama para vincularlo.`);
    return;
  }
  if (search) {
    search.value = dni;
    searchPacienteParaHistoria();
  }
}

// Compatibilidad con la función anterior (usada en otros lugares)
function verHCPacientePorDNI(dni, nombrePaciente) {
  const b = { paciente: nombrePaciente || '', dni: dni || '', paciente_id: '' };
  const sector = INTERNACION_SECTORES.find(s => (internacionUI.datos && internacionUI.datos[s.key] || []).some(x => x.paciente === nombrePaciente));
  if (sector) {
    const cama = internacionUI.datos[sector.key].find(x => x.paciente === nombrePaciente);
    return verHCDeCama(sector.key, cama.cama);
  }
  const navHistoriasBtn = document.getElementById('navHistoriasBtn');
  if (navHistoriasBtn) navHistoriasBtn.click();
  const search = document.getElementById('historiaDniSearch');
  if (search && b.dni) { search.value = b.dni; searchPacienteParaHistoria(); }
}

// ---------- Modal asignar / editar paciente ----------
function inicializarModalCama() {
  const form = document.getElementById('formAsignarCama');
  if (form) form.addEventListener('submit', guardarAsignacionCama);

  const cancelar = document.getElementById('camaCancelarBtn');
  if (cancelar) cancelar.addEventListener('click', cerrarModalCama);

  const liberar = document.getElementById('camaLiberarBtn');
  if (liberar) liberar.addEventListener('click', liberarCama);

  const cambiar = document.getElementById('camaCambiarPacienteBtn');
  if (cambiar) cambiar.addEventListener('click', deseleccionarPacienteCama);

  const input = document.getElementById('camaPacienteSearch');
  if (input) {
    input.addEventListener('input', () => filtrarPacientesParaCama(input.value));
    input.addEventListener('focus', mostrarListaPacientesCama);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // Enter en el buscador no debe enviar el formulario
        const primero = document.querySelector('#camaPatientDropdownList [data-pac-id], #camaPatientDropdownList [data-nombre-libre]');
        if (primero) primero.click();
      }
    });
  }

  const dropdown = document.getElementById('camaPatientDropdownList');
  if (dropdown) dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('[data-pac-id], [data-nombre-libre]');
    if (!item) return;
    if (item.hasAttribute('data-pac-id')) seleccionarPacienteParaCama(item.getAttribute('data-pac-id'));
    else seleccionarNombreLibreParaCama(item.getAttribute('data-nombre-libre'));
  });

  // Cerrar la lista al hacer clic fuera del buscador
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('camaPatientPickerWrap');
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById('camaPatientDropdownList');
      if (dd) dd.classList.add('hidden');
    }
  });
}

async function abrirModalCama(sectorKey, camaNum) {
  const b = buscarCama(sectorKey, camaNum);
  if (!b) return;
  if (internacionUI.conexion !== 'ok') {
    alert('Sin conexión con el servidor: la planilla está en modo solo lectura.');
    return;
  }
  if (!tienePermiso('internacion.editar')) {
    showToast('Tu perfil puede ver la planilla, pero no asignar camas.');
    return;
  }
  const sector = INTERNACION_SECTORES.find(s => s.key === sectorKey);
  const ocupada = camaOcupada(b);

  document.getElementById('asignarCamaSectorId').value = sectorKey;
  document.getElementById('asignarCamaNum').value = b.cama;
  document.getElementById('asignarCamaTitulo').textContent = ocupada ? 'Editar Paciente de la Cama' : 'Asignar Paciente a Cama';
  document.getElementById('asignarCamaSubtitulo').textContent = `${sector ? sector.titulo : ''} · Cama ${b.cama}`;
  document.getElementById('asignarCamaFecha').value = fechaIntAISO(b.fecha) || hoyISO();

  const actual = document.getElementById('asignarCamaActual');
  if (actual) {
    if (ocupada) {
      actual.innerHTML = `Paciente actual: <strong>${escInt(b.paciente)}</strong>${b.dni ? ' · DNI ' + escInt(b.dni) : ''}`;
      actual.classList.remove('hidden');
    } else {
      actual.innerHTML = '';
      actual.classList.add('hidden');
    }
  }
  const liberar = document.getElementById('camaLiberarBtn');
  if (liberar) liberar.style.visibility = ocupada ? 'visible' : 'hidden';

  deseleccionarPacienteCama(false);
  openModal('modalAsignarCama');

  // Si el padrón no estaba cargado, lo traemos y refrescamos la lista
  if (!state.pacientesList || state.pacientesList.length === 0) {
    const dd = document.getElementById('camaPatientDropdownList');
    if (dd) { dd.innerHTML = '<div class="patient-dropdown-empty">Cargando pacientes...</div>'; dd.classList.remove('hidden'); }
    await asegurarPacientesCargados();
    const input = document.getElementById('camaPacienteSearch');
    filtrarPacientesParaCama(input ? input.value : '');
  }
}

// Compatibilidad con la firma anterior editarCama('listPrimerPiso', '101 A')
function editarCama(sectorId, camaNum) {
  const legacy = {
    listTerapiaIntensiva: 'terapiaIntensiva', listPlantaBaja: 'plantaBaja', listPrimerPiso: 'primerPiso',
    listSegundoPiso: 'segundoPiso', listSalaTerapiaInt: 'salaTerapiaInt'
  };
  abrirModalCama(legacy[sectorId] || sectorId, camaNum);
}

function cerrarModalCama() {
  const dd = document.getElementById('camaPatientDropdownList');
  if (dd) dd.classList.add('hidden');
  closeModal('modalAsignarCama');
}

async function guardarAsignacionCama(event) {
  if (event && event.preventDefault) event.preventDefault();

  const sectorKey = document.getElementById('asignarCamaSectorId').value;
  const camaNum = document.getElementById('asignarCamaNum').value;
  const pacienteId = document.getElementById('asignarCamaPaciente').value;
  const nombreLibre = document.getElementById('asignarCamaNombreLibre').value.trim();
  const fecha = document.getElementById('asignarCamaFecha').value;

  const b = buscarCama(sectorKey, camaNum);
  if (!b) { alert('No se encontró la cama.'); return; }

  let nombre = '', dni = '', pid = '';
  if (pacienteId) {
    const p = (state.pacientesList || []).find(x => String(x.id) === String(pacienteId));
    if (!p) { alert('El paciente seleccionado ya no está en el padrón. Buscalo de nuevo.'); return; }
    nombre = `${p.apellido || ''} ${p.nombre || ''}`.trim();
    dni = p.dni || '';
    pid = p.id;
  } else if (nombreLibre) {
    nombre = nombreLibre;
  } else if (camaOcupada(b)) {
    // Solo se cambió la fecha de ingreso del paciente actual
    nombre = b.paciente; dni = b.dni; pid = b.paciente_id;
  } else {
    alert('Seleccioná un paciente de la lista (o escribí el nombre y elegí "Asignar sin registrar").');
    return;
  }

  // Primero se asigna la cama nueva; después se libera la anterior (si el paciente se muda).
  // Así, si algo falla a mitad de camino, el paciente nunca queda sin cama.
  const cambios = [{
    sector: sectorKey, cama: b.cama, version: b.version,
    paciente: nombre, dni: dni || '', paciente_id: pid || null,
    fecha_ingreso: fecha || hoyISO()
  }];

  // Evitar que el mismo paciente quede en dos camas
  if (pid || dni) {
    for (const s of INTERNACION_SECTORES) {
      const otra = (internacionUI.datos[s.key] || []).find(x =>
        !(s.key === sectorKey && String(x.cama) === String(camaNum)) &&
        camaOcupada(x) && ((pid && String(x.paciente_id) === String(pid)) || (dni && String(x.dni) === String(dni))));
      if (otra) {
        const mover = confirm(`${nombre} ya está en ${s.titulo} · Cama ${otra.cama}.\n\n¿Querés moverlo a esta cama? (La cama anterior quedará libre)`);
        if (!mover) return;
        cambios.push({ sector: s.key, cama: otra.cama, version: otra.version, paciente: '' });
      }
    }
  }

  const btn = document.getElementById('camaGuardarBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  const ok = await enviarCambiosCamas(cambios);
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Guardar'; if (window.lucide) window.lucide.createIcons(); }

  cerrarModalCama();
  if (ok) {
    internacionUI.abiertos.add(sectorKey);
    renderInternacion();
    showToast(`Cama ${b.cama} actualizada`);
  }
}

async function liberarCama() {
  const sectorKey = document.getElementById('asignarCamaSectorId').value;
  const camaNum = document.getElementById('asignarCamaNum').value;
  const b = buscarCama(sectorKey, camaNum);
  if (!b || !camaOcupada(b)) { cerrarModalCama(); return; }
  if (!confirm(`¿Liberar la cama ${b.cama}? Se quitará a ${b.paciente}.`)) return;

  const btn = document.getElementById('camaLiberarBtn');
  if (btn) btn.disabled = true;
  const ok = await enviarCambiosCamas([{ sector: sectorKey, cama: b.cama, version: b.version, paciente: '' }]);
  if (btn) btn.disabled = false;

  cerrarModalCama();
  if (ok) {
    renderInternacion();
    showToast(`Cama ${b.cama} liberada`);
  }
}

function filtrarPacientesParaCama(query = '') {
  const dropdown = document.getElementById('camaPatientDropdownList');
  if (!dropdown) return;

  const pacientes = state.pacientesList || [];
  const q = normInt(query);
  const qDni = String(query).replace(/\D/g, '');

  const filtrados = !q
    ? pacientes.slice(0, 10)
    : pacientes.filter(p => {
        const nombre = normInt(`${p.apellido || ''} ${p.nombre || ''}`);
        const dni = String(p.dni || '').replace(/\D/g, '');
        return q.split(' ').every(tok => nombre.includes(tok)) || (qDni.length >= 3 && dni.includes(qDni));
      }).slice(0, 12);

  let html = filtrados.map(p => `
    <div class="patient-dropdown-item" data-pac-id="${escInt(p.id)}">
      <div>
        <div class="patient-item-name">${escInt(`${escInt(p.apellido || '')}, ${escInt(p.nombre || '')}`)}</div>
        <div style="margin-top: 2px;">
          <span class="patient-item-dni">DNI: ${escInt(p.dni || 'S/D')}</span>
          <span class="patient-item-cov">${escInt(p.obra_social || 'Particular')}</span>
        </div>
      </div>
      <i data-lucide="check" style="width: 16px; height: 16px; color: var(--primary); opacity: 0.6;"></i>
    </div>`).join('');

  // Permite asignar a alguien que todavía no está en el padrón (ej. ingreso por guardia)
  const texto = String(query).trim();
  if (texto && !/^\d+$/.test(texto)) {
    html += `
      <div class="patient-dropdown-item patient-dropdown-free" data-nombre-libre="${escInt(texto)}">
        <div>
          <div class="patient-item-name">Asignar "${escInt(texto)}" sin registrar</div>
          <div style="margin-top: 2px; font-size: 0.75rem; color: var(--text-muted);">Se podrá vincular al padrón más adelante</div>
        </div>
        <i data-lucide="user-plus" style="width: 16px; height: 16px; color: var(--primary); opacity: 0.6;"></i>
      </div>`;
  }

  if (!html) {
    html = `<div class="patient-dropdown-empty">No se encontró ningún paciente con: <strong>${escInt(query)}</strong></div>`;
  }

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
  if (window.lucide) window.lucide.createIcons();
}

function mostrarSeleccionCama(titulo, meta) {
  document.getElementById('camaSelectedPatientName').textContent = titulo;
  document.getElementById('camaSelectedPatientMeta').textContent = meta;
  document.getElementById('camaPatientSearchBoxWrap').classList.add('hidden');
  document.getElementById('camaPatientSelectedCard').classList.remove('hidden');
  document.getElementById('camaPatientDropdownList').classList.add('hidden');
  const input = document.getElementById('camaPacienteSearch');
  if (input) input.value = '';
}

function seleccionarPacienteParaCama(pacienteId) {
  const p = (state.pacientesList || []).find(item => String(item.id) === String(pacienteId));
  if (!p) return;
  document.getElementById('asignarCamaPaciente').value = p.id;
  document.getElementById('asignarCamaNombreLibre').value = '';
  mostrarSeleccionCama(`${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente', `DNI: ${p.dni || 'S/D'} · ${p.obra_social || 'Particular'}`);
}

function seleccionarNombreLibreParaCama(nombre) {
  document.getElementById('asignarCamaPaciente').value = '';
  document.getElementById('asignarCamaNombreLibre').value = nombre;
  mostrarSeleccionCama(nombre, 'Sin registrar en el padrón');
}

function deseleccionarPacienteCama(enfocar = true) {
  document.getElementById('asignarCamaPaciente').value = '';
  document.getElementById('asignarCamaNombreLibre').value = '';
  document.getElementById('camaPatientSelectedCard').classList.add('hidden');
  document.getElementById('camaPatientSearchBoxWrap').classList.remove('hidden');
  const input = document.getElementById('camaPacienteSearch');
  if (input) {
    input.value = '';
    if (enfocar !== false) input.focus();
  }
  const dd = document.getElementById('camaPatientDropdownList');
  if (dd) dd.classList.add('hidden');
}

function mostrarListaPacientesCama() {
  const input = document.getElementById('camaPacienteSearch');
  filtrarPacientesParaCama(input ? input.value : '');
}

// ---------- Impresión de la planilla (A4 apaisada) ----------
function imprimirPlanillaInternacion() {
  if (!internacionUI.datos) { alert('La planilla todavía no se cargó.'); return; }
  const layout = document.getElementById('printInternacionLayout');
  if (!layout) { alert('No se encontró el área de impresión de internación.'); return; }

  const hoy = new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const hoyTxt = hoy.charAt(0).toUpperCase() + hoy.slice(1);
  const obs = (document.getElementById('internacionObsTextarea') || {}).value || '';

  const tablaSector = (s) => {
    const camas = internacionUI.datos[s.key] || [];
    return `
      <thead><tr><th colspan="3" class="th-green">${escInt(s.titulo)}</th></tr></thead>
      <tbody>
        ${camas.map(b => `
          <tr>
            <td class="col-cama">${escInt(b.cama)}</td>
            <td class="col-paciente">${escInt(b.paciente || '')}</td>
            <td class="col-fecha">${escInt(fechaIntMostrar(b.fecha))}</td>
          </tr>`).join('')}
      </tbody>`;
  };

  const columna = (n) => `
    <div class="print-int-col">
      <table class="print-int-table">
        <colgroup><col class="col-cama"><col class="col-paciente"><col class="col-fecha"></colgroup>
        ${INTERNACION_SECTORES.filter(s => s.columna === n).map(tablaSector).join('')}
      </table>
    </div>`;

  layout.innerHTML = `
    <div class="print-int-header">
      <div class="print-int-fecha">${escInt(hoyTxt)}</div>
      <h1>Planilla internación</h1>
      <div class="print-int-turno">Turno: _________________</div>
    </div>
    <div class="print-int-grid">${columna(1)}${columna(2)}${columna(3)}</div>
    <table class="print-int-table print-int-obs">
      <thead><tr><th class="th-green">Observaciones</th></tr></thead>
      <tbody><tr><td>${escInt(obs).replace(/\n/g, '<br>')}</td></tr></tbody>
    </table>`;

  // Hoja apaisada solo para esta impresión
  let estilo = document.getElementById('dynamicPrintLandscape');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'dynamicPrintLandscape';
    estilo.textContent = '@media print { @page { size: A4 landscape; margin: 6mm; } }';
    document.head.appendChild(estilo);
  }

  const originalTitle = document.title;
  document.title = 'Planilla de Internación — Clínica Passo S.A.';
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  document.body.classList.remove('printing-hc');
  document.body.classList.add('printing-internacion');

  let limpiado = false;
  const limpiar = () => {
    if (limpiado) return;
    limpiado = true;
    document.body.classList.remove('printing-internacion');
    const st = document.getElementById('dynamicPrintLandscape');
    if (st) st.remove();
    document.title = originalTitle;
    layout.innerHTML = '';
    window.removeEventListener('afterprint', limpiar);
  };
  window.addEventListener('afterprint', limpiar);

  setTimeout(() => {
    try {
      window.print();
    } catch (err) {
      console.error('Error al imprimir internación:', err);
      alert('No se pudo abrir la impresión: ' + err.message);
      limpiar();
      return;
    }
    setTimeout(limpiar, 60000); // respaldo si el navegador no dispara 'afterprint'
  }, 150);
}


// Filtrar historial por tipo de documento
function filtrarHistorial(tipo, btnEl) {
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => btn.classList.remove('active'));
  const clicked = btnEl || (window.event && window.event.target && window.event.target.closest ? window.event.target.closest('.filter-btn') : null);
  if (clicked) clicked.classList.add('active');

  if (!state.historiasList) return;

  const filtradas = (tipo === 'todos')
    ? state.historiasList
    : state.historiasList.filter(h => clasificarHistoria(h) === tipo);

  renderHistoriasTimeline(filtradas);
}

// Render del timeline filtrado: usa EXACTAMENTE la misma tarjeta que la carga inicial
function renderHistoriasTimeline(historias) {
  const timeline = document.getElementById('historiasTimeline');
  if (!timeline) return;

  if (!historias || historias.length === 0) {
    timeline.innerHTML = '<div class="empty-state-box"><i data-lucide="filter-x"></i><h4>No hay registros de este tipo</h4><p>Probá seleccionando otro filtro.</p></div>';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  timeline.innerHTML = historias.map(construirTarjetaHistoria).join('');
  if (window.lucide) window.lucide.createIcons();
}

window.toggleDropdownDocumento = function(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('menuCargarDocumento');
  if(menu) {
    menu.classList.toggle('active');
  } else {
    // menu not found
  }
};
document.addEventListener('click', function(e) {
  const menu = document.getElementById('menuCargarDocumento');
  const btn = document.getElementById('btnGroupCargarDocumento');
  if(menu && menu.classList.contains('active')) {
    if(btn && !btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.remove('active');
    }
  }
});

// ==========================================================================
// GUARDIA — Sala de espera (turnos de hoy de Guardia) + internados. Solo lectura.
// ==========================================================================
let salaEsperaTimer = null;

function iniciarSalaEspera() {
  cargarSalaEspera();
  detenerSalaEspera();
  salaLlegadasVistas = null;
  salaEsperaTimer = setInterval(() => { if (!document.hidden) cargarSalaEspera(); }, 20000);
}
function detenerSalaEspera() {
  if (salaEsperaTimer) { clearInterval(salaEsperaTimer); salaEsperaTimer = null; }
}

// ---------- Médicos para asignar el turno ----------
let medicosCache = null;
async function prepararSelectorMedico() {
  const sel = document.getElementById('turnoMedicoId');
  const ayuda = document.getElementById('turnoMedicoAyuda');
  if (!sel) return;
  const u = state.user || {};
  // Un médico agenda para sí mismo
  if (u.soloSusTurnos) {
    sel.innerHTML = `<option value="${escInt(u.id || '')}" data-nombre="${escInt(u.nombre || '')}">${escInt(u.nombre || 'Yo')}</option>`;
    sel.disabled = true;
    if (ayuda) ayuda.textContent = 'El turno queda en tu agenda.';
    return;
  }
  sel.disabled = false;
  if (ayuda) ayuda.textContent = 'El turno le aparece solo a este médico, en su calendario y en su sala de espera.';
  if (!medicosCache) {
    try {
      const res = await apiFetch('/turnos/medicos');
      medicosCache = res.ok ? await res.json() : [];
    } catch (e) { medicosCache = []; }
  }
  const previo = sel.value;
  const etiqueta = { GUARDIA: 'Guardia', UTI: 'UTI', PISOS: 'Pisos', CONSULTORIO: 'Consultorio' };
  sel.innerHTML = '<option value="">Sin asignar</option>' + medicosCache.map(m =>
    `<option value="${escInt(m.id)}" data-nombre="${escInt(m.nombre)}">${escInt(m.nombre)}${m.servicio ? ' · ' + escInt(etiqueta[m.servicio] || m.servicio) : ''}</option>`).join('');
  if (previo) sel.value = previo;
}

// ---------- Consultorio del día (lo elige el propio médico) ----------
// La pantalla de la sala anuncia "Pase por favor · <consultorio>". Como un médico
// puede atender un día en el 1 y otro en el 2, lo cambia él mismo desde acá.
const CONSULTORIOS_RAPIDOS = ['Consultorio 1', 'Consultorio 2', 'Consultorio 3', 'Consultorio 4', 'Consultorio 5', 'Consultorio 6'];

function prepararBarraConsultorio() {
  const barra = document.getElementById('consultorioBar');
  if (!barra) return;
  const u = state.user || {};
  const puede = u.rol === 'MED' && !!u.id;
  barra.classList.toggle('hidden', !puede);
  if (!puede) return;
  const input = document.getElementById('consultorioInput');
  if (input && document.activeElement !== input && !barra.dataset.editando) input.value = u.consultorio || '';
  pintarChipsConsultorio(u.consultorio || '');
  if (!u.consultorio) estadoConsultorio('Todavía no elegiste consultorio: la pantalla va a decir solo «Consultorio».', 'aviso');
}

function pintarChipsConsultorio(actual) {
  const cont = document.getElementById('consultorioChips');
  if (!cont) return;
  cont.innerHTML = CONSULTORIOS_RAPIDOS.map(c => {
    const n = c.replace('Consultorio ', '');
    const activo = actual.trim().toLowerCase() === c.toLowerCase();
    return `<button type="button" class="consultorio-chip${activo ? ' activo' : ''}" data-valor="${escInt(c)}" title="${escInt(c)}" aria-pressed="${activo}">${escInt(n)}</button>`;
  }).join('');
  cont.onclick = (e) => {
    const b = e.target.closest('.consultorio-chip');
    if (!b) return;
    document.getElementById('consultorioInput').value = b.dataset.valor;
    guardarConsultorio();
  };
}

function estadoConsultorio(texto, tipo) {
  const el = document.getElementById('consultorioEstado');
  if (!el) return;
  el.textContent = texto;
  el.className = 'consultorio-estado' + (tipo ? ' ' + tipo : '');
}

async function guardarConsultorio(e) {
  if (e && e.preventDefault) e.preventDefault();
  const input = document.getElementById('consultorioInput');
  const btn = document.getElementById('consultorioGuardarBtn');
  const valor = (input.value || '').replace(/\s+/g, ' ').trim();
  if (btn) btn.disabled = true;
  estadoConsultorio('Guardando…');
  try {
    const res = await apiFetch('/auth/consultorio', { method: 'PUT', body: JSON.stringify({ consultorio: valor }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo guardar el consultorio');
    if (data.usuario) Object.assign(state.user, { consultorio: data.usuario.consultorio || null });
    input.value = state.user.consultorio || '';
    pintarChipsConsultorio(state.user.consultorio || '');
    estadoConsultorio(state.user.consultorio
      ? `Listo: la pantalla va a anunciar «${state.user.consultorio}».`
      : 'Sin consultorio: la pantalla va a decir solo «Consultorio».', state.user.consultorio ? 'ok' : 'aviso');
    showToast(state.user.consultorio ? `Hoy atendés en ${state.user.consultorio}` : 'Consultorio borrado');
  } catch (err) {
    estadoConsultorio(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- Sala de espera (pestaña Turnos) ----------
let salaLlegadasVistas = null;   // para avisar al médico cuando llega alguien nuevo

async function cargarSalaEspera() {
  const lista = document.getElementById('guardiaLista');
  const resumen = document.getElementById('guardiaResumen');
  if (!lista) return;
  const u = state.user || {};
  const esMedico = !!u.soloSusTurnos || u.rol === 'ADM';
  const esRecepcion = tienePermiso('calendario') && !u.soloSusTurnos;
  const cardInt = document.getElementById('guardiaInternadosCard');
  if (cardInt) cardInt.classList.toggle('hidden', !(u.rol === 'MED' && u.servicio === 'GUARDIA'));
  prepararBarraConsultorio();
  if (!lista.children.length) lista.innerHTML = '<div class="guardia-vacio">Cargando…</div>';

  try {
    const res = await apiFetch('/guardia/sala-espera');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const turnos = data.turnos || [];
    salaUI.turnos = turnos;

    // Mantener sincronizado el calendario (llegada, llamado y estado)
    let cambio = false;
    turnos.forEach(x => {
      const local = (state.turnosList || []).find(tt => String(tt.id) === String(x.id));
      if (local && (local.llegada !== x.llegada || local.llamado !== x.llamado || local.estado !== x.estado) && !local._guardandoLlegada) {
        Object.assign(local, { llegada: x.llegada, llamado: x.llamado, estado: x.estado }); cambio = true;
      }
    });
    if (cambio) {
      const drawer = document.getElementById('dayDrawerPanel');
      if (drawer && drawer.classList.contains('active')) renderizarDrawerTurnos();
      if (typeof renderizarCalendarioMensual === 'function' && tienePermiso('calendario')) renderizarCalendarioMensual();
    }

    // Aviso al médico: pacientes que acaban de llegar
    const llegados = new Set(turnos.filter(x => x.etapa === 0).map(x => x.id));
    if (u.soloSusTurnos && salaLlegadasVistas) {
      const nuevos = turnos.filter(x => x.etapa === 0 && !salaLlegadasVistas.has(x.id));
      nuevos.forEach(x => showToast(`Llegó ${fmtNombrePersona(`${(x.pacientes || {}).apellido || ''} ${(x.pacientes || {}).nombre || ''}`)} a la sala de espera`));
    }
    salaLlegadasVistas = llegados;

    const cuenta = (e) => turnos.filter(x => x.etapa === e).length;
    if (resumen) resumen.innerHTML = turnos.length
      ? `<strong>${cuenta(0)} en sala</strong> · ${cuenta(1)} en consultorio · ${cuenta(2)} por llegar · ${cuenta(3)} atendidos <span class="sala-hora">· ${escInt(data.hora || '')}</span>`
      : (u.soloSusTurnos ? 'No tenés turnos para hoy.' : 'No hay turnos para hoy.');

    const ETAPA = [
      { clase: 'en-sala', txt: 'En sala' }, { clase: 'llamado', txt: 'En consultorio' },
      { clase: 'esperado', txt: 'Por llegar' }, { clase: 'atendido', txt: 'Atendido' }
    ];
    lista.innerHTML = turnos.length ? turnos.map(x => {
      const p = x.pacientes || {};
      const nombre = fmtNombrePersona(`${p.apellido || ''} ${p.nombre || ''}`) || 'Paciente';
      const edad = edadDesdeNacimiento(p.fecha_nac);
      const hora = String(x.fecha_turno || '').slice(11, 16);
      const et = ETAPA[x.etapa] || ETAPA[2];
      const principal = x.etapa === 0 ? `<i data-lucide="check-circle-2"></i> ${escInt(x.llegada)}`
        : x.etapa === 1 ? `<i data-lucide="door-open"></i> ${escInt(x.llamado)}` : escInt(hora);
      const idTurno = escInt(x.id);
      let acciones = '';
      if (esMedico) {
        if (tienePermiso('hc.acceso') && p.id) acciones += `<button type="button" class="btn btn-outline btn-sm btn-ojo" title="Ver historia clínica" onclick="verHCDesdeSala('${idTurno}')"><i data-lucide="eye"></i></button>`;
        if (x.etapa === 0) acciones += `<button type="button" class="btn btn-primary btn-sm" onclick="accionSala('${idTurno}', 'llamar')"><i data-lucide="megaphone"></i> Que pase</button>`;
        if (x.etapa === 1) acciones += `<button type="button" class="btn btn-outline btn-sm" title="Vuelve a aparecer en la pantalla de la sala" onclick="accionSala('${idTurno}', 'llamar')"><i data-lucide="repeat"></i> Volver a llamar</button>`
          + `<button type="button" class="btn btn-outline btn-sm" onclick="accionSala('${idTurno}', 'finalizar')"><i data-lucide="check"></i> Finalizar</button>`;
      } else if (esRecepcion && x.etapa === 2) {
        acciones += `<button type="button" class="btn btn-outline btn-sm" onclick="marcarLlegadaDesdeSala('${idTurno}')"><i data-lucide="map-pin"></i> Marcar llegada</button>`;
      }
      const aviso = '';   // el llamado se anuncia en la pantalla de la sala (no en Recepción)
      return `
        <div class="guardia-item sala-${et.clase}">
          <div class="guardia-hora"><span class="guardia-estado">${principal}</span></div>
          <div class="guardia-datos">
            <strong>${escInt(nombre)}</strong>
            <span>DNI ${escInt(fmtDni(p.dni))}${edad ? ' · ' + edad + ' años' : ''} · ${escInt(fmtCobertura(p.obra_social))} · turno ${escInt(hora)}</span>
            ${!u.soloSusTurnos ? `<span class="sala-medico">${escInt(x.especialidad || '')}${x.medico ? ' · ' + escInt(fmtNombrePersona(x.medico)) : ' · sin médico asignado'}</span>` : `<span class="sala-medico">${escInt(x.especialidad || '')}</span>`}
            ${x.notas ? `<span class="guardia-nota">${escInt(x.notas)}</span>` : ''}
            ${aviso}
          </div>
          <div class="sala-lado">
            <div class="guardia-tag">${et.txt}</div>
            ${acciones ? `<div class="sala-acciones">${acciones}</div>` : ''}
          </div>
        </div>`;
    }).join('') : `<div class="guardia-vacio"><i data-lucide="armchair"></i> ${u.soloSusTurnos ? 'Sin turnos para hoy' : 'Sala vacía'}</div>`;
  } catch (err) {
    lista.innerHTML = '<div class="guardia-vacio">No se pudo cargar la sala de espera. Se reintenta en unos segundos.</div>';
  }
  if (!document.getElementById('guardiaInternadosCard').classList.contains('hidden')) renderInternadosGuardia();
  if (window.lucide) window.lucide.createIcons();
}

const salaUI = { turnos: [] };

function verHCDesdeSala(idTurno) {
  const x = salaUI.turnos.find(t => String(t.id) === String(idTurno));
  if (x && x.pacientes) mostrarPacienteEnHistorias(x.pacientes, true);
}

async function accionSala(idTurno, accion) {
  try {
    const res = await apiFetch(`/guardia/turnos/${idTurno}/${accion}`, { method: 'PUT', body: '{}' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'No se pudo completar la acción'); return; }
    showToast(accion === 'llamar' ? 'Llamado en la pantalla de la sala' : 'Consulta finalizada');
    cargarSalaEspera();
  } catch (e) { showToast('Sin conexión con el servidor'); }
}

async function marcarLlegadaDesdeSala(idTurno) {
  const a = new Date();
  const hora = String(a.getHours()).padStart(2, '0') + ':' + String(a.getMinutes()).padStart(2, '0');
  try {
    const res = await apiFetch(`/turnos/${idTurno}/llegada`, { method: 'PUT', body: JSON.stringify({ llegada: hora }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'No se pudo marcar la llegada'); return; }
    const local = (state.turnosList || []).find(t => String(t.id) === String(idTurno));
    if (local) local.llegada = hora;
    showToast('Llegada marcada: el médico ya lo ve en su sala');
    cargarSalaEspera();
  } catch (e) { showToast('Sin conexión con el servidor'); }
}

function renderInternadosGuardia() {
  const cont = document.getElementById('guardiaInternados');
  if (!cont) return;
  if (!internacionUI.datos) { inicializarInternacion().then(() => renderInternadosGuardia()); return; }
  const filas = [];
  INTERNACION_SECTORES.forEach(s => (internacionUI.datos[s.key] || []).filter(camaOcupada).forEach(b => filas.push({ s, b })));
  cont.innerHTML = filas.length ? filas.map(({ s, b }) => `
    <div class="guardia-item" style="--sector:${s.color}">
      <div class="guardia-hora"><span class="guardia-cama">${escInt(b.cama)}</span></div>
      <div class="guardia-datos"><strong>${escInt(b.paciente)}</strong><span>${escInt(s.titulo)}${b.fecha ? ' · ingreso ' + escInt(fechaIntMostrar(b.fecha)) : ''}</span></div>
    </div>`).join('') : '<div class="guardia-vacio">No hay pacientes internados.</div>';
}

// ==========================================================================
// PORTAL DE PACIENTES — recepción habilita el acceso y manda el código por email
// ==========================================================================
let appPacienteId = null;

function fmtFechaHoraCorta(iso) {
  return iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' hs' : '—';
}

function pintarEstadoAppPaciente(d) {
  const caja = document.getElementById('appPacEstado');
  const btn = document.querySelector('#appPacEnviar span');
  const quitar = document.getElementById('appPacQuitar');
  const e = d && d.estado;
  const txt = {
    sin_acceso: ['neutro', 'user-plus', 'Todavía no tiene el portal de pacientes habilitado.'],
    codigo_enviado: ['pendiente', 'mail', `Código enviado a <strong>${escInt(d.email)}</strong>. Vence el ${escInt(fmtFechaHoraCorta(d.codigo_vence))}. Falta que el paciente lo use para elegir su contraseña.`],
    codigo_vencido: ['pendiente', 'clock', `El código que se le mandó a <strong>${escInt(d.email)}</strong> venció o se usó mal. Mandale uno nuevo.`],
    activa: ['ok', 'check-circle-2', `Usa el portal. Último ingreso: ${escInt(fmtFechaHoraCorta(d.ultimo_login))}.${d.codigo_vence ? ' Tiene un código nuevo pendiente.' : ''}`],
    bloqueada: ['error', 'lock', `Bloqueada por intentos fallidos hasta el ${escInt(fmtFechaHoraCorta(d.bloqueado_hasta))}. Enviar un código nuevo la desbloquea.`],
    desactivada: ['error', 'user-x', 'El acceso al portal está quitado. Enviar un código lo vuelve a habilitar.']
  }[e] || ['neutro', 'info', 'Sin datos.'];
  caja.className = 'app-pac-estado is-' + txt[0];
  caja.innerHTML = `<i data-lucide="${txt[1]}"></i><span>${txt[2]}</span>`;
  if (btn) btn.textContent = e === 'sin_acceso' ? 'Enviar código' : 'Enviar código nuevo';
  quitar.classList.toggle('hidden', !e || e === 'sin_acceso' || e === 'desactivada');
  if (window.lucide) window.lucide.createIcons();
}

async function abrirAppPaciente(id) {
  const p = (state.pacientesList || []).find(x => String(x.id) === String(id));
  appPacienteId = id;
  document.getElementById('appPacNombre').textContent = p ? `${fmtNombrePersona(p.apellido || '')}, ${fmtNombrePersona(p.nombre || '')} · DNI ${fmtDni(p.dni || '') || '—'}` : '';
  document.getElementById('appPacEmail').value = (p && p.email) || '';
  document.getElementById('appPacError').classList.add('hidden');
  document.getElementById('appPacCodigo').classList.add('hidden');
  document.getElementById('appPacEstado').className = 'app-pac-estado';
  document.getElementById('appPacEstado').textContent = 'Consultando…';
  document.getElementById('appPacQuitar').classList.add('hidden');
  openModal('modalAppPaciente');
  try {
    const res = await apiFetch('/acceso-app/' + encodeURIComponent(id));
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo consultar');
    if (d.email) document.getElementById('appPacEmail').value = d.email;
    pintarEstadoAppPaciente(d);
  } catch (err) {
    document.getElementById('appPacEstado').className = 'app-pac-estado is-error';
    document.getElementById('appPacEstado').textContent = err.message;
  }
}

async function enviarCodigoAppPaciente(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('appPacEmail').value.trim();
  const errEl = document.getElementById('appPacError');
  const codEl = document.getElementById('appPacCodigo');
  const btn = document.getElementById('appPacEnviar');
  errEl.classList.add('hidden'); codEl.classList.add('hidden');
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { errEl.textContent = 'Ingresá un email válido.'; errEl.classList.remove('hidden'); return; }
  btn.disabled = true;
  try {
    const res = await apiFetch('/acceso-app/' + encodeURIComponent(appPacienteId), { method: 'POST', body: JSON.stringify({ email }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo enviar el código');
    pintarEstadoAppPaciente(d);
    const p = (state.pacientesList || []).find(x => String(x.id) === String(appPacienteId));
    if (p) p.email = email;
    if (d.enviado) {
      showToast('Código enviado a ' + email);
    } else {
      codEl.innerHTML = `<p><strong>No se pudo mandar el email.</strong> Dale este código al paciente (vence en ${escInt(d.horas || 72)} horas):</p>
        <div class="app-pac-codigo-num">${escInt(d.codigo || '')}</div>
        <p>En clinicapasso.com.ar tiene que tocar <em>"Iniciar sesión"</em> → <em>"Tengo un código"</em> y poner su DNI y este código.</p>`;
      codEl.classList.remove('hidden');
    }
  } catch (err) {
    errEl.textContent = err.message; errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function quitarAccesoAppPaciente() {
  if (!confirm('¿Quitarle el acceso al portal a este paciente? Se le cierra la sesión en todos sus dispositivos. Su historia clínica no se modifica.')) return;
  try {
    const res = await apiFetch('/acceso-app/' + encodeURIComponent(appPacienteId), { method: 'DELETE' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo quitar el acceso');
    pintarEstadoAppPaciente(d);
    showToast('Acceso al portal quitado');
  } catch (err) { alert(err.message); }
}

// ==========================================================================
// ADMINISTRACIÓN — usuarios y auditoría
// ==========================================================================
let usuariosAdmin = [];

function etiquetaPerfilUsuario(u) {
  const m = MATRIZ_PERFILES[perfilClave(u.rol, u.servicio)];
  return m ? m.etiqueta : u.rol;
}

function mostrarVistaAdmin(vista) {
  document.querySelectorAll('[data-admin-vista]').forEach(b => b.classList.toggle('active', b.dataset.adminVista === vista));
  document.getElementById('adminVistaUsuarios').classList.toggle('hidden', vista !== 'usuarios');
  document.getElementById('adminVistaAuditoria').classList.toggle('hidden', vista !== 'auditoria');
  document.getElementById('adminVistaPantalla').classList.toggle('hidden', vista !== 'pantalla');
  if (vista === 'usuarios') cargarUsuariosAdmin();
  else if (vista === 'auditoria') cargarAuditoria();
  else cargarPantallaAdmin();
}

async function cargarUsuariosAdmin() {
  const body = document.getElementById('adminUsuariosBody');
  if (!body) return;
  try {
    const res = await apiFetch('/admin/usuarios');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    usuariosAdmin = await res.json();
  } catch (e) {
    body.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 2rem;">No se pudo cargar la lista de usuarios.</td></tr>';
    return;
  }
  const fmt = (f) => f ? new Date(f).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  body.innerHTML = usuariosAdmin.map(u => {
    const bloqueado = u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();
    const estado = !u.activo ? '<span class="usr-estado inactivo">Inactivo</span>'
      : bloqueado ? '<span class="usr-estado bloqueado">Bloqueado</span>'
      : u.debe_cambiar_password ? '<span class="usr-estado pendiente">Falta elegir clave</span>'
      : '<span class="usr-estado activo">Activo</span>';
    return `
      <tr class="pac-fila">
        <td data-label="ID"><span class="user-id-chip grande">${escInt(u.numero_visible)}</span></td>
        <td class="pac-td-nombre"><strong class="pac-nombre">${escInt(u.nombre_completo)}</strong>${u.matricula ? `<small class="pac-email pac-sin-dato">${escInt(u.matricula)}</small>` : ''}</td>
        <td data-label="Usuario">${escInt(u.usuario)}</td>
        <td data-label="Perfil">${escInt(etiquetaPerfilUsuario(u))}${u.consultorio ? `<small class="pac-email pac-sin-dato">${escInt(u.consultorio)}</small>` : ''}</td>
        <td data-label="Estado">${estado}</td>
        <td data-label="Último ingreso">${fmt(u.ultimo_login)}</td>
        <td class="pac-td-acciones"><div class="pac-acciones">
          <button class="btn btn-outline btn-sm" onclick="abrirModalUsuario('${escInt(u.id)}')"><i data-lucide="pencil"></i> Editar</button>
          <button class="btn btn-outline btn-sm" onclick="resetearClaveUsuario('${escInt(u.id)}')"><i data-lucide="key-round"></i> Resetear clave</button>
          ${bloqueado ? `<button class="btn btn-outline btn-sm" onclick="desbloquearUsuario('${escInt(u.id)}')"><i data-lucide="unlock"></i> Desbloquear</button>` : ''}
        </div></td>
      </tr>`;
  }).join('') || '<tr><td colspan="7" class="text-center" style="padding: 2rem;">Todavía no hay usuarios.</td></tr>';
  if (window.lucide) window.lucide.createIcons();
}

function actualizarServicioUsuario() {
  const rol = document.getElementById('usrRol').value;
  document.getElementById('usrServicioWrap').classList.toggle('hidden', rol !== 'MED');
  document.getElementById('usrConsultorioWrap').classList.toggle('hidden', rol !== 'MED');
  const m = MATRIZ_PERFILES[perfilClave(rol, document.getElementById('usrServicio').value)];
  const prev = document.getElementById('usrPermisosPreview');
  if (prev && m) {
    const docs = m.docsEscribir.map(t => NOMBRE_TIPO_DOC[t]);
    const soloVer = m.docsVer.filter(t => !m.docsEscribir.includes(t)).map(t => NOMBRE_TIPO_DOC[t]);
    prev.innerHTML = `<strong>Este perfil va a poder:</strong><ul>${m.permisos.map(p => `<li>${escInt(DESCRIPCION_PERMISOS_UI[p])}</li>`).join('')}
      ${docs.length ? `<li>Cargar: ${escInt(docs.join(', '))}</li>` : ''}${soloVer.length ? `<li>Ver (sin editar): ${escInt(soloVer.join(', '))}</li>` : ''}</ul>`;
  }
}

function abrirModalUsuario(id) {
  inicializarModalesCuenta();
  const u = id ? usuariosAdmin.find(x => String(x.id) === String(id)) : null;
  document.getElementById('formUsuario').reset();
  document.getElementById('usrId').value = u ? u.id : '';
  document.getElementById('modalUsuarioTitulo').textContent = u ? `Editar usuario · ID ${u.numero_visible}` : 'Nuevo usuario';
  document.getElementById('usrNombre').value = u ? u.nombre_completo : '';
  document.getElementById('usrUsuario').value = u ? u.usuario : '';
  document.getElementById('usrUsuario').readOnly = !!u;
  document.getElementById('usrNumero').value = u ? u.numero_visible : '';
  document.getElementById('usrNumero').readOnly = !!u;
  document.getElementById('usrRol').value = u ? u.rol : 'REC';
  document.getElementById('usrServicio').value = (u && u.servicio) || 'GUARDIA';
  document.getElementById('usrMatricula').value = (u && u.matricula) || '';
  document.getElementById('usrConsultorio').value = (u && u.consultorio) || '';
  document.getElementById('usrActivoWrap').classList.toggle('hidden', !u);
  document.getElementById('usrActivo').checked = !u || !!u.activo;
  document.getElementById('usrError').classList.add('hidden');
  document.getElementById('usrServicio').onchange = actualizarServicioUsuario;
  actualizarServicioUsuario();
  openModal('modalUsuario');
}

async function guardarUsuarioAdmin(e) {
  e.preventDefault();
  const id = document.getElementById('usrId').value;
  const err = document.getElementById('usrError');
  const btn = document.getElementById('btnGuardarUsuario');
  err.classList.add('hidden');
  const cuerpo = {
    nombre_completo: document.getElementById('usrNombre').value.trim(),
    rol: document.getElementById('usrRol').value,
    servicio: document.getElementById('usrServicio').value,
    matricula: document.getElementById('usrMatricula').value.trim(),
    consultorio: document.getElementById('usrConsultorio').value.trim()
  };
  if (!id) {
    cuerpo.usuario = document.getElementById('usrUsuario').value.trim().toLowerCase();
    const n = document.getElementById('usrNumero').value.trim();
    if (n) cuerpo.numero_visible = parseInt(n, 10);
  } else {
    cuerpo.activo = document.getElementById('usrActivo').checked;
  }
  btn.disabled = true;
  try {
    const res = await apiFetch(id ? `/admin/usuarios/${id}` : '/admin/usuarios', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(cuerpo) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { err.textContent = data.error || 'No se pudo guardar.'; err.classList.remove('hidden'); return; }
    closeModal('modalUsuario');
    if (!id && data.passwordTemporal) mostrarClaveTemporal(data.usuario.nombre_completo, data.usuario.usuario, data.passwordTemporal);
    else showToast('Usuario actualizado');
    cargarUsuariosAdmin();
  } catch (e2) {
    err.textContent = 'Sin conexión con el servidor.'; err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function resetearClaveUsuario(id) {
  const u = usuariosAdmin.find(x => String(x.id) === String(id));
  if (!u || !confirm(`¿Generar una contraseña temporal nueva para ${u.nombre_completo}?\n\nSus sesiones abiertas se van a cerrar.`)) return;
  const res = await apiFetch(`/admin/usuarios/${id}/reset`, { method: 'POST', body: '{}' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { alert(data.error || 'No se pudo resetear la contraseña.'); return; }
  mostrarClaveTemporal(u.nombre_completo, u.usuario, data.passwordTemporal);
  cargarUsuariosAdmin();
}

async function desbloquearUsuario(id) {
  const res = await apiFetch(`/admin/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify({ desbloquear: true }) });
  if (res.ok) { showToast('Usuario desbloqueado'); cargarUsuariosAdmin(); }
}

function mostrarClaveTemporal(nombre, usuario, clave) {
  document.getElementById('tempNombre').textContent = nombre;
  document.getElementById('tempUsuario').textContent = usuario;
  document.getElementById('tempClave').textContent = clave;
  openModal('modalClaveTemporal');
}

function copiarClaveTemporal() {
  const txt = `Usuario: ${document.getElementById('tempUsuario').textContent}\nContraseña temporal: ${document.getElementById('tempClave').textContent}`;
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => showToast('Copiado')).catch(() => showToast('No se pudo copiar: anotala a mano'));
}

const NOMBRE_ACCION = {
  'login': 'Ingresó al sistema', 'login.fallido': 'Intento de ingreso fallido', 'login.bloqueado': 'Usuario bloqueado por intentos',
  'login.compartido': 'Ingresó con clave compartida', 'login.primer_admin': 'Creó el primer administrador', 'password.cambio': 'Cambió su contraseña',
  'usuario.crear': 'Creó un usuario', 'usuario.modificar': 'Modificó un usuario', 'usuario.reset_password': 'Reseteó una contraseña',
  'hc.crear': 'Cargó un documento', 'hc.editar': 'Editó un documento', 'hc.eliminar': 'Eliminó un documento',
  'archivo.subir': 'Subió un archivo', 'cama.actualizar': 'Actualizó camas'
};

async function cargarAuditoria() {
  const cont = document.getElementById('auditLista');
  const sel = document.getElementById('auditFiltroUsuario');
  if (!cont) return;
  if (sel && sel.options.length <= 1) {
    if (!usuariosAdmin.length) { try { const r = await apiFetch('/admin/usuarios'); if (r.ok) usuariosAdmin = await r.json(); } catch (e) {} }
    usuariosAdmin.forEach(u => { const o = document.createElement('option'); o.value = u.id; o.textContent = `${u.nombre_completo} (ID ${u.numero_visible})`; sel.appendChild(o); });
  }
  const filtro = sel && sel.value ? `&usuario_id=${encodeURIComponent(sel.value)}` : '';
  try {
    const res = await apiFetch(`/admin/auditoria?limite=300${filtro}`);
    if (!res.ok) throw new Error();
    const eventos = await res.json();
    const numeros = Object.fromEntries(usuariosAdmin.map(u => [u.id, u.numero_visible]));
    cont.innerHTML = eventos.length ? eventos.map(ev => {
      const f = new Date(ev.fecha);
      const det = ev.detalle && ev.detalle.tipo ? ` · ${NOMBRE_TIPO_DOC[ev.detalle.tipo] || ev.detalle.tipo}` : (ev.detalle && ev.detalle.nombre ? ` · ${ev.detalle.nombre}` : '');
      return `
        <div class="audit-item ${String(ev.accion).includes('fallido') || String(ev.accion).includes('bloqueado') ? 'alerta' : ''}">
          <div class="audit-fecha">${f.toLocaleDateString('es-AR')}<br><strong>${f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
          <div class="audit-datos">
            <strong>${escInt(ev.usuario_nombre || 'Desconocido')}</strong>${numeros[ev.usuario_id] ? ` <span class="autor-id">ID ${numeros[ev.usuario_id]}</span>` : ''}
            <span>${escInt(NOMBRE_ACCION[ev.accion] || ev.accion)}${escInt(det)}</span>
          </div>
        </div>`;
    }).join('') : '<div class="guardia-vacio">Sin movimientos registrados.</div>';
  } catch (e) {
    cont.innerHTML = '<div class="guardia-vacio">No se pudo cargar la auditoría.</div>';
  }
  if (window.lucide) window.lucide.createIcons();
}

// ==========================================================================
// RAYOS — control de placas del día de los pacientes internados
// El técnico ve cada cama ocupada, si ya se subió la placa de HOY y quién la
// subió. Desde acá abre las placas del paciente o sube la que falta.
// ==========================================================================
const rayosUI = { fecha: null, internados: [], filtro: 'todos', timer: null, cargando: false };

async function cargarRayos() {
  if (!tienePermiso('rayos') || rayosUI.cargando) return;
  rayosUI.cargando = true;
  try {
    const res = await apiFetch('/rayos/internados');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    rayosUI.fecha = data.fecha;
    rayosUI.internados = data.internados || [];
    rayosUI.error = false;
  } catch (e) {
    rayosUI.error = true;
  } finally {
    rayosUI.cargando = false;
  }
  renderRayos();
  // la planilla de internación muestra las mismas marcas
  if (document.getElementById('internacion-tab') && document.getElementById('internacion-tab').classList.contains('active')) renderInternacion();
}

function iniciarRayos() {
  cargarRayos();
  detenerRayos();
  rayosUI.timer = setInterval(() => { if (!document.hidden) cargarRayos(); }, 60000);
}
function detenerRayos() {
  if (rayosUI.timer) { clearInterval(rayosUI.timer); rayosUI.timer = null; }
}

function filtrarRayos(filtro, btn) {
  rayosUI.filtro = filtro;
  document.querySelectorAll('#rayosFiltros .filter-btn').forEach(b => b.classList.toggle('active', b === btn));
  renderRayos();
}

// Marca de "placa de hoy" para una cama (la usa también la planilla de internación)
function estadoPlacaDeCama(sectorKey, cama) {
  return rayosUI.internados.find(f => f.sector === sectorKey && String(f.cama) === String(cama)) || null;
}

function renderRayos() {
  const cont = document.getElementById('rayosLista');
  const resumen = document.getElementById('rayosResumen');
  if (!cont) return;
  if (rayosUI.error && !rayosUI.internados.length) {
    cont.innerHTML = '<div class="guardia-vacio">No se pudo cargar la lista. Se reintenta en un minuto.</div>';
    return;
  }
  const lista = rayosUI.internados;
  const hechas = lista.filter(f => f.placasHoy).length;
  const faltan = lista.filter(f => !f.placasHoy && f.paciente).length;
  const sinPadron = lista.filter(f => !f.paciente).length;
  if (resumen) {
    const fecha = rayosUI.fecha ? fmtFechaDoc(rayosUI.fecha) : 'hoy';
    resumen.innerHTML = `<strong>${fecha}</strong> · ${lista.length} internados · <span class="rx-ok-txt">${hechas} con placa</span> · <span class="rx-falta-txt">${faltan} pendientes</span>${sinPadron ? ` · ${sinPadron} sin vincular` : ''}`;
  }
  const ordenSector = Object.fromEntries(INTERNACION_SECTORES.map((s, i) => [s.key, i]));
  const filas = lista
    .filter(f => rayosUI.filtro === 'todos' || (rayosUI.filtro === 'faltan' ? !f.placasHoy : f.placasHoy))
    .sort((a, b) => (a.placasHoy - b.placasHoy) || (ordenSector[a.sector] - ordenSector[b.sector]) || ((a.orden || 0) - (b.orden || 0)));

  cont.innerHTML = filas.length ? filas.map(f => {
    const sector = INTERNACION_SECTORES.find(s => s.key === f.sector) || { titulo: f.sector, color: '#4F6B8F' };
    const idx = lista.indexOf(f);
    const nombre = f.paciente ? fmtNombrePersona(`${f.paciente.apellido || ''} ${f.paciente.nombre || ''}`) : fmtNombrePersona(f.nombreEnCama);
    const u = f.ultima;
    const estado = !f.paciente
      ? `<span class="rx-estado rx-sinpadron"><i data-lucide="user-x"></i> No vinculado al padrón</span>`
      : f.placasHoy
        ? `<span class="rx-estado rx-ok"><i data-lucide="check-circle-2"></i> Placa de hoy${u && u.hora ? ' · ' + escInt(u.hora) : ''}${f.cantidadHoy > 1 ? ` (${f.cantidadHoy})` : ''}</span>`
        : `<span class="rx-estado rx-falta"><i data-lucide="alert-circle"></i> Falta la placa de hoy</span>`;
    const detalle = !f.paciente
      ? 'Pedí a Recepción que registre al paciente y lo asigne a la cama desde el padrón.'
      : u ? `Última: ${u.fecha === rayosUI.fecha ? 'hoy' : fmtFechaDoc(u.fecha)}${u.hora ? ' ' + escInt(u.hora) : ''}${u.nombre ? ' · ' + escInt(u.nombre) + (u.numero ? ' (ID ' + escInt(u.numero) + ')' : '') : ''}`
      : 'Todavía no tiene placas cargadas.';
    return `
      <div class="rx-item ${f.placasHoy ? 'is-ok' : (f.paciente ? 'is-falta' : 'is-sin')}" style="--sector:${sector.color}">
        <div class="rx-cama"><span>${escInt(f.cama)}</span><small>${escInt(sector.titulo)}</small></div>
        <div class="rx-datos">
          <strong>${escInt(nombre)}</strong>
          <span>${f.paciente ? 'DNI ' + escInt(fmtDni(f.paciente.dni)) + (f.fechaIngreso ? ' · ingreso ' + escInt(fmtFechaDoc(f.fechaIngreso)) : '') : 'Cargado en la cama como texto'}</span>
          ${estado}
          <span class="rx-detalle">${detalle}</span>
        </div>
        <div class="rx-acciones">
          ${f.paciente ? `
            <button type="button" class="btn btn-outline btn-sm" onclick="verPlacasRayos(${idx})"><i data-lucide="images"></i> Ver placas</button>
            <button type="button" class="btn ${f.placasHoy ? 'btn-outline' : 'btn-primary'} btn-sm" onclick="subirPlacaRayos(${idx})"><i data-lucide="upload"></i> Subir placa</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="guardia-vacio">${rayosUI.filtro === 'faltan' ? '<i data-lucide="party-popper"></i> Todas las placas del día están cargadas' : 'No hay pacientes en esta lista.'}</div>`;
  if (window.lucide) window.lucide.createIcons();
}

function verPlacasRayos(idx) {
  const f = rayosUI.internados[idx];
  if (f && f.paciente) mostrarPacienteEnHistorias(f.paciente, true);
}

function subirPlacaRayos(idx) {
  const f = rayosUI.internados[idx];
  if (!f || !f.paciente) return;
  state.selectedPacienteHistoria = f.paciente;   // el adjunto queda cargado a este paciente
  openModalAdjunto();
}

// ==========================================================================
// ADMINISTRACIÓN — Pantalla de llamados de la sala (Smart TV)
// ==========================================================================
let pantallaClave = null;

async function cargarPantallaAdmin() {
  const estado = document.getElementById('pantallaEstado');
  try {
    const res = await apiFetch('/admin/pantalla');
    const data = await res.json();
    pantallaClave = data.configurada ? data.clave : null;
  } catch (e) { pantallaClave = null; }
  document.getElementById('pantallaSinClave').classList.toggle('hidden', !!pantallaClave);
  document.getElementById('pantallaConClave').classList.toggle('hidden', !pantallaClave);
  if (estado) estado.textContent = pantallaClave ? 'Configurada' : 'Falta configurar';
  actualizarLinkPantalla();
}

function linkPantalla() {
  if (!pantallaClave) return '';
  const base = location.origin && location.origin.startsWith('http') ? location.origin : 'https://TU-SITIO.netlify.app';
  const modo = document.getElementById('pantallaModo').value;
  const voz = document.getElementById('pantallaVoz').checked ? '&voz=si' : '';
  return `${base}/pantalla.html#clave=${encodeURIComponent(pantallaClave)}&modo=${modo}${voz}`;
}

function actualizarLinkPantalla() {
  const el = document.getElementById('pantallaLink');
  if (el) el.textContent = linkPantalla();
}

function copiarLinkPantalla() {
  const link = linkPantalla();
  (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
    .then(() => showToast('Link copiado')).catch(() => showToast('Seleccioná el link y copialo a mano'));
}

function abrirPantalla() {
  const link = linkPantalla();
  if (link) window.open(link, '_blank', 'noopener');
}

// ==========================================================================
// HORARIOS LIBRES, AGENDA DE LOS MÉDICOS, REPROGRAMAR Y NOTIFICACIONES
//  - Los horarios salen de la agenda de cada médico (pestaña "Agenda").
//    Si el médico no la cargó, se ofrecen horarios cada 30 min de 8 a 20.
//  - El servidor no deja dar dos turnos encimados: si igual hace falta
//    (sobreturno), el panel pregunta y lo manda con "forzar".
// ==========================================================================
// "Martín Gómez" → "Dr/a. Martín Gómez"; "Dr. Martín Gómez" queda igual
function conTituloMedico(n) { const v = String(n || '').trim(); return /^dra?\b/i.test(v) ? v : `Dr/a. ${v}`; }
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const DURACIONES = [10, 15, 20, 30, 40, 45, 60, 90];
const aMinutos = (h) => { const [a, b] = String(h || '0:0').split(':').map(Number); return a * 60 + b; };
const fechaDeInput = (v) => String(v || '').slice(0, 10);
const horaDeInput = (v) => String(v || '').slice(11, 16);

// ---------- Chips de horarios (compartido por "Nuevo turno" y "Reprogramar") ----------
function pintarHorarios(box, datos, seleccion, onElegir) {
  if (!box) return;
  if (!datos) { box.innerHTML = '<p class="horarios-msg">Elegí la fecha para ver los horarios libres.</p>'; return; }
  if (datos.error) { box.innerHTML = `<p class="horarios-msg is-error">${escInt(datos.error)}</p>`; return; }
  const lista = datos.horarios || [];
  if (!lista.length) {
    box.innerHTML = `<p class="horarios-msg is-aviso"><i data-lucide="calendar-off"></i> ${escInt(datos.motivo || 'No hay horarios ese día.')}</p>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  const libres = lista.filter(h => h.libre).length;
  const grupo = (titulo, items) => items.length ? `<div class="horarios-fila"><span class="horarios-franja">${titulo}</span><div class="horarios-chips">${items.map(h =>
    `<button type="button" class="hora-chip${h.libre ? '' : ' ocupado'}${h.hora === seleccion ? ' elegido' : ''}" data-hora="${h.hora}" ${h.libre ? '' : 'disabled title="Ocupado"'}>${h.hora}</button>`).join('')}</div></div>` : '';
  box.innerHTML = grupo('Mañana', lista.filter(h => aMinutos(h.hora) < 780)) + grupo('Tarde', lista.filter(h => aMinutos(h.hora) >= 780)) +
    `<p class="horarios-nota">${libres ? `${libres} libre${libres === 1 ? '' : 's'} · turnos de ${datos.duracion || 30} min` : 'No quedan horarios libres ese día.'}${datos.configurada === false ? ' · El médico no cargó su agenda: se muestran horarios generales.' : ''}</p>`;
  box.querySelectorAll('.hora-chip:not(.ocupado)').forEach(b => b.addEventListener('click', () => {
    box.querySelectorAll('.hora-chip.elegido').forEach(x => x.classList.remove('elegido'));
    b.classList.add('elegido');
    onElegir(b.dataset.hora);
  }));
}

async function pedirHorarios({ medico_id, especialidad, fecha, excluir }) {
  const q = new URLSearchParams({ fecha });
  if (medico_id) q.set('medico_id', medico_id);
  if (especialidad) q.set('especialidad', especialidad);
  if (excluir) q.set('excluir', excluir);
  try {
    const res = await apiFetch(`/turnos/horarios?${q}`);
    const d = await res.json().catch(() => ({}));
    return res.ok ? d : { error: d.error || 'No se pudieron cargar los horarios.' };
  } catch (e) { return { error: 'Sin conexión con el servidor.' }; }
}

// ---------- "Nuevo turno": horarios libres del día y primer horario libre automático ----------
let horariosTurnoPedido = 0;
async function cargarHorariosTurno(elegirPrimeroLibre = false) {
  const box = document.getElementById('turnoHorarios');
  const input = document.getElementById('turnoFecha');
  if (!box || !input) return;
  const fecha = fechaDeInput(input.value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { pintarHorarios(box, null); return; }
  const medico_id = (document.getElementById('turnoMedicoId') || {}).value || '';
  const especialidad = (document.getElementById('turnoEspecialidad') || {}).value || '';
  if (!medico_id && !especialidad) { box.innerHTML = '<p class="horarios-msg">Elegí la especialidad o el médico para ver los horarios libres.</p>'; return; }
  const n = ++horariosTurnoPedido;
  box.innerHTML = '<p class="horarios-msg">Buscando horarios…</p>';
  const d = await pedirHorarios({ medico_id, especialidad, fecha });
  if (n !== horariosTurnoPedido) return;              // llegó una respuesta vieja
  let hora = horaDeInput(input.value);
  const actual = (d.horarios || []).find(h => h.hora === hora);
  // Si la hora puesta está ocupada (o no es de la grilla), se pasa al primer horario libre
  if (elegirPrimeroLibre && (!actual || !actual.libre)) {
    const primero = (d.horarios || []).find(h => h.libre);
    if (primero) { hora = primero.hora; input.value = `${fecha}T${hora}`; }
  }
  pintarHorarios(box, d, hora, (h) => { input.value = `${fecha}T${h}`; });
}

let horariosTurnoListo = false;
function prepararHorariosTurno() {
  if (horariosTurnoListo) return;
  horariosTurnoListo = true;
  const recargar = () => cargarHorariosTurno(true);
  ['turnoMedicoId', 'turnoEspecialidad'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', recargar); });
  const f = document.getElementById('turnoFecha');
  if (f) {
    let ultimaFecha = '';
    f.addEventListener('change', () => {
      const fecha = fechaDeInput(f.value);
      if (fecha !== ultimaFecha) { ultimaFecha = fecha; cargarHorariosTurno(!horaDeInput(f.value)); }
      else cargarHorariosTurno(false);
    });
  }
}

// Horario encimado o fuera de la agenda: el servidor devuelve 409 y se pregunta si va igual
function confirmarSobreturno(data) {
  const extra = data.conflicto === 'fuera_agenda' ? 'Si igual lo tiene que atender, se puede dar como sobreturno.' : 'Se puede dar igual como sobreturno.';
  return confirm(`${data.error}\n\n${extra}\n¿Agendarlo igual?`);
}

// ---------- Reprogramar ----------
let reprogTurno = null;
let reprogHoraElegida = '';

function turnoPorId(id) {
  return (state.turnosList || []).find(t => String(t.id) === String(id)) || (notifState.items.find(n => n.turno && String(n.turno.id) === String(id)) || {}).turno || null;
}

async function abrirReprogramar(turnoId) {
  cerrarMenusTurno();
  const t = turnoPorId(turnoId);
  if (!t) { showToast('No se encontró el turno. Actualizá los datos.'); return; }
  reprogTurno = t;
  reprogHoraElegida = '';
  const p = t.pacientes || t.paciente || {};
  const nombre = fmtNombrePersona(p.nombre ? `${p.nombre} ${p.apellido || ''}` : 'Paciente');
  const fechaTxt = `${fmtDiaCorto(getFechaKeyDeTurno(t))} ${getHoraStrDeTurno(t)} hs`;
  document.getElementById('reprogResumen').innerHTML = `
    <strong>${escInt(nombre)}</strong>
    <span>${escInt(t.especialidad || '')}${t.medico ? ' · ' + escInt(conTituloMedico(fmtNombrePersona(t.medico))) : ''}</span>
    <span class="reprog-actual"><i data-lucide="clock"></i> Turno actual: ${escInt(fechaTxt)}${t.origen === 'app' ? ' · <em>pedido por la web</em>' : ''}</span>
    ${t.notas ? `<span class="reprog-notas">${escInt(t.notas)}</span>` : ''}`;

  // Médico: el propio médico no lo puede pasar a otro
  const sel = document.getElementById('reprogMedico');
  const grupo = document.getElementById('reprogMedicoGrupo');
  const u = state.user || {};
  if (u.soloSusTurnos) {
    grupo.classList.add('hidden');
    sel.innerHTML = `<option value="${escInt(u.id || '')}"></option>`;
  } else {
    grupo.classList.remove('hidden');
    await asegurarMedicosCache();
    sel.innerHTML = '<option value="">Sin asignar</option>' + (medicosCache || []).map(m => `<option value="${escInt(m.id)}">${escInt(m.nombre)}</option>`).join('');
    sel.value = t.medico_id || '';
  }
  document.getElementById('reprogFecha').value = getFechaKeyDeTurno(t);
  document.getElementById('reprogHoraManual').value = '';
  document.getElementById('reprogManual').open = false;
  document.getElementById('reprogConfirmar').checked = true;
  const email = p.email;
  document.getElementById('reprogAvisarLinea').classList.toggle('hidden', !email);
  document.getElementById('reprogAvisar').checked = !!email;
  openModal('modalReprogramar');
  cargarHorariosReprog();
}

async function asegurarMedicosCache() {
  if (medicosCache) return medicosCache;
  try { const res = await apiFetch('/turnos/medicos'); medicosCache = res.ok ? await res.json() : []; } catch (e) { medicosCache = []; }
  return medicosCache;
}

function elegirHoraReprog(hora, manual = false) {
  reprogHoraElegida = hora || '';
  if (manual) document.querySelectorAll('#reprogHorarios .hora-chip.elegido').forEach(x => x.classList.remove('elegido'));
  else document.getElementById('reprogHoraManual').value = '';
}

async function cargarHorariosReprog() {
  if (!reprogTurno) return;
  const box = document.getElementById('reprogHorarios');
  const fecha = document.getElementById('reprogFecha').value;
  if (!fecha) { pintarHorarios(box, null); return; }
  box.innerHTML = '<p class="horarios-msg">Buscando horarios…</p>';
  const d = await pedirHorarios({ medico_id: document.getElementById('reprogMedico').value, especialidad: reprogTurno.especialidad, fecha, excluir: reprogTurno.id });
  const mismaFecha = fecha === getFechaKeyDeTurno(reprogTurno);
  const actual = mismaFecha ? getHoraStrDeTurno(reprogTurno) : '';
  if (!reprogHoraElegida || !(d.horarios || []).some(h => h.hora === reprogHoraElegida && h.libre)) reprogHoraElegida = '';
  pintarHorarios(box, d, reprogHoraElegida, (h) => elegirHoraReprog(h));
  if (actual) {
    const chip = box.querySelector(`.hora-chip[data-hora="${actual}"]`);
    if (chip) chip.classList.add('es-actual');
  }
}

async function guardarReprogramacion(e, forzar = false) {
  if (e) e.preventDefault();
  if (!reprogTurno) return;
  const fecha = document.getElementById('reprogFecha').value;
  const hora = reprogHoraElegida;
  if (!fecha || !hora) { showToast('Elegí un horario de la lista (o escribí uno en "Otro horario").'); return; }
  const btn = document.getElementById('btnGuardarReprog');
  btn.disabled = true;
  const cuerpo = { fecha_turno: `${fecha}T${hora}` };
  if (!(state.user || {}).soloSusTurnos) cuerpo.medico_id = document.getElementById('reprogMedico').value || null;
  if (document.getElementById('reprogConfirmar').checked) cuerpo.estado = 'confirmado';
  if (forzar) cuerpo.forzar = true;
  try {
    const res = await apiFetch(`/turnos/${reprogTurno.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data.conflicto) {
      btn.disabled = false;
      if (confirmarSobreturno(data)) return guardarReprogramacion(null, true);
      return;
    }
    if (!res.ok) throw new Error(data.error || 'No se pudo reprogramar');
    const id = reprogTurno.id;
    closeModal('modalReprogramar');
    showToast(`Turno pasado al ${fmtDiaCorto(fecha)} a las ${hora} hs`);
    if (document.getElementById('reprogAvisar').checked && !document.getElementById('reprogAvisarLinea').classList.contains('hidden')) {
      apiFetch(`/turnos/${id}/notificar-email`, { method: 'POST' }).then(r => showToast(r.ok ? 'Se le mandó el turno por email al paciente' : 'El turno se guardó, pero no se pudo mandar el email')).catch(() => {});
    }
    await cargarTodosLosTurnosParaCalendario();
    if (notifState.abierto) cargarNotificaciones();
  } catch (err) {
    alert(`Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Agenda del médico ----------
const agendaState = { medicoId: null, dias: {}, bloqueos: [], intervalo: 30, cambios: false };

async function iniciarAgenda() {
  const u = state.user || {};
  const wrap = document.getElementById('agendaMedicoWrap');
  const titulo = document.getElementById('agendaTitulo');
  if (u.soloSusTurnos) {
    wrap.classList.add('hidden');
    titulo.textContent = 'Mi agenda';
    return cargarAgendaMedico(u.id);
  }
  titulo.textContent = 'Agenda de los médicos';
  wrap.classList.remove('hidden');
  const etiqueta = { GUARDIA: 'Guardia', UTI: 'UTI', PISOS: 'Pisos', CONSULTORIO: 'Consultorio' };
  const medicos = await asegurarMedicosCache();
  const sel = document.getElementById('agendaMedicoSelect');
  const previo = sel.value || agendaState.medicoId;
  sel.innerHTML = medicos.length ? medicos.map(m => `<option value="${escInt(m.id)}">${escInt(m.nombre)}${m.servicio ? ' · ' + escInt(etiqueta[m.servicio] || m.servicio) : ''}</option>`).join('')
    : '<option value="">No hay médicos cargados</option>';
  const inicial = medicos.find(m => String(m.id) === String(previo)) || medicos.find(m => m.servicio === 'CONSULTORIO') || medicos[0];
  if (!inicial) { document.getElementById('agendaSemana').innerHTML = '<p class="agenda-vacio">No hay usuarios con perfil Médico.</p>'; return; }
  sel.value = inicial.id;
  cargarAgendaMedico(inicial.id);
}

async function cargarAgendaMedico(medicoId) {
  if (!medicoId) return;
  if (agendaState.cambios && agendaState.medicoId && String(agendaState.medicoId) !== String(medicoId) && !confirm('Hay cambios sin guardar en esta agenda. ¿Descartarlos?')) {
    document.getElementById('agendaMedicoSelect').value = agendaState.medicoId;
    return;
  }
  const semana = document.getElementById('agendaSemana');
  semana.innerHTML = '<p class="agenda-vacio">Cargando…</p>';
  try {
    const res = await apiFetch(`/agenda/${encodeURIComponent(medicoId)}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo cargar la agenda');
    agendaState.medicoId = medicoId;
    agendaState.intervalo = d.intervalo_defecto || 30;
    agendaState.dias = {};
    ORDEN_DIAS.forEach(dia => { agendaState.dias[dia] = []; });
    (d.franjas || []).forEach(f => agendaState.dias[f.dia_semana].push({ desde: f.hora_desde, hasta: f.hora_hasta, duracion: f.duracion_min }));
    agendaState.bloqueos = d.bloqueos || [];
    agendaState.cambios = false;
    pintarAgenda();
    pintarBloqueos();
  } catch (err) {
    semana.innerHTML = `<p class="agenda-vacio is-error">${escInt(err.message)}</p>`;
  }
}

function turnosDeFranja(f) {
  const total = aMinutos(f.hasta) - aMinutos(f.desde);
  return total > 0 && f.duracion ? Math.floor(total / f.duracion) : 0;
}

function pintarAgenda() {
  const semana = document.getElementById('agendaSemana');
  semana.innerHTML = ORDEN_DIAS.map(dia => {
    const franjas = agendaState.dias[dia];
    const atiende = franjas.length > 0;
    const filas = franjas.map((f, i) => `
      <div class="agenda-franja" data-dia="${dia}" data-i="${i}">
        <label><span>De</span><input type="time" step="300" value="${f.desde}" data-campo="desde"></label>
        <label><span>a</span><input type="time" step="300" value="${f.hasta}" data-campo="hasta"></label>
        <label><span>Turnos de</span><select data-campo="duracion">${DURACIONES.map(m => `<option value="${m}" ${m === f.duracion ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>
        <span class="agenda-cupos">${turnosDeFranja(f)} turnos</span>
        <button type="button" class="agenda-quitar" title="Quitar este horario" onclick="quitarFranja(${dia}, ${i})"><i data-lucide="x"></i></button>
      </div>`).join('');
    return `
      <div class="agenda-dia${atiende ? ' atiende' : ''}">
        <label class="agenda-dia-nombre">
          <input type="checkbox" ${atiende ? 'checked' : ''} onchange="alternarDia(${dia}, this.checked)">
          <span>${DIAS_SEMANA[dia]}</span>
        </label>
        <div class="agenda-dia-franjas">
          ${atiende ? filas + `<button type="button" class="agenda-agregar" onclick="agregarFranja(${dia})"><i data-lucide="plus"></i> Otro horario este día</button>` : '<span class="agenda-no">No atiende</span>'}
        </div>
      </div>`;
  }).join('');
  semana.querySelectorAll('.agenda-franja input, .agenda-franja select').forEach(el => el.addEventListener('change', () => {
    const fila = el.closest('.agenda-franja');
    const f = agendaState.dias[fila.dataset.dia][fila.dataset.i];
    f[el.dataset.campo] = el.dataset.campo === 'duracion' ? Number(el.value) : el.value;
    fila.querySelector('.agenda-cupos').textContent = `${turnosDeFranja(f)} turnos`;
    marcarCambiosAgenda();
  }));
  actualizarResumenAgenda();
  if (window.lucide) window.lucide.createIcons();
}

function marcarCambiosAgenda() {
  agendaState.cambios = true;
  actualizarResumenAgenda();
}

function actualizarResumenAgenda() {
  const el = document.getElementById('agendaResumen');
  const dias = ORDEN_DIAS.filter(d => agendaState.dias[d] && agendaState.dias[d].length);
  const cupos = dias.reduce((s, d) => s + agendaState.dias[d].reduce((x, f) => x + turnosDeFranja(f), 0), 0);
  const base = dias.length ? `Atiende ${dias.length} día${dias.length === 1 ? '' : 's'} por semana · ${cupos} turnos semanales`
    : `Sin agenda cargada: se ofrecen horarios generales cada ${agendaState.intervalo} min de 8 a 20.`;
  el.innerHTML = escInt(base) + (agendaState.cambios ? ' <strong class="agenda-sin-guardar">· Cambios sin guardar</strong>' : '');
}

function alternarDia(dia, atiende) {
  agendaState.dias[dia] = atiende ? [{ desde: '09:00', hasta: '13:00', duracion: agendaState.intervalo || 30 }] : [];
  marcarCambiosAgenda();
  pintarAgenda();
}

function agregarFranja(dia) {
  const ult = agendaState.dias[dia][agendaState.dias[dia].length - 1];
  const desde = ult && aMinutos(ult.hasta) < 20 * 60 ? `${String(Math.max(aMinutos(ult.hasta) / 60 + 1, 14) | 0).padStart(2, '0')}:00` : '15:00';
  const hasta = `${String(Math.min((aMinutos(desde) / 60 | 0) + 3, 23)).padStart(2, '0')}:00`;
  agendaState.dias[dia].push({ desde, hasta, duracion: ult ? ult.duracion : agendaState.intervalo || 30 });
  marcarCambiosAgenda();
  pintarAgenda();
}

function quitarFranja(dia, i) {
  agendaState.dias[dia].splice(i, 1);
  marcarCambiosAgenda();
  pintarAgenda();
}

async function guardarAgenda() {
  if (!agendaState.medicoId) return;
  const franjas = [];
  ORDEN_DIAS.forEach(dia => agendaState.dias[dia].forEach(f => franjas.push({ dia_semana: dia, hora_desde: f.desde, hora_hasta: f.hasta, duracion_min: f.duracion })));
  const btn = document.getElementById('btnGuardarAgenda');
  btn.disabled = true;
  try {
    const res = await apiFetch(`/agenda/${encodeURIComponent(agendaState.medicoId)}`, { method: 'PUT', body: JSON.stringify({ franjas }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
    agendaState.cambios = false;
    actualizarResumenAgenda();
    showToast('Agenda guardada');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

function pintarBloqueos() {
  const box = document.getElementById('agendaBloqueos');
  const f = (iso) => iso.split('-').reverse().join('/');
  box.innerHTML = agendaState.bloqueos.length ? agendaState.bloqueos.map(b => `
    <div class="agenda-bloqueo">
      <i data-lucide="calendar-off"></i>
      <span><strong>${b.fecha_desde === b.fecha_hasta ? f(b.fecha_desde) : `${f(b.fecha_desde)} al ${f(b.fecha_hasta)}`}</strong>${b.motivo ? ' · ' + escInt(b.motivo) : ''}</span>
      <button type="button" class="agenda-quitar" title="Quitar" onclick="quitarBloqueo('${escInt(b.id)}')"><i data-lucide="x"></i></button>
    </div>`).join('') : '<p class="agenda-vacio">No hay días sin atención cargados.</p>';
  if (window.lucide) window.lucide.createIcons();
}

async function agregarBloqueo(e) {
  e.preventDefault();
  if (!agendaState.medicoId) return;
  const desde = document.getElementById('bloqDesde').value;
  const hasta = document.getElementById('bloqHasta').value || desde;
  const motivo = document.getElementById('bloqMotivo').value.trim();
  const btn = document.getElementById('btnAgregarBloqueo');
  btn.disabled = true;
  try {
    const res = await apiFetch(`/agenda/${encodeURIComponent(agendaState.medicoId)}/bloqueos`, { method: 'POST', body: JSON.stringify({ fecha_desde: desde, fecha_hasta: hasta, motivo }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudo agregar');
    agendaState.bloqueos.push(d.bloqueo);
    agendaState.bloqueos.sort((a, b) => a.fecha_desde.localeCompare(b.fecha_desde));
    pintarBloqueos();
    document.getElementById('formBloqueo').reset();
    if (d.turnos_afectados) alert(`Listo. Ojo: ya había ${d.turnos_afectados} turno${d.turnos_afectados === 1 ? '' : 's'} dado${d.turnos_afectados === 1 ? '' : 's'} esos días. Hay que reprogramarlos desde el calendario.`);
    else showToast('Días sin atención agregados');
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function quitarBloqueo(id) {
  if (!confirm('¿Quitar estos días sin atención? Se vuelven a ofrecer turnos esos días.')) return;
  try {
    const res = await apiFetch(`/agenda/${encodeURIComponent(agendaState.medicoId)}/bloqueos/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('No se pudo quitar');
    agendaState.bloqueos = agendaState.bloqueos.filter(b => String(b.id) !== String(id));
    pintarBloqueos();
  } catch (err) { alert(err.message); }
}

// ---------- Notificaciones ----------
const notifState = { items: [], noLeidas: null, filtro: 'todas', abierto: false, timer: null, tituloBase: document.title };
const NOTIF_ICONO = { turno_pedido: 'calendar-plus', turno_cancelado: 'calendar-x', turno_nuevo: 'calendar-check', turno_reprogramado: 'calendar-clock' };

function iniciarNotificaciones() {
  const u = state.user || {};
  const puede = tienePermiso('calendario') && !!u.id;
  document.getElementById('btnNotif').classList.toggle('hidden', !puede);
  if (!puede || notifState.timer) return;
  revisarNotificaciones(true);
  notifState.timer = setInterval(() => { if (!document.hidden) revisarNotificaciones(false); }, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.isAuthenticated) revisarNotificaciones(false); });
}

async function revisarNotificaciones(primeraVez) {
  try {
    const res = await apiFetch('/notificaciones?resumen=1');
    if (!res.ok) return;
    const d = await res.json();
    const antes = notifState.noLeidas;
    pintarBadgeNotif(d.no_leidas);
    if (!primeraVez && antes !== null && d.no_leidas > antes && d.ultima) {
      showToast(`🔔 ${d.ultima.titulo}: ${d.ultima.detalle || ''}`);
      const btn = document.getElementById('btnNotif');
      btn.classList.remove('sonando'); void btn.offsetWidth; btn.classList.add('sonando');
      if (tienePermiso('calendario')) cargarTodosLosTurnosParaCalendario();   // el turno nuevo ya aparece en el calendario
      if (notifState.abierto) cargarNotificaciones();
    }
  } catch (e) { /* sin conexión: se reintenta en el próximo ciclo */ }
}

function pintarBadgeNotif(n) {
  notifState.noLeidas = n;
  const badge = document.getElementById('notifBadge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.classList.toggle('hidden', !n);
  document.getElementById('btnNotif').setAttribute('aria-label', n ? `Notificaciones: ${n} sin leer` : 'Notificaciones');
  document.title = n ? `(${n}) ${notifState.tituloBase}` : notifState.tituloBase;
}

function toggleNotificaciones() {
  if (notifState.abierto) cerrarNotificaciones(); else abrirNotificaciones();
}

function abrirNotificaciones() {
  notifState.abierto = true;
  document.getElementById('notifOverlay').classList.remove('hidden');
  const panel = document.getElementById('notifPanel');
  panel.classList.add('abierto');
  panel.setAttribute('aria-hidden', 'false');
  cargarNotificaciones();
}

function cerrarNotificaciones() {
  notifState.abierto = false;
  document.getElementById('notifOverlay').classList.add('hidden');
  const panel = document.getElementById('notifPanel');
  panel.classList.remove('abierto');
  panel.setAttribute('aria-hidden', 'true');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && notifState.abierto) cerrarNotificaciones(); });

async function cargarNotificaciones() {
  const lista = document.getElementById('notifLista');
  if (!notifState.items.length) lista.innerHTML = '<p class="notif-vacio">Cargando…</p>';
  try {
    const res = await apiFetch('/notificaciones');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'No se pudieron cargar');
    notifState.items = d.items || [];
    pintarBadgeNotif(d.no_leidas || 0);
    pintarNotificaciones();
  } catch (err) {
    lista.innerHTML = `<p class="notif-vacio is-error">${escInt(err.message)}</p>`;
  }
}

function filtrarNotificaciones(f) {
  notifState.filtro = f;
  document.querySelectorAll('[data-notif-filtro]').forEach(b => b.classList.toggle('active', b.dataset.notifFiltro === f));
  pintarNotificaciones();
}

function haceCuanto(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(min >= 0)) return '';
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

function pintarNotificaciones() {
  const lista = document.getElementById('notifLista');
  let items = notifState.items;
  if (notifState.filtro === 'sin_leer') items = items.filter(n => !n.leida);
  if (notifState.filtro === 'pedidos') items = items.filter(n => n.turno && estadoTurnoClave(n.turno.estado) === 'pendiente');
  // "Pedidos por confirmar": uno por turno
  if (notifState.filtro === 'pedidos') { const vistos = new Set(); items = items.filter(n => !vistos.has(String(n.turno.id)) && vistos.add(String(n.turno.id))); }
  document.getElementById('btnLeerTodas').disabled = !notifState.items.some(n => !n.leida);
  if (!items.length) {
    const txt = { todas: 'No tenés notificaciones todavía.', sin_leer: 'Estás al día: no hay notificaciones sin leer.', pedidos: 'No hay pedidos de turno esperando confirmación.' }[notifState.filtro];
    lista.innerHTML = `<div class="notif-vacio"><i data-lucide="inbox"></i><p>${txt}</p></div>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }
  lista.innerHTML = items.map(n => {
    const t = n.turno;
    const est = t ? estadoTurnoClave(t.estado) : null;
    const activo = t && est !== 'cancelado' && est !== 'realizado';
    const pac = t && t.paciente;
    const acciones = !t ? '<p class="notif-sin-turno">El turno ya no está disponible.</p>' : `
      <div class="notif-turno">
        <span class="turno-estado-mini estado-${est}">${{ pendiente: 'Pendiente', confirmado: 'Confirmado', cancelado: 'Cancelado', realizado: 'Realizado' }[est]}</span>
        <span>${escInt(fmtDiaCorto(getFechaKeyDeTurno(t)))} · ${escInt(getHoraStrDeTurno(t))} hs</span>
        ${pac && pac.telefono ? `<span class="notif-tel"><i data-lucide="phone"></i> ${escInt(pac.telefono)}</span>` : ''}
      </div>
      ${t.origen === 'app' && t.notas && /Comentario/.test(t.notas) ? `<p class="notif-comentario">${escInt(t.notas.replace(/^.*Comentario del paciente:\s*/, '“').replace(/·.*$/, '').trim())}”</p>` : ''}
      <div class="notif-acciones">
        ${activo && est === 'pendiente' ? `<button type="button" class="turno-accion turno-accion-primaria" onclick="accionNotif(event, '${escInt(n.id)}', 'confirmar')"><i data-lucide="check"></i> Confirmar</button>` : ''}
        ${activo ? `<button type="button" class="turno-accion" onclick="accionNotif(event, '${escInt(n.id)}', 'reprogramar')"><i data-lucide="calendar-clock"></i> Reprogramar</button>` : ''}
        ${activo ? `<button type="button" class="turno-accion turno-accion-peligro" onclick="accionNotif(event, '${escInt(n.id)}', 'cancelar')"><i data-lucide="x"></i> Cancelar</button>` : ''}
        <button type="button" class="turno-accion" onclick="accionNotif(event, '${escInt(n.id)}', 'ver')"><i data-lucide="calendar"></i> Ver el día</button>
      </div>`;
    return `
      <article class="notif-item${n.leida ? '' : ' no-leida'} tipo-${escInt(n.tipo)}" onclick="marcarNotifLeida('${escInt(n.id)}')">
        <div class="notif-icono"><i data-lucide="${NOTIF_ICONO[n.tipo] || 'bell'}"></i></div>
        <div class="notif-cuerpo">
          <div class="notif-top"><strong>${escInt(n.titulo)}</strong><time title="${escInt(new Date(n.creado_en).toLocaleString('es-AR'))}">${escInt(haceCuanto(n.creado_en))}</time></div>
          <p class="notif-detalle">${escInt(n.detalle || '')}</p>
          ${acciones}
        </div>
      </article>`;
  }).join('');
  if (window.lucide) window.lucide.createIcons();
}

async function marcarNotifLeida(id) {
  const n = notifState.items.find(x => String(x.id) === String(id));
  if (!n || n.leida) return;
  n.leida = true;
  pintarBadgeNotif(Math.max(0, (notifState.noLeidas || 1) - 1));
  pintarNotificaciones();
  try { await apiFetch(`/notificaciones/${encodeURIComponent(id)}/leida`, { method: 'POST' }); } catch (e) {}
}

async function leerTodasNotificaciones() {
  notifState.items.forEach(n => { n.leida = true; });
  pintarBadgeNotif(0);
  pintarNotificaciones();
  try { await apiFetch('/notificaciones/leer-todas', { method: 'POST' }); } catch (e) {}
}

async function accionNotif(ev, id, accion) {
  if (ev) ev.stopPropagation();
  const n = notifState.items.find(x => String(x.id) === String(id));
  if (!n || !n.turno) return;
  marcarNotifLeida(id);
  const t = n.turno;
  if (accion === 'ver') {
    cerrarNotificaciones();
    const nav = document.getElementById('navCalendarioBtn');
    if (nav && !nav.classList.contains('active')) nav.click();
    await cargarTodosLosTurnosParaCalendario();
    abrirDetalleDia(getFechaKeyDeTurno(t));
    return;
  }
  if (accion === 'reprogramar') {
    cerrarNotificaciones();
    // Con los datos que trae la notificación (mismo formato que el calendario)
    if (!(state.turnosList || []).some(x => String(x.id) === String(t.id))) t.pacientes = t.paciente;
    return abrirReprogramar(t.id);
  }
  if (accion === 'cancelar' && !confirm(`¿Cancelar el turno de ${t.paciente ? fmtNombrePersona(`${t.paciente.nombre} ${t.paciente.apellido}`) : 'este paciente'}?${t.paciente && t.paciente.email ? '\nSe le avisa por email.' : ''}`)) return;
  const estado = accion === 'confirmar' ? 'confirmado' : 'cancelado';
  try {
    const res = await apiFetch(`/turnos/${t.id}/estado`, { method: 'PUT', body: JSON.stringify({ estado }) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'No se pudo actualizar');
    showToast(estado === 'confirmado' ? `Turno confirmado${t.paciente && t.paciente.email ? ' · se le avisó por email' : ''}` : 'Turno cancelado');
    await cargarNotificaciones();
    cargarTodosLosTurnosParaCalendario();
  } catch (err) { alert(err.message); }
}
