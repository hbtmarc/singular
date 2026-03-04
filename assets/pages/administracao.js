import {
  createAuthUser,
  sendPasswordReset,
  getUidByEmail,
  getUserProfileByUid,
  listUserProfiles,
  upsertUserProfile,
  upsertEmailIndex,
  removeEmailIndex,
  softDeleteUserProfile,
  restoreUserProfile,
  removeUserFromProject,
  createBackup,
  listBackups,
  restoreBackup,
  deleteBackup,
  listUserAuditLogs
} from "../firebase.js";

import {
  ICON_EDIT, ICON_TRASH, ICON_RESTORE, ICON_USER_X, ICON_COPY, iconBtn
} from "../icons.js";

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

function roleOptionsHtml(selectedRole) {
  return ROLE_OPTIONS.map((role) => {
    const selected = role === selectedRole ? "selected" : "";
    return `<option value="${role}" ${selected}>${role}</option>`;
  }).join("");
}

function buildErrorMessage(result, fallback) {
  const base = String(result?.message || fallback || "Erro inesperado.").trim();
  const code = String(result?.code || result?.errorCode || "").trim();
  const details = String(result?.errorMessage || "").trim();

  const suffix = [];
  if (code) {
    suffix.push(`code=${code}`);
  }
  if (details) {
    suffix.push(`details=${details}`);
  }

  return suffix.length ? `${base} (${suffix.join(" • ")})` : base;
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

export function render(container) {
  const isAdmin = window.__userProfile?.role === "admin";

  if (!isAdmin) {
    container.innerHTML = `
      <section class="admin-page">
        <article class="card">
          <h2>Acesso restrito</h2>
          <p class="admin-card-text">Somente administradores podem gerenciar usuários.</p>
        </article>
      </section>
    `;
    return;
  }

  const RESTORE_PATHS = ["users", "emailIndex", "patients", "professionals", "services", "appointments", "finance"];

  let usersMap = {};
  let backupsList = [];
  let editingUid = "";
  let editingOriginalEmail = "";
  let restoreTargetBackupId = "";

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
            <button id="adm-copiar-uid-busca" type="button" class="admin-btn-icon" title="Copiar UID" aria-label="Copiar UID" style="display:none;">${ICON_COPY}</button>
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
                  <th>Status</th>
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

      <article class="card">
        <h2>Backups do banco</h2>
        <p class="admin-card-text">Crie snapshots internos no RTDB e restaure quando necessário.</p>

        <div class="admin-card-body">
          <label class="admin-label" for="adm-backup-note">Observação (opcional)</label>
          <input id="adm-backup-note" class="admin-input" type="text" placeholder="Ex.: antes de ajuste de permissões" />
          <div class="admin-inline-actions">
            <button id="adm-backup-create" type="button" class="admin-btn admin-btn-primary">Criar backup agora</button>
            <button id="adm-backup-refresh" type="button" class="admin-btn admin-btn-secondary">Atualizar lista</button>
          </div>

          <div id="adm-backup-list" class="admin-result-box admin-backup-list">Carregando backups...</div>
          <p id="adm-backup-feedback" class="admin-feedback"></p>
        </div>
      </article>

      <article class="card">
        <h2>Logs de atividade</h2>
        <p class="admin-card-text">Visualize os últimos eventos registrados por usuário.</p>

        <div class="admin-card-body">
          <label class="admin-label" for="adm-log-user">Usuário</label>
          <div class="admin-inline-actions">
            <select id="adm-log-user" class="admin-input"></select>
            <button id="adm-log-refresh" type="button" class="admin-btn admin-btn-secondary">Atualizar logs</button>
          </div>

          <div id="adm-log-list" class="admin-result-box admin-log-list">Selecione um usuário para carregar os logs.</div>
          <p id="adm-log-feedback" class="admin-feedback"></p>
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

    <div id="adm-backup-restore-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="adm-backup-restore-title">
        <button id="adm-backup-restore-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="adm-backup-restore-title">Confirmar restauração</h2>

        <div class="admin-card-body admin-modal-body">
          <p class="admin-warning-box">A restauração substitui os dados atuais pelos dados do backup selecionado.</p>
          <p id="adm-backup-restore-desc" class="admin-card-text"></p>

          <div>
            <strong>Caminhos restaurados:</strong>
            <ul id="adm-backup-restore-paths" class="admin-restore-paths"></ul>
          </div>

          <p id="adm-backup-restore-feedback" class="admin-feedback"></p>

          <div class="admin-modal-actions">
            <button id="adm-backup-restore-cancel" type="button" class="admin-btn admin-btn-secondary">Cancelar</button>
            <button id="adm-backup-restore-confirm" type="button" class="admin-btn admin-btn-primary">Restaurar agora</button>
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

  const backupNoteInput = container.querySelector("#adm-backup-note");
  const backupCreateButton = container.querySelector("#adm-backup-create");
  const backupRefreshButton = container.querySelector("#adm-backup-refresh");
  const backupListBox = container.querySelector("#adm-backup-list");
  const backupFeedback = container.querySelector("#adm-backup-feedback");

  const logUserSelect = container.querySelector("#adm-log-user");
  const logRefreshButton = container.querySelector("#adm-log-refresh");
  const logListBox = container.querySelector("#adm-log-list");
  const logFeedback = container.querySelector("#adm-log-feedback");

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

  const restoreModal = container.querySelector("#adm-backup-restore-modal");
  const restoreCloseButton = container.querySelector("#adm-backup-restore-close");
  const restoreCancelButton = container.querySelector("#adm-backup-restore-cancel");
  const restoreConfirmButton = container.querySelector("#adm-backup-restore-confirm");
  const restoreDesc = container.querySelector("#adm-backup-restore-desc");
  const restorePathsList = container.querySelector("#adm-backup-restore-paths");
  const restoreFeedback = container.querySelector("#adm-backup-restore-feedback");

  function setFeedback(element, message, type = "info") {
    const colors = {
      info: "#6b7280",
      success: "#065f46",
      error: "#b91c1c"
    };

    element.style.color = colors[type] || colors.info;
    element.textContent = message;
  }

  function openEditModal() {
    modalOverlay.classList.add("open");
    modalOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      editarRoleSelect.focus();
    }, 0);
  }

  function closeEditModal() {
    modalOverlay.classList.remove("open");
    modalOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    editarFeedback.textContent = "";
  }

  function openRestoreModal(backup) {
    if (!backup) {
      return;
    }

    restoreTargetBackupId = backup.backupId;
    const restorePaths = backup.includeLogs ? [...RESTORE_PATHS, "auditLogs"] : [...RESTORE_PATHS];

    restoreDesc.textContent = `${backupDisplayName(backup)} • ${formatDateTime(backup.ts)} • criado por ${backup.createdByEmail || "não informado"}`;
    restorePathsList.innerHTML = restorePaths.map((path) => `<li>${path}</li>`).join("");
    restoreFeedback.textContent = "";

    restoreModal.classList.add("open");
    restoreModal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeRestoreModal() {
    restoreModal.classList.remove("open");
    restoreModal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    restoreTargetBackupId = "";
    restoreFeedback.textContent = "";
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

    openEditModal();
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
        const isDeleted = typeof profile.deletedAt === "number" && profile.deletedAt > 0;
        const statusText = isDeleted ? "Excluído do projeto" : (profile.ativo ? "Ativo" : "Inativo");
        const statusClass = isDeleted ? "status-deleted" : (profile.ativo ? "status-active" : "status-inactive");

        const restoreButton = isDeleted
          ? iconBtn({ icon: ICON_RESTORE, label: "Restaurar", action: "restaurar", dataId: uid })
          : iconBtn({ icon: ICON_TRASH, label: "Excluir", action: "excluir", dataId: uid });

        return `
          <tr>
            <td>${profile.email || "Não informado"}</td>
            <td>${profile.role}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${uid}</td>
            <td>${formatDateTime(profile.updatedAt)}</td>
            <td>
              <div class="admin-inline-actions">
                ${iconBtn({ icon: ICON_EDIT, label: "Editar", action: "editar", dataId: uid })}
                ${restoreButton}
                ${iconBtn({ icon: ICON_USER_X, label: "Remover do projeto", action: "remover", dataId: uid, cls: "admin-btn-icon--danger" })}
                ${iconBtn({ icon: ICON_COPY, label: "Copiar UID", action: "copiar", dataId: uid })}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function formatBackupCounts(counts) {
    const safe = counts && typeof counts === "object" ? counts : {};
    return `P:${Number(safe.patients || 0)} • Prof:${Number(safe.professionals || 0)} • Serv:${Number(safe.services || 0)} • Atend:${Number(safe.appointments || 0)} • Fin:${Number(safe.finance || 0)}`;
  }

  function backupDisplayName(backup) {
    const note = String(backup?.note || "").trim();
    return note || "Backup sem observação";
  }

  function renderBackupsList() {
    if (!backupsList.length) {
      backupListBox.innerHTML = "Nenhum backup encontrado.";
      return;
    }

    backupListBox.innerHTML = backupsList.map((backup, index) => {
      const isOnly = backupsList.length === 1;
      const isLatest = index === 0;
      const deleteHint = (isOnly || isLatest)
        ? "Ao excluir este backup, um backup automático será criado antes."
        : "";

      return `
        <div class="admin-backup-item" data-backup-id="${backup.backupId}">
          <div class="admin-backup-main">
            <strong>${backupDisplayName(backup)}</strong>
            <span>${formatDateTime(backup.ts)}</span>
            <span>${backup.createdByEmail || "não informado"}</span>
          </div>
          <div class="admin-backup-meta">
            <span>${formatBackupCounts(backup.counts)}</span>
            <span>Inclui logs</span>
          </div>
          ${deleteHint ? `<div class="admin-backup-hint">${deleteHint}</div>` : ""}
          <div class="admin-inline-actions">
            <button type="button" class="admin-btn admin-btn-secondary" data-backup-action="restaurar" data-backup-id="${backup.backupId}">Restaurar</button>
            <button type="button" class="admin-btn admin-btn-secondary" data-backup-action="excluir" data-backup-id="${backup.backupId}">Excluir</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderLogUsersOptions() {
    const entries = Object.entries(usersMap)
      .sort((a, b) => String(a[1]?.email || "").localeCompare(String(b[1]?.email || "")));

    const currentUid = String(window.__currentUser?.uid || "").trim();
    const options = [];

    if (currentUid && usersMap[currentUid]) {
      options.push(`<option value="${currentUid}">Atual (${usersMap[currentUid].email || currentUid})</option>`);
    }

    entries.forEach(([uid, profile]) => {
      if (uid === currentUid) {
        return;
      }
      options.push(`<option value="${uid}">${profile.email || uid}</option>`);
    });

    logUserSelect.innerHTML = options.length ? options.join("") : "<option value=''>Sem usuários</option>";
  }

  function renderLogs(logs) {
    if (!logs.length) {
      logListBox.innerHTML = "Nenhum log encontrado para este usuário.";
      return;
    }

    logListBox.innerHTML = logs.map((item) => {
      const meta = item.meta && Object.keys(item.meta).length
        ? JSON.stringify(item.meta)
        : "{}";

      return `
        <div class="admin-log-item">
          <div class="admin-log-row"><strong>${formatDateTime(item.ts)}</strong> • ${item.tipo} • ${item.acao}</div>
          <div class="admin-log-row">${item.resumo || "Sem resumo"}</div>
          <div class="admin-log-meta">${meta}</div>
        </div>
      `;
    }).join("");
  }

  async function loadBackupsAndRender() {
    backupListBox.innerHTML = "Carregando backups...";

    const result = await listBackups(20);
    if (!result.ok) {
      setFeedback(backupFeedback, buildErrorMessage(result, "Não foi possível listar backups."), "error");
      backupListBox.innerHTML = "Falha ao carregar backups.";
      return;
    }

    backupsList = result.backups || [];
    renderBackupsList();
    setFeedback(backupFeedback, `${backupsList.length} backup(s) carregado(s).`, "info");
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
    renderLogUsersOptions();
  }

  async function loadSelectedLogs() {
    const uid = String(logUserSelect.value || "").trim();
    if (!uid) {
      logListBox.innerHTML = "Selecione um usuário para carregar os logs.";
      return;
    }

    logListBox.innerHTML = "Carregando logs...";
    const result = await listUserAuditLogs(uid, 60);

    if (!result.ok) {
      setFeedback(logFeedback, buildErrorMessage(result, "Não foi possível carregar os logs."), "error");
      logListBox.innerHTML = "Falha ao carregar logs.";
      return;
    }

    renderLogs(result.logs || []);
    setFeedback(logFeedback, `${(result.logs || []).length} log(s) carregado(s).`, "info");
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
    renderLogUsersOptions();
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
      ...usersMap[uid],
      email,
      role,
      ativo,
      updatedAt: Date.now()
    };

    editingUid = uid;
    editingOriginalEmail = email;

    renderUserTable();
    renderLogUsersOptions();
    salvarButton.disabled = false;
    closeEditModal();
    setFeedback(listaFeedback, "Alterações salvas com sucesso.", "success");
  }

  async function handleCreateBackup() {
    backupCreateButton.disabled = true;
    setFeedback(backupFeedback, "Criando backup...", "info");

    const result = await createBackup({
      note: backupNoteInput.value,
      includeLogs: true
    });

    backupCreateButton.disabled = false;

    if (!result.ok) {
      setFeedback(backupFeedback, buildErrorMessage(result, "Não foi possível criar backup."), "error");
      return;
    }

    setFeedback(backupFeedback, "Backup criado com sucesso.", "success");
    backupNoteInput.value = "";
    await loadBackupsAndRender();
  }

  async function handleDeleteBackup(backupId) {
    const backup = backupsList.find((item) => item.backupId === backupId);
    if (!backup) {
      return;
    }

    const isOnly = backupsList.length === 1;
    const isLatest = backupsList[0]?.backupId === backupId;
    const warn = (isOnly || isLatest)
      ? "Este backup é o mais recente/único. Um backup automático será criado antes da exclusão."
      : "Deseja excluir este backup?";

    const confirmed = window.confirm(warn);
    if (!confirmed) {
      return;
    }

    setFeedback(backupFeedback, "Excluindo backup...", "info");
    const result = await deleteBackup(backupId);

    if (!result.ok) {
      setFeedback(backupFeedback, buildErrorMessage(result, "Não foi possível excluir backup."), "error");
      return;
    }

    setFeedback(backupFeedback, result.message || "Backup excluído com sucesso.", "success");
    await loadBackupsAndRender();
  }

  async function confirmRestoreBackup() {
    const backupId = restoreTargetBackupId;
    if (!backupId) {
      return;
    }

    restoreConfirmButton.disabled = true;
    setFeedback(restoreFeedback, "Restaurando backup... aguarde.", "info");

    const result = await restoreBackup(backupId);

    restoreConfirmButton.disabled = false;

    if (!result.ok) {
      setFeedback(restoreFeedback, buildErrorMessage(result, "Não foi possível restaurar backup."), "error");
      return;
    }

    setFeedback(restoreFeedback, "Restauração concluída com sucesso.", "success");
    setFeedback(backupFeedback, result.message || "Backup restaurado com sucesso.", "success");

    await loadUsers();
    await loadBackupsAndRender();
    await loadSelectedLogs();

    window.setTimeout(() => {
      closeRestoreModal();
    }, 500);
  }

  buscarButton.addEventListener("click", handleBuscarUsuario);
  criarButton.addEventListener("click", handleCriarUsuario);
  salvarButton.addEventListener("click", handleSalvarEdicao);

  backupCreateButton.addEventListener("click", handleCreateBackup);
  backupRefreshButton.addEventListener("click", loadBackupsAndRender);

  backupListBox.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-backup-action][data-backup-id]");
    if (!button) {
      return;
    }

    const action = button.getAttribute("data-backup-action");
    const backupId = button.getAttribute("data-backup-id") || "";
    const backup = backupsList.find((item) => item.backupId === backupId);

    if (!backup) {
      return;
    }

    if (action === "restaurar") {
      openRestoreModal(backup);
      return;
    }

    if (action === "excluir") {
      await handleDeleteBackup(backupId);
    }
  });

  logRefreshButton.addEventListener("click", loadSelectedLogs);
  logUserSelect.addEventListener("change", loadSelectedLogs);

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
      setFeedback(listaFeedback, copied ? "UID copiado para a área de transferência." : "Não foi possível copiar o UID.", copied ? "success" : "error");
      return;
    }

    if (action === "editar") {
      enableEdit(uid, profile);
      setFeedback(listaFeedback, "Editando usuário selecionado.", "info");
      return;
    }

    if (action === "excluir") {
      const confirmed = window.confirm("Excluir usuário do projeto? Você poderá restaurar depois.");
      if (!confirmed) {
        return;
      }

      const result = await softDeleteUserProfile(uid);
      if (!result.ok) {
        setFeedback(listaFeedback, buildErrorMessage(result, "Não foi possível excluir usuário."), "error");
        return;
      }

      const appliedPatch = result.profilePatch || {
        ativo: false,
        deletedAt: Date.now(),
        deletedBy: "",
        updatedAt: Date.now()
      };

      usersMap[uid] = {
        ...usersMap[uid],
        ...appliedPatch
      };

      renderUserTable();
      setFeedback(listaFeedback, result.message || "Usuário excluído do projeto com sucesso.", "success");
      await loadSelectedLogs();
      return;
    }

    if (action === "restaurar") {
      const result = await restoreUserProfile(uid);
      if (!result.ok) {
        setFeedback(listaFeedback, buildErrorMessage(result, "Não foi possível restaurar usuário."), "error");
        return;
      }

      const appliedPatch = result.profilePatch || {
        ativo: true,
        deletedAt: null,
        deletedBy: "",
        updatedAt: Date.now()
      };

      usersMap[uid] = {
        ...usersMap[uid],
        ...appliedPatch
      };

      renderUserTable();
      setFeedback(listaFeedback, result.message || "Usuário restaurado com sucesso.", "success");
      await loadSelectedLogs();
      return;
    }

    if (action === "remover") {
      const confirmed = window.confirm("Remover usuário definitivamente do projeto (RTDB/índice)?");
      if (!confirmed) {
        return;
      }

      const result = await removeUserFromProject(uid);
      if (!result.ok) {
        setFeedback(listaFeedback, buildErrorMessage(result, "Não foi possível remover usuário do projeto."), "error");
        return;
      }

      delete usersMap[uid];
      renderUserTable();
      renderLogUsersOptions();
      setFeedback(listaFeedback, "Usuário removido do projeto com sucesso.", "success");
      await loadSelectedLogs();
    }
  });

  modalCloseButton.addEventListener("click", closeEditModal);
  modalCancelButton.addEventListener("click", closeEditModal);
  modalOverlay.addEventListener("click", (event) => {
    if (event.target === modalOverlay) {
      closeEditModal();
    }
  });

  modalOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalOverlay.classList.contains("open")) {
      closeEditModal();
    }
  });

  restoreCloseButton.addEventListener("click", closeRestoreModal);
  restoreCancelButton.addEventListener("click", closeRestoreModal);
  restoreConfirmButton.addEventListener("click", confirmRestoreBackup);
  restoreModal.addEventListener("click", (event) => {
    if (event.target === restoreModal) {
      closeRestoreModal();
    }
  });

  restoreModal.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && restoreModal.classList.contains("open")) {
      closeRestoreModal();
    }
  });

  loadUsers().then(() => {
    if (logUserSelect.value) {
      loadSelectedLogs();
    }
  });
  loadBackupsAndRender();
}
