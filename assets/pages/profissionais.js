import {
  listProfessionals,
  createProfessional,
  updateProfessional,
  setProfessionalActive,
  bulkImportProfessionalsWithAudit,
  readProfessionalsImportReport,
  getProfessionalsImportStatus
} from "../firebase.js";
import {
  onlyDigits,
  formatPhoneBR,
  formatCpf,
  formatCnpj,
  formatCpfCnpj
} from "../format.js";
import {
  ICON_EDIT,
  ICON_EYE,
  ICON_EYE_OFF,
  iconBtn
} from "../icons.js";

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
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

function detectCsvDelimiter(headerLine) {
  const line = String(headerLine || "");
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function normalizeCsvRowKeys(record = {}) {
  const normalized = {};

  Object.keys(record).forEach((key) => {
    const normalizedKey = normalizeHeaderKey(key);
    if (!normalizedKey) {
      return;
    }
    normalized[normalizedKey] = String(record[key] ?? "").trim();
  });

  return normalized;
}

function parseCsvProfessionals(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return {
      ok: false,
      rows: [],
      message: "Arquivo CSV vazio."
    };
  }

  const delimiter = detectCsvDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter);

  if (!headers.length) {
    return {
      ok: false,
      rows: [],
      message: "Cabeçalho inválido no CSV."
    };
  }

  const rows = [];

  for (let index = 1; index < lines.length; index += 1) {
    const values = parseCsvLine(lines[index], delimiter);
    const record = {};

    headers.forEach((header, hIndex) => {
      record[header] = values[hIndex] ?? "";
    });

    const normalized = normalizeCsvRowKeys(record);
    rows.push({
      ...normalized,
      rowIndex: index + 1
    });
  }

  return {
    ok: true,
    rows,
    message: "CSV carregado com sucesso."
  };
}

function buildNomeAbreviado(nomeCompleto) {
  const normalized = normalizeName(nomeCompleto);
  if (!normalized) {
    return "";
  }

  const parts = normalized.split(" ").filter(Boolean);
  const firstName = parts[0] || "";
  const lastName = parts[parts.length - 1] || "";

  if (parts.length === 1 || !lastName) {
    return firstName;
  }

  return `${firstName} ${lastName.charAt(0).toUpperCase()}.`;
}

function parseCurrencyInput(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }

  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maskCpfInput(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  }
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function maskCnpjInput(value) {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 2) {
    return digits;
  }
  if (digits.length <= 5) {
    return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  }
  if (digits.length <= 8) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  }
  if (digits.length <= 12) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  }
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

function maskPhoneInput(value) {
  const digits = onlyDigits(value).slice(0, 11);
  return formatPhoneBR(digits);
}

function formatRepasseValue(value, repasseTipo) {
  const parsed = Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;

  if (String(repasseTipo || "").toLowerCase() === "percentual") {
    return `${amount.toFixed(2).replace(".", ",")}%`;
  }

  return `R$ ${amount.toFixed(2).replace(".", ",")}`;
}

function normalizeProfessional(input = {}, id = "") {
  const repassePagamento = input.repassePagamento && typeof input.repassePagamento === "object"
    ? input.repassePagamento
    : {};

  return {
    id,
    nomeCompleto: normalizeName(input.nomeCompleto),
    nomeAbreviado: String(input.nomeAbreviado || "").trim(),
    cpf: onlyDigits(input.cpf),
    especialidade: String(input.especialidade || "").trim(),
    numeroConselho: String(input.numeroConselho || "").trim(),
    telefone: String(input.telefone || "").trim(),
    telefoneDigits: onlyDigits(input.telefoneDigits || input.telefone),
    email: String(input.email || "").trim().toLowerCase(),
    repasseTipo: String(input.repasseTipo || "Fixo").trim() || "Fixo",
    repasseValor: Number.isFinite(Number(input.repasseValor)) ? Number(input.repasseValor) : 0,
    cnpjVinculado: onlyDigits(input.cnpjVinculado),
    contratoTipo: String(input.contratoTipo || "").trim(),
    repassePagamento: {
      tipo: String(repassePagamento.tipo || "PIX").trim() || "PIX",
      pixChave: String(repassePagamento.pixChave || "").trim(),
      bancoNome: String(repassePagamento.bancoNome || "").trim(),
      agencia: String(repassePagamento.agencia || "").trim(),
      conta: String(repassePagamento.conta || "").trim(),
      status: String(repassePagamento.status || "").trim()
    },
    vinculos: input.vinculos && typeof input.vinculos === "object" ? input.vinculos : {},
    ativo: input.ativo !== false,
    createdAt: Number.isFinite(Number(input.createdAt)) ? Number(input.createdAt) : null,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : null
  };
}

function buildFilterText(professional) {
  return [
    professional.nomeCompleto,
    professional.nomeAbreviado,
    professional.especialidade,
    professional.cpf,
    formatCpfCnpj(professional.cpf),
    professional.telefone,
    professional.telefoneDigits
  ].join(" ").toLowerCase();
}

function formatDateTime(timestamp) {
  if (!Number.isFinite(Number(timestamp))) {
    return "Não informado";
  }

  try {
    return new Date(Number(timestamp)).toLocaleString("pt-BR");
  } catch (error) {
    return "Não informado";
  }
}

function fichaField(label, value) {
  const text = String(value || "").trim();
  return `
    <div class="ficha-field-label">${label}</div>
    <div class="ficha-field-value">${text || "Não informado"}</div>
  `;
}

export function render(container) {
  const role = String(window.__userProfile?.role || "").toLowerCase();
  const readOnly = role === "profissional";
  const canImport = !readOnly;

  let professionalsMap = {};
  let editingProfessionalId = "";
  let importRows = [];
  let importLastReportId = "";
  let importLocked = false;

  container.innerHTML = `
    <section class="admin-page professionals-page">
      <article class="card">
        <h2>Profissionais</h2>
        <p class="admin-card-text">Gerencie cadastro, repasse e status dos profissionais da clínica.</p>

        <div class="admin-card-body">
          <div class="admin-inline-actions">
            <input id="pro-filtro" class="admin-input admin-filter" type="text" placeholder="Filtrar por nome, especialidade, CPF, telefone ou abreviado" />
            ${readOnly ? "" : '<button id="pro-novo" type="button" class="admin-btn admin-btn-primary">Novo profissional</button>'}
          </div>

          <div class="admin-table-wrap">
            <table class="admin-table professionals-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Abreviado</th>
                  <th>Especialidade</th>
                  <th>Conselho</th>
                  <th>Telefone</th>
                  <th>CPF</th>
                  <th>Repasse</th>
                  <th>Ativo</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="pro-lista-body">
                <tr>
                  <td colspan="9" class="admin-empty">Carregando profissionais...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p id="pro-lista-feedback" class="admin-feedback"></p>
        </div>
      </article>

      ${canImport ? `
      <article id="pro-import-card" class="card">
        <h2>Importar lista inicial (uso único)</h2>
        <p class="admin-card-text">Importador CSV temporário para carga inicial de profissionais com auditoria.</p>

        <div class="admin-card-body">
          <input id="pro-import-file" class="admin-input" type="file" accept=".csv,text/csv" />
          <label class="admin-checkline" for="pro-import-clear">
            <input id="pro-import-clear" type="checkbox" />
            <span>Limpar base de profissionais antes de importar</span>
          </label>

          <div id="pro-import-preview" class="admin-result-box">Selecione um CSV para pré-visualizar.</div>

          <div class="admin-inline-actions">
            <button id="pro-import-btn" type="button" class="admin-btn admin-btn-primary" disabled>Importar agora</button>
            <button id="pro-import-report-btn" type="button" class="admin-btn admin-btn-secondary" style="display:none;">Ver auditoria</button>
          </div>

          <p id="pro-import-feedback" class="admin-feedback"></p>
          <p id="pro-import-error-details" class="admin-error-details"></p>
        </div>
      </article>
      ` : ""}
    </section>

    <div id="pro-edit-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal patient-edit-modal" role="dialog" aria-modal="true" aria-labelledby="pro-edit-title">
        <button id="pro-edit-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pro-edit-title">Novo profissional</h2>

        <div class="admin-card-body admin-modal-body">
          <section class="ficha-section ficha-section-card">
            <h3>Dados do profissional</h3>

            <label class="admin-label" for="pro-nome-completo">Nome completo</label>
            <input id="pro-nome-completo" class="admin-input" type="text" />

            <label class="admin-label" for="pro-nome-abreviado">Nome abreviado</label>
            <input id="pro-nome-abreviado" class="admin-input" type="text" readonly />

            <label class="admin-label" for="pro-cpf">CPF</label>
            <input id="pro-cpf" class="admin-input" type="text" inputmode="numeric" placeholder="Somente números" />

            <label class="admin-label" for="pro-especialidade">Especialidade</label>
            <input id="pro-especialidade" class="admin-input" type="text" />

            <label class="admin-label" for="pro-conselho">Número do conselho</label>
            <input id="pro-conselho" class="admin-input" type="text" />

            <label class="admin-label" for="pro-telefone">Telefone</label>
            <input id="pro-telefone" class="admin-input" type="text" />

            <label class="admin-label" for="pro-email">E-mail</label>
            <input id="pro-email" class="admin-input" type="email" />
          </section>

          <section class="ficha-section ficha-section-card">
            <h3>Repasse/Contrato</h3>

            <label class="admin-label" for="pro-repasse-tipo">Tipo de repasse</label>
            <select id="pro-repasse-tipo" class="admin-input">
              <option value="Fixo">Fixo</option>
              <option value="Percentual">Percentual</option>
              <option value="Outro">Outro</option>
            </select>

            <label class="admin-label" for="pro-repasse-valor">Valor do repasse</label>
            <input id="pro-repasse-valor" class="admin-input" type="text" inputmode="decimal" placeholder="Ex.: 1200,00 ou 30" />

            <label class="admin-label" for="pro-contrato-tipo">Tipo de contrato</label>
            <input id="pro-contrato-tipo" class="admin-input" type="text" />
          </section>

          <section class="ficha-section ficha-section-card">
            <h3>Pagamento do repasse</h3>

            <label class="admin-label" for="pro-pagamento-tipo">Tipo</label>
            <select id="pro-pagamento-tipo" class="admin-input">
              <option value="PIX">PIX</option>
              <option value="Banco">Banco</option>
            </select>

            <label class="admin-label" for="pro-pix-chave">PIX chave</label>
            <input id="pro-pix-chave" class="admin-input" type="text" />

            <label class="admin-label" for="pro-banco-nome">Banco</label>
            <input id="pro-banco-nome" class="admin-input" type="text" />

            <label class="admin-label" for="pro-agencia">Agência</label>
            <input id="pro-agencia" class="admin-input" type="text" />

            <label class="admin-label" for="pro-conta">Conta</label>
            <input id="pro-conta" class="admin-input" type="text" />

            <label class="admin-label" for="pro-status-pagamento">Status</label>
            <input id="pro-status-pagamento" class="admin-input" type="text" placeholder="Ex.: Ativo, Pendente" />
          </section>

          <section class="ficha-section ficha-section-card">
            <h3>CNPJ vinculado</h3>
            <label class="admin-label" for="pro-cnpj-vinculado">CNPJ</label>
            <input id="pro-cnpj-vinculado" class="admin-input" type="text" inputmode="numeric" />
          </section>

          <label class="admin-checkline" for="pro-ativo">
            <input id="pro-ativo" type="checkbox" checked />
            <span>Profissional ativo</span>
          </label>

          <p id="pro-edit-feedback" class="admin-feedback"></p>

          <div class="admin-modal-actions">
            <button id="pro-edit-cancelar" type="button" class="admin-btn admin-btn-secondary">Cancelar</button>
            <button id="pro-edit-salvar" type="button" class="admin-btn admin-btn-primary">Salvar</button>
          </div>
        </div>
      </div>
    </div>

    <div id="pro-ficha-modal" class="admin-modal-overlay" aria-hidden="true">
      <div class="admin-modal ficha-modal" role="dialog" aria-modal="true" aria-labelledby="pro-ficha-title">
        <button id="pro-ficha-close" type="button" class="admin-modal-close" aria-label="Fechar">×</button>
        <h2 id="pro-ficha-title">Ficha do profissional</h2>
        <div id="pro-ficha-body" class="admin-card-body admin-modal-body"></div>
      </div>
    </div>
  `;

  const filterInput = container.querySelector("#pro-filtro");
  const newButton = container.querySelector("#pro-novo");
  const listBody = container.querySelector("#pro-lista-body");
  const listFeedback = container.querySelector("#pro-lista-feedback");

  const editModalOverlay = container.querySelector("#pro-edit-modal");
  const editModalTitle = container.querySelector("#pro-edit-title");
  const editCloseButton = container.querySelector("#pro-edit-close");
  const editCancelButton = container.querySelector("#pro-edit-cancelar");
  const saveButton = container.querySelector("#pro-edit-salvar");
  const editFeedback = container.querySelector("#pro-edit-feedback");

  const nomeCompletoInput = container.querySelector("#pro-nome-completo");
  const nomeAbreviadoInput = container.querySelector("#pro-nome-abreviado");
  const cpfInput = container.querySelector("#pro-cpf");
  const especialidadeInput = container.querySelector("#pro-especialidade");
  const conselhoInput = container.querySelector("#pro-conselho");
  const telefoneInput = container.querySelector("#pro-telefone");
  const emailInput = container.querySelector("#pro-email");
  const repasseTipoInput = container.querySelector("#pro-repasse-tipo");
  const repasseValorInput = container.querySelector("#pro-repasse-valor");
  const contratoTipoInput = container.querySelector("#pro-contrato-tipo");
  const pagamentoTipoInput = container.querySelector("#pro-pagamento-tipo");
  const pixChaveInput = container.querySelector("#pro-pix-chave");
  const bancoNomeInput = container.querySelector("#pro-banco-nome");
  const agenciaInput = container.querySelector("#pro-agencia");
  const contaInput = container.querySelector("#pro-conta");
  const statusPagamentoInput = container.querySelector("#pro-status-pagamento");
  const cnpjVinculadoInput = container.querySelector("#pro-cnpj-vinculado");
  const ativoInput = container.querySelector("#pro-ativo");

  const fichaModalOverlay = container.querySelector("#pro-ficha-modal");
  const fichaCloseButton = container.querySelector("#pro-ficha-close");
  const fichaTitle = container.querySelector("#pro-ficha-title");
  const fichaBody = container.querySelector("#pro-ficha-body");

  const importCard = container.querySelector("#pro-import-card");
  const importFileInput = container.querySelector("#pro-import-file");
  const importClearInput = container.querySelector("#pro-import-clear");
  const importPreview = container.querySelector("#pro-import-preview");
  const importButton = container.querySelector("#pro-import-btn");
  const importReportButton = container.querySelector("#pro-import-report-btn");
  const importFeedback = container.querySelector("#pro-import-feedback");
  const importErrorDetails = container.querySelector("#pro-import-error-details");

  function setFeedback(element, message, type = "info") {
    const colors = {
      info: "#6b7280",
      success: "#065f46",
      error: "#b91c1c"
    };

    element.style.color = colors[type] || colors.info;
    element.textContent = message;
  }

  function closeEditModal() {
    editModalOverlay.classList.remove("open");
    editModalOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setFeedback(editFeedback, "", "info");
  }

  function openEditModal() {
    editModalOverlay.classList.add("open");
    editModalOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      nomeCompletoInput.focus();
    }, 0);
  }

  function closeFichaModal() {
    fichaModalOverlay.classList.remove("open");
    fichaModalOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function openFichaModal() {
    fichaModalOverlay.classList.add("open");
    fichaModalOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function clearEditForm() {
    nomeCompletoInput.value = "";
    nomeAbreviadoInput.value = "";
    cpfInput.value = "";
    especialidadeInput.value = "";
    conselhoInput.value = "";
    telefoneInput.value = "";
    emailInput.value = "";
    repasseTipoInput.value = "Fixo";
    repasseValorInput.value = "";
    contratoTipoInput.value = "";
    pagamentoTipoInput.value = "PIX";
    pixChaveInput.value = "";
    bancoNomeInput.value = "";
    agenciaInput.value = "";
    contaInput.value = "";
    statusPagamentoInput.value = "";
    cnpjVinculadoInput.value = "";
    ativoInput.checked = true;
    pagamentoTipoInput.value = "PIX";
    applyPagamentoMode();
    setFeedback(editFeedback, "", "info");
  }

  function populateEditForm(professional) {
    const normalized = normalizeProfessional(professional);
    nomeCompletoInput.value = normalized.nomeCompleto;
    nomeAbreviadoInput.value = normalized.nomeAbreviado;
    cpfInput.value = formatCpf(normalized.cpf) || normalized.cpf;
    especialidadeInput.value = normalized.especialidade;
    conselhoInput.value = normalized.numeroConselho;
    telefoneInput.value = formatPhoneBR(normalized.telefoneDigits || normalized.telefone) || normalized.telefone;
    emailInput.value = normalized.email;
    repasseTipoInput.value = normalized.repasseTipo || "Fixo";
    repasseValorInput.value = normalized.repasseValor ? String(normalized.repasseValor).replace(".", ",") : "";
    contratoTipoInput.value = normalized.contratoTipo;
    pagamentoTipoInput.value = normalized.repassePagamento.tipo || "PIX";
    pixChaveInput.value = normalized.repassePagamento.pixChave;
    bancoNomeInput.value = normalized.repassePagamento.bancoNome;
    agenciaInput.value = normalized.repassePagamento.agencia;
    contaInput.value = normalized.repassePagamento.conta;
    statusPagamentoInput.value = normalized.repassePagamento.status;
    cnpjVinculadoInput.value = formatCnpj(normalized.cnpjVinculado) || normalized.cnpjVinculado;
    ativoInput.checked = normalized.ativo !== false;
    applyPagamentoMode();
  }

  function applyPagamentoMode() {
    const paymentType = String(pagamentoTipoInput.value || "PIX").trim().toUpperCase();
    const isPix = paymentType === "PIX";

    pixChaveInput.disabled = !isPix;
    bancoNomeInput.disabled = isPix;
    agenciaInput.disabled = isPix;
    contaInput.disabled = isPix;

    if (isPix) {
      bancoNomeInput.value = "";
      agenciaInput.value = "";
      contaInput.value = "";
    } else {
      pixChaveInput.value = "";
    }
  }

  function setImportFeedback(message, type = "info") {
    if (!importFeedback) {
      return;
    }

    const colors = {
      info: "#6b7280",
      success: "#065f46",
      error: "#b91c1c"
    };

    importFeedback.style.color = colors[type] || colors.info;
    importFeedback.textContent = message;
  }

  function setImportErrorDetails(message) {
    if (!importErrorDetails) {
      return;
    }

    importErrorDetails.innerHTML = message ? `<small>${message}</small>` : "";
  }

  function renderImportPreview() {
    if (!importPreview) {
      return;
    }

    if (importLocked) {
      importPreview.innerHTML = "<strong>Importador bloqueado.</strong><p>Esta carga inicial já foi concluída.</p>";
      return;
    }

    if (!importRows.length) {
      importPreview.textContent = "Selecione um CSV para pré-visualizar.";
      return;
    }

    const previewNames = importRows
      .slice(0, 8)
      .map((row) => String(row.nomecompleto || row.nome || "Sem nome").trim())
      .filter(Boolean);

    const firstNames = previewNames.length
      ? `<ul class="patients-preview-list">${previewNames.map((name) => `<li>${name}</li>`).join("")}</ul>`
      : "<p>Sem nomes identificados nas primeiras linhas.</p>";

    importPreview.innerHTML = `
      <p><strong>Linhas detectadas:</strong> ${importRows.length}</p>
      <p><strong>Prévia (até 8 nomes):</strong></p>
      ${firstNames}
    `;
  }

  function setImportEnabled(enabled) {
    if (importFileInput) {
      importFileInput.disabled = !enabled;
    }
    if (importClearInput) {
      importClearInput.disabled = !enabled;
    }
    if (importButton) {
      importButton.disabled = !enabled || !importRows.length;
    }
  }

  async function loadImportStatus() {
    if (!canImport || !importCard) {
      return;
    }

    const status = await getProfessionalsImportStatus();

    if (!status.ok) {
      setImportFeedback(status.message || "Não foi possível validar o status do importador.", "error");
      setImportEnabled(false);
      return;
    }

    importLocked = status.enabled === false;
    importLastReportId = status.lastImportId || "";

    if (importReportButton && importLastReportId) {
      importReportButton.style.display = "inline-flex";
    }

    if (importLocked) {
      const completedText = Number.isFinite(Number(status.completedAt))
        ? new Date(Number(status.completedAt)).toLocaleString("pt-BR")
        : "data não informada";

      if (importCard) {
        importCard.style.display = "none";
      }

      setImportEnabled(false);
      setImportFeedback(`Importação inicial já concluída em ${completedText}.`, "info");
      renderImportPreview();
      return;
    }

    if (importCard) {
      importCard.style.display = "";
    }

    setImportEnabled(true);
    renderImportPreview();
  }

  async function showImportReport() {
    if (!importLastReportId) {
      setImportFeedback("Nenhum relatório disponível ainda.", "info");
      return;
    }

    const report = await readProfessionalsImportReport(importLastReportId);
    if (!report.ok) {
      setImportFeedback(report.message || "Não foi possível carregar relatório.", "error");
      return;
    }

    const stats = report.stats || {};
    const importErrors = Array.isArray(stats.importErrors) ? stats.importErrors : [];

    importPreview.innerHTML = `
      <p><strong>Relatório:</strong> ${importLastReportId}</p>
      <p><strong>Total:</strong> ${Number(stats.totalRowsDetected || 0)}</p>
      <p><strong>Importados:</strong> ${Number(stats.importedCount || 0)}</p>
      <p><strong>Ignorados vazios:</strong> ${Number(stats.skippedEmptyRows || 0)}</p>
      <p><strong>Sem CPF:</strong> ${Number(stats.semCpfCount || 0)}</p>
      <p><strong>Alertas:</strong> ${Number(stats.alertCount || 0)}</p>
    `;

    setImportErrorDetails(importErrors.length ? importErrors.slice(0, 5).join("<br />") : "");
    setImportFeedback("Relatório carregado com sucesso.", "success");
  }

  async function handleImportCsv() {
    if (!canImport || importLocked) {
      setImportFeedback("Importador bloqueado para novas cargas.", "error");
      return;
    }

    if (!importRows.length) {
      setImportFeedback("Selecione um CSV válido antes de importar.", "error");
      return;
    }

    const clearBeforeImport = importClearInput?.checked === true;

    if (clearBeforeImport) {
      const confirmed = window.confirm("Limpar toda a base de profissionais antes da importação?");
      if (!confirmed) {
        return;
      }
    }

    setImportEnabled(false);
    setImportFeedback("Importando profissionais...", "info");
    setImportErrorDetails("");

    const result = await bulkImportProfessionalsWithAudit(importRows, {
      clearBeforeImport
    });

    if (!result.ok) {
      setImportFeedback(result.message || "Falha ao importar profissionais.", "error");
      setImportErrorDetails(result.errorMessage || "");
      await loadImportStatus();
      return;
    }

    importLastReportId = result.lastImportId || "";
    if (importReportButton && importLastReportId) {
      importReportButton.style.display = "inline-flex";
    }

    const stats = result.stats || {};
    setImportFeedback(
      `Importação concluída. ${Number(stats.importedCount || 0)} profissionais importados.`,
      "success"
    );

    if (importFileInput) {
      importFileInput.value = "";
    }
    importRows = [];
    renderImportPreview();

    await loadProfessionals();
    await loadImportStatus();
  }

  function openCreateModal() {
    editingProfessionalId = "";
    editModalTitle.textContent = "Novo profissional";
    clearEditForm();
    openEditModal();
  }

  function openEditById(professionalId) {
    const professional = professionalsMap[professionalId];
    if (!professional) {
      setFeedback(listFeedback, "Profissional não encontrado.", "error");
      return;
    }

    editingProfessionalId = professionalId;
    editModalTitle.textContent = "Editar profissional";
    populateEditForm(professional);
    openEditModal();
  }

  function renderFicha(professional) {
    const normalized = normalizeProfessional(professional);
    fichaTitle.textContent = normalized.nomeCompleto
      ? `Ficha do profissional — ${normalized.nomeCompleto}`
      : "Ficha do profissional";

    fichaBody.innerHTML = `
      <section class="ficha-section ficha-section-card">
        <h3>Dados do profissional</h3>
        <div class="ficha-fields-grid">
          ${fichaField("Nome completo", normalized.nomeCompleto)}
          ${fichaField("Nome abreviado", normalized.nomeAbreviado)}
          ${fichaField("CPF", formatCpf(normalized.cpf) || "Não informado")}
          ${fichaField("Especialidade", normalized.especialidade)}
          ${fichaField("Conselho", normalized.numeroConselho)}
          ${fichaField("Telefone", formatPhoneBR(normalized.telefoneDigits || normalized.telefone) || "Não informado")}
          ${fichaField("E-mail", normalized.email)}
          ${fichaField("Status", normalized.ativo ? "Ativo" : "Inativo")}
        </div>
      </section>

      <section class="ficha-section ficha-section-card">
        <h3>Repasse e contrato</h3>
        <div class="ficha-fields-grid">
          ${fichaField("Tipo de repasse", normalized.repasseTipo)}
          ${fichaField("Valor de repasse", formatRepasseValue(normalized.repasseValor, normalized.repasseTipo))}
          ${fichaField("Tipo de contrato", normalized.contratoTipo)}
          ${fichaField("CNPJ vinculado", formatCnpj(normalized.cnpjVinculado) || "Não informado")}
        </div>
      </section>

      <section class="ficha-section ficha-section-card">
        <h3>Pagamento do repasse</h3>
        <div class="ficha-fields-grid">
          ${fichaField("Tipo", normalized.repassePagamento.tipo)}
          ${fichaField("PIX chave", normalized.repassePagamento.pixChave)}
          ${fichaField("Banco", normalized.repassePagamento.bancoNome)}
          ${fichaField("Agência", normalized.repassePagamento.agencia)}
          ${fichaField("Conta", normalized.repassePagamento.conta)}
          ${fichaField("Status", normalized.repassePagamento.status)}
        </div>
      </section>

      <section class="ficha-section ficha-section-card">
        <h3>Metadados</h3>
        <div class="ficha-fields-grid">
          ${fichaField("ID", normalized.id)}
          ${fichaField("Criado em", formatDateTime(normalized.createdAt))}
          ${fichaField("Atualizado em", formatDateTime(normalized.updatedAt))}
        </div>
      </section>
    `;
  }

  function renderTable() {
    const filter = String(filterInput.value || "").trim().toLowerCase();

    const rows = Object.values(professionalsMap)
      .filter((professional) => {
        if (!filter) {
          return true;
        }

        return buildFilterText(professional).includes(filter);
      })
      .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto));

    if (!rows.length) {
      listBody.innerHTML = `
        <tr>
          <td colspan="9" class="admin-empty">Nenhum profissional encontrado.</td>
        </tr>
      `;
      return;
    }

    listBody.innerHTML = rows.map((professional) => {
      const repasse = formatRepasseValue(professional.repasseValor, professional.repasseTipo);
      const statusClass = professional.ativo ? "status-active" : "status-inactive";
      const statusLabel = professional.ativo ? "Ativo" : "Inativo";

      const actions = readOnly
        ? "<span class=\"admin-empty\">Somente leitura</span>"
        : `
          <div class="admin-inline-actions">
            ${iconBtn({ icon: ICON_EDIT, label: "Editar", action: "editar", dataId: professional.id, dataKey: "data-id" })}
            ${professional.ativo
              ? iconBtn({ icon: ICON_EYE_OFF, label: "Inativar", action: "toggle", dataId: professional.id, dataKey: "data-id" })
              : iconBtn({ icon: ICON_EYE, label: "Ativar", action: "toggle", dataId: professional.id, dataKey: "data-id", cls: "admin-btn-icon--success" })}
          </div>
        `;

      return `
        <tr>
          <td>
            <button type="button" class="patient-name-link" data-action="ficha" data-id="${professional.id}">
              ${professional.nomeCompleto || "Não informado"}
            </button>
          </td>
          <td>${professional.nomeAbreviado || "-"}</td>
          <td>${professional.especialidade || "-"}</td>
          <td>${professional.numeroConselho || "-"}</td>
          <td>${formatPhoneBR(professional.telefoneDigits || professional.telefone) || "-"}</td>
          <td>${formatCpf(professional.cpf) || "-"}</td>
          <td>${repasse}</td>
          <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
          <td>${actions}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadProfessionals() {
    listBody.innerHTML = `
      <tr>
        <td colspan="9" class="admin-empty">Carregando profissionais...</td>
      </tr>
    `;

    const result = await listProfessionals();
    if (!result.ok) {
      listBody.innerHTML = `
        <tr>
          <td colspan="9" class="admin-empty admin-error">Falha ao carregar profissionais.</td>
        </tr>
      `;
      setFeedback(listFeedback, result.message || "Não foi possível carregar profissionais.", "error");
      return;
    }

    const normalizedMap = {};
    Object.entries(result.professionals || {}).forEach(([id, item]) => {
      normalizedMap[id] = normalizeProfessional(item, id);
    });

    professionalsMap = normalizedMap;
    renderTable();
  }

  async function handleSave() {
    const nomeCompleto = normalizeName(nomeCompletoInput.value);
    const nomeAbreviado = buildNomeAbreviado(nomeCompleto);
    nomeAbreviadoInput.value = nomeAbreviado;

    const payload = {
      nomeCompleto,
      nomeAbreviado,
      cpf: onlyDigits(cpfInput.value),
      especialidade: String(especialidadeInput.value || "").trim(),
      numeroConselho: String(conselhoInput.value || "").trim(),
      telefone: String(telefoneInput.value || "").trim(),
      telefoneDigits: onlyDigits(telefoneInput.value),
      email: String(emailInput.value || "").trim().toLowerCase(),
      repasseTipo: String(repasseTipoInput.value || "Fixo").trim(),
      repasseValor: parseCurrencyInput(repasseValorInput.value),
      cnpjVinculado: onlyDigits(cnpjVinculadoInput.value),
      contratoTipo: String(contratoTipoInput.value || "").trim(),
      repassePagamento: {
        tipo: String(pagamentoTipoInput.value || "PIX").trim(),
        pixChave: String(pixChaveInput.value || "").trim(),
        bancoNome: String(bancoNomeInput.value || "").trim(),
        agencia: String(agenciaInput.value || "").trim(),
        conta: String(contaInput.value || "").trim(),
        status: String(statusPagamentoInput.value || "").trim()
      },
      vinculos: editingProfessionalId
        ? (professionalsMap[editingProfessionalId]?.vinculos || {})
        : {},
      ativo: ativoInput.checked
    };

    if (!payload.nomeCompleto) {
      setFeedback(editFeedback, "Informe ao menos o nome completo do profissional.", "error");
      return;
    }

    saveButton.disabled = true;
    setFeedback(editFeedback, "Salvando profissional...", "info");

    let result;
    if (editingProfessionalId) {
      result = await updateProfessional(editingProfessionalId, payload);
    } else {
      result = await createProfessional(payload);
    }

    saveButton.disabled = false;

    if (!result?.ok) {
      setFeedback(editFeedback, result?.message || "Não foi possível salvar profissional.", "error");
      return;
    }

    await loadProfessionals();
    closeEditModal();
    setFeedback(listFeedback, result.message || "Profissional salvo com sucesso.", "success");
  }

  function openFichaById(professionalId) {
    const professional = professionalsMap[professionalId];
    if (!professional) {
      setFeedback(listFeedback, "Profissional não encontrado.", "error");
      return;
    }

    renderFicha(professional);
    openFichaModal();
  }

  filterInput.addEventListener("input", renderTable);

  if (newButton && !readOnly) {
    newButton.addEventListener("click", openCreateModal);
  }

  nomeCompletoInput.addEventListener("input", () => {
    nomeAbreviadoInput.value = buildNomeAbreviado(nomeCompletoInput.value);
  });

  cpfInput.addEventListener("input", () => {
    cpfInput.value = maskCpfInput(cpfInput.value);
  });

  cnpjVinculadoInput.addEventListener("input", () => {
    cnpjVinculadoInput.value = maskCnpjInput(cnpjVinculadoInput.value);
  });

  telefoneInput.addEventListener("input", () => {
    telefoneInput.value = maskPhoneInput(telefoneInput.value);
  });

  pagamentoTipoInput.addEventListener("change", applyPagamentoMode);

  if (importFileInput) {
    importFileInput.addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;

      importRows = [];
      setImportErrorDetails("");

      if (!file) {
        renderImportPreview();
        setImportEnabled(!importLocked);
        return;
      }

      const fileText = await file.text();
      const parsed = parseCsvProfessionals(fileText);

      if (!parsed.ok) {
        setImportFeedback(parsed.message || "CSV inválido.", "error");
        renderImportPreview();
        setImportEnabled(!importLocked);
        return;
      }

      importRows = parsed.rows || [];
      renderImportPreview();
      setImportEnabled(!importLocked);
      setImportFeedback("CSV carregado e pronto para importação.", "success");
    });
  }

  if (importButton) {
    importButton.addEventListener("click", handleImportCsv);
  }

  if (importReportButton) {
    importReportButton.addEventListener("click", showImportReport);
  }

  listBody.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("button[data-action][data-id]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.getAttribute("data-action") || "";
    const professionalId = actionButton.getAttribute("data-id") || "";
    const professional = professionalsMap[professionalId];

    if (!professionalId || !professional) {
      return;
    }

    if (action === "ficha") {
      openFichaById(professionalId);
      return;
    }

    if (readOnly) {
      return;
    }

    if (action === "editar") {
      openEditById(professionalId);
      return;
    }

    if (action === "toggle") {
      const nextActive = !professional.ativo;
      const result = await setProfessionalActive(professionalId, nextActive);
      if (!result.ok) {
        setFeedback(listFeedback, result.message || "Não foi possível atualizar o status.", "error");
        return;
      }

      professionalsMap[professionalId] = {
        ...professionalsMap[professionalId],
        ativo: nextActive,
        updatedAt: Date.now()
      };

      renderTable();
      setFeedback(listFeedback, result.message || "Status atualizado com sucesso.", "success");
    }
  });

  saveButton.addEventListener("click", handleSave);
  editCloseButton.addEventListener("click", closeEditModal);
  editCancelButton.addEventListener("click", closeEditModal);
  fichaCloseButton.addEventListener("click", closeFichaModal);

  editModalOverlay.addEventListener("click", (event) => {
    if (event.target === editModalOverlay) {
      closeEditModal();
    }
  });

  fichaModalOverlay.addEventListener("click", (event) => {
    if (event.target === fichaModalOverlay) {
      closeFichaModal();
    }
  });

  editModalOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && editModalOverlay.classList.contains("open")) {
      closeEditModal();
    }
  });

  fichaModalOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fichaModalOverlay.classList.contains("open")) {
      closeFichaModal();
    }
  });

  applyPagamentoMode();
  loadImportStatus();
  loadProfessionals();
}
