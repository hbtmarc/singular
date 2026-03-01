import { initFirebase, onUserChanged, logout, readUserProfile, watchUserProfile } from "./firebase.js";

const APP_BUNDLE_VERSION = "20260301-6";
const appBundleVersionFromUrl = new URL(import.meta.url).searchParams.get("v");
const ASSET_VERSION = String(appBundleVersionFromUrl || APP_BUNDLE_VERSION).trim() || APP_BUNDLE_VERSION;

function withAssetVersion(modulePath) {
  const basePath = String(modulePath || "").trim();
  if (!basePath) {
    return basePath;
  }
  const separator = basePath.includes("?") ? "&" : "?";
  return `${basePath}${separator}v=${ASSET_VERSION}`;
}

const routes = {
  "#/login": {
    title: "Acesso",
    subtitle: "Entre com sua conta para continuar",
    modulePath: "./pages/login.js"
  },
  "#/dashboard": {
    title: "Dashboard",
    subtitle: "Visão geral da clínica",
    modulePath: "./pages/dashboard.js"
  },
  "#/pacientes": {
    title: "Pacientes",
    subtitle: "Cadastro e histórico dos pacientes",
    modulePath: "./pages/pacientes.js"
  },
  "#/profissionais": {
    title: "Profissionais",
    subtitle: "Equipe clínica e disponibilidade",
    modulePath: "./pages/profissionais.js"
  },
  "#/atendimentos": {
    title: "Atendimentos",
    subtitle: "Agenda e evolução de atendimentos",
    modulePath: "./pages/atendimentos.js"
  },
  "#/financeiro": {
    title: "Financeiro",
    subtitle: "Receitas, despesas e saldo",
    modulePath: "./pages/financeiro.js"
  },
  "#/configuracoes": {
    title: "Configurações",
    subtitle: "Parâmetros gerais do sistema",
    modulePath: "./pages/configuracoes.js"
  },
  "#/administracao": {
    title: "Administração",
    subtitle: "Gerenciamento de usuários e acessos",
    modulePath: "./pages/administracao.js"
  }
};

const defaultHash = "#/dashboard";
const loginHash = "#/login";

let currentUser = null;
let authResolved = false;
let profileResolved = false;
let profileWatcherUnsubscribe = null;
let transientMessage = "";

const authRoot = document.getElementById("auth-root");
window.__userProfile = null;
window.__currentUser = null;

function setTransientMessage(message) {
  transientMessage = message || "";
}

function consumeTransientMessage() {
  const message = transientMessage;
  transientMessage = "";
  return message;
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const allowedRoles = ["admin", "gerente", "administrativo", "profissional"];
  const role = typeof profile.role === "string" ? profile.role : null;

  if (!role || !allowedRoles.includes(role)) {
    return null;
  }

  return {
    email: typeof profile.email === "string" ? profile.email : "",
    role,
    ativo: profile.ativo === true
  };
}

function hasActiveProfile() {
  return !!(window.__userProfile && window.__userProfile.ativo === true);
}

function getAllowedRoutes() {
  if (!currentUser) {
    return new Set([loginHash]);
  }

  if (!hasActiveProfile()) {
    return new Set(["#/dashboard", "#/configuracoes"]);
  }

  const role = window.__userProfile.role;

  if (role === "admin") {
    return new Set(Object.keys(routes).filter((routeKey) => routeKey !== loginHash));
  }

  if (role === "gerente") {
    return new Set(["#/dashboard", "#/pacientes", "#/profissionais", "#/atendimentos", "#/financeiro", "#/configuracoes"]);
  }

  if (role === "administrativo") {
    return new Set(["#/dashboard", "#/pacientes", "#/profissionais", "#/atendimentos", "#/configuracoes"]);
  }

  if (role === "profissional") {
    return new Set(["#/dashboard", "#/atendimentos", "#/configuracoes"]);
  }

  return new Set(["#/dashboard", "#/configuracoes"]);
}

function getProfileWarningMessage() {
  if (!currentUser) {
    return "";
  }

  if (!hasActiveProfile()) {
    return "Perfil não configurado/ativo. Procure o gestor.";
  }

  return "";
}

async function loadProfileForUser(user) {
  if (!user?.uid) {
    window.__userProfile = null;
    profileResolved = true;
    return;
  }

  profileResolved = false;
  const result = await readUserProfile(user.uid);
  window.__userProfile = normalizeProfile(result.profile);
  profileResolved = true;
}

function startProfileWatcher(user) {
  if (profileWatcherUnsubscribe) {
    profileWatcherUnsubscribe();
    profileWatcherUnsubscribe = null;
  }

  if (!user?.uid) {
    return;
  }

  profileWatcherUnsubscribe = watchUserProfile(user.uid, (profile) => {
    window.__userProfile = normalizeProfile(profile);
    updateSidebarForAuth();
    renderTopbarActions();
    renderRoute();
  });
}

function ensureHash() {
  if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = currentUser ? defaultHash : loginHash;
  }
}

function setAuthMode(enabled) {
  const isEnabled = !!enabled;
  document.body.classList.toggle("auth-mode", isEnabled);

  if (!authRoot) {
    return;
  }

  if (isEnabled) {
    authRoot.innerHTML = "";
  } else {
    authRoot.innerHTML = "";
  }
}

function setActiveMenu(hash) {
  const links = document.querySelectorAll("[data-route]");
  links.forEach((link) => {
    const isActive = link.getAttribute("href") === hash;
    link.classList.toggle("active", isActive);
  });
}

function applyMenuGating() {
  const links = document.querySelectorAll("[data-route]");
  const allowedRoutes = getAllowedRoutes();

  links.forEach((link) => {
    const route = link.getAttribute("href");
    const shouldShow = currentUser && allowedRoutes.has(route);
    link.style.display = shouldShow ? "" : "none";
  });
}

function renderTopbarActions() {
  const actionsElement = document.getElementById("topbar-actions");

  if (!actionsElement) {
    return;
  }

  if (!currentUser || document.body.classList.contains("auth-mode")) {
    actionsElement.innerHTML = "";
    return;
  }

  const emailPrefix = currentUser.email ? currentUser.email.split("@")[0] : "";
  const greetingText = emailPrefix ? `Olá, ${emailPrefix}!` : "Olá!";

  actionsElement.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="color:#4b5563; font-size:14px;">${greetingText}</span>
      <button id="logout-button" type="button" style="padding:8px 10px; border:1px solid #d1d5db; border-radius:8px; background:#fff; cursor:pointer;">Sair</button>
    </div>
  `;

  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      try {
        await logout();
        window.location.hash = loginHash;
      } catch (error) {
        window.alert("Não foi possível sair no momento. Tente novamente.");
      }
    });
  }
}

function updateSidebarForAuth() {
  const menuElement = document.querySelector(".menu");
  const footerElement = document.querySelector(".sidebar-footer");

  if (!menuElement || !footerElement) {
    return;
  }

  if (currentUser && !document.body.classList.contains("auth-mode")) {
    menuElement.style.display = "";
    applyMenuGating();
    footerElement.textContent = "Sessão ativa";
  } else {
    menuElement.style.display = "none";
    footerElement.textContent = "Faça login para acessar os módulos";
  }
}

function isProtectedRoute(hash) {
  return hash !== loginHash;
}

async function renderRoute() {
  ensureHash();

  const hash = window.location.hash;
  const fallbackHash = currentUser ? defaultHash : loginHash;
  const route = routes[hash] || routes[fallbackHash];

  if (!routes[hash]) {
    window.location.hash = fallbackHash;
    return;
  }

  if (!authResolved) {
    setAuthMode(true);
    if (authRoot) {
      authRoot.innerHTML = "<article class=\"card\" style=\"max-width:420px; width:100%;\"><h2 style=\"margin-top:0;\">Carregando sessão</h2><p>Aguarde enquanto validamos seu acesso.</p></article>";
    }
    return;
  }

  if (!currentUser && isProtectedRoute(hash)) {
    window.location.hash = loginHash;
    return;
  }

  if (currentUser && hash === loginHash && profileResolved) {
    window.location.hash = defaultHash;
    return;
  }

  if (hash === loginHash) {
    setAuthMode(true);
    renderTopbarActions();
    updateSidebarForAuth();

    try {
      const loginModule = await import(withAssetVersion(routes[loginHash].modulePath));
      if (authRoot) {
        loginModule.render(authRoot);
      }
    } catch (error) {
      if (authRoot) {
        authRoot.innerHTML = "<article class=\"card\" style=\"max-width:420px; width:100%;\"><h2 style=\"margin-top:0;\">Erro ao carregar login</h2><p>Não foi possível abrir a tela de acesso.</p></article>";
      }
    }

    return;
  }

  if (currentUser && !profileResolved) {
    setAuthMode(false);
    const contentElement = document.getElementById("page-content");
    if (contentElement) {
      contentElement.innerHTML = "<div class=\"card\"><h2>Carregando acesso</h2><p>Aguarde enquanto validamos seu perfil no RTDB.</p></div>";
    }
    return;
  }

  const allowedRoutes = getAllowedRoutes();

  if (!allowedRoutes.has(hash)) {
    const role = window.__userProfile?.role;

    if (hash === "#/administracao" && !(role === "admin" && hasActiveProfile())) {
      setTransientMessage("Acesso restrito ao Administrador.");
    } else if (hash === "#/financeiro" && role !== "gerente" && role !== "admin") {
      setTransientMessage("Acesso restrito ao perfil Gerente.");
    } else if (!hasActiveProfile()) {
      setTransientMessage("Perfil não configurado/ativo. Procure o gestor.");
    } else {
      setTransientMessage("Você não tem permissão para acessar este módulo.");
    }

    window.location.hash = defaultHash;
    return;
  }

  setAuthMode(false);

  setActiveMenu(hash);
  renderTopbarActions();
  updateSidebarForAuth();

  const titleElement = document.getElementById("page-title");
  const subtitleElement = document.getElementById("page-subtitle");
  const contentElement = document.getElementById("page-content");

  titleElement.textContent = route.title;
  subtitleElement.textContent = route.subtitle;

  contentElement.innerHTML = "";

  try {
    const pageModule = await import(withAssetVersion(route.modulePath));
    pageModule.render(contentElement);

    const profileWarning = getProfileWarningMessage();
    const message = consumeTransientMessage() || profileWarning;

    if (message) {
      contentElement.insertAdjacentHTML(
        "afterbegin",
        `<div class="card" style="border-left:4px solid #f59e0b; margin-bottom:12px;"><p style="margin:0; color:#92400e;">${message}</p></div>`
      );
    }
  } catch (error) {
    contentElement.innerHTML = "<div class=\"card\"><h2>Erro ao carregar página</h2><p>Não foi possível carregar este módulo.</p></div>";
    console.error("Erro no roteamento:", error);
  }
}

window.addEventListener("hashchange", renderRoute);

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const firebaseResult = await initFirebase();
    window.__firebaseStatus = {
      ok: firebaseResult.ok,
      message: firebaseResult.message,
      projectId: firebaseResult.app?.options?.projectId,
      hasAnalytics: !!firebaseResult.analytics
    };
  } catch (error) {
    window.__firebaseStatus = {
      ok: false,
      message: "Falha ao iniciar o Firebase.",
      hasAnalytics: false
    };
  }

  onUserChanged(async (user) => {
    if (profileWatcherUnsubscribe) {
      profileWatcherUnsubscribe();
      profileWatcherUnsubscribe = null;
    }

    currentUser = user;
    window.__currentUser = user
      ? {
          uid: user.uid,
          email: user.email || ""
        }
      : null;

    if (!user) {
      window.__userProfile = null;
      profileResolved = true;
    } else {
      await loadProfileForUser(user);
      startProfileWatcher(user);
    }

    authResolved = true;
    renderTopbarActions();
    updateSidebarForAuth();
    renderRoute();
  });

  setAuthMode(true);
  updateSidebarForAuth();
  renderRoute();
});
