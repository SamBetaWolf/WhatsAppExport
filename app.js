// ========== Estado global ==========
const state = {
  messages: [],
  participants: [],
  me: null,
  chatTitle: "Chat",
  originalText: "",
  searchQuery: "",
  theme: localStorage.getItem("theme") || "light"
};

// ========== Utilidades ==========
function $(id) {
  return document.getElementById(id);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $(id).classList.add("active");
}

function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  $("theme-toggle").textContent = state.theme === "dark" ? "☀️" : "🌙";
  localStorage.setItem("theme", state.theme);
}

// ========== Parser de WhatsApp (soporta muchos formatos) ==========
function parseWhatsAppExport(text) {
  const lines = text.split(/\r?\n/);
  const messages = [];
  let current = null;

  // Regex principales (ordenados de más específico a más general)
  const patterns = [
    // [20/10/2024, 10:19:33] Nombre: mensaje
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?[mM]\.?)?)\]\s*(.+?):\s*(.*)$/,
    // [20/10/2024 10:19:33] Nombre: mensaje
    /^\[(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?[mM]\.?)?)\]\s*(.+?):\s*(.*)$/,
    // [20/10, 10:19] Nombre: mensaje  (el más común en español)
    /^\[(\d{1,2}\/\d{1,2}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?[mM]\.?)?)\]\s*(.+?):\s*(.*)$/,
    // 20/10/2024, 10:19 - Nombre: mensaje  (formato antiguo)
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[aApP]\.?[mM]\.?)?)\s*-\s*(.+?):\s*(.*)$/,
    // 20/10/24, 10:19 a. m. - Nombre: mensaje
    /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*[aApP]\.?[mM]\.?)\s*-\s*(.+?):\s*(.*)$/
  ];

  // Mensajes de sistema típicos
  const systemPatterns = [
    /se unió|se fue|cambió el asunto|cambió el ícono|eliminó este mensaje|creó el grupo|añadió|salió|te añadió|cambió su número|los mensajes y las llamadas están cifrados/i,
    /^‎/,  // caracteres invisibles de WhatsApp
  ];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line) continue;

    let matched = false;

    for (const regex of patterns) {
      const match = line.match(regex);
      if (match) {
        // Guardar mensaje anterior si existe
        if (current) messages.push(current);

        const [, date, time, sender, content] = match;
        const fullContent = content || "";

        // Detectar si es multimedia
        const isMedia = /<archivo omitido>|<Multimedia omitido>|<Media omitted>|image omitted|audio omitted|video omitted|sticker omitted|documento omitido|GIF omitido/i.test(fullContent)
          || fullContent === "imagen omitida"
          || fullContent === "audio omitido"
          || fullContent === "video omitido"
          || fullContent === "sticker omitido";

        current = {
          date: date.trim(),
          time: time.trim(),
          sender: sender.trim(),
          content: isMedia ? getMediaPlaceholder(fullContent) : fullContent,
          isSystem: false,
          isMedia: isMedia,
          originalLine: line
        };
        matched = true;
        break;
      }
    }

    if (!matched) {
      // ¿Es un mensaje de sistema?
      const isSystem = systemPatterns.some(p => p.test(line)) || 
                       (!line.includes(":") && line.length < 120 && !current);

      if (isSystem && !current) {
        messages.push({
          date: "",
          time: "",
          sender: "",
          content: line.replace(/^‎/, "").trim(),
          isSystem: true,
          isMedia: false
        });
      } else if (current) {
        // Continuación de mensaje multilínea
        current.content += "\n" + line;
      } else {
        // Línea suelta → tratar como sistema
        messages.push({
          date: "",
          time: "",
          sender: "",
          content: line,
          isSystem: true,
          isMedia: false
        });
      }
    }
  }

  if (current) messages.push(current);

  return messages;
}

function getMediaPlaceholder(text) {
  const t = text.toLowerCase();
  if (t.includes("image") || t.includes("imagen") || t.includes("foto")) return "📷 Foto";
  if (t.includes("audio") || t.includes("ptt") || t.includes("nota de voz")) return "🎤 Audio";
  if (t.includes("video")) return "🎬 Video";
  if (t.includes("sticker")) return "🏷️ Sticker";
  if (t.includes("document") || t.includes("documento") || t.includes("pdf")) return "📄 Documento";
  if (t.includes("gif")) return "🎞️ GIF";
  if (t.includes("contacto")) return "👤 Contacto";
  return "📎 Archivo multimedia";
}

// ========== Detectar participantes y "yo" ==========
function cleanName(name) {
  return (name || "").replace(/\u200e/g, "").replace(/\u200f/g, "").trim();
}

function analyzeParticipants(messages) {
  const counts = {};
  messages.forEach(m => {
    if (!m.isSystem && m.sender) {
      const name = cleanName(m.sender);
      if (name) {
        m.sender = name; // normalizar
        counts[name] = (counts[name] || 0) + 1;
      }
    }
  });

  const participants = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  
  // El más frecuente se considera "yo" por defecto
  const me = participants[0] || null;

  return { participants, me, counts };
}

// ========== Renderizado ==========
function renderMessages() {
  const container = $("messages-container");
  container.innerHTML = "";

  if (state.messages.length === 0) {
    container.innerHTML = `<div class="empty-state">No se encontraron mensajes</div>`;
    return;
  }

  const query = state.searchQuery.toLowerCase().trim();

  state.messages.forEach((msg, index) => {
    if (query && !msg.content.toLowerCase().includes(query) && !msg.sender.toLowerCase().includes(query)) {
      return; // filtrar por búsqueda
    }

    const div = document.createElement("div");

    if (msg.isSystem) {
      div.className = "message system";
      div.textContent = msg.content;
    } else {
      const isMe = msg.sender === state.me;
      div.className = `message ${isMe ? "out" : "in"}${msg.isMedia ? " media" : ""}`;
      
      if (query && msg.content.toLowerCase().includes(query)) {
        div.classList.add("highlight");
      }

      const content = document.createElement("span");
      content.className = "message-content";
      content.textContent = msg.content;
      div.appendChild(content);

      const time = document.createElement("span");
      time.className = "message-time";
      time.textContent = msg.time || "";
      div.appendChild(time);
    }

    container.appendChild(div);
  });

  // Scroll al final
  container.scrollTop = container.scrollHeight;
}

function updateHeader() {
  const others = state.participants.filter(p => p !== state.me);

  // Título principal
  if (others.length === 1) {
    // Chat 1 a 1 → mostrar el nombre de la otra persona
    state.chatTitle = others[0];
    $("chat-title").textContent = others[0];
    $("chat-subtitle").textContent = "";           // vacío para que no se repita
  } else if (others.length > 1) {
    // Grupo
    state.chatTitle = state.chatTitle === "Chat" || state.chatTitle === "Grupo" ? "Grupo" : state.chatTitle;
    $("chat-title").textContent = state.chatTitle;
    $("chat-subtitle").textContent = others.slice(0, 3).join(", ") + (others.length > 3 ? "..." : "");
  } else {
    // Solo hay un participante (o ninguno)
    $("chat-title").textContent = state.me || "Chat";
    $("chat-subtitle").textContent = state.me ? "Tú" : "";
  }
}

// ========== Guardado en localStorage ==========
function getSavedChats() {
  try {
    return JSON.parse(localStorage.getItem("wa_saved_chats") || "[]");
  } catch {
    return [];
  }
}

function saveCurrentChat() {
  const chats = getSavedChats();
  const id = Date.now().toString();
  
  const chatData = {
    id,
    title: state.chatTitle,
    me: state.me,
    participants: state.participants,
    messages: state.messages,
    originalText: state.originalText,
    savedAt: new Date().toISOString()
  };

  chats.unshift(chatData);
  // Limitar a 20 chats
  if (chats.length > 20) chats.pop();
  
  localStorage.setItem("wa_saved_chats", JSON.stringify(chats));
  alert("Chat guardado correctamente");
  renderSavedChats();
}

function loadChat(id) {
  const chats = getSavedChats();
  const chat = chats.find(c => c.id === id);
  if (!chat) return;

  state.messages = chat.messages;
  state.participants = chat.participants;
  state.me = chat.me;
  state.chatTitle = chat.title;
  state.originalText = chat.originalText || "";
  state.searchQuery = "";

  updateHeader();
  renderMessages();
  showScreen("chat-screen");
}

function deleteSavedChat(id, event) {
  event.stopPropagation();
  if (!confirm("¿Eliminar este chat guardado?")) return;
  
  let chats = getSavedChats().filter(c => c.id !== id);
  localStorage.setItem("wa_saved_chats", JSON.stringify(chats));
  renderSavedChats();
}

function renderSavedChats() {
  const section = $("saved-chats-section");
  const list = $("saved-chats-list");
  const chats = getSavedChats();

  if (chats.length === 0) {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  list.innerHTML = "";

  chats.forEach(chat => {
    const item = document.createElement("div");
    item.className = "saved-chat-item";
    item.onclick = () => loadChat(chat.id);

    const date = new Date(chat.savedAt).toLocaleDateString("es-ES", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
    });

    item.innerHTML = `
      <div class="saved-chat-info">
        <div class="saved-chat-name">${escapeHtml(chat.title)}</div>
        <div class="saved-chat-date">${date} · ${chat.messages.length} mensajes</div>
      </div>
      <button class="saved-chat-delete" onclick="deleteSavedChat('${chat.id}', event)">🗑️</button>
    `;
    list.appendChild(item);
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ========== Eventos ==========
function initEvents() {
  // Tema
  $("theme-toggle").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
  };

  // Función común para procesar el texto
  function processChatText(text) {
    if (!text || !text.trim()) {
      alert("No se encontró texto para convertir");
      return;
    }

    state.originalText = text;
    state.messages = parseWhatsAppExport(text);
    
    const analysis = analyzeParticipants(state.messages);
    state.participants = analysis.participants;
    state.me = analysis.me;
    state.chatTitle = "Chat"; // se ajusta dentro de updateHeader()

    state.searchQuery = "";
    $("search-bar").classList.add("hidden");
    $("search-input").value = "";

    updateHeader();
    renderMessages();
    showScreen("chat-screen");
  }

  // Convertir desde textarea
  $("convert-btn").onclick = () => {
    const text = $("chat-input").value.trim();
    if (!text) {
      alert("Pega primero una conversación de WhatsApp o sube un archivo");
      return;
    }
    processChatText(text);
  };

  // Subir archivo .txt o .zip
  $("file-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    const isZip = name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    const isTxt = name.endsWith(".txt") || file.type === "text/plain";

    if (!isZip && !isTxt) {
      alert("Por favor sube un archivo .txt o el .zip que exporta WhatsApp");
      e.target.value = "";
      return;
    }

    try {
      let text = "";

      if (isZip) {
        // Descomprimir el ZIP en el navegador
        const zip = await JSZip.loadAsync(file);
        
        // Buscar el primer archivo .txt dentro del ZIP
        let txtFile = null;
        zip.forEach((relativePath, zipEntry) => {
          if (!txtFile && relativePath.toLowerCase().endsWith(".txt") && !zipEntry.dir) {
            txtFile = zipEntry;
          }
        });

        if (!txtFile) {
          alert("No se encontró ningún archivo .txt dentro del ZIP");
          e.target.value = "";
          return;
        }

        text = await txtFile.async("string");
      } else {
        // Archivo .txt normal
        text = await file.text();
      }

      $("chat-input").value = text;
      processChatText(text);

    } catch (err) {
      console.error(err);
      alert("Error al leer el archivo. Asegúrate de que es un ZIP o TXT válido de WhatsApp.");
    }

    // Reset para poder subir el mismo archivo otra vez
    e.target.value = "";
  };

  // Volver
  $("back-btn").onclick = () => {
    showScreen("home-screen");
    $("options-menu").classList.add("hidden");
  };

  // Menú
  $("menu-btn").onclick = () => {
    $("options-menu").classList.toggle("hidden");
  };

  // Cerrar menú al hacer clic fuera
  document.addEventListener("click", (e) => {
    if (!$("menu-btn").contains(e.target) && !$("options-menu").contains(e.target)) {
      $("options-menu").classList.add("hidden");
    }
  });

  // Buscar
  $("search-btn").onclick = () => {
    $("search-bar").classList.toggle("hidden");
    if (!$("search-bar").classList.contains("hidden")) {
      $("search-input").focus();
    } else {
      state.searchQuery = "";
      renderMessages();
    }
  };

  $("close-search").onclick = () => {
    $("search-bar").classList.add("hidden");
    state.searchQuery = "";
    $("search-input").value = "";
    renderMessages();
  };

  $("search-input").oninput = (e) => {
    state.searchQuery = e.target.value;
    renderMessages();
  };

  // Cambiar quién soy yo
  $("change-me-btn").onclick = () => {
    $("options-menu").classList.add("hidden");
    const options = $("me-options");
    options.innerHTML = "";

    state.participants.forEach(p => {
      const btn = document.createElement("button");
      btn.className = "me-option" + (p === state.me ? " selected" : "");
      btn.textContent = p + (p === state.me ? " (tú)" : "");
      btn.onclick = () => {
        state.me = p;
        updateHeader();
        renderMessages();
        $("me-modal").classList.add("hidden");
      };
      options.appendChild(btn);
    });

    $("me-modal").classList.remove("hidden");
  };

  $("close-me-modal").onclick = () => $("me-modal").classList.add("hidden");

  // Renombrar participantes
  $("rename-participants-btn").onclick = () => {
    $("options-menu").classList.add("hidden");
    const list = $("rename-list");
    list.innerHTML = "";

    state.participants.forEach(p => {
      const div = document.createElement("div");
      div.className = "rename-item";
      div.innerHTML = `
        <label>Nombre actual: ${escapeHtml(p)}</label>
        <input type="text" data-old="${escapeHtml(p)}" value="${escapeHtml(p)}">
      `;
      list.appendChild(div);
    });

    $("rename-modal").classList.remove("hidden");
  };

  $("save-renames-btn").onclick = () => {
    const inputs = $("rename-list").querySelectorAll("input");
    const renames = {};

    inputs.forEach(input => {
      const oldName = input.dataset.old;
      const newName = input.value.trim();
      if (newName && newName !== oldName) {
        renames[oldName] = newName;
      }
    });

    if (Object.keys(renames).length > 0) {
      // Actualizar mensajes
      state.messages.forEach(m => {
        if (renames[m.sender]) m.sender = renames[m.sender];
      });

      // Actualizar participantes
      state.participants = state.participants.map(p => renames[p] || p);
      
      // Actualizar "me"
      if (renames[state.me]) state.me = renames[state.me];

      // Actualizar título si corresponde
      if (renames[state.chatTitle]) state.chatTitle = renames[state.chatTitle];

      updateHeader();
      renderMessages();
    }

    $("rename-modal").classList.add("hidden");
  };

  $("close-rename-modal").onclick = () => $("rename-modal").classList.add("hidden");

  // Guardar chat
  $("save-chat-btn").onclick = () => {
    $("options-menu").classList.add("hidden");
    saveCurrentChat();
  };

  // Copiar texto original
  $("export-text-btn").onclick = () => {
    $("options-menu").classList.add("hidden");
    navigator.clipboard.writeText(state.originalText).then(() => {
      alert("Texto original copiado al portapapeles");
    }).catch(() => {
      alert("No se pudo copiar");
    });
  };
}

// ========== Inicio ==========
document.addEventListener("DOMContentLoaded", () => {
  applyTheme();
  initEvents();
  renderSavedChats();
});
