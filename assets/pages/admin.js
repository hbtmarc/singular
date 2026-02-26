import { getUserProfile, listUserProfiles, upsertUserProfile } from "../firebase.js";

const ROLE_OPTIONS = ["admin", "gerente", "administrativo", "profissional"];

function profileLabel(profile) {
  if (!profile) {
    return "Não encontrado";
  }

  const ativo = profile.ativo ? "Sim" : "Não";
  return `Role: ${profile.role} • Ativo: ${ativo}`;
}

function sanitizeUid(value) {
  return String(value || "").trim();
}

export function render(container) {
  let profilesMap = {};

  container.innerHTML = `
    <article class="card">
      <h2>Gerenciar usuário por UID</h2>
      <p>Informe um UID para consultar e atualizar o perfil de acesso no RTDB.</p>

      <div style="display:grid; gap:10px; max-width:620px;">
        <label for="admin-uid"><strong>UID</strong></label>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <input id="admin-uid" type="text" placeholder="Cole o UID do usuário" style="flex:1; min-width:260px; padding:10px; border:1px solid #d1d5db; border-radius:8px;" />
          <button id="admin-buscar" type="button" style="padding:10px 12px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer;">Buscar</button>
        </div>

        <p id="admin-status" style="margin:0; color:#6b7280;">Perfil atual: Não encontrado</p>

        <label for="admin-role"><strong>Role</strong></label>
        <select id="admin-role" style="padding:10px; border:1px solid #d1d5db; border-radius:8px;">
          ${ROLE_OPTIONS.map((role) => `<option value="${role}">${role}</option>`).join("")}
        </select>

        <label for="admin-ativo" style="display:flex; align-items:center; gap:8px;">
          <input id="admin-ativo" type="checkbox" checked />
          <span>Usuário ativo</span>
        </label>

        <button id="admin-salvar" type="button" style="width:fit-content; padding:10px 14px; border:0; border-radius:8px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer;">Salvar alterações</button>

        <p id="admin-feedback" style="min-height:20px; margin:0; color:#6b7280;"></p>
      </div>
    </article>

    <article class="card">
      <h2>Usuários cadastrados</h2>
      <p>Selecione uma linha para carregar o usuário no editor.</p>

      <div style="overflow:auto;">
        <table style="width:100%; border-collapse:collapse; min-width:560px;">
          <thead>
            <tr>
              <th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:8px;">UID</th>
              <th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:8px;">Role</th>
              <th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:8px;">Ativo</th>
              <th style="text-align:left; border-bottom:1px solid #e5e7eb; padding:8px;">Ações</th>
            </tr>
          </thead>
          <tbody id="admin-users-body">
            <tr>
              <td colspan="4" style="padding:10px; color:#6b7280;">Carregando usuários...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  `;

  const uidInput = container.querySelector("#admin-uid");
  const buscarButton = container.querySelector("#admin-buscar");
  const roleSelect = container.querySelector("#admin-role");
  const ativoCheckbox = container.querySelector("#admin-ativo");
  const salvarButton = container.querySelector("#admin-salvar");
  const statusText = container.querySelector("#admin-status");
  const feedbackText = container.querySelector("#admin-feedback");
  const usersBody = container.querySelector("#admin-users-body");

  function setFeedback(message, type = "info") {
    const colors = {
      info: "#6b7280",
      success: "#065f46",
      error: "#b91c1c"
    };

    feedbackText.style.color = colors[type] || colors.info;
    feedbackText.textContent = message;
  }

  function applyProfileToEditor(uid, profile) {
    uidInput.value = uid || "";

    if (profile && ROLE_OPTIONS.includes(profile.role)) {
      roleSelect.value = profile.role;
      ativoCheckbox.checked = !!profile.ativo;
      statusText.textContent = `Perfil atual: ${profileLabel(profile)}`;
      return;
    }

    roleSelect.value = "profissional";
    ativoCheckbox.checked = true;
    statusText.textContent = "Perfil atual: Não encontrado";
  }

  function renderUsersTable() {
    const uids = Object.keys(profilesMap);

    if (uids.length === 0) {
      usersBody.innerHTML = `
        <tr>
          <td colspan="4" style="padding:10px; color:#6b7280;">Nenhum usuário cadastrado no RTDB.</td>
        </tr>
      `;
      return;
    }

    usersBody.innerHTML = uids
      .sort((a, b) => a.localeCompare(b))
      .map((uid) => {
        const profile = profilesMap[uid];
        const ativoText = profile.ativo ? "Sim" : "Não";

        return `
          <tr data-uid="${uid}" style="cursor:pointer;">
            <td style="border-bottom:1px solid #f3f4f6; padding:8px;">${uid}</td>
            <td style="border-bottom:1px solid #f3f4f6; padding:8px;">${profile.role}</td>
            <td style="border-bottom:1px solid #f3f4f6; padding:8px;">${ativoText}</td>
            <td style="border-bottom:1px solid #f3f4f6; padding:8px;">
              <button type="button" data-copy-uid="${uid}" style="padding:6px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer;">Copiar UID</button>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function carregarUsuarios() {
    usersBody.innerHTML = `
      <tr>
        <td colspan="4" style="padding:10px; color:#6b7280;">Carregando usuários...</td>
      </tr>
    `;

    const result = await listUserProfiles();

    if (!result.ok) {
      profilesMap = {};
      usersBody.innerHTML = `
        <tr>
          <td colspan="4" style="padding:10px; color:#b91c1c;">Não foi possível carregar os usuários.</td>
        </tr>
      `;
      setFeedback(result.message || "Erro ao listar usuários.", "error");
      return;
    }

    profilesMap = result.profiles || {};
    renderUsersTable();
  }

  async function buscarUsuarioPorUid() {
    const uid = sanitizeUid(uidInput.value);

    if (!uid) {
      setFeedback("Informe um UID para buscar.", "error");
      return;
    }

    setFeedback("Consultando perfil...", "info");
    const result = await getUserProfile(uid);

    if (!result.ok) {
      setFeedback(result.message || "Não foi possível consultar o usuário.", "error");
      return;
    }

    if (!result.profile) {
      applyProfileToEditor(uid, null);
      setFeedback("Usuário não encontrado. Você pode criar um novo perfil e salvar.", "info");
      return;
    }

    applyProfileToEditor(uid, result.profile);
    setFeedback("Perfil carregado com sucesso.", "success");
  }

  async function salvarUsuarioPorUid() {
    const uid = sanitizeUid(uidInput.value);

    if (!uid) {
      setFeedback("Informe um UID válido antes de salvar.", "error");
      return;
    }

    const role = roleSelect.value;
    const ativo = ativoCheckbox.checked;

    salvarButton.disabled = true;
    setFeedback("Salvando alterações...", "info");

    const result = await upsertUserProfile(uid, { role, ativo });

    salvarButton.disabled = false;

    if (!result.ok) {
      setFeedback(result.message || "Não foi possível salvar o perfil.", "error");
      return;
    }

    profilesMap[uid] = {
      role,
      ativo,
      updatedAt: Date.now()
    };

    renderUsersTable();
    applyProfileToEditor(uid, profilesMap[uid]);
    setFeedback("Perfil salvo com sucesso.", "success");
  }

  usersBody.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-uid]");

    if (copyButton) {
      event.stopPropagation();
      const uidToCopy = copyButton.getAttribute("data-copy-uid") || "";

      try {
        await navigator.clipboard.writeText(uidToCopy);
      } catch (error) {
        const input = document.createElement("input");
        input.value = uidToCopy;
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        document.body.removeChild(input);
      }

      setFeedback("UID copiado para a área de transferência.", "success");
      return;
    }

    const row = event.target.closest("tr[data-uid]");

    if (!row) {
      return;
    }

    const uid = row.getAttribute("data-uid") || "";
    const profile = profilesMap[uid] || null;
    applyProfileToEditor(uid, profile);
    setFeedback("Usuário carregado no editor.", "info");
  });

  buscarButton.addEventListener("click", buscarUsuarioPorUid);
  salvarButton.addEventListener("click", salvarUsuarioPorUid);

  carregarUsuarios();
}
