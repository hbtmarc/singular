export function render(container) {
  const status = window.__firebaseStatus || {
    ok: false,
    message: "Firebase ainda não inicializado.",
    projectId: undefined,
    hasAnalytics: false
  };

  const analyticsTexto = status.hasAnalytics ? "Ativo" : "Indisponível";
  const currentUser = window.__currentUser || null;
  const profile = window.__userProfile || null;
  const roleText = profile?.role || "Não configurado";
  const ativoText = profile ? (profile.ativo ? "Sim" : "Não") : "Não";
  const uid = currentUser?.uid || "Não disponível";
  const email = profile?.email || currentUser?.email || "Não disponível";

  container.innerHTML = `
    <article class="card">
      <h2>Configurações gerais</h2>
      <p>Defina dados da clínica, horário de funcionamento e preferências do sistema.</p>
      <ul>
        <li>Nome da clínica</li>
        <li>Horário padrão</li>
        <li>Intervalo entre atendimentos</li>
      </ul>
    </article>

    <article class="card">
      <h2>Observação</h2>
      <p>Este módulo foi preparado com estrutura simples para expansão futura.</p>
    </article>

    <article class="card">
      <h2>Status do Firebase</h2>
      ${status.ok
        ? `<p><strong>Conectado</strong></p>
           <p>Project ID: ${status.projectId || "Não informado"}</p>
           <p>Analytics: ${analyticsTexto}</p>`
        : `<p><strong>Desconectado</strong></p>
           <p>${status.message}</p>`
      }
    </article>

    <article class="card">
      <h2>Meu acesso</h2>
      <p><strong>E-mail:</strong> ${email}</p>
      <p>
        <strong>UID:</strong> <span id="meu-uid">${uid}</span>
        <button id="copiar-uid" type="button" style="margin-left:8px; padding:6px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer;">Copiar UID</button>
      </p>
      <p><strong>Perfil atual:</strong> ${roleText}</p>
      <p><strong>Ativo:</strong> ${ativoText}</p>
      <p>No RTDB, crie /users/{UID} com role e ativo=true</p>
      <p>Se você for admin, gerencie acessos em Administração.</p>
    </article>
  `;

  const copyButton = container.querySelector("#copiar-uid");

  if (!copyButton) {
    return;
  }

  copyButton.addEventListener("click", async () => {
    if (!currentUser?.uid) {
      window.alert("UID não disponível para cópia.");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentUser.uid);
      copyButton.textContent = "UID copiado";
      window.setTimeout(() => {
        copyButton.textContent = "Copiar UID";
      }, 1500);
    } catch (error) {
      const input = document.createElement("input");
      input.value = currentUser.uid;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      copyButton.textContent = "UID copiado";
      window.setTimeout(() => {
        copyButton.textContent = "Copiar UID";
      }, 1500);
    }
  });
}
