import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-analytics.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getDatabase,
  ref as dbRef,
  get,
  onValue,
  set,
  update,
  push
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCFYAS7wtdHCoprhX1Vdx505j2ybj1IAwA",
  authDomain: "singular-marc35.firebaseapp.com",
  databaseURL: "https://singular-marc35-default-rtdb.firebaseio.com",
  projectId: "singular-marc35",
  storageBucket: "singular-marc35.firebasestorage.app",
  messagingSenderId: "117987537773",
  appId: "1:117987537773:web:beb2caf7bf4dfb73732064",
  measurementId: "G-YRB111S99R"
};

let firebaseApp = null;
let firebaseAnalytics = null;
let firebaseAuth = null;
let firebaseDatabase = null;
let firebaseMessage = "Firebase ainda não inicializado.";

let secondaryApp = null;
let secondaryAuth = null;
let lastPatientsImportId = "";

const ALLOWED_ROLES = ["admin", "gerente", "administrativo", "profissional"];

function getOrCreateApp() {
  const apps = getApps();

  if (apps.length > 0) {
    firebaseApp = apps.find((app) => app.name === "[DEFAULT]") || apps[0];
    return firebaseApp;
  }

  firebaseApp = initializeApp(firebaseConfig);
  return firebaseApp;
}

function getOrCreateSecondaryApp() {
  const existingSecondary = getApps().find((app) => app.name === "secondary");

  if (existingSecondary) {
    secondaryApp = existingSecondary;
    return secondaryApp;
  }

  secondaryApp = initializeApp(firebaseConfig, "secondary");
  return secondaryApp;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUserProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return null;
  }

  const role = typeof profile.role === "string" ? profile.role : "";
  const email = normalizeEmail(profile.email);

  if (!ALLOWED_ROLES.includes(role) || !email) {
    return null;
  }

  return {
    email,
    role,
    ativo: profile.ativo === true,
    updatedAt: typeof profile.updatedAt === "number" ? profile.updatedAt : null,
    deletedAt: typeof profile.deletedAt === "number" ? profile.deletedAt : null,
    deletedBy: typeof profile.deletedBy === "string" ? profile.deletedBy : ""
  };
}

function getCurrentUid() {
  const auth = getAuthInstance();
  return String(auth?.currentUser?.uid || "").trim();
}

function isPermissionDeniedError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code.includes("PERMISSION_DENIED") || message.includes("permission_denied");
}

function getFirebaseErrorMessage(error, fallbackMessage) {
  if (isPermissionDeniedError(error)) {
    return "Permissão negada no RTDB. Verifique as regras para escrita em /users.";
  }

  return fallbackMessage;
}

async function updateWithFallbackPatches(reference, patches) {
  const attempts = Array.isArray(patches) ? patches : [];

  if (!attempts.length) {
    throw new Error("Nenhum patch informado para updateWithFallbackPatches.");
  }

  let lastError = null;

  for (const patch of attempts) {
    try {
      await update(reference, patch);
      return {
        ok: true,
        patch
      };
    } catch (error) {
      lastError = error;

      if (!isPermissionDeniedError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Falha ao atualizar registro no RTDB.");
}

export function encodeEmailKey(email) {
  const normalized = normalizeEmail(email);
  return normalized.replaceAll(".", ",");
}

export async function initFirebase() {
  try {
    const existingApps = getApps();
    const wasReused = existingApps.length > 0;

    const app = getOrCreateApp();
    firebaseAuth = getAuth(app);
    firebaseDatabase = getDatabase(app);

    let analytics = null;
    let analyticsMessage = "Analytics indisponível.";

    try {
      const analyticsSupported = await isAnalyticsSupported();

      if (analyticsSupported) {
        analytics = getAnalytics(app);
        analyticsMessage = "Analytics ativo.";
      } else {
        analyticsMessage = "Analytics não suportado neste ambiente.";
      }
    } catch (error) {
      analytics = null;
      analyticsMessage = "Analytics indisponível no momento.";
    }

    firebaseAnalytics = analytics;
    firebaseMessage = wasReused
      ? `Firebase reutilizado com sucesso. ${analyticsMessage}`
      : `Firebase inicializado com sucesso. ${analyticsMessage}`;

    return {
      ok: true,
      app,
      auth: firebaseAuth,
      analytics,
      message: firebaseMessage
    };
  } catch (error) {
    firebaseApp = null;
    firebaseAnalytics = null;
    firebaseAuth = null;
    firebaseDatabase = null;
    firebaseMessage = "Não foi possível inicializar o Firebase.";

    return {
      ok: false,
      app: null,
      auth: null,
      analytics: null,
      message: firebaseMessage
    };
  }
}

export function getFirebaseApp() {
  return firebaseApp;
}

export function getFirebaseInfo() {
  if (!firebaseApp) {
    return {
      ok: false,
      projectId: null,
      message: firebaseMessage,
      hasAnalytics: false
    };
  }

  return {
    ok: true,
    projectId: firebaseApp.options?.projectId || firebaseConfig.projectId,
    message: firebaseMessage,
    hasAnalytics: !!firebaseAnalytics
  };
}

export function getAuthInstance() {
  if (!firebaseAuth) {
    const app = getOrCreateApp();
    firebaseAuth = getAuth(app);
  }

  return firebaseAuth;
}

function getSecondaryAuthInstance() {
  if (!secondaryAuth) {
    const app = getOrCreateSecondaryApp();
    secondaryAuth = getAuth(app);
  }

  return secondaryAuth;
}

export function getDatabaseInstance() {
  if (!firebaseDatabase) {
    const app = getOrCreateApp();
    firebaseDatabase = getDatabase(app);
  }

  return firebaseDatabase;
}

export function onUserChanged(callback) {
  const auth = getAuthInstance();
  return onAuthStateChanged(auth, callback);
}

export async function loginWithEmailPassword(email, password) {
  const auth = getAuthInstance();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  const auth = getAuthInstance();
  return signOut(auth);
}

export async function getUserProfileByUid(uid) {
  if (!uid) {
    return {
      ok: false,
      profile: null,
      message: "UID não informado para consulta de perfil."
    };
  }

  try {
    const database = getDatabaseInstance();
    const snapshot = await get(dbRef(database, `users/${uid}`));

    if (!snapshot.exists()) {
      return {
        ok: true,
        profile: null,
        message: "Perfil não encontrado."
      };
    }

    return {
      ok: true,
      profile: normalizeUserProfile(snapshot.val()),
      message: "Perfil carregado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      profile: null,
      message: "Não foi possível consultar o perfil no RTDB."
    };
  }
}

export async function readUserProfile(uid) {
  const result = await getUserProfileByUid(uid);

  if (!result.ok) {
    return result;
  }

  if (!result.profile) {
    return {
      ok: true,
      profile: null,
      message: result.message
    };
  }

  return {
    ok: true,
    profile: {
      email: result.profile.email,
      role: result.profile.role,
      ativo: result.profile.ativo
    },
    message: result.message
  };
}

export function watchUserProfile(uid, callback) {
  if (!uid || typeof callback !== "function") {
    return () => {};
  }

  const database = getDatabaseInstance();
  const profileRef = dbRef(database, `users/${uid}`);

  const unsubscribe = onValue(
    profileRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }

      callback(normalizeUserProfile(snapshot.val()));
    },
    () => {
      callback(null);
    }
  );

  return unsubscribe;
}

export async function getUidByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      ok: false,
      uid: null,
      message: "E-mail não informado para consulta."
    };
  }

  try {
    const database = getDatabaseInstance();
    const key = encodeEmailKey(normalizedEmail);
    const snapshot = await get(dbRef(database, `emailIndex/${key}`));

    if (!snapshot.exists()) {
      return {
        ok: true,
        uid: null,
        message: "E-mail não encontrado no índice."
      };
    }

    const indexData = snapshot.val();
    const uid = typeof indexData?.uid === "string" ? indexData.uid : null;

    if (uid) {
      const profileSnap = await get(dbRef(database, `users/${uid}`));
      if (!profileSnap.exists()) {
        await set(dbRef(database, `emailIndex/${key}`), null);
        return {
          ok: true,
          uid: null,
          message: "Índice de e-mail inconsistente foi corrigido automaticamente."
        };
      }
    }

    return {
      ok: true,
      uid,
      message: uid ? "UID encontrado com sucesso." : "Índice sem UID válido."
    };
  } catch (error) {
    return {
      ok: false,
      uid: null,
      message: "Não foi possível consultar o índice de e-mail."
    };
  }
}

export async function upsertUserProfile(uid, profile) {
  if (!uid) {
    return {
      ok: false,
      message: "UID não informado para salvar perfil."
    };
  }

  const email = normalizeEmail(profile?.email);
  const role = typeof profile?.role === "string" ? profile.role : "";
  const ativo = profile?.ativo === true;

  if (!email) {
    return {
      ok: false,
      message: "E-mail é obrigatório para salvar o perfil."
    };
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return {
      ok: false,
      message: "Role inválida para o perfil."
    };
  }

  try {
    const database = getDatabaseInstance();
    const currentSnap = await get(dbRef(database, `users/${uid}`));
    const current = currentSnap.exists() ? currentSnap.val() : {};

    await set(dbRef(database, `users/${uid}`), {
      email,
      role,
      ativo,
      deletedAt: ativo ? null : (typeof current?.deletedAt === "number" ? current.deletedAt : null),
      deletedBy: ativo ? "" : (typeof current?.deletedBy === "string" ? current.deletedBy : ""),
      updatedAt: Date.now()
    });

    return {
      ok: true,
      message: "Perfil salvo com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível salvar o perfil no RTDB."
    };
  }
}

export async function softDeleteUserProfile(uid) {
  const normalizedUid = String(uid || "").trim();

  if (!normalizedUid) {
    return {
      ok: false,
      message: "UID não informado para exclusão."
    };
  }

  try {
    const database = getDatabaseInstance();
    const userReference = dbRef(database, `users/${normalizedUid}`);
    const snapshot = await get(userReference);

    if (!snapshot.exists()) {
      return {
        ok: false,
        message: "Perfil não encontrado no projeto."
      };
    }

    const now = Date.now();
    const currentUid = getCurrentUid();
    const fallbackAttempts = [
      {
        ativo: false,
        deletedAt: now,
        deletedBy: currentUid,
        updatedAt: now
      },
      {
        ativo: false,
        deletedAt: now,
        updatedAt: now
      },
      {
        ativo: false,
        updatedAt: now
      }
    ];

    const updateResult = await updateWithFallbackPatches(userReference, fallbackAttempts);
    const appliedPatch = updateResult.patch || fallbackAttempts[fallbackAttempts.length - 1];

    const usedCompatibilityPatch = !Object.prototype.hasOwnProperty.call(appliedPatch, "deletedAt");

    return {
      ok: true,
      message: usedCompatibilityPatch
        ? "Usuário atualizado em modo compatível com as regras atuais do RTDB."
        : "Usuário excluído do projeto (soft delete).",
      profilePatch: {
        ativo: appliedPatch.ativo === true,
        deletedAt: typeof appliedPatch.deletedAt === "number" ? appliedPatch.deletedAt : null,
        deletedBy: typeof appliedPatch.deletedBy === "string" ? appliedPatch.deletedBy : "",
        updatedAt: typeof appliedPatch.updatedAt === "number" ? appliedPatch.updatedAt : now
      }
    };
  } catch (error) {
    return {
      ok: false,
      message: getFirebaseErrorMessage(error, "Não foi possível excluir usuário do projeto."),
      code: String(error?.code || "")
    };
  }
}

export async function restoreUserProfile(uid) {
  const normalizedUid = String(uid || "").trim();

  if (!normalizedUid) {
    return {
      ok: false,
      message: "UID não informado para restauração."
    };
  }

  try {
    const database = getDatabaseInstance();
    const userReference = dbRef(database, `users/${normalizedUid}`);
    const snapshot = await get(userReference);

    if (!snapshot.exists()) {
      return {
        ok: false,
        message: "Perfil não encontrado no projeto."
      };
    }

    const now = Date.now();
    const fallbackAttempts = [
      {
        ativo: true,
        deletedAt: null,
        deletedBy: "",
        updatedAt: now
      },
      {
        ativo: true,
        deletedAt: null,
        updatedAt: now
      },
      {
        ativo: true,
        updatedAt: now
      }
    ];

    const updateResult = await updateWithFallbackPatches(userReference, fallbackAttempts);
    const appliedPatch = updateResult.patch || fallbackAttempts[fallbackAttempts.length - 1];

    const usedCompatibilityPatch = !Object.prototype.hasOwnProperty.call(appliedPatch, "deletedAt");

    return {
      ok: true,
      message: usedCompatibilityPatch
        ? "Usuário restaurado em modo compatível com as regras atuais do RTDB."
        : "Usuário restaurado com sucesso.",
      profilePatch: {
        ativo: appliedPatch.ativo === true,
        deletedAt: Object.prototype.hasOwnProperty.call(appliedPatch, "deletedAt")
          ? (typeof appliedPatch.deletedAt === "number" ? appliedPatch.deletedAt : null)
          : null,
        deletedBy: Object.prototype.hasOwnProperty.call(appliedPatch, "deletedBy")
          ? (typeof appliedPatch.deletedBy === "string" ? appliedPatch.deletedBy : "")
          : "",
        updatedAt: typeof appliedPatch.updatedAt === "number" ? appliedPatch.updatedAt : now
      }
    };
  } catch (error) {
    return {
      ok: false,
      message: getFirebaseErrorMessage(error, "Não foi possível restaurar usuário."),
      code: String(error?.code || "")
    };
  }
}

export async function removeUserFromProject(uid) {
  const normalizedUid = String(uid || "").trim();

  if (!normalizedUid) {
    return {
      ok: false,
      message: "UID não informado para remoção."
    };
  }

  try {
    const database = getDatabaseInstance();
    const snapshot = await get(dbRef(database, `users/${normalizedUid}`));

    if (!snapshot.exists()) {
      return {
        ok: true,
        message: "Perfil já não existia no projeto."
      };
    }

    const profile = normalizeUserProfile(snapshot.val());
    if (profile?.email) {
      const key = encodeEmailKey(profile.email);
      await set(dbRef(database, `emailIndex/${key}`), null);
    }

    await set(dbRef(database, `users/${normalizedUid}`), null);

    return {
      ok: true,
      message: "Usuário removido do projeto com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: getFirebaseErrorMessage(error, "Não foi possível remover usuário do projeto."),
      code: String(error?.code || "")
    };
  }
}

export async function upsertEmailIndex(email, uid) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !uid) {
    return {
      ok: false,
      message: "E-mail e UID são obrigatórios para indexação."
    };
  }

  try {
    const database = getDatabaseInstance();
    const key = encodeEmailKey(normalizedEmail);

    await set(dbRef(database, `emailIndex/${key}`), {
      uid,
      email: normalizedEmail,
      updatedAt: Date.now()
    });

    return {
      ok: true,
      message: "Índice de e-mail atualizado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível atualizar o índice de e-mail."
    };
  }
}

export async function removeEmailIndex(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      ok: false,
      message: "E-mail não informado para remoção do índice."
    };
  }

  try {
    const database = getDatabaseInstance();
    const key = encodeEmailKey(normalizedEmail);
    await set(dbRef(database, `emailIndex/${key}`), null);

    return {
      ok: true,
      message: "Índice de e-mail removido com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível remover o índice de e-mail."
    };
  }
}

export async function listUserProfiles() {
  try {
    const database = getDatabaseInstance();
    const snapshot = await get(dbRef(database, "users"));

    if (!snapshot.exists()) {
      return {
        ok: true,
        profiles: {},
        message: "Nenhum usuário cadastrado."
      };
    }

    const raw = snapshot.val();
    const profiles = {};

    if (raw && typeof raw === "object") {
      Object.keys(raw).forEach((uid) => {
        const normalized = normalizeUserProfile(raw[uid]);
        if (normalized) {
          profiles[uid] = normalized;
        }
      });
    }

    return {
      ok: true,
      profiles,
      message: "Usuários carregados com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      profiles: {},
      message: "Não foi possível listar usuários no RTDB."
    };
  }
}

export async function createAuthUser(email, tempPassword) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !tempPassword) {
    return {
      ok: false,
      uid: null,
      code: "auth/invalid-input",
      message: "E-mail e senha temporária são obrigatórios."
    };
  }

  const auth = getSecondaryAuthInstance();

  try {
    const credential = await createUserWithEmailAndPassword(auth, normalizedEmail, tempPassword);
    await signOut(auth);

    return {
      ok: true,
      uid: credential.user.uid,
      code: null,
      message: "Usuário de autenticação criado com sucesso."
    };
  } catch (error) {
    try {
      await signOut(auth);
    } catch (signOutError) {
      console.warn("Falha ao limpar sessão secundária:", signOutError);
    }

    return {
      ok: false,
      uid: null,
      code: error?.code || "auth/unknown",
      message: "Não foi possível criar usuário no Auth."
    };
  }
}

export async function sendPasswordReset(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return {
      ok: false,
      message: "E-mail não informado para redefinição de senha."
    };
  }

  try {
    const auth = getAuthInstance();
    await sendPasswordResetEmail(auth, normalizedEmail);

    return {
      ok: true,
      message: "Convite de redefinição enviado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível enviar redefinição de senha."
    };
  }
}

export async function getUserProfile(uid) {
  return getUserProfileByUid(uid);
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeDateIso(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function normalizeObjectValues(input) {
  if (!input || typeof input !== "object") {
    return {};
  }

  const sanitizeKey = (value) => String(value || "")
    .trim()
    .replace(/[.#$/\[\]]/g, "_");

  const normalized = {};
  Object.keys(input).forEach((key) => {
    const nextKey = sanitizeKey(key);
    if (!nextKey) {
      return;
    }

    let uniqueKey = nextKey;
    let index = 1;
    while (Object.prototype.hasOwnProperty.call(normalized, uniqueKey)) {
      uniqueKey = `${nextKey}_${index}`;
      index += 1;
    }

    normalized[uniqueKey] = String(input[key] ?? "").trim();
  });

  return normalized;
}

function formatFirebaseError(error, fallbackMessage) {
  return {
    code: error?.code || "db/unknown",
    message: error?.message || fallbackMessage || "Erro desconhecido no Firebase."
  };
}

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  return String(value).trim() === "";
}

function readCoreFields(payload) {
  const source = payload?.core && typeof payload.core === "object" ? payload.core : payload;
  const nome = String(source?.nome || payload?.nome || "").trim();
  const cpf = normalizeDigits(source?.cpf || payload?.cpf);
  const telefone = String(source?.telefone || payload?.telefone || "").trim();
  const telefoneDigits = normalizeDigits(source?.telefoneDigits || payload?.telefoneDigits || telefone);
  const dataNascimento = normalizeDateIso(source?.dataNascimento || payload?.dataNascimento);
  const email = String(source?.email || payload?.email || "").trim().toLowerCase();
  const ativo = source?.ativo !== false && payload?.ativo !== false;

  return {
    nome,
    cpf,
    telefone,
    telefoneDigits,
    dataNascimento,
    email,
    ativo
  };
}

function readEnderecoFields(payload) {
  const endereco = payload?.endereco && typeof payload.endereco === "object" ? payload.endereco : {};

  return {
    cep: normalizeDigits(endereco.cep || payload?.cep),
    logradouro: String(endereco.logradouro || payload?.logradouro || "").trim(),
    numero: String(endereco.numero || payload?.numero || "").trim(),
    complemento: String(endereco.complemento || payload?.complemento || "").trim(),
    bairro: String(endereco.bairro || payload?.bairro || "").trim(),
    cidade: String(endereco.cidade || payload?.cidade || "").trim(),
    uf: String(endereco.uf || payload?.uf || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)
  };
}

function readPerfilFields(payload) {
  const perfil = payload?.perfil && typeof payload.perfil === "object" ? payload.perfil : {};
  const readSection = (key, fields) => {
    const section = perfil?.[key] && typeof perfil[key] === "object" ? perfil[key] : {};
    const output = {};
    fields.forEach((field) => {
      output[field] = String(section[field] || "").trim();
    });
    return output;
  };

  return {
    pessoais: readSection("pessoais", ["nomePaciente", "dataNascimento", "cpfPaciente"]),
    filiacao: readSection("filiacao", ["nomeMae", "nomePai", "nomeResponsavel", "vinculo", "telPrincipal", "telSecundario"]),
    escolares: readSection("escolares", ["escolaNome", "coordenacao", "periodo", "serieTurma"]),
    financeiros: readSection("financeiros", ["respFinanceiroNome", "respFinanceiroCpfCnpj", "respFinanceiroTelefone", "respFinanceiroEmail"]),
    endereco: {
      ...readSection("endereco", ["logradouro", "numero", "complemento", "bairro", "cidade"]),
      cep: normalizeDigits(perfil?.endereco?.cep || ""),
      uf: String(perfil?.endereco?.uf || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)
    },
    pagamento: readSection("pagamento", ["formaPagamento", "diaVencimento"])
  };
}

function normalizePatientPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const now = Date.now();
  const core = readCoreFields(payload);
  const endereco = readEnderecoFields(payload);
  const perfil = readPerfilFields(payload);
  const sourceRaw = payload?.source && typeof payload.source === "object" ? payload.source : {};

  return {
    core,
    nome: core.nome || "Sem nome",
    cpf: core.cpf,
    telefone: core.telefone,
    telefoneDigits: core.telefoneDigits,
    dataNascimento: core.dataNascimento,
    email: core.email,
    ativo: core.ativo,
    endereco,
    perfil,
    responsavelFinanceiro: String(payload?.responsavelFinanceiro || "").trim(),
    legacy: payload?.legacy && typeof payload.legacy === "object" ? { ...payload.legacy } : {},
    dadosOriginais: normalizeObjectValues(payload?.dadosOriginais),
    alertas: Array.isArray(payload?.alertas)
      ? payload.alertas.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    source: {
      importId: String(sourceRaw.importId || "").trim(),
      rowIndex: Number.isFinite(Number(sourceRaw.rowIndex)) ? Number(sourceRaw.rowIndex) : null,
      importedAt: Number.isFinite(Number(sourceRaw.importedAt)) ? Number(sourceRaw.importedAt) : null
    },
    createdAt: Number.isFinite(Number(payload?.createdAt)) ? Number(payload.createdAt) : now,
    updatedAt: now
  };
}

function hasPatientShape(node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  const hasCreatedAt = Object.prototype.hasOwnProperty.call(node, "createdAt");
  const nome = String(node?.nome || node?.core?.nome || "").trim();
  return hasCreatedAt && !!nome;
}

function mergeNonEmpty(currentValue, incomingValue) {
  if (isEmptyValue(incomingValue)) {
    return currentValue;
  }
  return incomingValue;
}

function mergePatientForCsvImport(currentPatient, incomingPatient) {
  const current = normalizePatientPayload(currentPatient);
  const incoming = normalizePatientPayload(incomingPatient);

  if (!current) {
    return incoming;
  }
  if (!incoming) {
    return current;
  }

  const mergedCore = {
    nome: mergeNonEmpty(current.core.nome, incoming.core.nome),
    cpf: mergeNonEmpty(current.core.cpf, incoming.core.cpf),
    telefone: mergeNonEmpty(current.core.telefone, incoming.core.telefone),
    telefoneDigits: mergeNonEmpty(current.core.telefoneDigits, incoming.core.telefoneDigits),
    dataNascimento: mergeNonEmpty(current.core.dataNascimento, incoming.core.dataNascimento),
    email: mergeNonEmpty(current.core.email, incoming.core.email),
    ativo: current.core.ativo !== false
  };

  return {
    ...current,
    ...incoming,
    core: mergedCore,
    nome: mergedCore.nome,
    cpf: mergedCore.cpf,
    telefone: mergedCore.telefone,
    telefoneDigits: mergedCore.telefoneDigits,
    dataNascimento: mergedCore.dataNascimento,
    email: mergedCore.email,
    ativo: mergedCore.ativo,
    endereco: {
      cep: mergeNonEmpty(current.endereco?.cep, incoming.endereco?.cep),
      logradouro: mergeNonEmpty(current.endereco?.logradouro, incoming.endereco?.logradouro),
      bairro: mergeNonEmpty(current.endereco?.bairro, incoming.endereco?.bairro),
      cidade: mergeNonEmpty(current.endereco?.cidade, incoming.endereco?.cidade)
    },
    responsavelFinanceiro: mergeNonEmpty(current.responsavelFinanceiro, incoming.responsavelFinanceiro),
    legacy: {
      ...(current.legacy || {}),
      ...(incoming.legacy || {})
    },
    dadosOriginais: incoming.dadosOriginais || {},
    alertas: incoming.alertas || [],
    source: incoming.source || {},
    createdAt: Number.isFinite(Number(current.createdAt)) ? Number(current.createdAt) : Date.now(),
    updatedAt: Date.now()
  };
}

export async function listPatients() {
  try {
    const database = getDatabaseInstance();
    const snapshot = await get(dbRef(database, "patients"));

    if (!snapshot.exists()) {
      return {
        ok: true,
        patients: {},
        message: "Nenhum paciente cadastrado."
      };
    }

    const raw = snapshot.val();
    const patients = {};

    if (raw && typeof raw === "object") {
      Object.keys(raw).forEach((patientId) => {
        if (String(patientId).startsWith("__")) {
          return;
        }

        if (!hasPatientShape(raw[patientId])) {
          return;
        }

        const normalized = normalizePatientPayload(raw[patientId]);
        if (!normalized || !normalized.core?.nome) {
          return;
        }

        patients[patientId] = {
          ...normalized,
          id: patientId
        };
      });
    }

    return {
      ok: true,
      patients,
      message: "Pacientes carregados com sucesso."
    };
  } catch (error) {
    const details = formatFirebaseError(error, "Não foi possível listar pacientes no RTDB.");
    return {
      ok: false,
      patients: {},
      message: "Não foi possível listar pacientes no RTDB.",
      errorCode: details.code,
      errorMessage: details.message
    };
  }
}

export async function createPatient(patientId, payload) {
  const id = String(patientId || "").trim();
  if (!id) {
    return {
      ok: false,
      message: "ID do paciente não informado."
    };
  }

  const normalized = normalizePatientPayload(payload);
  if (!normalized) {
    return {
      ok: false,
      message: "Dados inválidos para cadastrar paciente."
    };
  }

  try {
    const database = getDatabaseInstance();
    await set(dbRef(database, `patients/${id}`), normalized);
    return {
      ok: true,
      message: "Paciente cadastrado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível cadastrar o paciente."
    };
  }
}

export async function updatePatient(patientId, patch) {
  const id = String(patientId || "").trim();
  if (!id) {
    return {
      ok: false,
      message: "ID do paciente não informado para atualização."
    };
  }

  try {
    const database = getDatabaseInstance();
    const currentSnap = await get(dbRef(database, `patients/${id}`));

    if (!currentSnap.exists()) {
      return {
        ok: false,
        message: "Paciente não encontrado para atualização."
      };
    }

    const merged = {
      ...currentSnap.val(),
      ...(patch || {})
    };

    const normalized = normalizePatientPayload(merged);
    if (!normalized) {
      return {
        ok: false,
        message: "Dados inválidos para salvar paciente."
      };
    }

    await set(dbRef(database, `patients/${id}`), {
      ...normalized,
      createdAt:
        Number.isFinite(Number(currentSnap.val()?.createdAt))
          ? Number(currentSnap.val().createdAt)
          : normalized.createdAt
    });

    return {
      ok: true,
      message: "Paciente atualizado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível atualizar o paciente."
    };
  }
}

export async function setPatientActive(patientId, active) {
  const id = String(patientId || "").trim();
  if (!id) {
    return {
      ok: false,
      message: "ID do paciente não informado."
    };
  }

  try {
    const database = getDatabaseInstance();
    await update(dbRef(database), {
      [`patients/${id}/ativo`]: active === true,
      [`patients/${id}/core/ativo`]: active === true,
      [`patients/${id}/updatedAt`]: Date.now()
    });

    return {
      ok: true,
      message: "Status do paciente atualizado com sucesso."
    };
  } catch (error) {
    return {
      ok: false,
      message: "Não foi possível atualizar o status do paciente."
    };
  }
}

export function generatePushKeyForPatients() {
  const database = getDatabaseInstance();
  const key = push(dbRef(database, "patients")).key;
  return key || `tmp_${Date.now()}`;
}

export async function clearPatientsBeforeImport(knownPatientIds = []) {
  const database = getDatabaseInstance();

  try {
    await set(dbRef(database, "patients"), null);
    return {
      ok: true,
      strategy: "full-delete",
      message: "Base de pacientes limpa com sucesso."
    };
  } catch (fullDeleteError) {
    const fullDeleteDetails = formatFirebaseError(fullDeleteError, "Sem permissão para limpar /patients inteiro.");

    try {
      await set(dbRef(database, "patients/__meta"), null);

      const validIds = Array.isArray(knownPatientIds)
        ? knownPatientIds.map((id) => String(id || "").trim()).filter((id) => !!id && !id.startsWith("__"))
        : [];

      if (validIds.length > 0) {
        const deleteFanOut = {};
        validIds.forEach((id) => {
          deleteFanOut[`patients/${id}`] = null;
        });
        await update(dbRef(database), deleteFanOut);
      }

      return {
        ok: true,
        strategy: "fallback-meta-and-known-keys",
        message: "Base limpa parcialmente (meta + pacientes conhecidos).",
        warningCode: fullDeleteDetails.code,
        warningMessage: fullDeleteDetails.message
      };
    } catch (fallbackError) {
      const fallbackDetails = formatFirebaseError(fallbackError, "Falha na limpeza parcial da base de pacientes.");
      return {
        ok: false,
        strategy: "failed",
        message: "Não foi possível limpar a base antes de importar.",
        errorCode: fallbackDetails.code,
        errorMessage: fallbackDetails.message,
        previousErrorCode: fullDeleteDetails.code,
        previousErrorMessage: fullDeleteDetails.message
      };
    }
  }
}

export function getLastPatientsImportId() {
  return lastPatientsImportId;
}

export async function bulkImportPatientsWithAudit(rows, options = {}) {
  const normalizedImportId = `imp_${Date.now()}`;
  const list = Array.isArray(rows) ? rows : [];
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};

  const stats = {
    totalRowsDetected: list.length,
    skippedEmptyRows: 0,
    importedCount: 0,
    semCpfCount: 0,
    alertCount: 0,
    startedAt: Date.now(),
    finishedAt: null
  };

  try {
    const database = getDatabaseInstance();
    const snapshot = await get(dbRef(database, "patients"));
    const raw = snapshot.exists() ? snapshot.val() : {};
    const existing = {};

    if (raw && typeof raw === "object") {
      Object.keys(raw).forEach((patientId) => {
        if (String(patientId).startsWith("__")) {
          return;
        }
        if (!hasPatientShape(raw[patientId])) {
          return;
        }
        existing[patientId] = raw[patientId];
      });
    }

    const staged = { ...existing };
    const patientFanOut = {};
    const auditRowsFanOut = {};
    const seenCpf = new Set();
    const importErrors = [];

    for (let index = 0; index < list.length; index += 1) {
      const row = list[index] || {};
      const rowIndex = Number.isFinite(Number(row.rowIndex)) ? Number(row.rowIndex) : index + 1;

      try {
        const dadosOriginais = normalizeObjectValues(row.dadosOriginais);
        const isEmptyRow = Object.values(dadosOriginais).every((value) => isEmptyValue(value));

        if (isEmptyRow) {
          stats.skippedEmptyRows += 1;
          auditRowsFanOut[`patients/__meta/imports/${normalizedImportId}/rows/${rowIndex}`] = {
            rowIndex,
            status: "ignorado",
            erro: "Linha vazia (todos os campos em branco).",
            alertas: [],
            patientId: null,
            createdAt: Date.now()
          };
          onProgress(index + 1, list.length);
          continue;
        }

        const alertas = [];
        const draftCore = {
          nome: String(row?.core?.nome || "").trim(),
          cpf: normalizeDigits(row?.core?.cpf),
          telefone: String(row?.core?.telefone || "").trim(),
          telefoneDigits: normalizeDigits(row?.core?.telefone || ""),
          dataNascimento: normalizeDateIso(row?.core?.dataNascimento),
          email: String(row?.core?.email || "").trim().toLowerCase(),
          ativo: true
        };

        if (!draftCore.nome) {
          alertas.push("Campo Nome ausente.");
          draftCore.nome = `Sem nome (linha ${rowIndex})`;
        }
        if (!draftCore.telefone) {
          alertas.push("Campo Telefone ausente.");
          draftCore.telefone = "Não informado";
          draftCore.telefoneDigits = "";
        }
        if (!draftCore.cpf) {
          alertas.push("Campo CPF ausente ou inválido.");
        }
        if (!draftCore.dataNascimento) {
          alertas.push("Campo DN/Data de nascimento ausente.");
        }
        if (!draftCore.email) {
          alertas.push("Campo E-mail ausente.");
        }

        const source = {
          importId: normalizedImportId,
          rowIndex,
          importedAt: Date.now()
        };

        const incoming = normalizePatientPayload({
          core: draftCore,
          endereco: row.endereco || {},
          responsavelFinanceiro: row.responsavelFinanceiro || "",
          legacy: row.legacy || {},
          dadosOriginais,
          alertas,
          source,
          ativo: true,
          createdAt: Date.now()
        });

        if (!incoming) {
          importErrors.push(`Linha ${rowIndex}: payload inválido.`);
          auditRowsFanOut[`patients/__meta/imports/${normalizedImportId}/rows/${rowIndex}`] = {
            rowIndex,
            status: "erro",
            erro: "Payload inválido para importação.",
            alertas,
            patientId: null,
            createdAt: Date.now()
          };
          onProgress(index + 1, list.length);
          continue;
        }

        const cpfDigits = normalizeDigits(incoming.core.cpf);
        let patientId = "";

        if (cpfDigits.length >= 11) {
          patientId = `cpf_${cpfDigits}`;

          if (seenCpf.has(patientId)) {
            auditRowsFanOut[`patients/__meta/imports/${normalizedImportId}/rows/${rowIndex}`] = {
              rowIndex,
              status: "ignorado",
              erro: "CPF duplicado no arquivo.",
              alertas,
              patientId,
              createdAt: Date.now()
            };
            stats.alertCount += alertas.length;
            onProgress(index + 1, list.length);
            continue;
          }

          seenCpf.add(patientId);

          if (staged[patientId]) {
            const merged = mergePatientForCsvImport(staged[patientId], incoming);
            merged.alertas = Array.isArray(merged.alertas) ? merged.alertas : alertas;
            staged[patientId] = merged;
            patientFanOut[`patients/${patientId}`] = merged;
          } else {
            const created = {
              ...incoming,
              createdAt: Date.now(),
              updatedAt: Date.now()
            };
            staged[patientId] = created;
            patientFanOut[`patients/${patientId}`] = created;
          }
        } else {
          stats.semCpfCount += 1;
          patientId = `p_${generatePushKeyForPatients()}`;
          const created = {
            ...incoming,
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          staged[patientId] = created;
          patientFanOut[`patients/${patientId}`] = created;
        }

        stats.importedCount += 1;
        stats.alertCount += alertas.length;

        auditRowsFanOut[`patients/__meta/imports/${normalizedImportId}/rows/${rowIndex}`] = {
          rowIndex,
          status: "importado",
          erro: null,
          alertas,
          patientId,
          createdAt: Date.now()
        };
      } catch (rowError) {
        const rowDetails = formatFirebaseError(rowError, "Erro ao processar linha da importação.");
        importErrors.push(`Linha ${rowIndex}: ${rowDetails.code} - ${rowDetails.message}`);
        auditRowsFanOut[`patients/__meta/imports/${normalizedImportId}/rows/${rowIndex}`] = {
          rowIndex,
          status: "erro",
          erro: `${rowDetails.code}: ${rowDetails.message}`,
          alertas: [],
          patientId: null,
          createdAt: Date.now()
        };
      }

      onProgress(index + 1, list.length);
    }

    stats.finishedAt = Date.now();

    if (Object.keys(patientFanOut).length > 0) {
      try {
        await update(dbRef(database), patientFanOut);
      } catch (patientsWriteError) {
        const writeDetails = formatFirebaseError(patientsWriteError, "Falha ao salvar pacientes no RTDB.");
        return {
          ok: false,
          message: "Não foi possível importar pacientes.",
          errorCode: writeDetails.code,
          errorMessage: writeDetails.message,
          stats,
          lastImportId: normalizedImportId,
          auditWriteOk: false
        };
      }
    }

    lastPatientsImportId = normalizedImportId;

    const auditFanOut = {
      [`patients/__meta/imports/${normalizedImportId}/stats`]: {
        ...stats,
        importId: normalizedImportId,
        importErrors
      },
      ...auditRowsFanOut
    };

    try {
      await update(dbRef(database), auditFanOut);
      return {
        ok: true,
        message: "Importação concluída com auditoria.",
        stats,
        lastImportId: normalizedImportId,
        auditWriteOk: true
      };
    } catch (auditWriteError) {
      const auditDetails = formatFirebaseError(auditWriteError, "Pacientes importados, mas falhou a gravação da auditoria.");
      return {
        ok: true,
        message: "Pacientes importados, mas não foi possível salvar a auditoria completa.",
        stats,
        lastImportId: normalizedImportId,
        auditWriteOk: false,
        errorCode: auditDetails.code,
        errorMessage: auditDetails.message
      };
    }
  } catch (error) {
    const details = formatFirebaseError(error, "Não foi possível concluir a importação com auditoria.");
    return {
      ok: false,
      stats,
      message: "Não foi possível concluir a importação com auditoria.",
      errorCode: details.code,
      errorMessage: details.message,
      lastImportId: normalizedImportId,
      auditWriteOk: false
    };
  }
}

export async function readImportReport(importId) {
  const normalizedImportId = String(importId || "").trim();
  if (!normalizedImportId) {
    return {
      ok: false,
      stats: null,
      rows: {},
      message: "Import ID não informado."
    };
  }

  try {
    const database = getDatabaseInstance();
    const [statsSnap, rowsSnap] = await Promise.all([
      get(dbRef(database, `patients/__meta/imports/${normalizedImportId}/stats`)),
      get(dbRef(database, `patients/__meta/imports/${normalizedImportId}/rows`))
    ]);

    return {
      ok: true,
      stats: statsSnap.exists() ? statsSnap.val() : null,
      rows: rowsSnap.exists() ? rowsSnap.val() : {},
      message: "Relatório carregado com sucesso."
    };
  } catch (error) {
    const details = formatFirebaseError(error, "Não foi possível carregar o relatório do import.");
    return {
      ok: false,
      stats: null,
      rows: {},
      message: "Não foi possível carregar o relatório do import.",
      errorCode: details.code,
      errorMessage: details.message
    };
  }
}