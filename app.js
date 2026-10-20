// ========== Estado global ==========
const state = {
  messages: [],
  participants: [],
  me: null,
  chatTitle: "Chat",
  originalText: "",
  searchQuery: "",
  theme: localStorage.getItem("theme") || "light",
  mediaFiles: {}   // filename → objectURL
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

        // Detectar multimedia y posible nombre de archivo
        const mediaInfo = detectMedia(fullContent);

        current = {
          date: date.trim(),
          time: time.trim(),
          sender: sender.trim(),
          content: mediaInfo.isMedia && !mediaInfo.filename ? mediaInfo.placeholder : fullContent,
          isSystem: false,
          isMedia: mediaInfo.isMedia,
          mediaFilename: mediaInfo.filename || null,
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

function detectMedia(text) {
  const t = text.trim();

  // Formato iOS: <attached: 00000013-PHOTO-2024-03-16-09-15-02.jpg>
  let match = t.match(/<attached:\s*([^>]+)>/i);
  if (match) {
    return { isMedia: true, filename: match[1].trim(), placeholder: getPlaceholderFromName(match[1]) };
  }

  // Formato Android: IMG-20240316-WA0001.jpg (file attached)  o  (archivo adjunto)
  match = t.match(/^(.+?\.(jpg|jpeg|png|gif|webp|mp4|mov|3gp|opus|m4a|ogg|mp3|pdf|docx?|xlsx?|pptx?|vcf|zip))\s*(\(file attached\)|\(archivo adjunto\))?$/i);
  if (match) {
    return { isMedia: true, filename: match[1].trim(), placeholder: getPlaceholderFromName(match[1]) };
  }

  // Placeholders sin archivo (export sin media)
  const omitted = /<archivo omitido>|<Multimedia omitido>|<Media omitted>|image omitted|audio omitted|video omitted|sticker omitted|documento omitido|GIF omitido|imagen omitida|audio omitido|video omitido|sticker omitido/i;
  if (omitted.test(t)) {
    return { isMedia: true, filename: null, placeholder: getPlaceholderFromText(t) };
  }

  return { isMedia: false, filename: null, placeholder: null };
}

function getPlaceholderFromName(filename) {
  const f = filename.toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp)$/.test(f) || f.includes("img-") || f.includes("photo")) return "📷 Foto";
  if (/\.(opus|m4a|ogg|mp3)$/.test(f) || f.includes("ptt-") || f.includes("audio")) return "🎤 Audio";
  if (/\.(mp4|mov|3gp)$/.test(f) || f.includes("vid-") || f.includes("video")) return "🎬 Video";
  if (f.includes("sticker")) return "🏷️ Sticker";
  if (/\.(pdf|docx?|xlsx?|pptx?)$/.test(f)) return "📄 Documento";
  if (f.endsWith(".vcf")) return "👤 Contacto";
  return "📎 Archivo";
}

function getPlaceholderFromText(text) {
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

      // Intentar mostrar el archivo multimedia real
      let mediaShown = false;
      if (msg.mediaFilename) {
        const url = state.mediaFiles[msg.mediaFilename] || state.mediaFiles[msg.mediaFilename.toLowerCase()];
        if (url) {
          const lower = msg.mediaFilename.toLowerCase();
          if (/\.(jpg|jpeg|png|gif|webp)$/.test(lower)) {
            const img = document.createElement("img");
            img.src = url;
            img.alt = "Imagen";
            img.className = "media-image";
            img.loading = "lazy";
            img.onclick = () => window.open(url, "_blank");
            div.appendChild(img);
            mediaShown = true;
          } else if (/\.(mp4|mov|3gp)$/.test(lower)) {
            const video = document.createElement("video");
            video.src = url;
            video.controls = true;
            video.className = "media-video";
            video.preload = "metadata";
            div.appendChild(video);
            mediaShown = true;
          } else if (/\.(opus|m4a|ogg|mp3)$/.test(lower)) {
            const audio = document.createElement("audio");
            audio.src = url;
            audio.controls = true;
            audio.className = "media-audio";
            audio.preload = "metadata";
            div.appendChild(audio);
            mediaShown = true;
          } else {
            // Documento u otro → enlace de descarga
            const link = document.createElement("a");
            link.href = url;
            link.download = msg.mediaFilename;
            link.className = "media-file-link";
            link.textContent = "📄 " + msg.mediaFilename;
            div.appendChild(link);
            mediaShown = true;
          }
        }
      }

      // Si no se pudo mostrar el medio, mostrar el texto/placeholder
      if (!mediaShown) {
        const content = document.createElement("span");
        content.className = "message-content";
        content.textContent = msg.content;
        div.appendChild(content);
      }

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
    const looksLikeZip = name.endsWith(".zip") || 
                         file.type.includes("zip") || 
                         file.type === "application/octet-stream";

    try {
      let text = "";

      // Limpiar ObjectURLs anteriores para no acumular memoria
      Object.values(state.mediaFiles).forEach(url => URL.revokeObjectURL(url));
      state.mediaFiles = {};

      if (looksLikeZip) {
        try {
          const zip = await JSZip.loadAsync(file);
          
          let txtFile = null;
          const mediaEntries = [];

          zip.forEach((relativePath, zipEntry) => {
            if (zipEntry.dir) return;
            const lower = relativePath.toLowerCase();
            const baseName = relativePath.split("/").pop(); // por si viene en subcarpeta

            if (!txtFile && lower.endsWith(".txt")) {
              txtFile = zipEntry;
            } else if (/\.(jpg|jpeg|png|gif|webp|mp4|mov|3gp|opus|m4a|ogg|mp3|pdf|docx?|xlsx?|pptx?|vcf)$/i.test(lower)) {
              mediaEntries.push({ name: baseName, entry: zipEntry });
            }
          });

          if (!txtFile) {
            alert("No se encontró ningún archivo .txt dentro del ZIP");
            e.target.value = "";
            return;
          }

          text = await txtFile.async("string");

          // Extraer medios y crear ObjectURLs
          for (const { name, entry } of mediaEntries) {
            try {
              const blob = await entry.async("blob");
              state.mediaFiles[name] = URL.createObjectURL(blob);
              // También guardar sin mayúsculas por si acaso
              state.mediaFiles[name.toLowerCase()] = state.mediaFiles[name];
            } catch (mediaErr) {
              console.warn("No se pudo extraer:", name, mediaErr);
            }
          }

        } catch (zipErr) {
          console.warn("No se pudo leer como ZIP, intentando como texto:", zipErr);
          text = await file.text();
        }
      } else {
        text = await file.text();
      }

      if (!text || !text.trim()) {
        alert("El archivo está vacío o no se pudo leer");
        e.target.value = "";
        return;
      }

      $("chat-input").value = text;
      processChatText(text);

    } catch (err) {
      console.error(err);
      alert("Error al leer el archivo. Prueba con el .txt o el .zip que exporta WhatsApp.");
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
