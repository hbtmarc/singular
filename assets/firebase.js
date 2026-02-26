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
import { getDatabase, ref as dbRef, get, onValue, set } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-database.js";

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
    updatedAt: typeof profile.updatedAt === "number" ? profile.updatedAt : null
  };
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
    await set(dbRef(database, `users/${uid}`), {
      email,
      role,
      ativo,
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