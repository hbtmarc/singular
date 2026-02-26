export function render(container) {
  container.innerHTML = `
    <article class="card">
      <h2>Lista de pacientes</h2>
      <p>Este módulo reúne cadastro, busca e status dos pacientes da clínica.</p>
      <ul>
        <li>Campos principais: nome, CPF, telefone e data de nascimento.</li>
        <li>Ações comuns: cadastrar, editar e inativar.</li>
      </ul>
    </article>

    <article class="card">
      <h2>Próximo passo</h2>
      <p>Integrar este módulo com o Firestore para leitura e gravação dos dados.</p>
    </article>
  `;
}
