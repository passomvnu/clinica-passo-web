/**
 * LÓGICA DEL PANEL DE GESTIÓN — CLÍNICA PASSO S.A.
 * Conectado a la API de Render & Supabase
 * Sistema de Seguridad & Control de Acceso Presencial
 */

// URL de la API en producción (Render)
const API_BASE = 'https://clinica-passo-backend.onrender.com/api';

// ========================================================
// CLAVES MAESTRAS DE SEGURIDAD PRESENCIAL
// ========================================================
const CREDENCIALES_SEGURIDAD = {
  recepcion: 'Passo2026#Recep',
  medico:    'Passo2026#Medico'
};

// Estado global de la aplicación
let state = {
  currentTab: 'calendario-tab',
  viewingAllTurnos: false,
  userRole: 'recepcion', // 'recepcion' o 'medico'
  isAuthenticated: false,
  intentosFallidos: 0,
  bloqueadoHasta: null,
  turnosList: [],
  pacientesList: [],
  selectedPacienteHistoria: null,
  historiasList: []
};

// Helper universal para peticiones fetch 100% compatible con CORS estándar
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'x-user-role': state.userRole || 'recepcion'
  };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
  }

  const config = {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  };

  return fetch(url, config);
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
function verificarSesionExistente() {
  const sesionGuardada = sessionStorage.getItem('passo_auth_session');
  if (sesionGuardada) {
    try {
      const data = JSON.parse(sesionGuardada);
      if (data.exp > Date.now()) {
        iniciarSesionExitosa(data.rol, false);
        return;
      }
    } catch (e) {
      sessionStorage.removeItem('passo_auth_session');
    }
  }

  // Si no hay sesión válida, mostrar pantalla de bloqueo
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminLayout').classList.add('hidden');
}

function cambiarPlaceholderPassword() {
  const rol = document.getElementById('loginRol').value;
  const input = document.getElementById('loginPassword');
  input.placeholder = rol === 'medico' ? 'Password de médico...' : 'Password de recepción...';
}

function toggleVisibilidadClave() {
  const input = document.getElementById('loginPassword');
  const eyeIcon = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    eyeIcon.setAttribute('data-lucide', 'eye-off');
  } else {
    input.type = 'password';
    eyeIcon.setAttribute('data-lucide', 'eye');
  }
  if (window.lucide) window.lucide.createIcons();
}

function ejecutarAutenticacion(e) {
  e.preventDefault();
  const errorBox = document.getElementById('loginErrorMsg');
  const errorText = document.getElementById('loginErrorText');
  const lockoutBox = document.getElementById('lockoutTimerMsg');

  // Verificar si está bloqueado por intentos
  if (state.bloqueadoHasta && Date.now() < state.bloqueadoHasta) {
    const minutosRestantes = Math.ceil((state.bloqueadoHasta - Date.now()) / 60000);
    lockoutBox.classList.remove('hidden');
    document.getElementById('lockoutTimerText').textContent = `Terminal bloqueada. Reintentar en ${minutosRestantes} minuto(s).`;
    return;
  }

  const rolSeleccionado = document.getElementById('loginRol').value;
  const passwordIngresada = document.getElementById('loginPassword').value.trim();
  const claveEsperada = CREDENCIALES_SEGURIDAD[rolSeleccionado];

  if (passwordIngresada === claveEsperada) {
    // Éxito: Resetear intentos y entrar
    state.intentosFallidos = 0;
    state.bloqueadoHasta = null;
    errorBox.classList.add('hidden');
    lockoutBox.classList.add('hidden');

    // Guardar sesión por 8 horas
    const sessionPayload = {
      rol: rolSeleccionado,
      exp: Date.now() + (8 * 60 * 60 * 1000)
    };
    sessionStorage.setItem('passo_auth_session', JSON.stringify(sessionPayload));

    iniciarSesionExitosa(rolSeleccionado, true);
  } else {
    // Fallo: Incrementar contador
    state.intentosFallidos += 1;
    errorBox.classList.remove('hidden');
    errorText.textContent = `Clave incorrecta (${state.intentosFallidos}/5 intentos). Acceso denegado.`;

    if (state.intentosFallidos >= 5) {
      state.bloqueadoHasta = Date.now() + (5 * 60 * 1000); // 5 minutos de bloqueo
      lockoutBox.classList.remove('hidden');
      document.getElementById('lockoutTimerText').textContent = 'Demasiados intentos fallidos. Terminal bloqueada por 5 minutos.';
    }

    if (window.lucide) window.lucide.createIcons();
  }
}

function iniciarSesionExitosa(rol, mostrarToast = true) {
  state.isAuthenticated = true;
  state.userRole = rol;

  // Actualizar UI según el rol
  const sidebarRoleLabel = document.getElementById('sidebarRoleLabel');
  const userProfileRole = document.getElementById('userProfileRole');
  const navHistoriasBtn = document.getElementById('navHistoriasBtn');
  const boxFilterMedico = document.getElementById('boxFilterMedico');

  if (rol === 'medico') {
    sidebarRoleLabel.textContent = 'Panel Médico Integral';
    userProfileRole.textContent = 'Cuerpo Médico';
    if (navHistoriasBtn) navHistoriasBtn.classList.remove('hidden');
    if (boxFilterMedico) boxFilterMedico.style.display = 'inline-flex';
  } else {
    sidebarRoleLabel.textContent = 'Panel de Recepción';
    userProfileRole.textContent = 'Recepción Central';
    if (navHistoriasBtn) navHistoriasBtn.classList.add('hidden'); // Ocultar historias a recepción
    if (boxFilterMedico) boxFilterMedico.style.display = 'none';
  }

  // Ocultar login y mostrar panel
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminLayout').classList.remove('hidden');

  // Inicializar componentes del panel
  verificarConexionApi();
  configurarTabs();
  cargarTodosLosTurnosParaCalendario();
  cargarPacientes();

  if (mostrarToast) {
    showToast(`Terminal desbloqueada: Modo ${rol === 'medico' ? 'Médico' : 'Recepción'}`);
  }

  if (window.lucide) window.lucide.createIcons();
}

function cerrarSesion() {
  if (!confirm('¿Deseas bloquear la terminal y cerrar la sesión actual?')) return;

  sessionStorage.removeItem('passo_auth_session');
  state.isAuthenticated = false;
  state.userRole = 'recepcion';

  document.getElementById('formLogin').reset();
  document.getElementById('adminLayout').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');

  showToast('Terminal bloqueada correctamente');
  if (window.lucide) window.lucide.createIcons();
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
function configurarTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panes = document.querySelectorAll('.tab-pane');
  const pageTitle = document.getElementById('pageTitle');
  const mainActionBtn = document.getElementById('mainActionBtn');
  const btnCargarEvolucion = document.getElementById('btnCargarEvolucion');
  const btnCargarHC = document.getElementById('btnCargarHC');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      item.classList.add('active');
      const targetTabId = item.getAttribute('data-tab');
      const targetPane = document.getElementById(targetTabId);
      if (targetPane) targetPane.classList.add('active');
      state.currentTab = targetTabId;

      if (btnCargarEvolucion) btnCargarEvolucion.style.display = 'none';
      if (btnCargarHC) btnCargarHC.style.display = 'none';
      if (mainActionBtn) mainActionBtn.style.display = 'none';

      if (targetTabId === 'calendario-tab') {
        pageTitle.textContent = 'Calendario';
        cargarTodosLosTurnosParaCalendario();
      } else if (targetTabId === 'pacientes-tab') {
        pageTitle.textContent = 'Padrón de Pacientes & Búsqueda DNI/Email';
        if (mainActionBtn) {
          mainActionBtn.style.display = 'inline-flex';
          mainActionBtn.innerHTML = '<i data-lucide="user-plus"></i> Registrar Paciente';
          mainActionBtn.onclick = openModalNuevoPaciente;
        }
      } else if (targetTabId === 'historias-tab') {
        pageTitle.textContent = 'Historias Clínicas & Evoluciones Médicas';
        if (btnCargarEvolucion) btnCargarEvolucion.style.display = 'inline-flex';
        if (btnCargarHC) btnCargarHC.style.display = 'inline-flex';
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
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--red); padding: 2rem;">Error al conectar con la base de datos: ${err.message}</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="color: var(--red);">Error: ${err.message}</td></tr>`;
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
  if (!turnos || turnos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding: 3rem; color: var(--text-muted);"><i data-lucide="calendar-x"></i><br>No hay turnos registrados para mostrar.</td></tr>`;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  tbody.innerHTML = turnos.map(t => {
    const p = t.pacientes || {};
    const nombreCompleto = p.nombre ? `${p.apellido || ''}, ${p.nombre || ''}` : 'Paciente no asignado';
    const dni = p.dni || '-';
    const email = p.email ? `<small style="display:block; color: var(--text-muted); font-size:0.75rem;">${p.email}</small>` : '';
    
    const fechaObj = new Date(t.fecha_turno);
    const horaStr = fechaObj.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const fechaCorta = fechaObj.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    const timeDisplay = state.viewingAllTurnos ? `${fechaCorta} · ${horaStr} hs` : `${horaStr} hs`;

    return `
      <tr>
        <td><strong>${timeDisplay}</strong></td>
        <td><strong>${nombreCompleto}</strong>${email}</td>
        <td><strong>${dni}</strong></td>
        <td><span class="timeline-pill">${t.especialidad || '-'}</span></td>
        <td>${t.medico || 'A designar'}</td>
        <td>
          <select class="status-select badge-${t.estado}" onchange="cambiarEstadoTurno('${t.id}', this.value)">
            <option value="pendiente" ${t.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="confirmado" ${t.estado === 'aceptado' || t.estado === 'confirmado' ? 'selected' : ''}>Confirmado</option>
            <option value="cancelado" ${t.estado === 'rechazado' || t.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            <option value="realizado" ${t.estado === 'realizado' ? 'selected' : ''}>Realizado</option>
          </select>
        </td>
        <td>
          ${(t.pacientes?.email) ? `
            <button class="btn btn-outline btn-sm" onclick="enviarMailTurnoDirecto('${t.id}', this)" title="Avisar por Email" style="color: var(--primary);">
              <i data-lucide="mail"></i>
            </button>
          ` : ''}
          ${state.userRole === 'medico' ? `
            <button class="btn btn-outline btn-sm" onclick="irAHistoriaPacientePorId('${t.paciente_id}')" title="Ver Historia Clínica">
              <i data-lucide="clipboard"></i>
            </button>
          ` : ''}
          <button class="btn btn-outline btn-sm" style="color: var(--red);" onclick="eliminarTurno('${t.id}')" title="Eliminar Turno">
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

  const originalHtml = btnElement ? btnElement.innerHTML : 'Avisar por Email';
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = 'Enviando...';
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
      btnElement.innerHTML = 'Email Enviado';
      btnElement.classList.add('enviado');
      setTimeout(() => {
        btnElement.disabled = false;
        btnElement.innerHTML = 'Reenviar Email';
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

async function eliminarTurno(turnoId) {
  if (!confirm('¿Estás seguro de eliminar este turno?')) return;
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
    html += `<option value="${m.toLowerCase()}">Dr/a. ${m}</option>`;
  });

  select.innerHTML = html;
  if (currentVal && (currentVal === 'todos' || medicos.some(m => m.toLowerCase() === currentVal.toLowerCase()))) {
    select.value = currentVal;
  }
}

function handleTurnosSearch() {
  const query = document.getElementById('turnosSearch').value.toLowerCase().trim();
  const filterState = document.getElementById('turnosFilterState').value;
  const filterMedicoEl = document.getElementById('turnosFilterMedico');
  const filterMedico = filterMedicoEl ? filterMedicoEl.value : 'todos';
  filtrarYRenderizarTurnos(query, filterState, filterMedico);
}

function handleTurnosFilterChange() {
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
        pacientes.map(p => `<option value="${p.id}">${p.apellido}, ${p.nombre} (DNI: ${p.dni})</option>`).join('');
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="text-center" style="color: var(--red);">Error: ${err.message}</td></tr>`;
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
    <tr>
      <td>
        <strong>${p.apellido || ''}, ${p.nombre || ''}</strong>
        ${p.email ? `<br><small style="color: var(--primary-royal);">${p.email}</small>` : '<br><small style="color: var(--text-muted);">Sin email</small>'}
      </td>
      <td><strong>${p.dni || '-'}</strong></td>
      <td>${p.telefono || '-'}</td>
      <td>${p.obra_social || 'Particular'}</td>
      <td>${p.nro_afiliado || '-'}</td>
      <td>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <button class="btn btn-outline btn-sm" onclick="openModalEditarPaciente('${p.id}')" title="Modificar Datos">
            <i data-lucide="edit-3"></i> Editar
          </button>
          ${state.userRole === 'medico' ? `
            <button class="btn btn-primary btn-sm" onclick="irAHistoriaPacientePorId('${p.id}')" title="Ver Historia Clínica">
              <i data-lucide="clipboard-list"></i> Historia
            </button>
          ` : ''}
          <button class="btn btn-outline btn-sm" onclick="openModalTurnoConPaciente('${p.id}')" title="Asignar Turno">
            <i data-lucide="calendar-plus"></i> Turno
          </button>
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

  try {
    const res = await apiFetch(`/pacientes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, apellido, dni, fecha_nac, telefono, email, obra_social, nro_afiliado })
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
async function searchPacienteParaHistoria() {
  if (state.userRole !== 'medico') {
    alert('Acceso denegado. Solo el cuerpo médico puede consultar historias clínicas.');
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

  try {
    const res = await apiFetch(`/pacientes/buscar?dni=${dni}`);
    if (res.ok) {
      const paciente = await res.json();
      state.selectedPacienteHistoria = paciente;

      document.getElementById('historiaNombrePaciente').textContent = `${paciente.apellido}, ${paciente.nombre}`;
      document.getElementById('historiaDniPaciente').textContent = `DNI: ${paciente.dni}`;
      document.getElementById('historiaObraSocial').textContent = `Obra Social: ${paciente.obra_social || 'Particular'}`;
      document.getElementById('historiaAfiliado').textContent = paciente.nro_afiliado ? `N° Afiliado: ${paciente.nro_afiliado}` : '';
      card.classList.remove('hidden');

      cargarHistoriasDePaciente(paciente.id);
    } else {
      card.classList.add('hidden');
      timeline.innerHTML = `<div class="empty-state-box"><i data-lucide="user-x"></i><h4>No se encontró ningún paciente con DNI: ${dni}</h4><p>Verificá que el número de documento sea correcto.</p></div>`;
      if (window.lucide) window.lucide.createIcons();
    }
  } catch (err) {
    console.error(err);
  }
}

async function cargarHistoriasDePaciente(pacienteId) {
  const timeline = document.getElementById('historiasTimeline');
  const countEl = document.getElementById('historiaTotalCount');
  timeline.innerHTML = `<div class="text-center p-4"><i data-lucide="loader-2" class="spin"></i> Cargando historial médico confidencial...</div>`;
  if (window.lucide) window.lucide.createIcons();

  try {
    const res = await apiFetch(`/historias-clinicas/paciente/${pacienteId}`);
    if (!res.ok) {
      if (res.status === 403) {
        timeline.innerHTML = `<div class="empty-state-box" style="color: var(--red);"><i data-lucide="shield-alert"></i><h4>Acceso Restringido</h4><p>El perfil actual no tiene permisos para consultar historias clínicas confidenciales.</p></div>`;
        if (window.lucide) window.lucide.createIcons();
        return;
      }
      throw new Error('Error al cargar historias clínicas');
    }
    const historias = await res.json();
    state.historiasList = historias;
    countEl.textContent = `${historias.length} registro(s)`;

    if (historias.length === 0) {
      timeline.innerHTML = `
        <div class="empty-state-box">
          <i data-lucide="file-question"></i>
          <h4>Este paciente aún no tiene evoluciones médicas cargadas</h4>
          <p>Hacé clic en "Cargar Nueva Evolución Médica" para ingresar la primera consulta.</p>
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
      h._signedImagenes = await Promise.all(rawImgs.map(url => obtenerUrlFirmada(url)));
    }

    timeline.innerHTML = historias.map(h => {
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

      const esConsultorio = meta && meta.tipo_planilla === 'evolucion_consultorio';
      const badgeTipo = esConsultorio
        ? `<span class="badge-consultorio"><i data-lucide="clipboard-pen"></i> Planilla de Consultorio</span>`
        : `<span class="badge-hc-completa"><i data-lucide="file-text"></i> H.C. Frente y Dorso</span>`;

      const renderImagenes = signedArray.length > 0 ? `
        <div style="margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--border);">
          <strong style="font-size: 0.85rem; color: var(--text-dark); display: block; margin-bottom: 6px;">
            <i data-lucide="shield-check" style="width: 14px; height: 14px; color: #16A34A; vertical-align: middle;"></i> Estudios Adjuntos Protegidos (Token Firmado):
          </strong>
          <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
            ${signedArray.map((fileUrl, idx) => {
              const isPdf = fileUrl.toLowerCase().includes('.pdf');
              const isExternalPortal = fileUrl.startsWith('http') && !fileUrl.includes('ktyzjbntowcudhmiocdp.supabase.co') && !/\.(jpg|jpeg|png|webp|gif)$/i.test(fileUrl.split('?')[0]);

              if (isPdf) {
                return `
                  <a href="${fileUrl}" target="_blank" rel="noopener" class="pdf-attached-link">
                    <i data-lucide="file-text"></i> Ver Documento PDF #${idx + 1}
                  </a>
                `;
              }
              if (isExternalPortal) {
                return `
                  <a href="${fileUrl}" target="_blank" rel="noopener" class="portal-attached-link">
                    <i data-lucide="external-link"></i> Abrir Portal RDA / Estudio #${idx + 1}
                  </a>
                `;
              }
              return `
                <a href="${fileUrl}" target="_blank" rel="noopener" title="Ver imagen en tamaño completo">
                  <img src="${fileUrl}" alt="Estudio Médico Protegido" style="width: 75px; height: 75px; object-fit: cover; border-radius: 6px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);" onerror="this.src='assets/logo.jpg'">
                </a>
              `;
            }).join('')}
          </div>
        </div>
      ` : '';

      if (esConsultorio) {
        return `
          <div class="timeline-card">
            <div class="timeline-card-header">
              <span class="timeline-date"><i data-lucide="calendar"></i> ${fechaFormat}</span>
              <div style="display: flex; gap: 8px; align-items: center;">
                <span class="timeline-doctor"><strong>Médico:</strong> ${h.medico} ${h.matricula ? `(${h.matricula})` : ''}</span>
                <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${h.id}')" title="Ver Planilla de Consultorio en Pantalla" style="display: inline-flex; align-items: center; gap: 5px;">
                  <i data-lucide="eye"></i> Ver Planilla
                </button>
                <button class="btn btn-outline btn-sm btn-print" onclick="imprimirHistoriaClinica('${h.id}')" title="Imprimir Planilla de Evolución Médica (1 Hoja)">
                  <i data-lucide="printer"></i> Imprimir Planilla
                </button>
              </div>
            </div>
            <div class="timeline-body">
              <div style="margin-bottom: 8px;">
                ${badgeTipo}
              </div>
              <h4>— Evolución Médica:</h4>
              <p style="white-space: pre-wrap; font-size: 0.92rem; line-height: 1.5;">${meta.evolucion || h.motivo_consulta || '-'}</p>

              <h4>— Indicaciones & Tratamiento:</h4>
              <p style="white-space: pre-wrap; color: var(--primary-dark); font-weight: 600; font-size: 0.92rem; line-height: 1.5;">${meta.indicaciones || h.tratamiento || '-'}</p>
              ${renderImagenes}
            </div>
          </div>
        `;
      }

      return `
        <div class="timeline-card">
          <div class="timeline-card-header">
            <span class="timeline-date"><i data-lucide="calendar"></i> ${fechaFormat}</span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <span class="timeline-doctor"><strong>Médico:</strong> ${h.medico} ${h.matricula ? `(${h.matricula})` : ''}</span>
              <button class="btn btn-secondary btn-sm" onclick="verHistoriaCompletaVirtual('${h.id}')" title="Ver Historia Clínica Completa en Pantalla" style="display: inline-flex; align-items: center; gap: 5px;">
                <i data-lucide="eye"></i> Ver
              </button>
              <button class="btn btn-outline btn-sm btn-print" onclick="imprimirHistoriaClinica('${h.id}')" title="Imprimir Historia Clínica Oficial (2 Páginas Frente y Dorso)">
                <i data-lucide="printer"></i> Imprimir Oficial
              </button>
            </div>
          </div>
          <div class="timeline-body">
            <div style="margin-bottom: 8px;">
              ${badgeTipo}
            </div>
            <h4>Motivo de Consulta / Internación:</h4>
            <p>${h.motivo_consulta || '-'}</p>

            ${(meta && meta.diagnostico_ingreso) ? `<h4>Diagnóstico de Ingreso:</h4><p><strong>${meta.diagnostico_ingreso}</strong></p>` : (h.diagnostico ? `<h4>Diagnóstico:</h4><p><strong>${h.diagnostico}</strong></p>` : '')}
            ${(meta && meta.diagnostico_egreso) ? `<h4>Diagnóstico de Egreso:</h4><p><strong>${meta.diagnostico_egreso}</strong></p>` : ''}
            ${(meta && meta.motivo_egreso && meta.motivo_egreso !== 'ninguno') ? `<h4>Estado / Motivo de Egreso:</h4><p><span class="badge" style="background:#E0E7FF; color:#3730A3; font-weight:700; text-transform:uppercase;">${meta.motivo_egreso}</span></p>` : ''}
            
            ${h.tratamiento ? `<h4>Tratamiento / Indicaciones:</h4><p>${h.tratamiento}</p>` : ''}
            ${h.medicacion ? `<h4>Medicación:</h4><p style="color: var(--primary-dark); font-weight: 600;">${h.medicacion}</p>` : ''}
            ${(!meta && h.observaciones) ? `<h4>Observaciones:</h4><p style="color: var(--text-muted); font-size: 0.85rem;">${h.observaciones}</p>` : ''}
            ${renderImagenes}
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  } catch (err) {
    timeline.innerHTML = `<div class="text-center text-red p-4">Error: ${err.message}</div>`;
  }
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
function imprimirHistoriaClinica(historiaId) {
  try {
    // 1. Obtener datos directamente desde el estado local
    let h = (state.historiasList || []).find(item => String(item.id) === String(historiaId)) || {};

    // Normalizar datos de paciente
    const p = state.selectedPacienteHistoria || (h && h.pacientes) || {};
    
    // Calcular edad si está disponible la fecha de nacimiento
    let edadCalculada = p.edad || '';
    if (!edadCalculada && p.fecha_nacimiento) {
      const birth = new Date(p.fecha_nacimiento);
      if (!isNaN(birth.getTime())) {
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        edadCalculada = `${age} años`;
      }
    }

    const pac = {
      nombre_completo: `${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente Registrado',
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

    // SI ES PLANILLA DE CONSULTORIO (1 HOJA SEGÚN FORMATO MANUSCRITO)
    if (meta && meta.tipo_planilla === 'evolucion_consultorio') {
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
                <span class="hc-num-val">${pac.dni}</span>
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
                  <span class="hc-val">${pac.nombre_completo}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">Médico Tratante:</span>
                  <span class="hc-val">${h.medico || 'Médico Tratante'} ${h.matricula ? `(${h.matricula})` : ''}</span>
                </div>
              </div>

              <div class="hc-row">
                <div class="hc-col hc-col-left">
                  <span class="hc-lbl">DNI:</span>
                  <span class="hc-val">${pac.dni}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">Obra Social:</span>
                  <span class="hc-val">${pac.obra_social}</span>
                </div>
              </div>

              <div class="hc-row">
                <div class="hc-col hc-col-left">
                  <span class="hc-lbl">Especialidad:</span>
                  <span class="hc-val">${h.especialidad || 'Consultorio Externo'}</span>
                </div>
                <div class="hc-col hc-col-right">
                  <span class="hc-lbl">N° Beneficio / Afiliado:</span>
                  <span class="hc-val">${pac.nro_afiliado}</span>
                </div>
              </div>
            </div>

            <!-- SECCIÓN 1: EVOLUCIÓN -->
            <div class="hc-section-item" style="margin-bottom: 18px;">
              <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                — Evolución:
              </div>
              <div class="hc-sec-content" style="min-height: 260px;">
                <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${evolucionTexto}</div>
                ${generarLineasPunteadas(8)}
              </div>
            </div>

            <!-- SECCIÓN 2: INDICACIONES -->
            <div class="hc-section-item" style="margin-bottom: 18px;">
              <div class="hc-sec-title" style="font-size: 13px; font-weight: 800; border-bottom: 1.5px solid #001FD1; padding-bottom: 3px; margin-bottom: 6px;">
                — Indicaciones:
              </div>
              <div class="hc-sec-content" style="min-height: 200px;">
                <div class="hc-text-filled" style="white-space: pre-wrap; font-size: 12.5px; line-height: 1.5;">${indicacionesTexto}</div>
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
                  <strong>${h.medico || 'Médico Tratante'}</strong> ${h.matricula ? `(${h.matricula})` : ''}<br>
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

      const originalTitle = document.title;
      document.title = `${pac.nombre_completo} — Evolución Médica Consultorio`;
      window.print();
      setTimeout(() => { document.title = originalTitle; }, 800);
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
              <span class="hc-num-val">${pac.dni}</span>
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
                <span class="hc-val">${pac.nombre_completo}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Sexo:</span>
                <span class="hc-val">${pac.sexo}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Edad:</span>
                <span class="hc-val">${pac.edad}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">N° Afiliado:</span>
                <span class="hc-val">${pac.nro_afiliado}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Obra Social:</span>
                <span class="hc-val">${pac.obra_social}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Hora:</span>
                <span class="hc-val">${consulta.hora_ingreso}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left">
                <span class="hc-lbl">Fecha de Ingreso:</span>
                <span class="hc-val">${consulta.fecha_ingreso}</span>
              </div>
              <div class="hc-col hc-col-right">
                <span class="hc-lbl">Hora:</span>
                <span class="hc-val">${consulta.hora_egreso}</span>
              </div>
            </div>

            <div class="hc-row">
              <div class="hc-col hc-col-left" style="flex: 1;">
                <span class="hc-lbl">Fecha de Egreso:</span>
                <span class="hc-val">${consulta.fecha_egreso}</span>
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
                ${consulta.diagnostico_ingreso ? `<div class="hc-text-filled">${consulta.diagnostico_ingreso}</div>` : ''}
                ${generarLineasPunteadas(consulta.diagnostico_ingreso ? 2 : 3)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Diagnóstico de Egreso:</div>
              <div class="hc-sec-content">
                ${consulta.diagnostico_egreso ? `<div class="hc-text-filled">${consulta.diagnostico_egreso}</div>` : ''}
                ${generarLineasPunteadas(consulta.diagnostico_egreso ? 2 : 3)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Motivo de Internación:</div>
              <div class="hc-sec-content">
                ${consulta.motivo_consulta ? `<div class="hc-text-filled">${consulta.motivo_consulta}</div>` : ''}
                ${generarLineasPunteadas(consulta.motivo_consulta ? 2 : 4)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Enfermedad Actual:</div>
              <div class="hc-sec-content">
                ${consulta.enfermedad_actual ? `<div class="hc-text-filled">${consulta.enfermedad_actual}</div>` : ''}
                ${generarLineasPunteadas(consulta.enfermedad_actual ? 2 : 4)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Medicación que recibe y dosis:</div>
              <div class="hc-sec-content">
                ${consulta.medicacion ? `<div class="hc-text-filled">${consulta.medicacion}</div>` : ''}
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
              <div class="hc-vital-cell"><strong>Peso:</strong> <span class="hc-dots">${vitals.peso || '..............'}</span></div>
              <div class="hc-vital-cell"><strong>Talla:</strong> <span class="hc-dots">${vitals.talla || '..............'}</span></div>
              <div class="hc-vital-cell"><strong>Saturación:</strong> <span class="hc-dots">${vitals.saturacion || '..............'}</span></div>
            </div>
            <div class="hc-vital-row">
              <div class="hc-vital-main"><strong>Signos Vitales:</strong></div>
              <div class="hc-vital-cell"><strong>Pulso:</strong> <span class="hc-dots">${vitals.pulso || '..............'}</span></div>
              <div class="hc-vital-cell"><strong>T.A.:</strong> <span class="hc-dots">${vitals.ta || '..............'}</span></div>
              <div class="hc-vital-cell"><strong>F.R.:</strong> <span class="hc-dots">${vitals.fr || '..............'}</span></div>
            </div>
            <div class="hc-vital-row">
              <div class="hc-vital-cell" style="flex: 1.1;"><strong>Temperatura axilar:</strong> <span class="hc-dots">${vitals.temp_axilar || '..............'}</span></div>
              <div class="hc-vital-cell" style="flex: 1.8;"><strong>Temperatura Rectal:</strong> <span class="hc-dots">${vitals.temp_rectal || '............................'}</span></div>
            </div>
          </div>

          <!-- Secciones del Dorso -->
          <div class="hc-section-group">
            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Cardiovascular:</div>
              <div class="hc-sec-content">
                ${sist.cardiovascular ? `<div class="hc-text-filled">${sist.cardiovascular}</div>` : ''}
                ${generarLineasPunteadas(sist.cardiovascular ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Aparato Respiratorio:</div>
              <div class="hc-sec-content">
                ${sist.respiratorio ? `<div class="hc-text-filled">${sist.respiratorio}</div>` : ''}
                ${generarLineasPunteadas(sist.respiratorio ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Abdomen:</div>
              <div class="hc-sec-content">
                ${sist.abdomen ? `<div class="hc-text-filled">${sist.abdomen}</div>` : ''}
                ${generarLineasPunteadas(sist.abdomen ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Urogenital:</div>
              <div class="hc-sec-content">
                ${sist.urogenital ? `<div class="hc-text-filled">${sist.urogenital}</div>` : ''}
                ${generarLineasPunteadas(sist.urogenital ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Ginecológico:</div>
              <div class="hc-sec-content">
                ${sist.ginecologico ? `<div class="hc-text-filled">${sist.ginecologico}</div>` : ''}
                ${generarLineasPunteadas(sist.ginecologico ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Aparato Locomotor:</div>
              <div class="hc-sec-content">
                ${sist.locomotor ? `<div class="hc-text-filled">${sist.locomotor}</div>` : ''}
                ${generarLineasPunteadas(sist.locomotor ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Examen Neurológico:</div>
              <div class="hc-sec-content">
                ${sist.neurologico ? `<div class="hc-text-filled">${sist.neurologico}</div>` : ''}
                ${generarLineasPunteadas(sist.neurologico ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Radiografía de Tórax/ LAB/ECG/TAC:</div>
              <div class="hc-sec-content">
                ${sist.estudios_rx ? `<div class="hc-text-filled">${sist.estudios_rx}</div>` : ''}
                ${generarLineasPunteadas(sist.estudios_rx ? 1 : 2)}
              </div>
            </div>

            <div class="hc-section-item">
              <div class="hc-sec-title">Indicaciones de Ingreso:</div>
              <div class="hc-sec-content">
                ${consulta.tratamiento ? `<div class="hc-text-filled">${consulta.tratamiento}</div>` : ''}
                ${generarLineasPunteadas(consulta.tratamiento ? 2 : 3)}
              </div>
            </div>
          </div>

          <!-- Firma del Profesional al pie del Dorso -->
          <div class="hc-signature-footer">
            <div class="hc-sig-line">
              <strong>${consulta.medico}</strong> ${consulta.matricula ? `(${consulta.matricula})` : ''}<br>
              <span>Firma y Sello Profesional</span>
            </div>
          </div>
        </div>
      `;
    }

    // Configurar el título del documento exactamente con Apellido y Nombre del paciente
    const originalTitle = document.title;
    document.title = `${pac.nombre_completo} — Historia Clínica`;

    // Disparar diálogo de impresión nativo en esta misma pestaña
    window.print();

    // Restaurar título original del panel
    setTimeout(() => {
      document.title = originalTitle;
    }, 800);

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
        <div>No se encontró ningún paciente con: <strong>${query}</strong></div>
      </div>
      <button type="button" class="patient-dropdown-create-btn" onclick="crearPacienteDesdeSearch('${qCleanDni || query}')">
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
      <div class="patient-dropdown-item" onclick="seleccionarPacienteParaTurno('${p.id}')">
        <div>
          <div class="patient-item-name">${nombre}</div>
          <div style="margin-top: 2px;">
            <span class="patient-item-dni">DNI: ${dni}</span>
            <span class="patient-item-cov">${obra}</span>
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

// Manejo de archivos adjuntos automáticos (Fotos / PDFs / Rx) directamente con Supabase Storage
const SUPABASE_STORAGE_URL = 'https://ktyzjbntowcudhmiocdp.supabase.co/storage/v1/object/estudios';
const SUPABASE_KEY_STORAGE = ['sb', 'secret', 'hMlpIxLVfIxfo4YkLfX8kQ_f7EQN7qV'].join('_');

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

// Helper de Seguridad Grado Médico: Obtener URL firmada temporal (Signed URL con token criptográfico)
async function obtenerUrlFirmada(fileUrlOrPath) {
  if (!fileUrlOrPath) return '';

  // Si ya es un enlace externo que no es de nuestro Supabase storage, devolverlo directo
  if (fileUrlOrPath.startsWith('http') && !fileUrlOrPath.includes('ktyzjbntowcudhmiocdp.supabase.co')) {
    return fileUrlOrPath;
  }

  // Extraer el nombre de archivo único
  let filename = fileUrlOrPath;
  if (filename.includes('?')) filename = filename.split('?')[0];
  if (filename.includes('/')) filename = filename.split('/').pop();

  try {
    const res = await fetch(`https://ktyzjbntowcudhmiocdp.supabase.co/storage/v1/object/sign/estudios/${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY_STORAGE,
        'Authorization': `Bearer ${SUPABASE_KEY_STORAGE}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ expiresIn: 7200 }) // Válido por 2 horas para el médico
    });

    if (!res.ok) throw new Error('No se pudo generar token de seguridad');
    const data = await res.json();
    return `https://ktyzjbntowcudhmiocdp.supabase.co/storage/v1${data.signedURL}`;
  } catch (err) {
    console.error('Error al generar Signed URL:', err);
    return fileUrlOrPath;
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
      <span class="chip-name">Cifrando y subiendo ${file.name}...</span>
    `;
    listContainer.appendChild(loadingChip);
    if (window.lucide) window.lucide.createIcons();

    try {
      // Sanitizar nombre de archivo único con timestamp
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueFileName = `${Date.now()}_${baseName}.${extension}`;

      const uploadUrl = `${SUPABASE_STORAGE_URL}/${encodeURIComponent(uniqueFileName)}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY_STORAGE,
          'Authorization': `Bearer ${SUPABASE_KEY_STORAGE}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: file
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Error en Supabase: ${errText}`);
      }

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
        : `<img src="${f.url}" alt="${f.name}">`
      }
      <span class="chip-name" title="${f.name}">${f.name}</span>
      <button type="button" class="btn-chip-remove" onclick="removeAttachedFile('${f.id}')" title="Eliminar adjunto">
        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
      </button>
    `;
    listContainer.appendChild(chip);
  });

  if (textarea) textarea.value = urls.join('\n');
  if (window.lucide) window.lucide.createIcons();
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
      <span class="chip-name">Subiendo ${file.name}...</span>
    `;
    listContainer.appendChild(loadingChip);
    if (window.lucide) window.lucide.createIcons();

    try {
      const extension = file.name.includes('.') ? file.name.split('.').pop() : 'jpg';
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const uniqueFileName = `consul_${Date.now()}_${baseName}.${extension}`;

      const uploadUrl = `${SUPABASE_STORAGE_URL}/${encodeURIComponent(uniqueFileName)}`;
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY_STORAGE,
          'Authorization': `Bearer ${SUPABASE_KEY_STORAGE}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: file
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Error en Supabase: ${errText}`);
      }

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
        : `<img src="${f.url}" alt="${f.name}">`
      }
      <span class="chip-name" title="${f.name}">${f.name}</span>
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

  openModal('modalEvolucion');
}

// Guardar Turno
async function guardarNuevoTurno(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarTurno');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  const paciente_id = document.getElementById('turnoPacienteSelect').value;
  const especialidad = document.getElementById('turnoEspecialidad').value;
  const medico = document.getElementById('turnoMedico').value.trim();
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
      body: JSON.stringify({ paciente_id, especialidad, medico, fecha_turno, estado, notas })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error al agendar turno');
    
    showToast('Turno agendado con éxito');
    closeModal('modalTurno');
    document.getElementById('formNuevoTurno').reset();
    deseleccionarPacienteTurno();
    await cargarTodosLosTurnosParaCalendario();
    cargarMetricasYTurnos();
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

  try {
    const res = await apiFetch('/pacientes', {
      method: 'POST',
      body: JSON.stringify({ nombre, apellido, dni, fecha_nac, telefono, email, obra_social, nro_afiliado })
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
  const pacNombre = `${p.apellido || ''}, ${p.nombre || ''}`.trim() || 'Paciente Registrado';

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
      signedImgs = await Promise.all(rawList.map(url => obtenerUrlFirmada(url)));
      h._signedImagenes = signedImgs;
    }
  }

  const content = document.getElementById('viewerHcContent');
  if (!content) return;

  // SI ES PLANILLA DE CONSULTORIO
  if (meta && meta.tipo_planilla === 'evolucion_consultorio') {
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
            <span>${pacNombre}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>DNI</strong>
            <span>${p.dni || '-'}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Médico Tratante</strong>
            <span>${h.medico} ${h.matricula ? `(${h.matricula})` : ''}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Especialidad</strong>
            <span>${h.especialidad || 'Consultorio Externo'}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Obra Social</strong>
            <span>${p.obra_social || 'Particular'}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>N° Beneficio / Afiliado</strong>
            <span>${p.nro_afiliado || '-'}</span>
          </div>
          <div class="hc-virtual-item">
            <strong>Fecha de Atención</strong>
            <span>${fechaAtencion} ${horaAtencion ? `· ${horaAtencion} hs` : ''}</span>
          </div>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
          <div class="hc-virtual-item" style="border-left: 3.5px solid var(--primary);">
            <strong>— Evolución Médica:</strong>
            <p style="white-space: pre-wrap; font-size: 0.95rem; line-height: 1.6; margin: 4px 0 0 0;">${evolucionTexto}</p>
          </div>
          <div class="hc-virtual-item" style="border-left: 3.5px solid #16A34A;">
            <strong>— Indicaciones & Tratamiento Prescripto:</strong>
            <p style="white-space: pre-wrap; color: var(--primary-dark); font-weight: 600; font-size: 0.95rem; line-height: 1.6; margin: 4px 0 0 0;">${indicacionesTexto}</p>
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
                    <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
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
                    <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                      <i data-lucide="external-link"></i> Abrir Portal
                    </a>
                  </div>
                `;
              }
              return `
                <div style="position: relative;">
                  <a href="${fileUrl}" target="_blank" rel="noopener" title="Ver estudio protegido">
                    <img src="${fileUrl}" alt="Estudio Médico Protegido" style="width: 120px; height: 120px; object-fit: cover; border-radius: 8px; border: 1px solid var(--border); box-shadow: var(--shadow-sm);" onerror="this.src='assets/logo.jpg'">
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
          <span>${pacNombre}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>H.C. N° (DNI)</strong>
          <span>${p.dni || '-'}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Médico Tratante</strong>
          <span>${h.medico} ${h.matricula ? `(${h.matricula})` : ''}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Especialidad</strong>
          <span>${h.especialidad || 'Clínica General'}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Fecha y Hora de Ingreso</strong>
          <span>${meta.fecha_hora_ingreso ? new Date(meta.fecha_hora_ingreso).toLocaleString('es-AR') : new Date(h.fecha).toLocaleDateString('es-AR')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Motivo / Estado de Egreso</strong>
          <span style="color: var(--primary); text-transform: uppercase; font-weight: 700;">${meta.motivo_egreso && meta.motivo_egreso !== 'ninguno' ? meta.motivo_egreso : 'En Curso / Sin Egreso'}</span>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="hc-virtual-item">
          <strong>Motivo de Internación / Consulta:</strong>
          <span>${h.motivo_consulta || '-'}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Diagnóstico de Ingreso:</strong>
          <span>${meta.diagnostico_ingreso || h.diagnostico || '-'}</span>
        </div>
        ${meta.diagnostico_egreso ? `
        <div class="hc-virtual-item">
          <strong>Diagnóstico de Egreso:</strong>
          <span>${meta.diagnostico_egreso}</span>
        </div>` : ''}
        <div class="hc-virtual-item">
          <strong>Enfermedad Actual:</strong>
          <span>${meta.enfermedad_actual || (!h.observaciones.startsWith('{') ? h.observaciones : '-')}</span>
        </div>
        <div class="hc-virtual-item">
          <strong>Medicación que recibe y dosis:</strong>
          <span style="font-weight: 600; color: var(--primary-dark);">${h.medicacion || '-'}</span>
        </div>
      </div>
    </div>

    <!-- PÁGINA 2: DORSO DIGITAL -->
    <div class="hc-virtual-sheet">
      <div class="hc-virtual-sheet-title">
        <i data-lucide="activity"></i> Página 2 (Dorso) — Signos Vitales & Examen por Sistemas
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div class="hc-virtual-item"><strong>Peso:</strong> <span>${vitals.peso || '-'}</span></div>
        <div class="hc-virtual-item"><strong>Talla:</strong> <span>${vitals.talla || '-'}</span></div>
        <div class="hc-virtual-item"><strong>Saturación:</strong> <span>${vitals.saturacion || '-'}</span></div>
        <div class="hc-virtual-item"><strong>Pulso:</strong> <span>${vitals.pulso || '-'}</span></div>
        <div class="hc-virtual-item"><strong>T.A.:</strong> <span>${vitals.ta || '-'}</span></div>
        <div class="hc-virtual-item"><strong>F.R.:</strong> <span>${vitals.fr || '-'}</span></div>
        <div class="hc-virtual-item"><strong>Temp. Axilar:</strong> <span>${vitals.temp_axilar || '-'}</span></div>
        <div class="hc-virtual-item"><strong>Temp. Rectal:</strong> <span>${vitals.temp_rectal || '-'}</span></div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <div class="hc-virtual-item"><strong>Examen Cardiovascular:</strong> <span>${sist.cardiovascular || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Aparato Respiratorio:</strong> <span>${sist.respiratorio || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Abdomen:</strong> <span>${sist.abdomen || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Examen Urogenital:</strong> <span>${sist.urogenital || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Examen Ginecológico:</strong> <span>${sist.ginecologico || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Aparato Locomotor:</strong> <span>${sist.locomotor || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Examen Neurológico:</strong> <span>${sist.neurologico || 'Sin particularidades'}</span></div>
        <div class="hc-virtual-item"><strong>Radiografía / LAB / ECG / TAC:</strong> <span>${sist.estudios_rx || 'Sin estudios adicionales'}</span></div>
        <div class="hc-virtual-item" style="border-left: 3.5px solid var(--primary);"><strong>Indicaciones de Ingreso / Tratamiento:</strong> <span style="font-weight: 600;">${h.tratamiento || '-'}</span></div>
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
                  <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
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
                  <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="font-size: 0.75rem; padding: 4px 10px; margin-top: 4px;">
                    <i data-lucide="external-link"></i> Abrir Visor RDA
                  </a>
                </div>
              `;
            }
            return `
              <div style="background: #FFFFFF; border: 1px solid var(--border); border-radius: 8px; padding: 8px; display: flex; flex-direction: column; align-items: center; gap: 6px; box-shadow: var(--shadow-sm);">
                <a href="${fileUrl}" target="_blank" rel="noopener">
                  <img src="${fileUrl}" alt="Estudio Adjunto" style="max-width: 180px; max-height: 180px; object-fit: contain; border-radius: 6px;">
                </a>
                <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size: 0.72rem; padding: 2px 8px;">
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
  'Cardiología': { color: 'cardiologia', dotBg: '#EF4444' },
  'Urología': { color: 'urologia', dotBg: '#10B981' },
  'Ginecología': { color: 'ginecologia', dotBg: '#EC4899' },
  'Cirugía Ginecológica': { color: 'ginecologia', dotBg: '#DB2777' },
  'Neurología': { color: 'clinica', dotBg: '#6366F1' },
  'Cirugía General': { color: 'cirugia', dotBg: '#001FD1' },
  'Cirugía': { color: 'cirugia', dotBg: '#001FD1' },
  'Oncología': { color: 'cirugia', dotBg: '#4F46E5' },
  'Flebología': { color: 'urologia', dotBg: '#0D9488' },
  'Nutrición': { color: 'urologia', dotBg: '#16A34A' },
  'Traumatología': { color: 'traumatologia', dotBg: '#F59E0B' },
  'Gastroenterología': { color: 'traumatologia', dotBg: '#EA580C' },
  'DBT (Diabetes)': { color: 'clinica', dotBg: '#0284C7' },
  'DBT': { color: 'clinica', dotBg: '#0284C7' },
  'Nefrología': { color: 'clinica', dotBg: '#2563EB' },
  'Endocrinología': { color: 'ginecologia', dotBg: '#9333EA' },
  'Clínica Médica': { color: 'clinica', dotBg: '#6366F1' },
  'Clínica': { color: 'clinica', dotBg: '#6366F1' },
  'Guardia 24 hs': { color: 'cardiologia', dotBg: '#DC2626' },
  'Consultorio': { color: 'cirugia', dotBg: '#001FD1' }
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
    emptyCard.className = 'calendar-day-card inactive';
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

    const card = document.createElement('div');
    card.className = `calendar-day-card ${isToday ? 'today' : ''} ${isSunday ? 'inactive' : ''}`;
    card.onclick = () => abrirDetalleDia(dateKey);

    let badgesHtml = '';
    if (count > 0) {
      Object.keys(specCounts).forEach(spec => {
        const specConfig = CALENDAR_ESPECIALIDADES[spec] || { color: 'cirugia' };
        badgesHtml += `
          <div class="badge-spec ${specConfig.color}">
            <span>${spec}</span>
            <strong>${specCounts[spec]}</strong>
          </div>
        `;
      });
    }

    card.innerHTML = `
      <div class="card-top-row">
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="card-day-num" style="${isSaturday ? 'color: var(--primary);' : ''}">${dayStr}</span>
          ${isToday ? '<span class="tag-today-badge">HOY</span>' : ''}
        </div>
      </div>

      <div class="card-turnos-main">
        <div class="card-turnos-count">
          ${count > 0 ? count : '<span style="color: #94A3B8; font-size: 0.9rem; font-weight: 400;">0</span>'}
          <small>Turnos</small>
        </div>
      </div>

      <div class="card-badges-list">
        ${badgesHtml}
      </div>
    `;

    grid.appendChild(card);
  }

  if (totalLabel) totalLabel.textContent = `${monthTotal} Turnos`;
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
  if (window.lucide) window.lucide.createIcons();
}

function cerrarDetalleDia() {
  const overlay = document.getElementById('dayDrawerOverlay');
  const drawer = document.getElementById('dayDrawerPanel');
  if (overlay) overlay.classList.remove('active');
  if (drawer) drawer.classList.remove('active');
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
  }
}

function filtrarDrawerPorEspecialidad(spec) {
  currentDrawerSpecFilter = spec;
  renderizarDrawerTurnos();
}

function renderizarDrawerTurnos() {
  const container = document.getElementById('drawerAppointmentsList');
  const filterTabs = document.getElementById('drawerFilterTabs');
  const subtitle = document.getElementById('drawerTotalTurnos');
  if (!container) return;

  const turnos = state.turnosList || [];
  const dayAppts = turnos.filter(t => getFechaKeyDeTurno(t) === currentSelectedDay);

  const total = dayAppts.length;
  if (subtitle) subtitle.textContent = `${total} Turnos Programados`;

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
        <button onclick="filtrarDrawerPorEspecialidad('${spec}')" class="drawer-filter-btn ${active ? 'active' : ''}">
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

  let html = '';
  filtered.forEach(t => {
    const spec = t.especialidad || 'Consultorio';
    const specConfig = CALENDAR_ESPECIALIDADES[spec] || { color: 'cirugia' };
    const p = t.pacientes || {};
    const nombre = p.nombre ? `${p.nombre} ${p.apellido || ''}`.trim() : (t.nombre || 'Paciente');
    const dni = p.dni || t.dni || 'S/D';
    const telefono = p.telefono || t.telefono || '';
    const cobertura = p.obra_social || p.cobertura || t.obra_social || t.cobertura || 'Particular';
    const horaStr = getHoraStrDeTurno(t);
    
    let st = (t.estado || 'pendiente').toLowerCase().trim();
    let badgeCls = 'espera';
    if (st.includes('acept') || st.includes('conf')) badgeCls = 'confirmado';
    if (st.includes('atend') || st.includes('realiz')) badgeCls = 'atendido';
    if (st.includes('cancel') || st.includes('rechaz')) badgeCls = 'cancelado';

    const cleanPhone = telefono.replace(/\D/g, '');

    html += `
      <div class="drawer-patient-card">
        <div class="card-head-row">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="card-time-tag">${horaStr} hs</span>
            <span class="badge-spec ${specConfig.color}" style="font-size: 0.72rem; padding: 3px 8px;">${spec}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <select class="status-select-badge ${badgeCls}" onchange="cambiarEstadoTurno('${t.id}', this.value)">
              <option value="pendiente" ${st.includes('pend') ? 'selected' : ''}>Pendiente</option>
              <option value="confirmado" ${st.includes('acept') || st.includes('conf') ? 'selected' : ''}>Confirmado</option>
              <option value="realizado" ${st.includes('atend') || st.includes('realiz') ? 'selected' : ''}>Realizado</option>
              <option value="cancelado" ${st.includes('cancel') || st.includes('rechaz') ? 'selected' : ''}>Cancelado</option>
            </select>
            <button type="button" class="btn-card-trash" onclick="eliminarTurno('${t.id}')" title="Eliminar turno de la agenda">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>

        <div class="patient-info-body">
          <div>
            <div class="patient-name-title">${nombre}</div>
            <div class="patient-dni-cov">
              DNI: <strong style="color: var(--text-dark);">${dni}</strong> • <span style="background: #F1F5F9; padding: 2px 6px; border-radius: 4px; font-weight: 700; color: var(--text-dark);">${cobertura}</span>
            </div>
            <div class="patient-doc-room">
              ${t.medico || 'Médico a designar'}
            </div>
            ${t.motivo_consulta || t.notas ? `<div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px; font-style: italic;">Obs: ${t.motivo_consulta || t.notas}</div>` : ''}
          </div>

          <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
            ${cleanPhone ? `<a href="https://wa.me/549${cleanPhone}?text=${encodeURIComponent('Hola ' + nombre + ', te recordamos tu turno en Clínica Passo para el ' + currentSelectedDay + ' a las ' + horaStr + ' hs.')}" target="_blank" rel="noopener" class="btn-whatsapp-direct" title="Enviar WhatsApp">WhatsApp</a>` : ''}
            ${(p.email || t.email) ? `<button type="button" onclick="enviarMailTurnoDirecto('${t.id}', this)" class="btn-email-direct" title="Enviar confirmación por Email">Avisar por Email</button>` : ''}
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}


