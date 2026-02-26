import {
  createAuthUser,
  sendPasswordReset,
  getUidByEmail,
  getUserProfileByUid,
  listUserProfiles,
  upsertUserProfile,
  upsertEmailIndex,
  removeEmailIndex
} from "../firebase.js";

const ROLE_OPTIONS = ["admin", "gerente", "administrativo", "profissional"];

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function formatDateTime(timestamp) {
  if (typeof timestamp !== "number") {
    return "Não informado";
  }

  try {
    return new Date(timestamp).toLocaleString("pt-BR");
  } catch (error) {
    return "Não informado";
  }
}

function generateTempPassword(length = 14) {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  const values = new Uint32Array(length);
  window.crypto.getRandomValues(values);

  let password = "";

  for (let index = 0; index < values.length; index += 1) {
    password += charset[values[index] % charset.length];
  }

  return password;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    try {
      const input = document.createElement("input");
      input.value = text;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      return true;
    } catch (fallbackError) {
      return false;
    }
  }
}

function roleOptionsHtml(selectedRole) {
  return ROLE_OPTIONS.map((role) => {
    const selected = role === selectedRole ? "selected" : "";
    return `<option value="${role}" ${selected}>${role}</option>`;
  }).join("");
}

export function render(container) {
  let usersMap = {};
  let editingUid = "";
  let editingOriginalEmail = "";

  container.innerHTML = `
    <section class="admin-page">
      <div class="admin-grid">
        <article class="card">
          <h2>Buscar usuário (por e-mail)</h2>
          <p class="admin-card-text">Informe o e-mail para localizar o UID no índice e carregar o perfil no RTDB.</p>

          <div class="admin-card-body">
            <label class="admin-label" for="adm-busca-email">E-mail</label>
            <div class="admin-inline-actions">
              <input id="adm-busca-email" class="admin-input" type="email" placeholder="usuario@clinica.com" />
              <button id="adm-buscar" type="button" class="admin-btn admin-btn-secondary">Buscar</button>
            </div>

            <div id="adm-busca-resultado" class="admin-result-box">Nenhuma consulta realizada.</div>
            <button id="adm-copiar-uid-busca" type="button" class="admin-btn admin-btn-secondary" style="display:none; width:fit-content;">Copiar UID</button>
          </div>
        </article>

        <article class="card">
          <h2>Criar usuário</h2>
          <p class="admin-card-text">Cria o usuário no Auth, registra perfil no RTDB e envia convite por e-mail.</p>

          <div class="admin-card-body">
            <label class="admin-label" for="adm-criar-email">E-mail</label>
            <input id="adm-criar-email" class="admin-input" type="email" placeholder="novo.usuario@clinica.com" />

            <label class="admin-label" for="adm-criar-role">Perfil</label>
            <select id="adm-criar-role" class="admin-input">
              ${roleOptionsHtml("profissional")}
            </select>

            <label class="admin-checkline" for="adm-criar-ativo">
              <input id="adm-criar-ativo" type="checkbox" checked />
              <span>Usuário ativo</span>
            </label>

            <div class="admin-inline-actions">
              <button id="adm-criar" type="button" class="admin-btn admin-btn-primary">Criar e enviar convite</button>
              <button id="adm-redefinir" type="button" class="admin-btn admin-btn-secondary" style="display:none;">Enviar redefinição de senha</button>
            </div>

            <p id="adm-criar-feedback" class="admin-feedback"></p>
          </div>
        </article>
      </div>

      <article class="card">
        <h2>Usuários cadastrados</h2>
        <p class="admin-card-text">Filtre por e-mail e use as ações para editar ou copiar o UID.</p>

        <div class="admin-card-body">
          <input id="adm-filtro-email" class="admin-input admin-filter" type="text" placeholder="Filtrar por e-mail" />

          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Ativo</th>
                  <th>UID</th>
                  <th>Atualizado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="adm-lista-body">
                <tr>
                  <td colspan="6" class="admin-empty">Carregando usuários...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p id="adm-lista-feedback" class="admin-feedback"></p>
        </div>
      </article>
    </section>

    <div id="adm-edit-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adm-modal-title">
        <button id="adm-modal-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="adm-modal-title">Editar usuário</h2>

        <div class="admin-card-body admin-modal-body">
          <label class="admin-label" for="adm-editar-uid">UID</label>
          <input id="adm-editar-uid" class="admin-input" type="text" readonly />

          <label class="admin-label" for="adm-editar-email">E-mail</label>
          <input id="adm-editar-email" class="admin-input" type="email" readonly />

          <label class="admin-label" for="adm-editar-role">Perfil</label>
          <select id="adm-editar-role" class="admin-input">
            ${roleOptionsHtml("profissional")}
          </select>

          <label class="admin-checkline" for="adm-editar-ativo">
            <input id="adm-editar-ativo" type="checkbox" checked />
            <span>Usuário ativo</span>
          </label>

          <p id="adm-editar-feedback" class="admin-feedback"></p>

          <div class="admin-modal-actions">
            <button id="adm-modal-cancelar" type="button" class="admin-btn admin-btn-secondary">Cancelar</button>
            <button id="adm-salvar" type="button" class="admin-btn admin-btn-primary">Salvar alterações</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const buscaEmailInput = container.querySelector("#adm-busca-email");
  const buscarButton = container.querySelector("#adm-buscar");
  const buscaResultado = container.querySelector("#adm-busca-resultado");
  const copiarUidBuscaButton = container.querySelector("#adm-copiar-uid-busca");

  const criarEmailInput = container.querySelector("#adm-criar-email");
  const criarRoleSelect = container.querySelector("#adm-criar-role");
  const criarAtivoToggle = container.querySelector("#adm-criar-ativo");
  const criarButton = container.querySelector("#adm-criar");
  const redefinirButton = container.querySelector("#adm-redefinir");
  const criarFeedback = container.querySelector("#adm-criar-feedback");

  const filtroInput = container.querySelector("#adm-filtro-email");
  const listaBody = container.querySelector("#adm-lista-body");
  const listaFeedback = container.querySelector("#adm-lista-feedback");

  const modalOverlay = container.querySelector("#adm-edit-modal");
  const modalCloseButton = container.querySelector("#adm-modal-close");
  const modalCancelButton = container.querySelector("#adm-modal-cancelar");
  const editarUidInput = container.querySelector("#adm-editar-uid");
  const editarEmailInput = container.querySelector("#adm-editar-email");
  const editarRoleSelect = container.querySelector("#adm-editar-role");
  const editarAtivoToggle = container.querySelector("#adm-editar-ativo");
  const salvarButton = container.querySelector("#adm-salvar");
  const editarFeedback = container.querySelector("#adm-editar-feedback");

  function setFeedback(element, message, type = "info") {
    const colors = {
      info: "#6b7280",
      success: "#065f46",
      error: "#b91c1c"
    };

    element.style.color = colors[type] || colors.info;
    element.textContent = message;
  }

  function openModal() {
    modalOverlay.classList.add("open");
    modalOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      editarRoleSelect.focus();
    }, 0);
  }

  function closeModal() {
    modalOverlay.classList.remove("open");
    modalOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    editarFeedback.textContent = "";
  }

  function setBuscaResultado(profile, uid) {
    if (!profile || !uid) {
      buscaResultado.innerHTML = "Não encontrado.";
      copiarUidBuscaButton.style.display = "none";
      copiarUidBuscaButton.dataset.uid = "";
      return;
    }

    buscaResultado.innerHTML = `
      <p><strong>UID:</strong> ${uid}</p>
      <p><strong>E-mail:</strong> ${profile.email}</p>
      <p><strong>Perfil:</strong> ${profile.role}</p>
      <p><strong>Ativo:</strong> ${profile.ativo ? "Sim" : "Não"}</p>
      <p><strong>Atualizado em:</strong> ${formatDateTime(profile.updatedAt)}</p>
    `;

    copiarUidBuscaButton.style.display = "inline-flex";
    copiarUidBuscaButton.dataset.uid = uid;
  }

  function enableEdit(uid, profile) {
    editingUid = uid;
    editingOriginalEmail = normalizeEmail(profile?.email);

    editarUidInput.value = uid;
    editarEmailInput.value = profile?.email || "";
    editarRoleSelect.value = profile?.role || "profissional";
    editarAtivoToggle.checked = !!profile?.ativo;

    openModal();
  }

  function renderUserTable() {
    const filter = normalizeEmail(filtroInput.value || "");
    const rows = Object.entries(usersMap)
      .filter(([, profile]) => {
        if (!filter) {
          return true;
        }

        return (profile.email || "").includes(filter);
      })
      .sort((first, second) => {
        const firstEmail = first[1].email || "";
        const secondEmail = second[1].email || "";
        return firstEmail.localeCompare(secondEmail);
      });

    if (rows.length === 0) {
      listaBody.innerHTML = `
        <tr>
          <td colspan="6" class="admin-empty">Nenhum usuário encontrado.</td>
        </tr>
      `;
      return;
    }

    listaBody.innerHTML = rows
      .map(([uid, profile]) => {
        const ativoText = profile.ativo ? "Sim" : "Não";

        return `
          <tr>
            <td>${profile.email || "Não informado"}</td>
            <td>${profile.role}</td>
            <td>${ativoText}</td>
            <td>${uid}</td>
            <td>${formatDateTime(profile.updatedAt)}</td>
            <td>
              <div class="admin-inline-actions">
                <button type="button" data-action="editar" data-uid="${uid}" class="admin-btn admin-btn-secondary">Editar</button>
                <button type="button" data-action="copiar" data-uid="${uid}" class="admin-btn admin-btn-secondary">Copiar UID</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function loadUsers() {
    listaBody.innerHTML = `
      <tr>
        <td colspan="6" class="admin-empty">Carregando usuários...</td>
      </tr>
    `;

    const result = await listUserProfiles();

    if (!result.ok) {
      listaBody.innerHTML = `
        <tr>
          <td colspan="6" class="admin-empty admin-error">Falha ao carregar usuários.</td>
        </tr>
      `;
      return;
    }

    usersMap = result.profiles || {};
    renderUserTable();
  }

  async function handleBuscarUsuario() {
    const email = normalizeEmail(buscaEmailInput.value);

    if (!email) {
      setBuscaResultado(null, "");
      buscaResultado.textContent = "Informe um e-mail válido para busca.";
      return;
    }

    buscaResultado.textContent = "Buscando usuário...";

    const uidResult = await getUidByEmail(email);

    if (!uidResult.ok) {
      buscaResultado.textContent = uidResult.message || "Erro ao consultar índice de e-mail.";
      setBuscaResultado(null, "");
      return;
    }

    if (!uidResult.uid) {
      setBuscaResultado(null, "");
      buscaResultado.textContent = "Não encontrado.";
      return;
    }

    const profileResult = await getUserProfileByUid(uidResult.uid);

    if (!profileResult.ok || !profileResult.profile) {
      setBuscaResultado(null, "");
      buscaResultado.textContent = "UID encontrado, mas o perfil não está configurado.";
      return;
    }

    setBuscaResultado(profileResult.profile, uidResult.uid);
    setFeedback(listaFeedback, "Usuário localizado com sucesso.", "success");
  }

  async function handleCriarUsuario() {
    const email = normalizeEmail(criarEmailInput.value);
    const role = criarRoleSelect.value;
    const ativo = criarAtivoToggle.checked;

    if (!email) {
      setFeedback(criarFeedback, "Informe um e-mail válido.", "error");
      return;
    }

    redefinirButton.style.display = "none";
    redefinirButton.dataset.email = email;

    criarButton.disabled = true;
    setFeedback(criarFeedback, "Criando usuário...", "info");

    const tempPassword = generateTempPassword(14);
    const createResult = await createAuthUser(email, tempPassword);

    if (!createResult.ok) {
      criarButton.disabled = false;

      if (createResult.code === "auth/email-already-in-use") {
        setFeedback(criarFeedback, "Este e-mail já está cadastrado. Você pode enviar redefinição de senha.", "error");
        redefinirButton.style.display = "inline-flex";
        return;
      }

      setFeedback(criarFeedback, createResult.message || "Não foi possível criar usuário no Auth.", "error");
      return;
    }

    const uid = createResult.uid;

    const profileResult = await upsertUserProfile(uid, { email, role, ativo });
    if (!profileResult.ok) {
      criarButton.disabled = false;
      setFeedback(criarFeedback, "Usuário criado no Auth, mas falhou ao salvar perfil no RTDB.", "error");
      return;
    }

    const indexResult = await upsertEmailIndex(email, uid);
    if (!indexResult.ok) {
      criarButton.disabled = false;
      setFeedback(criarFeedback, "Usuário criado, mas falhou ao atualizar índice de e-mail.", "error");
      return;
    }

    const resetResult = await sendPasswordReset(email);

    usersMap[uid] = {
      email,
      role,
      ativo,
      updatedAt: Date.now()
    };

    renderUserTable();

    criarButton.disabled = false;

    if (!resetResult.ok) {
      setFeedback(criarFeedback, "Usuário criado, mas não foi possível enviar o convite por e-mail.", "error");
      return;
    }

    setFeedback(criarFeedback, "Usuário criado. Convite enviado por e-mail.", "success");
  }

  async function handleSalvarEdicao() {
    const uid = String(editarUidInput.value || "").trim();
    const email = normalizeEmail(editarEmailInput.value);
    const role = editarRoleSelect.value;
    const ativo = editarAtivoToggle.checked;

    if (!uid) {
      setFeedback(editarFeedback, "Selecione um usuário para editar.", "error");
      return;
    }

    if (!email) {
      setFeedback(editarFeedback, "E-mail inválido para o usuário selecionado.", "error");
      return;
    }

    salvarButton.disabled = true;
    setFeedback(editarFeedback, "Salvando alterações...", "info");

    const profileResult = await upsertUserProfile(uid, { email, role, ativo });

    if (!profileResult.ok) {
      salvarButton.disabled = false;
      setFeedback(editarFeedback, profileResult.message || "Falha ao salvar perfil.", "error");
      return;
    }

    if (editingOriginalEmail && editingOriginalEmail !== email) {
      await removeEmailIndex(editingOriginalEmail);
    }

    const indexResult = await upsertEmailIndex(email, uid);
    if (!indexResult.ok) {
      salvarButton.disabled = false;
      setFeedback(editarFeedback, indexResult.message || "Falha ao atualizar índice de e-mail.", "error");
      return;
    }

    usersMap[uid] = {
      email,
      role,
      ativo,
      updatedAt: Date.now()
    };

    editingUid = uid;
    editingOriginalEmail = email;

    renderUserTable();
    salvarButton.disabled = false;
    closeModal();
    setFeedback(listaFeedback, "Alterações salvas com sucesso.", "success");
  }

  buscarButton.addEventListener("click", handleBuscarUsuario);
  criarButton.addEventListener("click", handleCriarUsuario);
  salvarButton.addEventListener("click", handleSalvarEdicao);

  redefinirButton.addEventListener("click", async () => {
    const email = normalizeEmail(redefinirButton.dataset.email || criarEmailInput.value);

    if (!email) {
      setFeedback(criarFeedback, "Informe um e-mail válido para redefinição.", "error");
      return;
    }

    setFeedback(criarFeedback, "Enviando redefinição de senha...", "info");
    const resetResult = await sendPasswordReset(email);

    if (!resetResult.ok) {
      setFeedback(criarFeedback, "Não foi possível enviar a redefinição de senha.", "error");
      return;
    }

    setFeedback(criarFeedback, "E-mail de redefinição enviado com sucesso.", "success");
  });

  copiarUidBuscaButton.addEventListener("click", async () => {
    const uid = String(copiarUidBuscaButton.dataset.uid || "").trim();

    if (!uid) {
      return;
    }

    const copied = await copyText(uid);
    if (!copied) {
      buscaResultado.insertAdjacentHTML("beforeend", "<p class='admin-error'>Não foi possível copiar o UID.</p>");
    }
  });

  filtroInput.addEventListener("input", renderUserTable);

  listaBody.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("button[data-action]");

    if (!actionButton) {
      return;
    }

    const action = actionButton.getAttribute("data-action");
    const uid = actionButton.getAttribute("data-uid") || "";
    const profile = usersMap[uid];

    if (!uid || !profile) {
      return;
    }

    if (action === "copiar") {
      const copied = await copyText(uid);
      if (copied) {
        setFeedback(listaFeedback, "UID copiado para a área de transferência.", "success");
      } else {
        setFeedback(listaFeedback, "Não foi possível copiar o UID.", "error");
      }
      return;
    }

    if (action === "editar") {
      enableEdit(uid, profile);
      setFeedback(listaFeedback, "Editando usuário selecionado.", "info");
    }
  });

  modalCloseButton.addEventListener("click", closeModal);
  modalCancelButton.addEventListener("click", closeModal);

  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
      closeModal();
    }
  });

  modalOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalOverlay.classList.contains("open")) {
      closeModal();
    }
  });

  loadUsers();
}
