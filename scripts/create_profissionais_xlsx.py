from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from datetime import datetime, timezone
from xml.sax.saxutils import escape

headers = [
    "nomeCompleto",
    "cpf",
    "especialidade",
    "numeroConselho",
    "telefone",
    "email",
    "repasseTipo",
    "repasseValor",
    "cnpjVinculado",
    "contratoTipo",
    "repassePagamento.tipo",
    "repassePagamento.pixChave",
    "repassePagamento.bancoNome",
    "repassePagamento.agencia",
    "repassePagamento.conta",
    "repassePagamento.status",
    "ativo",
]

rows = [
    [
        "Ana Flávia Silva",
        "12345678901",
        "Psicologia",
        "CRP 06/12345",
        "(11) 98888-7777",
        "ana.silva@clinica.com",
        "Percentual",
        "30",
        "12345678000199",
        "PJ",
        "PIX",
        "ana@pix.com",
        "",
        "",
        "",
        "Ativo",
        "true",
    ],
    [
        "Bruno Rocha",
        "",
        "Fonoaudiologia",
        "CREFONO 2-54321",
        "11977776666",
        "bruno@clinica.com",
        "Fixo",
        "2500,00",
        "",
        "CLT",
        "Banco",
        "",
        "Banco do Brasil",
        "1234",
        "98765-0",
        "Pendente",
        "true",
    ],
]

all_rows = [headers] + rows


def col_letter(index_1_based: int) -> str:
    result = ""
    n = index_1_based
    while n:
        n, rem = divmod(n - 1, 26)
        result = chr(65 + rem) + result
    return result


shared_values = []
shared_index = {}

for row in all_rows:
    for value in row:
        text = "" if value is None else str(value)
        if text not in shared_index:
            shared_index[text] = len(shared_values)
            shared_values.append(text)

sheet_rows_xml = []
for r_idx, row in enumerate(all_rows, start=1):
    cells = []
    for c_idx, value in enumerate(row, start=1):
        ref = f"{col_letter(c_idx)}{r_idx}"
        s_idx = shared_index[str(value)]
        cells.append(f'<c r="{ref}" t="s"><v>{s_idx}</v></c>')
    sheet_rows_xml.append(f'<row r="{r_idx}">{"".join(cells)}</row>')

sheet_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheetData>'
    + "".join(sheet_rows_xml)
    + '</sheetData></worksheet>'
)

shared_items_xml = "".join([f"<si><t>{escape(value)}</t></si>" for value in shared_values])
shared_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    f'count="{len(shared_values)}" uniqueCount="{len(shared_values)}">'
    + shared_items_xml
    + '</sst>'
)

workbook_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    '<sheets><sheet name="Profissionais" sheetId="1" r:id="rId1"/></sheets>'
    '</workbook>'
)

styles_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    '</styleSheet>'
)

content_types_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    '</Types>'
)

rels_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    '</Relationships>'
)

workbook_rels_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    '</Relationships>'
)

created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
core_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
    'xmlns:dc="http://purl.org/dc/elements/1.1/" '
    'xmlns:dcterms="http://purl.org/dc/terms/" '
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    '<dc:title>Profissionais Modelo</dc:title>'
    '<dc:creator>Copilot</dc:creator>'
    '<cp:lastModifiedBy>Copilot</cp:lastModifiedBy>'
    f'<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>'
    f'<dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>'
    '</cp:coreProperties>'
)

app_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" '
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    '<Application>Microsoft Excel</Application>'
    '</Properties>'
)

output = Path("/Users/marcelino/Documents/VSCODE/singular/profissionais_modelo.xlsx")
output.parent.mkdir(parents=True, exist_ok=True)

with ZipFile(output, "w", compression=ZIP_DEFLATED) as zf:
    zf.writestr("[Content_Types].xml", content_types_xml)
    zf.writestr("_rels/.rels", rels_xml)
    zf.writestr("docProps/core.xml", core_xml)
    zf.writestr("docProps/app.xml", app_xml)
    zf.writestr("xl/workbook.xml", workbook_xml)
    zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels_xml)
    zf.writestr("xl/styles.xml", styles_xml)
    zf.writestr("xl/sharedStrings.xml", shared_xml)
    zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)

print(output)
