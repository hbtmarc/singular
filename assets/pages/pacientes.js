import {
  listPatients,
  createPatient,
  updatePatient,
  setPatientActive,
  bulkImportPatientsWithAudit,
  readImportReport,
  clearPatientsBeforeImport
} from "../firebase.js";
import {
  onlyDigits,
  formatPhoneBR,
  formatCpfCnpj,
  formatCep,
  formatDateBR
} from "../format.js";

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeDateForStorage(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!br) {
    return null;
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

  return {
    nome: String(core.nome || patient.nome || "").trim(),
    cpf: onlyDigits(core.cpf || patient.cpf),
    telefone: String(core.telefone || patient.telefone || "").trim(),
    telefoneDigits: onlyDigits(core.telefoneDigits || patient.telefoneDigits || core.telefone || patient.telefone),
    dataNascimento: normalizeDateForStorage(core.dataNascimento || patient.dataNascimento),
    email: String(core.email || patient.email || "").trim().toLowerCase(),
    ativo: core.ativo !== false && patient.ativo !== false
  };
}

function getPatientEndereco(patient) {
  const endereco = patient?.endereco && typeof patient.endereco === "object" ? patient.endereco : {};
  return {
    cep: onlyDigits(endereco.cep || ""),
    logradouro: String(endereco.logradouro || "").trim(),
    bairro: String(endereco.bairro || "").trim(),
    cidade: String(endereco.cidade || "").trim()
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
  const isAdmin = userRole === "admin";
  const readOnly = userRole === "profissional";

  let patientsMap = {};
  let csvRows = [];
  let showAuditImport = false;
  let lastImportId = "";
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
            ${isAdmin ? '<button id="pac-reimportar" type="button" class="admin-btn admin-btn-secondary">Reimportar (modo auditoria)</button>' : ""}
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

      <article id="pac-import-card" class="card" style="display:none;">
        <h2>Importar lista inicial</h2>
        <p class="admin-card-text">Importe CSV com auditoria completa de linhas e estatísticas.</p>

        <div class="admin-card-body">
          ${isAdmin ? `
            <label class="admin-checkline" for="pac-import-clear">
              <input id="pac-import-clear" type="checkbox" />
              Limpar base antes de importar (apaga todos os pacientes)
            </label>
          ` : ""}

          <input id="pac-import-file" class="admin-input" type="file" accept=".csv" />
          <div id="pac-import-preview" class="admin-result-box">Selecione um arquivo CSV para pré-visualizar.</div>

          <div class="admin-inline-actions">
            <button id="pac-import-btn" type="button" class="admin-btn admin-btn-primary" disabled>Importar agora</button>
            <button id="pac-import-report-btn" type="button" class="admin-btn admin-btn-secondary" style="display:none;">Ver auditoria</button>
          </div>

          <p id="pac-import-feedback" class="admin-feedback"></p>
          <p id="pac-import-error-details" class="admin-error-details"></p>
        </div>
      </article>
    </section>

    <div id="pac-edit-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="pac-edit-title">
        <button id="pac-edit-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pac-edit-title">Novo paciente</h2>

        <div class="admin-card-body admin-modal-body">
          <label class="admin-label" for="pac-nome">Nome *</label>
          <input id="pac-nome" class="admin-input" type="text" placeholder="Nome completo" />

          <label class="admin-label" for="pac-telefone">Telefone *</label>
          <input id="pac-telefone" class="admin-input" type="text" placeholder="(00) 00000-0000" />

          <label class="admin-label" for="pac-cpf">CPF/CNPJ</label>
          <input id="pac-cpf" class="admin-input" type="text" placeholder="000.000.000-00 ou 00.000.000/0000-00" />

          <label class="admin-label" for="pac-data">Data de nascimento</label>
          <input id="pac-data" class="admin-input" type="date" />

          <label class="admin-label" for="pac-email">E-mail</label>
          <input id="pac-email" class="admin-input" type="email" placeholder="paciente@email.com" />

          <label class="admin-label" for="pac-resp">Responsável financeiro</label>
          <input id="pac-resp" class="admin-input" type="text" placeholder="Nome do responsável" />

          <label class="admin-label" for="pac-cep">CEP</label>
          <input id="pac-cep" class="admin-input" type="text" placeholder="00000-000" />

          <label class="admin-label" for="pac-end">Endereço</label>
          <input id="pac-end" class="admin-input" type="text" placeholder="Rua, número" />

          <label class="admin-label" for="pac-bairro">Bairro</label>
          <input id="pac-bairro" class="admin-input" type="text" placeholder="Bairro" />

          <label class="admin-label" for="pac-cidade">Cidade</label>
          <input id="pac-cidade" class="admin-input" type="text" placeholder="Cidade" />

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

    <div id="pac-report-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal ficha-modal" role="dialog" aria-modal="true" aria-labelledby="pac-report-title">
        <button id="pac-report-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pac-report-title">Relatório do import</h2>
        <div id="pac-report-body" class="admin-card-body admin-modal-body"></div>
      </div>
    </div>
  `;

  const filtroInput = container.querySelector("#pac-filtro");
  const novoButton = container.querySelector("#pac-novo");
  const reimportarButton = container.querySelector("#pac-reimportar");
  const listaBody = container.querySelector("#pac-lista-body");
  const listaFeedback = container.querySelector("#pac-lista-feedback");

  const importCard = container.querySelector("#pac-import-card");
  const importFileInput = container.querySelector("#pac-import-file");
  const importClearInput = container.querySelector("#pac-import-clear");
  const importPreview = container.querySelector("#pac-import-preview");
  const importButton = container.querySelector("#pac-import-btn");
  const importFeedback = container.querySelector("#pac-import-feedback");
  const importErrorDetails = container.querySelector("#pac-import-error-details");
  const importReportButton = container.querySelector("#pac-import-report-btn");

  const editOverlay = container.querySelector("#pac-edit-modal");
  const editCloseButton = container.querySelector("#pac-edit-close");
  const editCancelButton = container.querySelector("#pac-edit-cancelar");
  const editSaveButton = container.querySelector("#pac-edit-salvar");
  const editTitle = container.querySelector("#pac-edit-title");
  const editFeedback = container.querySelector("#pac-edit-feedback");

  const nomeInput = container.querySelector("#pac-nome");
  const telefoneInput = container.querySelector("#pac-telefone");
  const cpfInput = container.querySelector("#pac-cpf");
  const dataInput = container.querySelector("#pac-data");
  const emailInput = container.querySelector("#pac-email");
  const responsavelInput = container.querySelector("#pac-resp");
  const cepInput = container.querySelector("#pac-cep");
  const enderecoInput = container.querySelector("#pac-end");
  const bairroInput = container.querySelector("#pac-bairro");
  const cidadeInput = container.querySelector("#pac-cidade");

  const fichaOverlay = container.querySelector("#pac-ficha-modal");
  const fichaClose = container.querySelector("#pac-ficha-close");
  const fichaBody = container.querySelector("#pac-ficha-body");

  const reportOverlay = container.querySelector("#pac-report-modal");
  const reportClose = container.querySelector("#pac-report-close");
  const reportBody = container.querySelector("#pac-report-body");

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
            <button type="button" class="admin-btn admin-btn-secondary" data-action="editar" data-id="${patient.id}">Editar</button>
            <button type="button" class="admin-btn admin-btn-secondary" data-action="toggle" data-id="${patient.id}">${core.ativo ? "Inativar" : "Ativar"}</button>
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
    nomeInput.value = "";
    telefoneInput.value = "";
    cpfInput.value = "";
    dataInput.value = "";
    emailInput.value = "";
    responsavelInput.value = "";
    cepInput.value = "";
    enderecoInput.value = "";
    bairroInput.value = "";
    cidadeInput.value = "";
  }

  function openEditModal(patientId = "") {
    resetEditForm();

    if (patientId) {
      editingPatientId = patientId;
      editTitle.textContent = "Editar paciente";

      const patient = patientsMap[patientId];
      const core = getPatientCore(patient);
      const endereco = getPatientEndereco(patient);

      nomeInput.value = core.nome;
      telefoneInput.value = core.telefone;
      cpfInput.value = core.cpf;
      dataInput.value = core.dataNascimento || "";
      emailInput.value = core.email;
      responsavelInput.value = String(patient?.responsavelFinanceiro || "").trim();
      cepInput.value = endereco.cep;
      enderecoInput.value = endereco.logradouro;
      bairroInput.value = endereco.bairro;
      cidadeInput.value = endereco.cidade;
    }

    openModal(editOverlay);
    window.setTimeout(() => nomeInput.focus(), 0);
  }

  function openFichaModal(patientId) {
    const patient = patientsMap[patientId];
    if (!patient) {
      return;
    }

    const core = getPatientCore(patient);
    const endereco = getPatientEndereco(patient);
    const source = patient?.source && typeof patient.source === "object" ? patient.source : {};
    const dadosOriginais = patient?.dadosOriginais && typeof patient.dadosOriginais === "object"
      ? patient.dadosOriginais
      : {};

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

    const telefoneFormatado = formatPhoneBR(core.telefoneDigits || core.telefone) || "-";
    const cpfCnpjFormatado = formatCpfCnpj(core.cpf) || "-";
    const cepFormatado = formatCep(endereco.cep) || "-";

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

    fichaBody.innerHTML = `
      <section class="ficha-section">
        <h3>Dados principais</h3>
        <p><strong>Nome:</strong> ${core.nome || "-"}</p>
        <p><strong>CPF/CNPJ:</strong> ${cpfCnpjFormatado}</p>
        <p><strong>Telefone:</strong> ${telefoneFormatado}</p>
        <p><strong>Nascimento:</strong> ${formatDateBR(core.dataNascimento)}</p>
        <p><strong>E-mail:</strong> ${core.email || "-"}</p>
        <p><strong>Ativo:</strong> ${core.ativo ? "Sim" : "Não"}</p>
      </section>

      <section class="ficha-section">
        <h3>Endereço</h3>
        <p><strong>CEP:</strong> ${cepFormatado}</p>
        <p><strong>Logradouro:</strong> ${endereco.logradouro || "-"}</p>
        <p><strong>Bairro:</strong> ${endereco.bairro || "-"}</p>
        <p><strong>Cidade:</strong> ${endereco.cidade || "-"}</p>
      </section>

      <section class="ficha-section">
        <h3>Responsável financeiro</h3>
        <p>${String(patient?.responsavelFinanceiro || "").trim() || "Não informado"}</p>
      </section>

      ${sourceSection}

      ${originalDataSection}
    `;

    openModal(fichaOverlay);
  }

  async function openImportReportModal(importId) {
    reportBody.innerHTML = "<p class=\"admin-empty\">Carregando relatório...</p>";
    openModal(reportOverlay);

    const report = await readImportReport(importId);
    if (!report.ok) {
      reportBody.innerHTML = `<p class="admin-error">${report.message || "Não foi possível carregar o relatório."}</p>`;
      return;
    }

    const stats = report.stats || {};
    const rows = report.rows || {};

    const rowsList = Object.keys(rows)
      .map((rowIndex) => ({ rowIndex: Number(rowIndex), ...rows[rowIndex] }))
      .sort((a, b) => a.rowIndex - b.rowIndex);

    const problematic = rowsList.filter((row) => row.status !== "importado" || row.erro || (Array.isArray(row.alertas) && row.alertas.length));

    reportBody.innerHTML = `
      <section class="ficha-section">
        <h3>Resumo</h3>
        <p><strong>Total de linhas:</strong> ${stats.totalLinhas || 0}</p>
        <p><strong>Total detectado:</strong> ${stats.totalRowsDetected || stats.totalLinhas || 0}</p>
        <p><strong>Linhas vazias ignoradas:</strong> ${stats.skippedEmptyRows || 0}</p>
        <p><strong>Importados:</strong> ${stats.importedCount || stats.importados || 0}</p>
        <p><strong>Sem CPF:</strong> ${stats.semCpfCount || stats.semCpf || 0}</p>
        <p><strong>Alertas:</strong> ${stats.alertCount || 0}</p>
        <p><strong>Início:</strong> ${stats.startedAt ? new Date(stats.startedAt).toLocaleString("pt-BR") : "-"}</p>
        <p><strong>Fim:</strong> ${stats.finishedAt ? new Date(stats.finishedAt).toLocaleString("pt-BR") : "-"}</p>
      </section>

      <section class="ficha-section">
        <h3>Linhas ignoradas/erro</h3>
        ${problematic.length
          ? `
            <div class="ficha-original-grid">
              <div class="ficha-original-grid-cell ficha-original-grid-key ficha-original-grid-head">Linha</div>
              <div class="ficha-original-grid-cell ficha-original-grid-head">Detalhe</div>
              ${problematic.map((row) => `
                <div class="ficha-original-grid-cell ficha-original-grid-key">${row.rowIndex}</div>
                <div class="ficha-original-grid-cell">
                  ${row.status || "-"}
                  ${row.erro ? ` • ${row.erro}` : ""}
                  ${Array.isArray(row.alertas) && row.alertas.length ? ` • alertas: ${row.alertas.join("; ")}` : ""}
                </div>
              `).join("")}
            </div>
          `
          : '<p class="admin-empty">Nenhuma linha problemática neste import.</p>'}
      </section>
    `;
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
      importCard.style.display = "none";
      return;
    }

    patientsMap = result.patients || {};
    const total = Object.keys(patientsMap).length;

    renderPatientsTable();
    setFeedback(listaFeedback, `${total} paciente(s) carregado(s).`, "info");

    const shouldShowImport = total === 0 || (showAuditImport && isAdmin);
    importCard.style.display = shouldShowImport ? "" : "none";

    if (!shouldShowImport) {
      csvRows = [];
      importPreview.innerHTML = "Selecione um arquivo CSV para pré-visualizar.";
      importButton.disabled = true;
      importReportButton.style.display = "none";
      importFeedback.textContent = "";
      setErrorDetails(importErrorDetails, "", "");
    }
  }

  async function savePatient() {
    const nome = normalizeName(nomeInput.value);
    const telefoneRaw = String(telefoneInput.value || "").trim();
    const telefoneDigits = onlyDigits(telefoneRaw);

    if (!nome || !telefoneRaw) {
      setFeedback(editFeedback, "Nome e telefone são obrigatórios.", "error");
      return;
    }

    const payload = {
      core: {
        nome,
        cpf: onlyDigits(cpfInput.value),
        telefone: telefoneRaw,
        telefoneDigits,
        dataNascimento: normalizeDateForStorage(dataInput.value),
        email: String(emailInput.value || "").trim().toLowerCase(),
        ativo: true
      },
      endereco: {
        cep: onlyDigits(cepInput.value),
        logradouro: String(enderecoInput.value || "").trim(),
        bairro: String(bairroInput.value || "").trim(),
        cidade: String(cidadeInput.value || "").trim()
      },
      responsavelFinanceiro: String(responsavelInput.value || "").trim()
    };

    if (editingPatientId) {
      const current = patientsMap[editingPatientId] || {};
      const result = await updatePatient(editingPatientId, {
        ...current,
        ...payload,
        createdAt: Number.isFinite(Number(current.createdAt)) ? Number(current.createdAt) : Date.now()
      });

      if (!result.ok) {
        setFeedback(editFeedback, result.message || "Não foi possível atualizar paciente.", "error");
        return;
      }
    } else {
      const cpf = payload.core.cpf;
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

  if (reimportarButton) {
    reimportarButton.addEventListener("click", () => {
      showAuditImport = !showAuditImport;
      reimportarButton.textContent = showAuditImport
        ? "Ocultar reimportação"
        : "Reimportar (modo auditoria)";
      refreshPatients();
    });
  }

  editCloseButton.addEventListener("click", () => closeModal(editOverlay));
  editCancelButton.addEventListener("click", () => closeModal(editOverlay));
  editSaveButton.addEventListener("click", savePatient);

  telefoneInput.addEventListener("blur", () => {
    telefoneInput.value = formatPhoneBR(telefoneInput.value);
  });

  cpfInput.addEventListener("blur", () => {
    cpfInput.value = formatCpfCnpj(cpfInput.value);
  });

  cepInput.addEventListener("blur", () => {
    cepInput.value = formatCep(cepInput.value);
  });

  fichaClose.addEventListener("click", () => closeModal(fichaOverlay));
  reportClose.addEventListener("click", () => closeModal(reportOverlay));

  [editOverlay, fichaOverlay, reportOverlay].forEach((overlay) => {
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

  importFileInput.addEventListener("change", async () => {
    importButton.disabled = true;
    importReportButton.style.display = "none";
    lastImportId = "";
    setErrorDetails(importErrorDetails, "", "");

    const file = importFileInput.files?.[0];
    if (!file) {
      csvRows = [];
      importPreview.innerHTML = "Selecione um arquivo CSV para pré-visualizar.";
      return;
    }

    try {
      const text = await readCsvFile(file);
      csvRows = parseCsvToRows(text);

      const nonEmptyRows = csvRows.filter((row) => {
        const values = Object.values(row.rawRow || {});
        return values.some((value) => String(value || "").trim() !== "");
      });

      const skippedEmptyRows = csvRows.length - nonEmptyRows.length;
      const preview = csvRows.slice(0, 5);
      const comCpf = nonEmptyRows.filter((row) => {
        const core = buildCoreFromCsvRow(row.rawRow, row.normalizedRow);
        return core.cpf.length >= 11;
      }).length;
      const semCpf = nonEmptyRows.length - comCpf;

      importPreview.innerHTML = `
        <p><strong>Total detectado:</strong> ${nonEmptyRows.length}</p>
        <p><strong>Linhas vazias ignoradas:</strong> ${skippedEmptyRows}</p>
        <p><strong>Com CPF:</strong> ${comCpf}</p>
        <p><strong>Sem CPF:</strong> ${semCpf}</p>
        <p><strong>Prévia (5 primeiras linhas):</strong></p>
        <ul class="patients-preview-list">
          ${preview.map((row) => {
            const core = buildCoreFromCsvRow(row.rawRow, row.normalizedRow);
            return `<li><strong>${core.nome || "Sem nome"}</strong> • ${core.telefone || "Sem telefone"} • ${core.cpf || "sem CPF"}</li>`;
          }).join("")}
        </ul>
      `;

      importButton.disabled = csvRows.length === 0;
      setFeedback(importFeedback, "Prévia carregada. Pronto para importar.", "info");
    } catch (error) {
      csvRows = [];
      importPreview.innerHTML = "Não foi possível processar o CSV selecionado.";
      setFeedback(importFeedback, "Falha na leitura do arquivo CSV.", "error");
      setErrorDetails(importErrorDetails, error?.code || "csv/read-failed", error?.message || "Falha ao ler arquivo.");
    }
  });

  importButton.addEventListener("click", async () => {
    if (!csvRows.length) {
      setFeedback(importFeedback, "Nenhuma linha disponível para importar.", "error");
      return;
    }

    const preparedRows = csvRows.map((row) => {
      const core = buildCoreFromCsvRow(row.rawRow, row.normalizedRow);
      const endereco = buildEnderecoFromCsvRow(row.rawRow, row.normalizedRow);
      const legacy = buildLegacyFromCsvRow(row.rawRow, row.normalizedRow);
      const responsavelFinanceiro = String(
        row.rawRow["Resp.Fin"] || row.normalizedRow.respfin || ""
      ).trim();

      return {
        rowIndex: row.rowIndex,
        core,
        endereco,
        legacy,
        responsavelFinanceiro,
        dadosOriginais: row.rawRow
      };
    });

    importButton.disabled = true;
    importReportButton.style.display = "none";
    setErrorDetails(importErrorDetails, "", "");

    if (isAdmin && importClearInput?.checked) {
      const clearResult = await clearPatientsBeforeImport(Object.keys(patientsMap));
      if (!clearResult.ok) {
        setFeedback(importFeedback, clearResult.message || "Falha ao limpar base antes da importação.", "error");
        setErrorDetails(importErrorDetails, clearResult.errorCode, clearResult.errorMessage);
        importButton.disabled = false;
        return;
      }
    }

    const result = await bulkImportPatientsWithAudit(preparedRows, {
      onProgress: (current, total) => {
        setFeedback(importFeedback, `Importando... (${current}/${total})`, "info");
      }
    });

    if (!result.ok) {
      setFeedback(importFeedback, result.message || "Falha na importação.", "error");
      setErrorDetails(importErrorDetails, result.errorCode, result.errorMessage);
      importButton.disabled = false;
      return;
    }

    lastImportId = result.lastImportId || "";
    setFeedback(
      importFeedback,
      `Importação concluída. totalRowsDetected=${result.stats.totalRowsDetected || 0}, skippedEmptyRows=${result.stats.skippedEmptyRows || 0}, importedCount=${result.stats.importedCount || 0}, semCpfCount=${result.stats.semCpfCount || 0}, alertCount=${result.stats.alertCount || 0}, lastImportId=${lastImportId || "-"}.`,
      "success"
    );

    if (result.auditWriteOk === false) {
      setErrorDetails(importErrorDetails, result.errorCode, result.errorMessage);
    }

    importReportButton.style.display = "inline-flex";
    importButton.disabled = true;

    // Após importar uma base vazia, oculta o card; em modo auditoria admin, mantém visível.
    if (!showAuditImport) {
      importCard.style.display = "none";
    }

    await refreshPatients();
  });

  importReportButton.addEventListener("click", async () => {
    if (!lastImportId) {
      setFeedback(importFeedback, "Nenhum import recente disponível para relatório.", "error");
      return;
    }
    await openImportReportModal(lastImportId);
  });

  refreshPatients();
}
