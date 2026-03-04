import {
  listPatients,
  createPatient,
  updatePatient,
  setPatientActive
} from "../firebase.js";
import {
  onlyDigits,
  formatPhoneBR,
  formatCpfCnpj,
  formatCep,
  formatDateBR
} from "../format.js";
import {
  ICON_EDIT, ICON_EYE, ICON_EYE_OFF, iconBtn
} from "../icons.js";

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDateForStorage(value) {
  const normalized = normalizeDate(value);
  return normalized || null;
}

function normalizeDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!br) {
    return "";
  }

  return `${br[3]}-${br[2]}-${br[1]}`;
}

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseCsvLine(line, delimiter = ";") {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function getPatientCore(patient) {
  if (!patient || typeof patient !== "object") {
    return {
      nome: "",
      cpf: "",
      telefone: "",
      telefoneDigits: "",
      dataNascimento: null,
      email: "",
      ativo: true
    };
  }

  const core = patient.core && typeof patient.core === "object" ? patient.core : patient;
  const perfil = buildPerfilFromPatient(patient);
  const pessoais = perfil.pessoais;
  const financeiros = perfil.financeiros;
  const filiacao = perfil.filiacao;
  const primaryPhone = onlyDigits(filiacao.telPrincipal || "");

  return {
    nome: String(core.nome || patient.nome || pessoais.nomePaciente || "").trim(),
    cpf: onlyDigits(core.cpf || patient.cpf || pessoais.cpfPaciente),
    telefone: String(core.telefone || patient.telefone || filiacao.telPrincipal || "").trim(),
    telefoneDigits: onlyDigits(core.telefoneDigits || patient.telefoneDigits || primaryPhone || core.telefone || patient.telefone),
    dataNascimento: normalizeDateForStorage(core.dataNascimento || patient.dataNascimento || pessoais.dataNascimento),
    email: String(core.email || patient.email || financeiros.respFinanceiroEmail || "").trim().toLowerCase(),
    ativo: core.ativo !== false && patient.ativo !== false
  };
}

function getPatientEndereco(patient) {
  const perfil = buildPerfilFromPatient(patient);
  const endereco = perfil.endereco;
  return {
    cep: onlyDigits(endereco.cep || ""),
    logradouro: String(endereco.logradouro || "").trim(),
    numero: String(endereco.numero || "").trim(),
    complemento: String(endereco.complemento || "").trim(),
    bairro: String(endereco.bairro || "").trim(),
    cidade: String(endereco.cidade || "").trim(),
    uf: String(endereco.uf || "").trim().toUpperCase().slice(0, 2)
  };
}

function readPerfilSection(perfil, key, fields) {
  const section = perfil?.[key] && typeof perfil[key] === "object" ? perfil[key] : {};
  const result = {};
  fields.forEach((field) => {
    result[field] = String(section[field] || "").trim();
  });
  return result;
}

function buildPerfilFromPatient(patient) {
  const perfilRaw = patient?.perfil && typeof patient.perfil === "object" ? patient.perfil : {};
  const enderecoRoot = patient?.endereco && typeof patient.endereco === "object" ? patient.endereco : {};

  const pessoais = readPerfilSection(perfilRaw, "pessoais", ["nomePaciente", "dataNascimento", "cpfPaciente"]);
  if (!pessoais.nomePaciente) {
    pessoais.nomePaciente = String(patient?.nome || patient?.core?.nome || "").trim();
  }
  if (!pessoais.dataNascimento) {
    pessoais.dataNascimento = normalizeDate(patient?.dataNascimento || patient?.core?.dataNascimento || "");
  }
  if (!pessoais.cpfPaciente) {
    pessoais.cpfPaciente = onlyDigits(patient?.cpf || patient?.core?.cpf || "");
  }

  const filiacao = readPerfilSection(perfilRaw, "filiacao", [
    "nomeMae",
    "nomePai",
    "nomeResponsavel",
    "vinculo",
    "telPrincipal",
    "telSecundario"
  ]);
  if (!filiacao.telPrincipal) {
    filiacao.telPrincipal = String(patient?.telefone || patient?.core?.telefone || "").trim();
  }

  const escolares = readPerfilSection(perfilRaw, "escolares", ["escolaNome", "coordenacao", "periodo", "serieTurma"]);

  const financeiros = readPerfilSection(perfilRaw, "financeiros", [
    "respFinanceiroNome",
    "respFinanceiroCpfCnpj",
    "respFinanceiroTelefone",
    "respFinanceiroEmail"
  ]);
  if (!financeiros.respFinanceiroNome) {
    financeiros.respFinanceiroNome = String(patient?.responsavelFinanceiro || "").trim();
  }
  if (!financeiros.respFinanceiroEmail) {
    financeiros.respFinanceiroEmail = String(patient?.email || patient?.core?.email || "").trim().toLowerCase();
  }

  const endereco = readPerfilSection(perfilRaw, "endereco", [
    "logradouro",
    "numero",
    "complemento",
    "cep",
    "bairro",
    "cidade",
    "uf"
  ]);
  if (!endereco.logradouro) {
    endereco.logradouro = String(enderecoRoot.logradouro || patient?.logradouro || "").trim();
  }
  if (!endereco.numero) {
    endereco.numero = String(enderecoRoot.numero || patient?.numero || "").trim();
  }
  if (!endereco.complemento) {
    endereco.complemento = String(enderecoRoot.complemento || patient?.complemento || "").trim();
  }
  if (!endereco.cep) {
    endereco.cep = onlyDigits(enderecoRoot.cep || patient?.cep || "");
  }
  if (!endereco.bairro) {
    endereco.bairro = String(enderecoRoot.bairro || patient?.bairro || "").trim();
  }
  if (!endereco.cidade) {
    endereco.cidade = String(enderecoRoot.cidade || patient?.cidade || "").trim();
  }
  if (!endereco.uf) {
    endereco.uf = String(enderecoRoot.uf || patient?.uf || "").trim().toUpperCase().slice(0, 2);
  }

  const pagamento = readPerfilSection(perfilRaw, "pagamento", ["formaPagamento", "diaVencimento"]);

  return {
    pessoais,
    filiacao,
    escolares,
    financeiros,
    endereco,
    pagamento
  };
}

function buildPatientPatchFromPerfil(perfilInput, currentPatient = {}) {
  const perfil = buildPerfilFromPatient({ perfil: perfilInput });

  const pessoais = {
    nomePaciente: normalizeName(perfil.pessoais.nomePaciente),
    dataNascimento: normalizeDate(perfil.pessoais.dataNascimento),
    cpfPaciente: onlyDigits(perfil.pessoais.cpfPaciente)
  };

  const filiacao = {
    nomeMae: String(perfil.filiacao.nomeMae || "").trim(),
    nomePai: String(perfil.filiacao.nomePai || "").trim(),
    nomeResponsavel: String(perfil.filiacao.nomeResponsavel || "").trim(),
    vinculo: String(perfil.filiacao.vinculo || "").trim(),
    telPrincipal: String(perfil.filiacao.telPrincipal || "").trim(),
    telSecundario: String(perfil.filiacao.telSecundario || "").trim()
  };

  const escolares = {
    escolaNome: String(perfil.escolares.escolaNome || "").trim(),
    coordenacao: String(perfil.escolares.coordenacao || "").trim(),
    periodo: String(perfil.escolares.periodo || "").trim(),
    serieTurma: String(perfil.escolares.serieTurma || "").trim()
  };

  const financeiros = {
    respFinanceiroNome: String(perfil.financeiros.respFinanceiroNome || "").trim(),
    respFinanceiroCpfCnpj: onlyDigits(perfil.financeiros.respFinanceiroCpfCnpj),
    respFinanceiroTelefone: String(perfil.financeiros.respFinanceiroTelefone || "").trim(),
    respFinanceiroEmail: String(perfil.financeiros.respFinanceiroEmail || "").trim().toLowerCase()
  };

  const endereco = {
    logradouro: String(perfil.endereco.logradouro || "").trim(),
    numero: String(perfil.endereco.numero || "").trim(),
    complemento: String(perfil.endereco.complemento || "").trim(),
    cep: onlyDigits(perfil.endereco.cep),
    bairro: String(perfil.endereco.bairro || "").trim(),
    cidade: String(perfil.endereco.cidade || "").trim(),
    uf: String(perfil.endereco.uf || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2)
  };

  const pagamento = {
    formaPagamento: String(perfil.pagamento.formaPagamento || "").trim(),
    diaVencimento: String(perfil.pagamento.diaVencimento || "").trim().replace(/[^0-9]/g, "").slice(0, 2)
  };

  const telPrincipalDigits = onlyDigits(filiacao.telPrincipal);
  const birthDate = pessoais.dataNascimento || null;
  const now = Date.now();

  return {
    core: {
      nome: pessoais.nomePaciente || "Sem nome",
      cpf: pessoais.cpfPaciente,
      telefone: filiacao.telPrincipal,
      telefoneDigits: telPrincipalDigits,
      dataNascimento: birthDate,
      email: financeiros.respFinanceiroEmail,
      ativo: currentPatient?.ativo !== false
    },
    nome: pessoais.nomePaciente || "Sem nome",
    cpf: pessoais.cpfPaciente,
    telefoneDigits: telPrincipalDigits,
    dataNascimento: birthDate,
    ativo: currentPatient?.ativo !== false,
    perfil: {
      pessoais,
      filiacao,
      escolares,
      financeiros,
      endereco,
      pagamento
    },
    endereco: {
      cep: endereco.cep,
      logradouro: endereco.logradouro,
      numero: endereco.numero,
      complemento: endereco.complemento,
      bairro: endereco.bairro,
      cidade: endereco.cidade,
      uf: endereco.uf
    },
    responsavelFinanceiro: financeiros.respFinanceiroNome,
    email: financeiros.respFinanceiroEmail,
    updatedAt: now,
    createdAt: Number.isFinite(Number(currentPatient?.createdAt)) ? Number(currentPatient.createdAt) : now
  };
}

function buildFilterText(patient) {
  const core = getPatientCore(patient);
  return [
    core.nome.toLowerCase(),
    core.telefoneDigits,
    core.cpf
  ].join(" ");
}

function buildCoreFromCsvRow(rawRow, normalizedRow) {
  // Prioriza os cabeçalhos exatos do CSV e mantém fallback por chave normalizada.
  const nome = String(rawRow["Nome"] || normalizedRow.nome || "").trim();
  const cpfDigits = onlyDigits(rawRow["CPF.CNPJ"] || normalizedRow.cpfcnpj || "");
  const telefone = String(rawRow["Telefone"] || rawRow["Telefone "] || normalizedRow.telefone || "").trim();
  const telefoneDigits = onlyDigits(telefone);

  const dnRaw =
    rawRow["DN"] ||
    rawRow["Data Nascimento"] ||
    rawRow["Data nascimento"] ||
    normalizedRow.dn ||
    normalizedRow.datanascimento ||
    "";

  const email = String(rawRow["E-mail"] || normalizedRow.email || "").trim().toLowerCase();

  return {
    nome,
    cpf: cpfDigits,
    telefone,
    telefoneDigits,
    dataNascimento: normalizeDateForStorage(dnRaw),
    email,
    ativo: true
  };
}

function buildEnderecoFromCsvRow(rawRow, normalizedRow) {
  return {
    cep: onlyDigits(rawRow["CEP"] || normalizedRow.cep || ""),
    logradouro: String(rawRow["Endereço"] || normalizedRow.endereco || "").trim(),
    bairro: String(rawRow["Bairro"] || rawRow["Bairro "] || normalizedRow.bairro || "").trim(),
    cidade: String(rawRow["Cidade"] || normalizedRow.cidade || "").trim()
  };
}

function buildLegacyFromCsvRow(rawRow, normalizedRow) {
  const readGroup = (prefixRaw, prefixNormalized) => {
    const values = [];

    Object.keys(rawRow).forEach((key) => {
      if (String(key).trim().startsWith(prefixRaw)) {
        const value = String(rawRow[key] || "").trim();
        if (value) {
          values.push(value);
        }
      }
    });

    Object.keys(normalizedRow).forEach((key) => {
      if (String(key).startsWith(prefixNormalized)) {
        const value = String(normalizedRow[key] || "").trim();
        if (value && !values.includes(value)) {
          values.push(value);
        }
      }
    });

    return values.join("; ");
  };

  return {
    terapias: readGroup("Terapia.", "terapia"),
    dias: readGroup("Data.", "data"),
    profissionais: readGroup("Profissional.", "profissional"),
    tipo: String(rawRow["Tipo"] || normalizedRow.tipo || "").trim(),
    turno: String(rawRow["Turno"] || normalizedRow.turno || "").trim(),
    escolaridade: String(rawRow["Escolaridade"] || normalizedRow.escolaridade || "").trim(),
    escola: String(rawRow["Escola"] || normalizedRow.escola || "").trim(),
    redesSociais: String(rawRow["RedesSociais"] || normalizedRow.redessociais || "").trim()
  };
}

function normalizeDiaSemana(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  if (normalized.startsWith("segunda")) return "segunda";
  if (normalized.startsWith("terca") || normalized.startsWith("terça")) return "terca";
  if (normalized.startsWith("quarta")) return "quarta";
  if (normalized.startsWith("quinta")) return "quinta";
  if (normalized.startsWith("sexta")) return "sexta";
  if (normalized.startsWith("sabado")) return "sabado";
  if (normalized.startsWith("domingo")) return "domingo";

  return "";
}

function formatDiaSemanaLabel(value) {
  const dia = normalizeDiaSemana(value);
  const labels = {
    segunda: "Segunda-feira",
    terca: "Terça-feira",
    quarta: "Quarta-feira",
    quinta: "Quinta-feira",
    sexta: "Sexta-feira",
    sabado: "Sábado",
    domingo: "Domingo"
  };
  return labels[dia] || "Não informado";
}

function normalizeAgendaTextValue(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedToken = normalized
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedToken) {
    return "";
  }

  const emptyMarkers = new Set([
    "nao informado",
    "nao informada",
    "n/a",
    "na",
    "-",
    "--",
    "null",
    "undefined",
    "sem informacao",
    "sem preencher",
    "sem preenchimento",
    "nao preenchido",
    "nao preenchida",
    "vazio"
  ]);

  if (emptyMarkers.has(normalized) || emptyMarkers.has(normalizedToken)) {
    return "";
  }

  if (/\bnao\s+informad[oa]\b/.test(normalizedToken)) {
    return "";
  }

  if (/\bsem\s+informacao\b/.test(normalizedToken)) {
    return "";
  }

  if (/\bnao\s+preenchid[oa]\b/.test(normalizedToken)) {
    return "";
  }

  if (/^n\s*a$/.test(normalizedToken)) {
    return "";
  }

  return raw;
}

function buildAgendaSlotsFromPlano(patient) {
  const plano = patient?.planoTerapias && typeof patient.planoTerapias === "object"
    ? patient.planoTerapias
    : {};

  return [1, 2, 3].map((slotIndex) => {
    const slot = plano[String(slotIndex)] && typeof plano[String(slotIndex)] === "object"
      ? plano[String(slotIndex)]
      : {};

    return {
      slotIndex,
      terapia: normalizeAgendaTextValue(slot.terapia),
      diaSemana: normalizeDiaSemana(normalizeAgendaTextValue(slot.diaSemana)),
      profissional: normalizeAgendaTextValue(slot.profissional)
    };
  });
}

function buildAgendaSlotsFromDadosOriginais(dadosOriginais) {
  const normalizedMap = {};
  Object.keys(dadosOriginais || {}).forEach((key) => {
    const normalizedKey = normalizeHeaderKey(key);
    if (!normalizedKey) {
      return;
    }
    normalizedMap[normalizedKey] = String(dadosOriginais[key] || "").trim();
  });

  const roman = ["i", "ii", "iii"];
  return [1, 2, 3].map((slotIndex, index) => {
    const suffix = roman[index];
    const terapia = normalizeAgendaTextValue(normalizedMap[`terapia${suffix}`]);
    const diaRaw = normalizeAgendaTextValue(normalizedMap[`data${suffix}`] || normalizedMap[`dia${suffix}`]);
    const profissional = normalizeAgendaTextValue(normalizedMap[`profissional${suffix}`]);

    return {
      slotIndex,
      terapia,
      diaSemana: normalizeDiaSemana(diaRaw),
      profissional
    };
  });
}

function getAgendaSlotsForDisplay(patient, dadosOriginais) {
  const fromPlano = buildAgendaSlotsFromPlano(patient);
  const hasPlanoData = fromPlano.some((slot) => slot.terapia || slot.diaSemana || slot.profissional);
  if (hasPlanoData) {
    return fromPlano;
  }
  return buildAgendaSlotsFromDadosOriginais(dadosOriginais);
}

function setFeedback(element, message, type = "info") {
  const colors = {
    info: "#6b7280",
    success: "#065f46",
    error: "#b91c1c"
  };

  element.style.color = colors[type] || colors.info;
  element.textContent = message;
}

function setErrorDetails(element, errorCode, errorMessage) {
  const code = String(errorCode || "").trim();
  const message = String(errorMessage || "").trim();

  if (!code && !message) {
    element.innerHTML = "";
    return;
  }

  element.innerHTML = `
    <small><strong>Detalhes técnicos:</strong> ${code || "(sem código)"} ${message ? `• ${message}` : ""}</small>
  `;
}

function sortByNome(entries) {
  return [...entries].sort((a, b) => {
    const nameA = getPatientCore(a).nome.toLowerCase();
    const nameB = getPatientCore(b).nome.toLowerCase();
    return nameA.localeCompare(nameB, "pt-BR");
  });
}

function openModal(overlay) {
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeModal(overlay) {
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function parseCsvToRows(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const rawHeaders = parseCsvLine(lines[0], ";").map((header) => String(header || "").trim());

  const rows = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const values = parseCsvLine(lines[lineIndex], ";");

    const rawRow = {};
    rawHeaders.forEach((header, index) => {
      rawRow[header] = String(values[index] || "").trim();
    });

    const normalizedRow = {};
    Object.keys(rawRow).forEach((header) => {
      normalizedRow[normalizeHeaderKey(header)] = rawRow[header];
    });

    rows.push({
      rowIndex: lineIndex,
      rawRow,
      normalizedRow
    });
  }

  return rows;
}

function readCsvFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo CSV."));
    reader.readAsText(file, "utf-8");
  });
}

export function render(container) {
  const userRole = window.__userProfile?.role || "";
  const readOnly = userRole === "profissional";

  let patientsMap = {};
  let editingPatientId = "";

  container.innerHTML = `
    <section class="admin-page">
      <article class="card">
        <h2>Pacientes cadastrados</h2>
        <p class="admin-card-text">Busque por nome, telefone ou CPF e gerencie os dados de cadastro.</p>

        <div class="admin-card-body">
          <div class="admin-inline-actions">
            <input id="pac-filtro" class="admin-input admin-filter" type="text" placeholder="Filtrar por nome, telefone ou CPF" />
            ${readOnly ? "" : '<button id="pac-novo" type="button" class="admin-btn admin-btn-primary">Novo paciente</button>'}
          </div>

          <div class="admin-table-wrap">
            <table class="admin-table patients-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Telefone</th>
                  <th>CPF/CNPJ</th>
                  <th>Nascimento</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="pac-lista-body">
                <tr>
                  <td colspan="6" class="admin-empty">Carregando pacientes...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p id="pac-lista-feedback" class="admin-feedback"></p>
        </div>
      </article>
    </section>

    <div id="pac-edit-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal patient-edit-modal" role="dialog" aria-modal="true" aria-labelledby="pac-edit-title">
        <button id="pac-edit-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pac-edit-title">Novo paciente</h2>

        <div class="admin-card-body admin-modal-body">
          <p class="form-required-note">Campos com <span class="required-asterisk">*</span> são obrigatórios.</p>

          <section class="patient-form-section">
            <h3>Dados Pessoais Paciente</h3>
            <div class="patient-form-grid">
              <label class="admin-label required-label" for="pac-nome-paciente">Nome do Paciente</label>
              <input id="pac-nome-paciente" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-data-nascimento">Data de Nascimento</label>
              <input id="pac-data-nascimento" class="admin-input" type="text" placeholder="DD/MM/AAAA ou AAAA-MM-DD" />

              <label class="admin-label" for="pac-cpf-paciente">CPF do Paciente</label>
              <input id="pac-cpf-paciente" class="admin-input" type="text" />
            </div>
          </section>

          <section class="patient-form-section">
            <h3>Filiação e Responsável</h3>
            <div class="patient-form-grid">
              <label class="admin-label required-label" for="pac-nome-mae">Nome da Mãe</label>
              <input id="pac-nome-mae" class="admin-input" type="text" />

              <label class="admin-label" for="pac-nome-pai">Nome do Pai</label>
              <input id="pac-nome-pai" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-nome-responsavel">Nome Responsável (Para contato)</label>
              <input id="pac-nome-responsavel" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-vinculo">Vínculo</label>
              <select id="pac-vinculo" class="admin-input">
                <option value="">Selecione</option>
                <option value="Pai">Pai</option>
                <option value="Mãe">Mãe</option>
                <option value="Outro">Outro</option>
              </select>

              <label class="admin-label required-label" for="pac-tel-principal">Telefone / WhatsApp (Principal)</label>
              <input id="pac-tel-principal" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-tel-secundario">Telefone / WhatsApp (Secundário)</label>
              <input id="pac-tel-secundario" class="admin-input" type="text" />
            </div>
          </section>

          <section class="patient-form-section">
            <h3>Dados Escolares</h3>
            <div class="patient-form-grid">
              <label class="admin-label" for="pac-escola-nome">Nome da Escola</label>
              <input id="pac-escola-nome" class="admin-input" type="text" />

              <label class="admin-label" for="pac-coordenacao">Coordenação</label>
              <input id="pac-coordenacao" class="admin-input" type="text" />

              <label class="admin-label" for="pac-periodo">Período</label>
              <select id="pac-periodo" class="admin-input">
                <option value="">Selecione</option>
                <option value="Manhã">Manhã</option>
                <option value="Tarde">Tarde</option>
                <option value="Integral">Integral</option>
              </select>

              <label class="admin-label" for="pac-serie-turma">Série / Turma</label>
              <input id="pac-serie-turma" class="admin-input" type="text" />
            </div>
          </section>

          <section class="patient-form-section">
            <h3>Dados Financeiros</h3>
            <div class="patient-form-grid">
              <label class="admin-label required-label" for="pac-resp-financeiro">Responsável Financeiro</label>
              <input id="pac-resp-financeiro" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-cpf-cnpj-resp-fin">CPF Resp. Fin.</label>
              <input id="pac-cpf-cnpj-resp-fin" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-tel-resp-fin">Telefone / WhatsApp (Resp. Fin.)</label>
              <input id="pac-tel-resp-fin" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-email-resp-fin">E-mail</label>
              <input id="pac-email-resp-fin" class="admin-input" type="email" />
            </div>
          </section>

          <section class="patient-form-section">
            <h3>Endereço</h3>
            <div class="patient-form-grid">
              <label class="admin-label required-label" for="pac-logradouro">Logradouro</label>
              <input id="pac-logradouro" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-numero">Número</label>
              <input id="pac-numero" class="admin-input" type="text" />

              <label class="admin-label" for="pac-complemento">Complemento</label>
              <input id="pac-complemento" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-cep">CEP</label>
              <input id="pac-cep" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-bairro">Bairro</label>
              <input id="pac-bairro" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-cidade">Cidade</label>
              <input id="pac-cidade" class="admin-input" type="text" />

              <label class="admin-label required-label" for="pac-uf">UF (2-letter)</label>
              <input id="pac-uf" class="admin-input" type="text" maxlength="2" />
            </div>
          </section>

          <section class="patient-form-section">
            <h3>Dados para Pagamento</h3>
            <div class="patient-form-grid">
              <label class="admin-label required-label" for="pac-forma-pagamento">Forma de Pagamento</label>
              <select id="pac-forma-pagamento" class="admin-input">
                <option value="">Selecione</option>
                <option value="PIX">PIX</option>
                <option value="Cartão">Cartão</option>
                <option value="Dinheiro">Dinheiro</option>
                <option value="Boleto">Boleto</option>
                <option value="Outro">Outro</option>
              </select>

              <label class="admin-label required-label" for="pac-dia-vencimento">Dia Vencimento</label>
              <input id="pac-dia-vencimento" class="admin-input" type="number" min="1" max="31" />
            </div>
          </section>

          <p id="pac-edit-feedback" class="admin-feedback"></p>

          <div class="admin-modal-actions">
            <button id="pac-edit-cancelar" type="button" class="admin-btn admin-btn-secondary">Cancelar</button>
            <button id="pac-edit-salvar" type="button" class="admin-btn admin-btn-primary">Salvar</button>
          </div>
        </div>
      </div>
    </div>

    <div id="pac-ficha-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal ficha-modal" role="dialog" aria-modal="true" aria-labelledby="pac-ficha-title">
        <button id="pac-ficha-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pac-ficha-title">Ficha do paciente</h2>
        <div id="pac-ficha-body" class="admin-card-body admin-modal-body"></div>
      </div>
    </div>

  `;

  const filtroInput = container.querySelector("#pac-filtro");
  const novoButton = container.querySelector("#pac-novo");
  const listaBody = container.querySelector("#pac-lista-body");
  const listaFeedback = container.querySelector("#pac-lista-feedback");

  const editOverlay = container.querySelector("#pac-edit-modal");
  const editCloseButton = container.querySelector("#pac-edit-close");
  const editCancelButton = container.querySelector("#pac-edit-cancelar");
  const editSaveButton = container.querySelector("#pac-edit-salvar");
  const editTitle = container.querySelector("#pac-edit-title");
  const editFeedback = container.querySelector("#pac-edit-feedback");

  const nomePacienteInput = container.querySelector("#pac-nome-paciente");
  const dataNascimentoInput = container.querySelector("#pac-data-nascimento");
  const cpfPacienteInput = container.querySelector("#pac-cpf-paciente");
  const nomeMaeInput = container.querySelector("#pac-nome-mae");
  const nomePaiInput = container.querySelector("#pac-nome-pai");
  const nomeResponsavelInput = container.querySelector("#pac-nome-responsavel");
  const vinculoInput = container.querySelector("#pac-vinculo");
  const telPrincipalInput = container.querySelector("#pac-tel-principal");
  const telSecundarioInput = container.querySelector("#pac-tel-secundario");
  const escolaNomeInput = container.querySelector("#pac-escola-nome");
  const coordenacaoInput = container.querySelector("#pac-coordenacao");
  const periodoInput = container.querySelector("#pac-periodo");
  const serieTurmaInput = container.querySelector("#pac-serie-turma");
  const respFinanceiroInput = container.querySelector("#pac-resp-financeiro");
  const respFinanceiroCpfCnpjInput = container.querySelector("#pac-cpf-cnpj-resp-fin");
  const respFinanceiroTelefoneInput = container.querySelector("#pac-tel-resp-fin");
  const respFinanceiroEmailInput = container.querySelector("#pac-email-resp-fin");
  const logradouroInput = container.querySelector("#pac-logradouro");
  const numeroInput = container.querySelector("#pac-numero");
  const complementoInput = container.querySelector("#pac-complemento");
  const cepInput = container.querySelector("#pac-cep");
  const bairroInput = container.querySelector("#pac-bairro");
  const cidadeInput = container.querySelector("#pac-cidade");
  const ufInput = container.querySelector("#pac-uf");
  const formaPagamentoInput = container.querySelector("#pac-forma-pagamento");
  const diaVencimentoInput = container.querySelector("#pac-dia-vencimento");

  const fichaOverlay = container.querySelector("#pac-ficha-modal");
  const fichaClose = container.querySelector("#pac-ficha-close");
  const fichaTitle = container.querySelector("#pac-ficha-title");
  const fichaBody = container.querySelector("#pac-ficha-body");

  function renderPatientsTable() {
    const filter = String(filtroInput.value || "").trim().toLowerCase();
    const filterDigits = onlyDigits(filter);

    const patients = sortByNome(
      Object.keys(patientsMap).map((id) => ({
        ...patientsMap[id],
        id
      }))
    ).filter((patient) => {
      if (!filter) {
        return true;
      }
      const text = buildFilterText(patient);
      const byText = text.includes(filter);
      const byDigits = filterDigits ? text.includes(filterDigits) : false;
      return byText || byDigits;
    });

    if (!patients.length) {
      listaBody.innerHTML = `
        <tr>
          <td colspan="6" class="admin-empty">Nenhum paciente cadastrado.</td>
        </tr>
      `;
      return;
    }

    listaBody.innerHTML = patients.map((patient) => {
      const core = getPatientCore(patient);
      const status = core.ativo ? "Ativo" : "Inativo";
      const actions = readOnly
        ? "<span class=\"admin-empty\">Somente leitura</span>"
        : `
          <div class="admin-inline-actions">
            ${iconBtn({ icon: ICON_EDIT, label: "Editar", action: "editar", dataId: patient.id, dataKey: "data-id" })}
            ${core.ativo
              ? iconBtn({ icon: ICON_EYE_OFF, label: "Inativar", action: "toggle", dataId: patient.id, dataKey: "data-id" })
              : iconBtn({ icon: ICON_EYE, label: "Ativar", action: "toggle", dataId: patient.id, dataKey: "data-id", cls: "admin-btn-icon--success" })}
          </div>
        `;

      return `
        <tr>
          <td>
            <button type="button" class="patient-name-link" data-action="ficha" data-id="${patient.id}">${core.nome || "-"}</button>
          </td>
          <td>${formatPhoneBR(core.telefoneDigits || core.telefone) || "-"}</td>
          <td>${formatCpfCnpj(core.cpf) || "-"}</td>
          <td>${formatDateBR(core.dataNascimento)}</td>
          <td>${status}</td>
          <td>${actions}</td>
        </tr>
      `;
    }).join("");
  }

  function resetEditForm() {
    editingPatientId = "";
    editTitle.textContent = "Novo paciente";
    editFeedback.textContent = "";
    nomePacienteInput.value = "";
    dataNascimentoInput.value = "";
    cpfPacienteInput.value = "";
    nomeMaeInput.value = "";
    nomePaiInput.value = "";
    nomeResponsavelInput.value = "";
    vinculoInput.value = "";
    telPrincipalInput.value = "";
    telSecundarioInput.value = "";
    escolaNomeInput.value = "";
    coordenacaoInput.value = "";
    periodoInput.value = "";
    serieTurmaInput.value = "";
    respFinanceiroInput.value = "";
    respFinanceiroCpfCnpjInput.value = "";
    respFinanceiroTelefoneInput.value = "";
    respFinanceiroEmailInput.value = "";
    logradouroInput.value = "";
    numeroInput.value = "";
    complementoInput.value = "";
    cepInput.value = "";
    bairroInput.value = "";
    cidadeInput.value = "";
    ufInput.value = "";
    formaPagamentoInput.value = "";
    diaVencimentoInput.value = "";
  }

  function openEditModal(patientId = "") {
    resetEditForm();

    if (patientId) {
      editingPatientId = patientId;
      editTitle.textContent = "Editar paciente";

      const patient = patientsMap[patientId];
      const perfil = buildPerfilFromPatient(patient);

      nomePacienteInput.value = perfil.pessoais.nomePaciente || "";
      dataNascimentoInput.value = perfil.pessoais.dataNascimento || "";
      cpfPacienteInput.value = formatCpfCnpj(perfil.pessoais.cpfPaciente || "");

      nomeMaeInput.value = perfil.filiacao.nomeMae || "";
      nomePaiInput.value = perfil.filiacao.nomePai || "";
      nomeResponsavelInput.value = perfil.filiacao.nomeResponsavel || "";
      vinculoInput.value = perfil.filiacao.vinculo || "";
      telPrincipalInput.value = formatPhoneBR(perfil.filiacao.telPrincipal || "");
      telSecundarioInput.value = formatPhoneBR(perfil.filiacao.telSecundario || "");

      escolaNomeInput.value = perfil.escolares.escolaNome || "";
      coordenacaoInput.value = perfil.escolares.coordenacao || "";
      periodoInput.value = perfil.escolares.periodo || "";
      serieTurmaInput.value = perfil.escolares.serieTurma || "";

      respFinanceiroInput.value = perfil.financeiros.respFinanceiroNome || "";
      respFinanceiroCpfCnpjInput.value = formatCpfCnpj(perfil.financeiros.respFinanceiroCpfCnpj || "");
      respFinanceiroTelefoneInput.value = formatPhoneBR(perfil.financeiros.respFinanceiroTelefone || "");
      respFinanceiroEmailInput.value = perfil.financeiros.respFinanceiroEmail || "";

      logradouroInput.value = perfil.endereco.logradouro || "";
      numeroInput.value = perfil.endereco.numero || "";
      complementoInput.value = perfil.endereco.complemento || "";
      cepInput.value = formatCep(perfil.endereco.cep || "");
      bairroInput.value = perfil.endereco.bairro || "";
      cidadeInput.value = perfil.endereco.cidade || "";
      ufInput.value = String(perfil.endereco.uf || "").toUpperCase().slice(0, 2);

      formaPagamentoInput.value = perfil.pagamento.formaPagamento || "";
      diaVencimentoInput.value = perfil.pagamento.diaVencimento || "";
    }

    openModal(editOverlay);
    window.setTimeout(() => nomePacienteInput.focus(), 0);
  }

  function openFichaModal(patientId) {
    const patient = patientsMap[patientId];
    if (!patient) {
      return;
    }

    const core = getPatientCore(patient);
    const perfil = buildPerfilFromPatient(patient);
    const source = patient?.source && typeof patient.source === "object" ? patient.source : {};
    const dadosOriginais = patient?.dadosOriginais && typeof patient.dadosOriginais === "object"
      ? patient.dadosOriginais
      : {};

    const patientDisplayName = [
      core.nome,
      perfil?.pessoais?.nomePaciente,
      patient?.nome,
      patient?.core?.nome
    ]
      .map((value) => String(value || "").trim())
      .find((value) => value);
    fichaTitle.textContent = patientDisplayName
      ? `Ficha do paciente — ${patientDisplayName}`
      : "Ficha do paciente";

    const display = (value, formatter = null) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Não informado";
      }
      const formatted = typeof formatter === "function" ? formatter(raw) : raw;
      return String(formatted || raw).trim() || "Não informado";
    };

    const fieldRow = (label, value) => `
      <div class="ficha-field-label">${label}</div>
      <div class="ficha-field-value">${value}</div>
    `;

    const sectionCard = (title, rowsHtml) => `
      <section class="ficha-section ficha-section-card">
        <h3>${title}</h3>
        <div class="ficha-fields-grid">
          ${rowsHtml}
        </div>
      </section>
    `;

    const originalRows = isAdmin
      ? Object.keys(dadosOriginais)
        .filter((key) => String(dadosOriginais[key] || "").trim() !== "")
        .map((key) => `
          <div class="ficha-original-grid-cell ficha-original-grid-key">${key}</div>
          <div class="ficha-original-grid-cell">${dadosOriginais[key]}</div>
        `)
        .join("")
      : "";

    const originalDataSection = isAdmin
      ? `
        <section class="ficha-section">
          <details class="ficha-collapsible">
            <summary>Dados originais</summary>
            <div class="ficha-collapsible-content">
              ${originalRows
                ? `
                  <div class="ficha-original-grid">
                    <div class="ficha-original-grid-cell ficha-original-grid-key ficha-original-grid-head">Campo</div>
                    <div class="ficha-original-grid-cell ficha-original-grid-head">Valor</div>
                    ${originalRows}
                  </div>
                `
                : '<p class="admin-empty">Nenhum dado original disponível.</p>'}
            </div>
          </details>
        </section>
      `
      : "";

    const dadosPessoaisHtml = sectionCard(
      "Dados Pessoais Paciente",
      [
        fieldRow("Nome do Paciente", display(perfil.pessoais.nomePaciente)),
        fieldRow("Data de Nascimento", display(perfil.pessoais.dataNascimento, formatDateBR)),
        fieldRow("CPF do Paciente", display(perfil.pessoais.cpfPaciente, formatCpfCnpj))
      ].join("")
    );

    const filiacaoHtml = sectionCard(
      "Filiação e Responsável",
      [
        fieldRow("Nome da Mãe", display(perfil.filiacao.nomeMae)),
        fieldRow("Nome do Pai", display(perfil.filiacao.nomePai)),
        fieldRow("Nome Responsável (Para contato)", display(perfil.filiacao.nomeResponsavel)),
        fieldRow("Vínculo", display(perfil.filiacao.vinculo)),
        fieldRow("Telefone / WhatsApp (Principal)", display(perfil.filiacao.telPrincipal, formatPhoneBR)),
        fieldRow("Telefone / WhatsApp (Secundário)", display(perfil.filiacao.telSecundario, formatPhoneBR))
      ].join("")
    );

    const escolaresHtml = sectionCard(
      "Dados Escolares",
      [
        fieldRow("Nome da Escola", display(perfil.escolares.escolaNome)),
        fieldRow("Coordenação", display(perfil.escolares.coordenacao)),
        fieldRow("Período", display(perfil.escolares.periodo)),
        fieldRow("Série / Turma", display(perfil.escolares.serieTurma))
      ].join("")
    );

    const financeirosHtml = sectionCard(
      "Dados Financeiros",
      [
        fieldRow("Responsável Financeiro", display(perfil.financeiros.respFinanceiroNome)),
        fieldRow("CPF Resp. Fin.", display(perfil.financeiros.respFinanceiroCpfCnpj, formatCpfCnpj)),
        fieldRow("Telefone / WhatsApp (Resp. Fin.)", display(perfil.financeiros.respFinanceiroTelefone, formatPhoneBR)),
        fieldRow("E-mail", display(perfil.financeiros.respFinanceiroEmail))
      ].join("")
    );

    const enderecoHtml = sectionCard(
      "Endereço",
      [
        fieldRow("Logradouro", display(perfil.endereco.logradouro)),
        fieldRow("Número", display(perfil.endereco.numero)),
        fieldRow("Complemento", display(perfil.endereco.complemento)),
        fieldRow("CEP", display(perfil.endereco.cep, formatCep)),
        fieldRow("Bairro", display(perfil.endereco.bairro)),
        fieldRow("Cidade", display(perfil.endereco.cidade)),
        fieldRow("UF", display(perfil.endereco.uf))
      ].join("")
    );

    const pagamentoHtml = sectionCard(
      "Dados para Pagamento",
      [
        fieldRow("Forma de Pagamento", display(perfil.pagamento.formaPagamento)),
        fieldRow("Dia Vencimento", display(perfil.pagamento.diaVencimento))
      ].join("")
    );

    const sourceSection = isAdmin
      ? `
        <section class="ficha-section">
          <h3>Origem do cadastro</h3>
          <p><strong>Import ID:</strong> ${String(source.importId || "").trim() || "-"}</p>
          <p><strong>Linha:</strong> ${Number.isFinite(Number(source.rowIndex)) ? Number(source.rowIndex) : "-"}</p>
          <p><strong>Importado em:</strong> ${Number.isFinite(Number(source.importedAt)) ? new Date(Number(source.importedAt)).toLocaleString("pt-BR") : "-"}</p>
        </section>
      `
      : "";

    const agendaSlots = getAgendaSlotsForDisplay(patient, dadosOriginais);

    const agendaRowBlocks = [];
    for (let i = 0; i < agendaSlots.length; i++) {
      const slot = agendaSlots[i];
      const terapia = normalizeAgendaTextValue(slot ? slot.terapia : "");
      const diaSemana = normalizeDiaSemana(normalizeAgendaTextValue(slot ? slot.diaSemana : ""));
      const profissional = normalizeAgendaTextValue(slot ? slot.profissional : "");

      const hasAnyValue = !!(terapia || diaSemana || profissional);
      if (!hasAnyValue) {
        continue;
      }

      const incomplete = !terapia || !diaSemana || !profissional;

      const terapiaHtml = terapia
        ? terapia
        : '<span class="muted">Não informado</span>';
      const diaHtml = diaSemana
        ? formatDiaSemanaLabel(diaSemana)
        : '<span class="muted">Não informado</span>';
      const profissionalHtml = profissional
        ? profissional
        : '<span class="muted">Não informado</span>';

      agendaRowBlocks.push(`
        <div class="agenda-grid-cell">${terapiaHtml}</div>
        <div class="agenda-grid-cell">${diaHtml}</div>
        <div class="agenda-grid-cell">${profissionalHtml}${incomplete ? ' <span class="badge-warn">Incompleto</span>' : ''}</div>
      `);
    }

    const hasAgendaData = agendaRowBlocks.length > 0;
    const agendaRows = hasAgendaData ? agendaRowBlocks.join("") : "";

    const agendaSection = `
      <section class="ficha-section">
        <h3>Agenda</h3>
        ${hasAgendaData
          ? `
            <div class="agenda-grid">
              <div class="agenda-grid-cell agenda-grid-head">Terapia</div>
              <div class="agenda-grid-cell agenda-grid-head">Dia</div>
              <div class="agenda-grid-cell agenda-grid-head">Profissional</div>
              ${agendaRows}
            </div>
          `
          : '<p class="muted">Agenda não informada.</p>'}
      </section>
    `;

    fichaBody.innerHTML = `
      ${dadosPessoaisHtml}
      ${filiacaoHtml}
      ${escolaresHtml}
      ${financeirosHtml}
      ${enderecoHtml}
      ${pagamentoHtml}

      ${agendaSection}

      ${sourceSection}

      ${originalDataSection}
    `;

    openModal(fichaOverlay);
  }

  async function refreshPatients() {
    const result = await listPatients();

    if (!result.ok) {
      setFeedback(listaFeedback, result.message || "Falha ao carregar pacientes.", "error");
      listaBody.innerHTML = `
        <tr>
          <td colspan="6" class="admin-error">Falha ao carregar pacientes.</td>
        </tr>
      `;
      return;
    }

    patientsMap = result.patients || {};
    const total = Object.keys(patientsMap).length;

    renderPatientsTable();
    setFeedback(listaFeedback, `${total} paciente(s) carregado(s).`, "info");
  }

  async function savePatient() {
    const current = editingPatientId ? patientsMap[editingPatientId] || {} : {};

    const perfilInput = {
      pessoais: {
        nomePaciente: nomePacienteInput.value,
        dataNascimento: dataNascimentoInput.value,
        cpfPaciente: cpfPacienteInput.value
      },
      filiacao: {
        nomeMae: nomeMaeInput.value,
        nomePai: nomePaiInput.value,
        nomeResponsavel: nomeResponsavelInput.value,
        vinculo: vinculoInput.value,
        telPrincipal: telPrincipalInput.value,
        telSecundario: telSecundarioInput.value
      },
      escolares: {
        escolaNome: escolaNomeInput.value,
        coordenacao: coordenacaoInput.value,
        periodo: periodoInput.value,
        serieTurma: serieTurmaInput.value
      },
      financeiros: {
        respFinanceiroNome: respFinanceiroInput.value,
        respFinanceiroCpfCnpj: respFinanceiroCpfCnpjInput.value,
        respFinanceiroTelefone: respFinanceiroTelefoneInput.value,
        respFinanceiroEmail: respFinanceiroEmailInput.value
      },
      endereco: {
        logradouro: logradouroInput.value,
        numero: numeroInput.value,
        complemento: complementoInput.value,
        cep: cepInput.value,
        bairro: bairroInput.value,
        cidade: cidadeInput.value,
        uf: ufInput.value
      },
      pagamento: {
        formaPagamento: formaPagamentoInput.value,
        diaVencimento: diaVencimentoInput.value
      }
    };

    const patch = buildPatientPatchFromPerfil(perfilInput, current);
    const payload = {
      ...current,
      ...patch,
      planoTerapias: current?.planoTerapias && typeof current.planoTerapias === "object" ? current.planoTerapias : {},
      dadosOriginais: current?.dadosOriginais && typeof current.dadosOriginais === "object" ? current.dadosOriginais : {},
      alertas: Array.isArray(current?.alertas) ? current.alertas : [],
      source: current?.source && typeof current.source === "object" ? current.source : {},
      legacy: current?.legacy && typeof current.legacy === "object" ? current.legacy : {}
    };

    if (editingPatientId) {
      const result = await updatePatient(editingPatientId, {
        ...payload,
        createdAt: Number.isFinite(Number(current.createdAt)) ? Number(current.createdAt) : payload.createdAt
      });

      if (!result.ok) {
        setFeedback(editFeedback, result.message || "Não foi possível atualizar paciente.", "error");
        return;
      }
    } else {
      const cpf = payload.cpf;
      const patientId = cpf.length >= 11
        ? `cpf_${cpf}`
        : `manual_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`;

      const result = await createPatient(patientId, payload);
      if (!result.ok) {
        setFeedback(editFeedback, result.message || "Não foi possível cadastrar paciente.", "error");
        return;
      }
    }

    closeModal(editOverlay);
    await refreshPatients();
  }

  if (novoButton) {
    novoButton.addEventListener("click", () => openEditModal());
  }

  editCloseButton.addEventListener("click", () => closeModal(editOverlay));
  editCancelButton.addEventListener("click", () => closeModal(editOverlay));
  editSaveButton.addEventListener("click", savePatient);

  [telPrincipalInput, telSecundarioInput, respFinanceiroTelefoneInput].forEach((input) => {
    input.addEventListener("blur", () => {
      input.value = formatPhoneBR(input.value);
    });
  });

  [cpfPacienteInput, respFinanceiroCpfCnpjInput].forEach((input) => {
    input.addEventListener("blur", () => {
      input.value = formatCpfCnpj(input.value);
    });
  });

  cepInput.addEventListener("blur", () => {
    cepInput.value = formatCep(cepInput.value);
  });

  dataNascimentoInput.addEventListener("blur", () => {
    const normalized = normalizeDate(dataNascimentoInput.value);
    if (normalized) {
      dataNascimentoInput.value = normalized;
    }
  });

  ufInput.addEventListener("blur", () => {
    ufInput.value = String(ufInput.value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  });

  fichaClose.addEventListener("click", () => closeModal(fichaOverlay));

  [editOverlay, fichaOverlay].forEach((overlay) => {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(overlay);
      }
    });
  });

  filtroInput.addEventListener("input", renderPatientsTable);

  listaBody.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) {
      return;
    }

    const action = trigger.dataset.action;
    const patientId = trigger.dataset.id;

    if (!patientId || !patientsMap[patientId]) {
      return;
    }

    if (action === "ficha") {
      openFichaModal(patientId);
      return;
    }

    if (readOnly) {
      return;
    }

    if (action === "editar") {
      openEditModal(patientId);
      return;
    }

    if (action === "toggle") {
      const currentCore = getPatientCore(patientsMap[patientId]);
      const result = await setPatientActive(patientId, !currentCore.ativo);
      if (!result.ok) {
        setFeedback(listaFeedback, result.message || "Não foi possível atualizar o status.", "error");
        return;
      }
      await refreshPatients();
    }
  });

  refreshPatients();
}
