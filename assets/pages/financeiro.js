export function render(container) {
  container.innerHTML = `
    <section class="grid">
      <article class="kpi">
        <small>Receita (mês)</small>
        <strong>R$ 32.500,00</strong>
      </article>
      <article class="kpi">
        <small>Despesa (mês)</small>
        <strong>R$ 11.200,00</strong>
      </article>
      <article class="kpi">
        <small>Saldo (mês)</small>
        <strong>R$ 21.300,00</strong>
      </article>
    </section>

    <article class="card">
      <h2>Financeiro</h2>
      <p>Área para lançamentos de receita e despesa, com visão consolidada por período.</p>
    </article>
  `;
}
