export function render(container) {
  container.innerHTML = `
    <section class="grid">
      <article class="kpi">
        <small>Agendados</small>
        <strong>15</strong>
      </article>
      <article class="kpi">
        <small>Em atendimento</small>
        <strong>3</strong>
      </article>
      <article class="kpi">
        <small>Concluídos</small>
        <strong>4</strong>
      </article>
    </section>

    <article class="card">
      <h2>Agenda e atendimento</h2>
      <p>Visualize e atualize o status dos atendimentos: agendado, confirmado, em atendimento e concluído.</p>
    </article>
  `;
}
