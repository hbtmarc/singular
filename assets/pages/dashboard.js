export function render(container) {
  container.innerHTML = `
    <section class="grid">
      <article class="kpi">
        <small>Pacientes ativos</small>
        <strong>128</strong>
      </article>
      <article class="kpi">
        <small>Atendimentos hoje</small>
        <strong>22</strong>
      </article>
      <article class="kpi">
        <small>Profissionais em agenda</small>
        <strong>10</strong>
      </article>
    </section>

    <article class="card">
      <h2>Resumo do dia</h2>
      <p>Bem-vindo ao painel da Singular. Aqui você acompanha os principais números da clínica de forma rápida.</p>
    </article>
  `;
}
