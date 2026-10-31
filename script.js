/* =====================================================================
   SCRIPT.JS — Sistema de pedidos (POO + CRUD)
   Fluxo: Repositorio (dados) -> render*() (tela) -> eventos (ações)
   ===================================================================== */

/* ---------- Utilidades ---------- */
const $ = (s) => document.querySelector(s);
// Formata número como moeda brasileira: 22 -> "R$ 22,00"
const moeda = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
// Escapa HTML: evita que um nome digitado como <script> quebre a página
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* =====================================================================
   CLASSE 1 — Produto
   Atributos PRIVADOS (#) = encapsulamento: só se acessa por getters/setters,
   e os setters VALIDAM o valor (não existe produto com preço negativo).
   ===================================================================== */
class Produto {
  #id; #nome; #descricao; #preco; #categoria; #imagem;

  constructor({ id, nome, descricao, preco, categoria, imagem }) {
    this.#id = id;
    // Usa os setters (this.nome = ...) para já validar na criação
    this.nome = nome; this.descricao = descricao; this.preco = preco;
    this.categoria = categoria; this.imagem = imagem;
  }

  get id() { return this.#id; }                 // id: só leitura (sem setter)
  get nome() { return this.#nome; }
  set nome(v) {
    if (!v || !String(v).trim()) throw new Error("O nome é obrigatório.");
    this.#nome = String(v).trim();
  }
  get descricao() { return this.#descricao; }
  set descricao(v) { this.#descricao = String(v ?? "").trim(); }
  get preco() { return this.#preco; }
  set preco(v) {
    const texto = String(v ?? "").trim();
  
    if (!texto) {
      throw new Error("Informe o preço do produto.");
    }
  
    const n = Number(texto.replace(",", "."));
  
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error("O preço deve ser um número maior que zero.");
    }
  
    this.#preco = Math.round((n + Number.EPSILON) * 100) / 100;
  }
  get categoria() { return this.#categoria; }
  set categoria(v) { this.#categoria = v || "Prato"; }
  get imagem() { return this.#imagem; }
  set imagem(v) { this.#imagem = v || `https://picsum.photos/seed/${encodeURIComponent(this.#nome)}/800/450`; }

  // JSON.stringify chama este método: necessário para salvar no localStorage
  toJSON() {
    return { id: this.#id, nome: this.#nome, descricao: this.#descricao, preco: this.#preco, categoria: this.#categoria, imagem: this.#imagem };
  }
}

/* =====================================================================
   CLASSE 2 — ItemCarrinho
   RELACIONAMENTO: "tem um" Produto (composição) + uma quantidade.
   ===================================================================== */
class ItemCarrinho {
  #produto; #quantidade;
  constructor(produto, quantidade = 1) { this.#produto = produto; this.quantidade = quantidade; }
  get produto() { return this.#produto; }
  get quantidade() { return this.#quantidade; }
  set quantidade(q) {
    if (!Number.isInteger(q) || q < 1) throw new Error("Quantidade inválida.");
    this.#quantidade = q;
  }
  // Getter calculado: usa o preço ATUAL do produto (se editar o preço, atualiza aqui)
  get subtotal() { return this.#produto.preco * this.#quantidade; }
}

/* =====================================================================
   CLASSE 3 — Carrinho
   Agrupa ItemCarrinho e calcula subtotal, taxa e total.
   ===================================================================== */
class Carrinho {
  static TAXA_DELIVERY = 2.5;   // static = pertence à classe, não ao objeto
  #itens = [];

  get itens() { return [...this.#itens]; }   // devolve CÓPIA (protege o array interno)
  get totalItens() { return this.#itens.reduce((s, i) => s + i.quantidade, 0); }
  get subtotal() { return this.#itens.reduce((s, i) => s + i.subtotal, 0); }

  // CREATE: adiciona produto (se já existe, só soma 1 na quantidade)
  adicionar(produto) {
    const item = this.#itens.find((i) => i.produto.id === produto.id);
    if (item) item.quantidade++;
    else this.#itens.push(new ItemCarrinho(produto, 1));
  }
  // UPDATE: soma/subtrai quantidade (delta = +1 ou -1); mínimo 1
  alterarQuantidade(id, delta) {
    const item = this.#itens.find((i) => i.produto.id === id);
    if (item && item.quantidade + delta >= 1) item.quantidade += delta;
  }
  // DELETE: remove um item / limpa tudo
  remover(id) { this.#itens = this.#itens.filter((i) => i.produto.id !== id); }
  limpar() { this.#itens = []; }

  // Taxa só no delivery e só se houver itens
  taxaEntrega(tipo) { return tipo === "delivery" && this.#itens.length ? Carrinho.TAXA_DELIVERY : 0; }
  total(tipo) { return this.subtotal + this.taxaEntrega(tipo); }
}

/* =====================================================================
   CLASSE 4 — Pedido (pedido finalizado)
   Guarda uma "foto" dos itens (nome/preço/qtd) para o histórico não
   mudar se o cardápio for editado depois.
   ===================================================================== */
class Pedido {
  #dados;

  constructor({
    id,
    cliente,
    itens,
    tipoEntrega,
    taxa,
    total,
    formaPagamento = "Não informado",
    status = "Recebido",
    data = new Date().toISOString()
  }) {
    this.#dados = {
      id,
      cliente,
      itens,
      tipoEntrega,
      taxa,
      total,
      formaPagamento,
      status,
      data
    };
  }

  get id() { return this.#dados.id; }
  get cliente() { return this.#dados.cliente; }
  get itens() { return this.#dados.itens; }
  get tipoEntrega() { return this.#dados.tipoEntrega; }
  get taxa() { return this.#dados.taxa; }
  get total() { return this.#dados.total; }
  get formaPagamento() { return this.#dados.formaPagamento; }
  get status() { return this.#dados.status; }
  get data() { return new Date(this.#dados.data); }

  toJSON() {
    return this.#dados;
  }
}

/* =====================================================================
   CLASSE 5 — Repositorio (gerenciador do CRUD)
   Única classe que mexe nos dados e no localStorage (bônus).
   ===================================================================== */
class Repositorio {
  #produtos = [];
  #pedidos = [];

constructor() {
  this.#carregar();

  // Primeira vez (sem nada salvo): cria cardápio inicial
  if (!this.#produtos.length && !localStorage.getItem("produtos")) {

    [
      [
        "Iphone 17 Pro Max",
        "Celular muito aclamado pela mídia",
        11999.99,
        "Celular",
        "https://images.unsplash.com/photo-1726587912121-ea21fcc57ff8?q=80&w=880&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D"
      ],

      [
        "Monitor ACER",
        "Monitor perfeito para você assistir séries ou jogar seus jogos favoritos",
        599.99,
        "Eletrônico",
        "https://images.unsplash.com/photo-1556583186-c7b22658adea?q=80&w=1171&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D"
      ],

      [
        "MacBook M1",
        "Notebook muito rápido e perfeito para qualquer atividade",
        16999.99,
        "Notebook",
        "https://images.unsplash.com/photo-1532198528077-0d9e4ca9bb40?q=80&w=1147&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D"
      ],

      [
        "Mouse Lenovo",
        "Mouse adequado para qualquer público",
        159.99,
        "Eletrônico",
        "https://images.tcdn.com.br/img/img_prod/1187875/mouse_lenovo_essential_sm_8823_usb_optico_1600dpi_seminovo_532_1_b25bac1ec995a2a286b1294529590f62.jpg"
      ],

      [
        "Mousepad",
        "Mousepad para tornar a sua experiência com o mouse mais agradável",
        69.99,
        "Utilidades",
        "https://attackshark.net.br/cdn/shop/files/8_5baae11f-ea30-49ad-8a5b-55a4ca270a25.jpg?v=1770432526&width=800"
      ],

      [
        "Headset",
        "Fones de ouvido excelentes com total redução de ruído",
        399.99,
        "Eletrônico",
        "https://img.terabyteshop.com.br/produto/g/headset-gamer-fifine-h6-71-surround-drivers-de-50mm-rgb-usb-black_151054.jpg"
      ],

      [
        "Cadeira Ergonômica",
        "Cadeira perfeita e super confortável",
        699.99,
        "Utilidades",
        "https://m.media-amazon.com/images/I/61nIX+GFPmL._AC_SL1254_.jpg"
      ]

    ].forEach(([nome, descricao, preco, categoria, imagem]) =>
      this.criarProduto({
        nome,
        descricao,
        preco,
        categoria,
        imagem
      })
    );
  }
}

  // Persistência (privados: ninguém de fora precisa chamar)
  #carregar() {
    try {
      this.#produtos = (JSON.parse(localStorage.getItem("produtos")) || []).map((p) => new Produto(p));
      this.#pedidos = (JSON.parse(localStorage.getItem("pedidos")) || []).map((p) => new Pedido(p));
    } catch { this.#produtos = []; this.#pedidos = []; }   // dados corrompidos: começa do zero
  }
  #salvar() {
    localStorage.setItem("produtos", JSON.stringify(this.#produtos));
    localStorage.setItem("pedidos", JSON.stringify(this.#pedidos));
  }

  // ----- CRUD de produtos -----
  criarProduto(dados) {                                   // CREATE
    const p = new Produto({ ...dados, id: Date.now() + Math.floor(Math.random() * 1000) });
    this.#produtos.push(p); this.#salvar(); return p;
  }
  listarProdutos() { return [...this.#produtos]; }        // READ (todos)
  buscarProduto(id) { return this.#produtos.find((p) => p.id === id); }   // READ (um)
  atualizarProduto(id, d) {                               // UPDATE
    const p = this.buscarProduto(id);
    if (!p) throw new Error("Produto não encontrado.");
    p.nome = d.nome; p.descricao = d.descricao; p.preco = d.preco; p.categoria = d.categoria;
    if (d.imagem && d.imagem.trim()) {
      p.imagem = d.imagem.trim();
    }                                  // setters validam
    this.#salvar(); return p;
  }
  removerProduto(id) {                                    // DELETE
    this.#produtos = this.#produtos.filter((p) => p.id !== id); this.#salvar();
  }

  // ----- Pedidos -----
criarPedido(dados) {
  const pedido = new Pedido({
    ...dados,
    id: dados.id ?? Date.now()
  });

  this.#pedidos.unshift(pedido);
  this.#salvar();

  return pedido;
}

  listarPedidos() {
    return [...this.#pedidos];
  }
}

/* =====================================================================
   INTERFACE
   ===================================================================== */
const repo = new Repositorio();
const carrinho = new Carrinho();
let slideAtual = 0;

const tipoEntrega = () => document.querySelector('input[name="entrega"]:checked').value;

/* FEEDBACK (IHC): mensagem temporária após cada ação */
let timerToast;
function aviso(msg, tipo = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "mostrar " + (tipo === "erro" ? "erro" : "");
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.className = ""), 3000);
}

/* ---------- CARDÁPIO (READ) ---------- */
function renderCardapio() {
  const ps = repo.listarProdutos();
  $("#lista").innerHTML = ps.length ? ps.map((p) => `
    <article class="prod">
      <img src="${esc(p.imagem)}" alt="Foto do prato ${esc(p.nome)}" loading="lazy" onerror="this.src='https://picsum.photos/seed/prato/800/450'">
      <div class="prod__corpo">
        <span class="cat">${esc(p.categoria)}</span>
        <h3>${esc(p.nome)}</h3>
        <p class="desc">${esc(p.descricao)}</p>
        <p class="preco">${moeda(p.preco)}</p>
        <div class="linha-btn">
          <button class="btn btn-pq" type="button" data-acao="add" data-id="${p.id}">Adicionar</button>
          <button class="btn btn-pq btn-sec" type="button" data-acao="editar" data-id="${p.id}">Editar</button>
          <button class="btn btn-pq btn-perigo" type="button" data-acao="excluir" data-id="${p.id}">Excluir</button>
        </div>
      </div>
    </article>`).join("") : '<p class="vazio">Nenhum produto. Clique em "+ Novo produto".</p>';
}

/* ---------- BUSCA DE PRODUTOS ---------- */
$("#busca").addEventListener("input", () => {
  const termo = $("#busca").value
    .trim()
    .toLocaleLowerCase("pt-BR");

  const produtos = repo.listarProdutos().filter((p) =>
    `${p.nome} ${p.descricao} ${p.categoria}`
      .toLocaleLowerCase("pt-BR")
      .includes(termo)
  );

  $("#lista").innerHTML = produtos.length
    ? produtos.map((p) => `
        <article class="prod">
          <img
            src="${esc(p.imagem)}"
            alt="${esc(p.nome)}"
            loading="lazy"
            onerror="this.onerror=null;this.src='https://picsum.photos/seed/prato/800/450'"
          >

          <div class="prod__corpo">
            <span class="cat">${esc(p.categoria)}</span>
            <h3>${esc(p.nome)}</h3>
            <p class="desc">${esc(p.descricao)}</p>
            <p class="preco">${moeda(p.preco)}</p>

            <div class="linha-btn">
              <button class="btn btn-pq" type="button"
                data-acao="add" data-id="${p.id}">
                Adicionar
              </button>

              <button class="btn btn-pq btn-sec" type="button"
                data-acao="editar" data-id="${p.id}">
                Editar
              </button>

              <button class="btn btn-pq btn-perigo" type="button"
                data-acao="excluir" data-id="${p.id}">
                Excluir
              </button>
            </div>
          </div>
        </article>
      `).join("")
    : '<p class="vazio">Nenhum produto encontrado.</p>';
});

/* ---------- CARRINHO (READ) ---------- */
function renderCarrinho() {
  const itens = carrinho.itens;
  $("#itens").innerHTML = itens.length ? itens.map((i) => `
    <li>
      <span>${esc(i.produto.nome)}<br><small>${moeda(i.produto.preco)} cada</small></span>
      <span class="qtd">
        <button type="button" data-acao="menos" data-id="${i.produto.id}" aria-label="Diminuir quantidade de ${esc(i.produto.nome)}">−</button>
        <strong aria-label="Quantidade">${i.quantidade}</strong>
        <button type="button" data-acao="mais" data-id="${i.produto.id}" aria-label="Aumentar quantidade de ${esc(i.produto.nome)}">+</button>
      </span>
      <span>${moeda(i.subtotal)}</span>
      <button class="btn btn-pq btn-perigo" type="button" data-acao="remover" data-id="${i.produto.id}" aria-label="Remover ${esc(i.produto.nome)}">✕</button>
    </li>`).join("") : '<li class="vazio">Seu carrinho está vazio.</li>';

  const tipo = tipoEntrega();
  $("#bloco-end").hidden = tipo !== "delivery";           // endereço só no delivery
  $("#r-sub").textContent = moeda(carrinho.subtotal);
  $("#r-taxa").textContent = moeda(carrinho.taxaEntrega(tipo));   // visibilidade da taxa
  $("#r-total").textContent = moeda(carrinho.total(tipo));
  $("#contador").textContent = carrinho.totalItens;
}

/* ---------- PEDIDOS ---------- */
function renderPedidos() {
  const ps = repo.listarPedidos();
  $("#lista-pedidos").innerHTML = ps.length ? ps.map((p) => `
    <li>
      <strong>#${p.id}</strong> · ${esc(p.cliente.nome)} · ${p.data.toLocaleString("pt-BR")}
      <span class="status">${esc(p.status)}</span><br>

      Pagamento: ${esc(p.formaPagamento || "Não informado")}<br>

      ${p.itens.map((i) => `${i.quantidade}x ${esc(i.nome)}`).join(", ")}<br>
      ${p.tipoEntrega === "delivery" ? `Delivery para ${esc(p.cliente.endereco)} (taxa ${moeda(p.taxa)})` : "Retirada / consumo no local"}
      — <strong>Total ${moeda(p.total)}</strong>
    </li>`).join("") : '<li class="vazio">Nenhum pedido ainda.</li>';
}

const renderTudo = () => { renderCardapio(); renderCarrinho(); };

/* ---------- FORMULÁRIO DE PRODUTO (CREATE / UPDATE) ---------- */
const dlg = $("#dlg");
function abrirForm(produto) {
  $("#form-produto").reset();
  $("#erro-form").textContent = "";
  $("#t-form").textContent = produto ? "Editar produto" : "Novo produto";
  $("#p-id").value = produto ? produto.id : "";            // id preenchido = modo edição
  if (produto) {
    $("#p-nome").value = produto.nome; $("#p-desc").value = produto.descricao;
    $("#p-preco").value = String(produto.preco).replace(".", ","); $("#p-cat").value = produto.categoria;
    $("#p-img").value = produto.imagem;
  }
  dlg.showModal();
  $("#p-nome").focus();
}
$("#novo").addEventListener("click", () => abrirForm(null));
$("#cancelar").addEventListener("click", () => dlg.close());

$("#form-produto").addEventListener("submit", (e) => {
  e.preventDefault();
  const dados = { nome: $("#p-nome").value, descricao: $("#p-desc").value, preco: $("#p-preco").value, categoria: $("#p-cat").value, imagem: $("#p-img").value.trim() };
  try {                                                    // validação: os setters lançam Error
    const id = Number($("#p-id").value);
    if (id) { repo.atualizarProduto(id, dados); aviso("Produto atualizado!"); }
    else { repo.criarProduto(dados); aviso("Produto cadastrado!"); }
    dlg.close(); renderTudo();
  } catch (err) { $("#erro-form").textContent = err.message; }   // mostra o erro no formulário
});

/* ---------- AÇÕES DOS BOTÕES (delegação de eventos) ---------- */
document.addEventListener("click", (e) => {
  const ponto = e.target.closest("[data-ponto]");

  const b = e.target.closest("[data-acao]");
  if (!b) return;
  const id = Number(b.dataset.id);
  const prod = repo.buscarProduto(id);

  switch (b.dataset.acao) {
    case "add":
      carrinho.adicionar(prod); renderCarrinho(); aviso(`${prod.nome} adicionado ao carrinho.`); break;
    case "mais": carrinho.alterarQuantidade(id, 1); renderCarrinho(); break;
    case "menos": carrinho.alterarQuantidade(id, -1); renderCarrinho(); break;
    case "remover":                                        // prevenção de erros: confirmação
      if (confirm(`Remover "${prod?.nome ?? "item"}" do carrinho?`)) { carrinho.remover(id); renderCarrinho(); aviso("Item removido."); }
      break;
    case "editar": abrirForm(prod); break;
    case "excluir":
      if (confirm(`Excluir "${prod.nome}" do cardápio?`)) {
        repo.removerProduto(id); carrinho.remover(id);     // também sai do carrinho
        renderTudo(); aviso("Produto excluído do cardápio.");
      }
      break;
  }
});


document.querySelectorAll('input[name="entrega"]').forEach((r) => r.addEventListener("change", renderCarrinho));

$("#limpar").addEventListener("click", () => {
  if (!carrinho.itens.length) return aviso("O carrinho já está vazio.", "erro");
  if (confirm("Limpar todo o carrinho?")) { carrinho.limpar(); renderCarrinho(); aviso("Carrinho limpo."); }
});

/* ---------- FINALIZAR PEDIDO ---------- */
/* ---------- PAGAMENTO E FINALIZAÇÃO DO PEDIDO ---------- */

// Armazena temporariamente os dados do pedido
let pedidoPendente = null;


// GERAÇÃO DO QR CODE FICTÍCIO
function gerarQrCode(dadosPedido) {

  const modal = $("#dlg-pagamento");
  const container = $("#qrcode");
  const valorPagamento = $("#valor-pagamento");

  if (!window.QRCode) {
    aviso("Não foi possível carregar a biblioteca QR Code.", "erro");
    return false;
  }

  // Limpa o QR Code anterior
  container.innerHTML = "";

  // Dados mais curtos para evitar excesso de informação
  const dados = `VOLT|${dadosPedido.id}|${dadosPedido.total.toFixed(2)}|SIMULACAO`;

  // Gera o QR Code
  new QRCode(container, {
    text: dados,
    width: 200,
    height: 200,
    colorDark: "#000000",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.L
  });

  valorPagamento.textContent =
    `Valor do pedido: ${moeda(dadosPedido.total)}`;

  modal.showModal();

  return true;
}


// REGISTRO DO PEDIDO
function concluirPedido(dadosPedido, status) {

  const pedido = repo.criarPedido({
    ...dadosPedido,
    status
  });

  // Limpa o carrinho após a conclusão
  carrinho.limpar();

  $("#cli-nome").value = "";
  $("#cli-end").value = "";

  renderCarrinho();
  renderPedidos();

  aviso(
    `Pedido #${pedido.id} realizado! Total: ${moeda(pedido.total)}`
  );

  return pedido;
}


// EVENTO DO BOTÃO FINALIZAR
$("#finalizar").addEventListener("click", () => {

  const tipo = tipoEntrega();

  const nome = $("#cli-nome").value.trim();
  const end = $("#cli-end").value.trim();

  const pagamento = document.querySelector(
    'input[name="pagamento"]:checked'
  );

  // VALIDAÇÕES

  if (!carrinho.itens.length) {
    return aviso("Adicione itens antes de finalizar.", "erro");
  }

  if (nome.length < 2) {
    $("#cli-nome").focus();
    return aviso("Informe o nome do cliente.", "erro");
  }

  if (tipo === "delivery" && end.length < 5) {
    $("#cli-end").focus();
    return aviso("Informe o endereço de entrega.", "erro");
  }

  if (!pagamento) {
    return aviso("Selecione uma forma de pagamento.", "erro");
  }


  // MONTA OS DADOS DO PEDIDO

  const dadosPedido = {

    id: Date.now(),

    cliente: {
      nome,
      endereco: tipo === "delivery" ? end : ""
    },

    itens: carrinho.itens.map((i) => ({
      nome: i.produto.nome,
      preco: i.produto.preco,
      quantidade: i.quantidade
    })),

    tipoEntrega: tipo,

    taxa: carrinho.taxaEntrega(tipo),

    total: carrinho.total(tipo),

    formaPagamento: pagamento.value === "qr-code"
      ? "QR Code (simulação)"
      : "Dinheiro"

  };


  // PAGAMENTO VIA QR CODE

  if (pagamento.value === "qr-code") {

    pedidoPendente = dadosPedido;

    const gerado = gerarQrCode(dadosPedido);

    // Se houver erro, mantém o carrinho intacto
    if (!gerado) {
      pedidoPendente = null;
    }

    return;
  }


  // PAGAMENTO EM DINHEIRO

  concluirPedido(
    dadosPedido,
    "Pedido realizado"
  );

});


// CONFIRMAÇÃO DA SIMULAÇÃO DE PAGAMENTO

$("#confirmar-pagamento").addEventListener("click", () => {

  if (!pedidoPendente) {
    return aviso(
      "Não existe nenhum pedido aguardando pagamento.",
      "erro"
    );
  }

  const dadosConfirmados = pedidoPendente;

  pedidoPendente = null;

  $("#dlg-pagamento").close();

  concluirPedido(
    dadosConfirmados,
    "Pagamento simulado"
  );

});


// CANCELAMENTO DO PAGAMENTO

$("#fechar-pagamento").addEventListener("click", () => {

  $("#dlg-pagamento").close();

  pedidoPendente = null;

});


// Também limpa a pendência se o usuário fechar com ESC
$("#dlg-pagamento").addEventListener("close", () => {

  pedidoPendente = null;

});

/* ---------- TEMA CLARO/ESCURO ---------- */

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-theme", tema);

  const btnTema = document.querySelector("#btn-tema");

  if (btnTema) {
    btnTema.textContent = tema === "dark"
      ? "☀️ Tema claro"
      : "🌙 Tema escuro";
  }
}

function inicializarTema() {
  const temaSalvo = localStorage.getItem("tema");

  const temaInicial = temaSalvo ||
    (window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light");

  aplicarTema(temaInicial);

  const btnTema = document.querySelector("#btn-tema");

  if (btnTema) {
    btnTema.addEventListener("click", () => {
      const temaAtual = document.documentElement.getAttribute("data-theme");

      const novoTema = temaAtual === "dark" ? "light" : "dark";

      aplicarTema(novoTema);
      localStorage.setItem("tema", novoTema);
    });
  }
}

// Inicializa o tema
inicializarTema();
  

/* ---------- INÍCIO ---------- */
renderTudo();
renderPedidos();
