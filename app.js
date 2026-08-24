/**
 * LÓGICA INTERACTIVA & INTEGRACIÓN WHATSAPP — CLÍNICA PASSO S.A.
 */

// ==========================================================================
// CONFIGURACIÓN DE CONTACTO DE LA CLÍNICA
// Cambiá este número por el celular de WhatsApp donde querés recibir los turnos:
// ==========================================================================
const CLINICA_CONFIG = {
  // Formato internacional de Argentina: 549 + 11 + número de celular sin el 15
  whatsappNumber: '5491139511478', // Número de WhatsApp para Turnos y Consultas
  telefonoGuardia: '1142640056',
  direccion: 'Av. Eva Perón 3097, B1832 Temperley, Provincia de Buenos Aires'
};

document.addEventListener('DOMContentLoaded', () => {
  // 1. Inicializar iconos de Lucide
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 2. Navegación Móvil
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.getElementById('navLinks');
  const menuIcon = document.getElementById('menuIcon');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('mobile-open');
      menuToggle.setAttribute('aria-expanded', isOpen);
      if (isOpen) {
        menuToggle.innerHTML = '<i data-lucide="x"></i>';
      } else {
        menuToggle.innerHTML = '<i data-lucide="menu"></i>';
      }
      if (window.lucide) window.lucide.createIcons();
    });

    // Cerrar menú al hacer clic en un enlace
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('mobile-open');
        menuToggle.innerHTML = '<i data-lucide="menu"></i>';
        if (window.lucide) window.lucide.createIcons();
      });
    });
  }

  // 3. Navbar Sticky con sombra al hacer scroll
  const mainNav = document.getElementById('mainNav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
      mainNav.classList.add('scrolled');
    } else {
      mainNav.classList.remove('scrolled');
    }
  });

  // 4. Filtrado de Especialidades Médicas
  const filterTabs = document.querySelectorAll('.filter-tab');
  const serviceCards = document.querySelectorAll('.service-card');

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const filterValue = tab.getAttribute('data-filter');

      serviceCards.forEach(card => {
        const category = card.getAttribute('data-category');
        if (filterValue === 'all' || category === filterValue || (filterValue === 'quirurgicas' && category === 'quirurgicas')) {
          card.style.display = 'flex';
          card.style.opacity = '0';
          setTimeout(() => {
            card.style.opacity = '1';
          }, 50);
        } else {
          card.style.display = 'none';
        }
      });
    });
  });

  // 5. Acordeón de Guía al Paciente
  const accordionHeaders = document.querySelectorAll('.accordion-header');

  accordionHeaders.forEach(header => {
    header.addEventListener('click', () => {
      const parentItem = header.parentElement;
      const isActive = parentItem.classList.contains('active');

      document.querySelectorAll('.accordion-item').forEach(item => {
        item.classList.remove('active');
        item.querySelector('.accordion-header').setAttribute('aria-expanded', 'false');
      });

      if (!isActive) {
        parentItem.classList.add('active');
        header.setAttribute('aria-expanded', 'true');
      }
    });
  });

  // 6. Cerrar modal con la tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTurnoModal();
    }
  });

  // Cerrar modal al hacer clic en el fondo oscurecido
  const modalBackdrop = document.getElementById('turnoModal');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeTurnoModal();
      }
    });
  }
});

// ==========================================
// FUNCIONES GLOBALES DE MODAL & TURNOS
// ==========================================

function openTurnoModal(specialty = '') {
  const modal = document.getElementById('turnoModal');
  const specialtySelect = document.getElementById('modalSpecialty');
  const feedback = document.getElementById('modalFeedback');

  if (feedback) feedback.classList.add('hidden');
  
  if (specialtySelect && specialty) {
    for (let i = 0; i < specialtySelect.options.length; i++) {
      if (specialtySelect.options[i].text.toLowerCase().includes(specialty.toLowerCase()) || 
          specialtySelect.options[i].value.toLowerCase().includes(specialty.toLowerCase())) {
        specialtySelect.selectedIndex = i;
        break;
      }
    }
  }

  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (window.lucide) window.lucide.createIcons();
  }
}

function closeTurnoModal() {
  const modal = document.getElementById('turnoModal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

// Envío del Modal a WhatsApp
function handleModalSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('modalName').value.trim();
  const phone = document.getElementById('modalPhone').value.trim();
  const insurance = document.getElementById('modalInsurance').value.trim() || 'Particular / A consultar';
  const specialty = document.getElementById('modalSpecialty').value;
  const notes = document.getElementById('modalNotes').value.trim() || 'Sin observaciones adicionales';

  const feedback = document.getElementById('modalFeedback');
  const submitBtn = event.target.querySelector('button[type="submit"]');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2"></i> Conectando con WhatsApp...';
    if (window.lucide) window.lucide.createIcons();
  }

  // Construir mensaje estructurado para WhatsApp
  const message = 
    `🏥 *SOLICITUD DE TURNO — CLÍNICA PASSO S.A.*\n\n` +
    `👤 *Paciente:* ${name}\n` +
    `📞 *Teléfono:* ${phone}\n` +
    `🩺 *Especialidad:* ${specialty}\n` +
    `💳 *Obra Social / Prepaga:* ${insurance}\n` +
    `📝 *Preferencia / Consulta:* ${notes}\n\n` +
    `_Enviado desde el sitio web de Clínica Passo S.A._`;

  const waUrl = `https://wa.me/${CLINICA_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;

  setTimeout(() => {
    if (feedback) {
      feedback.classList.remove('hidden');
      feedback.innerHTML = '<i data-lucide="check-circle-2"></i> <p><strong>¡Abriendo WhatsApp!</strong> Enviando los datos de tu turno a recepción...</p>';
      if (window.lucide) window.lucide.createIcons();
    }
    
    // Abrir WhatsApp en una nueva pestaña/app
    window.open(waUrl, '_blank');

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check"></i> ¡Listo!';
      if (window.lucide) window.lucide.createIcons();
    }

    setTimeout(() => {
      closeTurnoModal();
      event.target.reset();
      if (submitBtn) submitBtn.innerHTML = '<i data-lucide="send"></i> Confirmar Solicitud por WhatsApp';
    }, 2500);
  }, 600);
}

// Envío del Formulario de la Página a WhatsApp
function handleFormSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('formName').value.trim();
  const phone = document.getElementById('formPhone').value.trim();
  const email = document.getElementById('formEmail').value.trim() || 'No especificado';
  const specialty = document.getElementById('formSpecialty').value;
  const insurance = document.getElementById('formInsurance').value.trim() || 'Particular / A consultar';
  const userMsg = document.getElementById('formMessage').value.trim() || 'Sin mensaje adicional';

  const feedback = document.getElementById('formFeedback');
  const submitBtn = document.getElementById('submitBtn');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i data-lucide="loader-2"></i> Conectando con WhatsApp...';
    if (window.lucide) window.lucide.createIcons();
  }

  // Construir mensaje estructurado para WhatsApp
  const message = 
    `🏥 *CONSULTA / TURNO — CLÍNICA PASSO S.A.*\n\n` +
    `👤 *Nombre:* ${name}\n` +
    `📞 *Teléfono:* ${phone}\n` +
    `✉️ *Email:* ${email}\n` +
    `🩺 *Especialidad:* ${specialty}\n` +
    `💳 *Cobertura:* ${insurance}\n` +
    `📝 *Mensaje:* ${userMsg}\n\n` +
    `_Enviado desde el formulario web de Clínica Passo S.A._`;

  const waUrl = `https://wa.me/${CLINICA_CONFIG.whatsappNumber}?text=${encodeURIComponent(message)}`;

  setTimeout(() => {
    if (feedback) {
      feedback.classList.remove('hidden');
      feedback.innerHTML = '<i data-lucide="check-circle-2"></i> <p><strong>¡Abriendo WhatsApp!</strong> Se preparó tu solicitud de turno para enviarla a recepción.</p>';
      if (window.lucide) window.lucide.createIcons();
    }

    // Abrir WhatsApp
    window.open(waUrl, '_blank');

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="check"></i> Enviado a WhatsApp';
      if (window.lucide) window.lucide.createIcons();
    }

    setTimeout(() => {
      event.target.reset();
      feedback.classList.add('hidden');
      if (submitBtn) submitBtn.innerHTML = '<i data-lucide="send"></i> Enviar Solicitud por WhatsApp';
      if (window.lucide) window.lucide.createIcons();
    }, 4500);
  }, 600);
}

function openDirectWhatsApp() {
  const defaultMsg = "Hola Clínica Passo, quisiera consultar por turnos y atención en la clínica.";
  const url = `https://wa.me/${CLINICA_CONFIG.whatsappNumber}?text=${encodeURIComponent(defaultMsg)}`;
  window.open(url, '_blank');
}

function copyAddressToClipboard() {
  navigator.clipboard.writeText(CLINICA_CONFIG.direccion).then(() => {
    showToast("¡Dirección copiada al portapapeles!");
  }).catch(() => {
    showToast("Av. Eva Perón 3097, Temperley");
  });
}

function showToast(message) {
  const toast = document.getElementById('toastNotification');
  const msgEl = document.getElementById('toastMessage');
  if (toast && msgEl) {
    msgEl.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }
}
