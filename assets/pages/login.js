import { loginWithEmailPassword } from "../firebase.js";

function mapAuthErrorToPtBr(errorCode) {
  const code = errorCode || "";

  if (code === "auth/invalid-email") {
    return "E-mail inválido. Verifique o formato e tente novamente.";
  }

  if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
    return "E-mail ou senha incorretos.";
  }

  if (code === "auth/too-many-requests") {
    return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  }

  if (code === "auth/network-request-failed") {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }

  return "Não foi possível entrar no momento. Tente novamente.";
}

function validateForm(email, senha) {
  if (!email || !senha) {
    return "Preencha e-mail e senha para continuar.";
  }

  if (!email.includes("@") || !email.includes(".")) {
    return "Informe um e-mail válido.";
  }

  if (senha.length < 6) {
    return "A senha deve ter pelo menos 6 caracteres.";
  }

  return "";
}

export function render(container) {
  container.innerHTML = `
    <article class="login-card">
      <div class="login-brand">
        <div class="login-badge">S</div>
        <div>
          <strong>Singular</strong>
          <small>Clínica Multidisciplinar</small>
        </div>
      </div>
      <p class="login-subtitle">Acesse com seu email e senha.</p>

      <form id="login-form" novalidate>
        <div class="login-form-grid">
          <label for="login-email">E-mail</label>
          <input id="login-email" name="email" type="email" autocomplete="email" placeholder="seuemail@clinica.com" class="login-input" />

          <label for="login-senha">Senha</label>
          <input id="login-senha" name="senha" type="password" autocomplete="current-password" placeholder="********" class="login-input" />

          <button type="submit" id="login-submit" class="login-button">
            Entrar
          </button>
        </div>

        <p id="login-feedback" class="login-feedback"></p>
      </form>

      <p class="login-forgot-wrap">
        <a href="#" id="forgot-link" class="login-forgot-link">Esqueci minha senha</a>
      </p>
    </article>
  `;

  const form = container.querySelector("#login-form");
  const feedbackElement = container.querySelector("#login-feedback");
  const submitButton = container.querySelector("#login-submit");
  const forgotLink = container.querySelector("#forgot-link");

  forgotLink.addEventListener("click", (event) => {
    event.preventDefault();
    window.alert("Fluxo de recuperação será implementado depois");
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const email = String(formData.get("email") || "").trim();
    const senha = String(formData.get("senha") || "");

    const validationError = validateForm(email, senha);
    if (validationError) {
      feedbackElement.textContent = validationError;
      return;
    }

    feedbackElement.style.color = "#374151";
    feedbackElement.innerHTML = '<div class="spinner" style="margin:8px auto 0;"></div>';
    submitButton.disabled = true;

    try {
      await loginWithEmailPassword(email, senha);
      feedbackElement.style.color = "#065f46";
      feedbackElement.textContent = "Login realizado com sucesso. Redirecionando...";
      window.location.hash = "#/dashboard";
    } catch (error) {
      feedbackElement.style.color = "#b91c1c";
      feedbackElement.textContent = mapAuthErrorToPtBr(error?.code);
    } finally {
      submitButton.disabled = false;
    }
  });
}
