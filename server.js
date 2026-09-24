// server.js
// API REST - Sistema de Controle de Produção com Estoque e Relatórios
// Node.js + Express

const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------------------
// "Banco de dados" em memória
// -----------------------------------------------------------------------
let ordens = [];

// -----------------------------------------------------------------------
// Funções internas / regras de negócio
// -----------------------------------------------------------------------

/**
 * Verifica se já existe uma ordem com o mesmo codigoOrdem.
 */
function codigoOrdemExiste(codigoOrdem, ignorarIndice = -1) {
  return ordens.some((ordem, indice) => {
    if (indice === ignorarIndice) return false;
    // Compara como string para aceitar tanto number quanto string vindos do JSON
    return String(ordem.codigoOrdem) === String(codigoOrdem);
  });
}

/**
 * Valida o tipoProduto usando um switch (1, 2 ou 3).
 * Retorna true se válido, false caso contrário.
 */
function tipoProdutoValido(tipoProduto) {
  const tipo = Number(tipoProduto);
  switch (tipo) {
    case 1:
    case 2:
    case 3:
      return true;
    default:
      return false;
  }
}

/**
 * Valida os campos obrigatórios de uma ordem (usados em POST).
 * Retorna um array de mensagens de erro; array vazio = sem erros.
 */
function validarCamposObrigatorios(body) {
  const erros = [];
  const camposObrigatorios = [
    'codigoOrdem',
    'codigoProduto',
    'tipoProduto',
    'quantidadeProduzida',
    'custoUnitarioBase',
    'estoqueInicial'
  ];

  // Loop de validação de presença dos campos
  for (let i = 0; i < camposObrigatorios.length; i++) {
    const campo = camposObrigatorios[i];
    if (body[campo] === undefined || body[campo] === null || body[campo] === '') {
      erros.push(`O campo "${campo}" é obrigatório.`);
    }
  }

  if (erros.length > 0) return erros; // evita validar tipos com campos ausentes

  if (!tipoProdutoValido(body.tipoProduto)) {
    erros.push('O campo "tipoProduto" deve ser 1 (Padrão), 2 (Premium) ou 3 (Sob encomenda).');
  }

  if (isNaN(Number(body.quantidadeProduzida)) || Number(body.quantidadeProduzida) < 0) {
    erros.push('O campo "quantidadeProduzida" deve ser um número maior ou igual a 0.');
  }

  if (isNaN(Number(body.custoUnitarioBase)) || Number(body.custoUnitarioBase) < 0) {
    erros.push('O campo "custoUnitarioBase" deve ser um número maior ou igual a 0.');
  }

  if (isNaN(Number(body.estoqueInicial)) || Number(body.estoqueInicial) < 0) {
    erros.push('O campo "estoqueInicial" deve ser um número maior ou igual a 0.');
  }

  return erros;
}

/**
 * Retorna a chave textual do tipo de produto (usada em relatórios).
 */
function chaveTipoProduto(tipoProduto) {
  switch (Number(tipoProduto)) {
    case 1:
      return 'padrao';
    case 2:
      return 'premium';
    case 3:
      return 'sobEncomenda';
    default:
      return 'desconhecido';
  }
}

/**
 * Calcula custoUnitarioAjustado com base no tipoProduto.
 */
function calcularCustoUnitarioAjustado(tipoProduto, custoUnitarioBase) {
  const custoBase = Number(custoUnitarioBase);
  switch (Number(tipoProduto)) {
    case 1: // Padrão
      return custoBase;
    case 2: // Premium (+10%)
      return custoBase * 1.1;
    case 3: // Sob encomenda (+20%)
      return custoBase * 1.2;
    default:
      return custoBase;
  }
}

/**
 * Calcula o alertaEstoque com base no estoqueFinal.
 */
function calcularAlertaEstoque(estoqueFinal) {
  if (estoqueFinal > 5000) return 'ALTO';
  if (estoqueFinal < 500) return 'CRITICO';
  return 'NORMAL';
}

/**
 * Recalcula todos os campos derivados de uma ordem (usado em POST e PUT).
 * Recebe o objeto "cru" com os campos base e devolve o objeto completo.
 */
function recalcularOrdem(ordemBase) {
  const quantidadeProduzida = Number(ordemBase.quantidadeProduzida);
  const custoUnitarioBase = Number(ordemBase.custoUnitarioBase);
  const estoqueInicial = Number(ordemBase.estoqueInicial);
  const tipoProduto = Number(ordemBase.tipoProduto);

  const estoqueFinal = estoqueInicial + quantidadeProduzida;
  const custoUnitarioAjustado = calcularCustoUnitarioAjustado(tipoProduto, custoUnitarioBase);
  const custoTotal = quantidadeProduzida * custoUnitarioAjustado;
  const alertaEstoque = calcularAlertaEstoque(estoqueFinal);

  return {
    codigoOrdem: ordemBase.codigoOrdem,
    codigoProduto: ordemBase.codigoProduto,
    tipoProduto,
    quantidadeProduzida,
    custoUnitarioBase,
    estoqueInicial,
    custoUnitarioAjustado: Number(custoUnitarioAjustado.toFixed(2)),
    estoqueFinal,
    custoTotal: Number(custoTotal.toFixed(2)),
    alertaEstoque
  };
}

/**
 * Gera o relatório consolidado utilizado pelo endpoint /relatorios/ordens.
 */
function gerarRelatorioConsolidado() {
  const totalOrdens = ordens.length;

  const estoquePorTipo = { padrao: 0, premium: 0, sobEncomenda: 0 };
  const quantidadeAlertas = { alto: 0, critico: 0, normal: 0 };
  const porProdutoMap = {}; // codigoProduto -> { estoqueFinalConsolidado, valorTotalInvestido }

  let somaCustoTotal = 0;
  let ordemMaisCara = null;
  let ordemMaisBarata = null;

  for (let i = 0; i < ordens.length; i++) {
    const ordem = ordens[i];

    // estoque por tipo
    const chaveTipo = chaveTipoProduto(ordem.tipoProduto);
    if (estoquePorTipo[chaveTipo] !== undefined) {
      estoquePorTipo[chaveTipo] += ordem.estoqueFinal;
    }

    // contagem de alertas
    switch (ordem.alertaEstoque) {
      case 'ALTO':
        quantidadeAlertas.alto += 1;
        break;
      case 'CRITICO':
        quantidadeAlertas.critico += 1;
        break;
      case 'NORMAL':
        quantidadeAlertas.normal += 1;
        break;
    }

    // soma para média
    somaCustoTotal += ordem.custoTotal;

    // ordem mais cara / mais barata
    if (ordemMaisCara === null || ordem.custoTotal > ordemMaisCara.custoTotal) {
      ordemMaisCara = { codigoOrdem: ordem.codigoOrdem, custoTotal: ordem.custoTotal };
    }
    if (ordemMaisBarata === null || ordem.custoTotal < ordemMaisBarata.custoTotal) {
      ordemMaisBarata = { codigoOrdem: ordem.codigoOrdem, custoTotal: ordem.custoTotal };
    }

    // consolidação por produto
    if (!porProdutoMap[ordem.codigoProduto]) {
      porProdutoMap[ordem.codigoProduto] = {
        codigoProduto: ordem.codigoProduto,
        estoqueFinalConsolidado: 0,
        valorTotalInvestido: 0
      };
    }
    porProdutoMap[ordem.codigoProduto].estoqueFinalConsolidado += ordem.estoqueFinal;
    porProdutoMap[ordem.codigoProduto].valorTotalInvestido += ordem.custoTotal;
  }

  const mediaCustoTotalPorOrdem = totalOrdens > 0
    ? Number((somaCustoTotal / totalOrdens).toFixed(2))
    : 0;

  // arredondar valores de porProduto
  const porProduto = Object.values(porProdutoMap).map((item) => ({
    ...item,
    valorTotalInvestido: Number(item.valorTotalInvestido.toFixed(2))
  }));

  return {
    totalOrdens,
    estoquePorTipo,
    mediaCustoTotalPorOrdem,
    ordemMaisCara,
    ordemMaisBarata,
    quantidadeAlertas,
    porProduto
  };
}

// -----------------------------------------------------------------------
// Rotas
// -----------------------------------------------------------------------

// Rota raiz - informativa
app.get('/', (req, res) => {
  res.json({
    mensagem: 'API de Controle de Produção com Estoque e Relatórios',
    endpoints: [
      'POST   /ordens',
      'GET    /ordens',
      'GET    /ordens/:codigoOrdem',
      'PUT    /ordens/:codigoOrdem',
      'DELETE /ordens/:codigoOrdem',
      'GET    /relatorios/ordens'
    ]
  });
});

// 1. POST /ordens - cadastra uma nova ordem de produção
app.post('/ordens', (req, res) => {
  const body = req.body;

  const erros = validarCamposObrigatorios(body);
  if (erros.length > 0) {
    return res.status(400).json({ erro: 'Falha de validação', detalhes: erros });
  }

  if (codigoOrdemExiste(body.codigoOrdem)) {
    return res.status(400).json({
      erro: `Já existe uma ordem cadastrada com o codigoOrdem "${body.codigoOrdem}".`
    });
  }

  const novaOrdem = recalcularOrdem(body);
  ordens.push(novaOrdem);

  return res.status(201).json(novaOrdem);
});

// 2. GET /ordens - lista todas as ordens, com filtros opcionais
app.get('/ordens', (req, res) => {
  let resultado = ordens;

  const { tipo, alerta } = req.query;

  if (tipo !== undefined) {
    const tipoNum = Number(tipo);
    resultado = resultado.filter((ordem) => ordem.tipoProduto === tipoNum);
  }

  if (alerta !== undefined) {
    const alertaUpper = String(alerta).toUpperCase();
    resultado = resultado.filter((ordem) => ordem.alertaEstoque === alertaUpper);
  }

  return res.status(200).json(resultado);
});

// 3. GET /ordens/:codigoOrdem - retorna uma ordem específica
app.get('/ordens/:codigoOrdem', (req, res) => {
  const { codigoOrdem } = req.params;
  const ordem = ordens.find((o) => String(o.codigoOrdem) === String(codigoOrdem));

  if (!ordem) {
    return res.status(404).json({ erro: `Ordem "${codigoOrdem}" não encontrada.` });
  }

  return res.status(200).json(ordem);
});

// 4. PUT /ordens/:codigoOrdem - atualiza uma ordem existente
app.put('/ordens/:codigoOrdem', (req, res) => {
  const { codigoOrdem } = req.params;
  const indice = ordens.findIndex((o) => String(o.codigoOrdem) === String(codigoOrdem));

  if (indice === -1) {
    return res.status(404).json({ erro: `Ordem "${codigoOrdem}" não encontrada.` });
  }

  const ordemAtual = ordens[indice];
  const body = req.body;

  // Monta o objeto atualizado, usando os valores enviados ou mantendo os atuais
  const ordemAtualizadaBase = {
    codigoOrdem: ordemAtual.codigoOrdem, // não permite trocar o código pela rota PUT
    codigoProduto: body.codigoProduto !== undefined ? body.codigoProduto : ordemAtual.codigoProduto,
    tipoProduto: body.tipoProduto !== undefined ? body.tipoProduto : ordemAtual.tipoProduto,
    quantidadeProduzida: body.quantidadeProduzida !== undefined ? body.quantidadeProduzida : ordemAtual.quantidadeProduzida,
    custoUnitarioBase: body.custoUnitarioBase !== undefined ? body.custoUnitarioBase : ordemAtual.custoUnitarioBase,
    estoqueInicial: body.estoqueInicial !== undefined ? body.estoqueInicial : ordemAtual.estoqueInicial
  };

  // Validações
  const erros = [];

  if (!tipoProdutoValido(ordemAtualizadaBase.tipoProduto)) {
    erros.push('O campo "tipoProduto" deve ser 1 (Padrão), 2 (Premium) ou 3 (Sob encomenda).');
  }
  if (isNaN(Number(ordemAtualizadaBase.quantidadeProduzida)) || Number(ordemAtualizadaBase.quantidadeProduzida) < 0) {
    erros.push('O campo "quantidadeProduzida" deve ser um número maior ou igual a 0.');
  }
  if (isNaN(Number(ordemAtualizadaBase.custoUnitarioBase)) || Number(ordemAtualizadaBase.custoUnitarioBase) < 0) {
    erros.push('O campo "custoUnitarioBase" deve ser um número maior ou igual a 0.');
  }
  if (isNaN(Number(ordemAtualizadaBase.estoqueInicial)) || Number(ordemAtualizadaBase.estoqueInicial) < 0) {
    erros.push('O campo "estoqueInicial" deve ser um número maior ou igual a 0.');
  }

  if (erros.length > 0) {
    return res.status(400).json({ erro: 'Falha de validação', detalhes: erros });
  }

  const ordemRecalculada = recalcularOrdem(ordemAtualizadaBase);
  ordens[indice] = ordemRecalculada;

  return res.status(200).json(ordemRecalculada);
});

// 5. DELETE /ordens/:codigoOrdem - remove uma ordem
app.delete('/ordens/:codigoOrdem', (req, res) => {
  const { codigoOrdem } = req.params;
  const indice = ordens.findIndex((o) => String(o.codigoOrdem) === String(codigoOrdem));

  if (indice === -1) {
    return res.status(404).json({ erro: `Ordem "${codigoOrdem}" não encontrada.` });
  }

  const [ordemRemovida] = ordens.splice(indice, 1);

  return res.status(200).json({
    mensagem: `Ordem "${codigoOrdem}" removida com sucesso.`,
    ordemRemovida
  });
});

// 6. GET /relatorios/ordens - relatório consolidado
app.get('/relatorios/ordens', (req, res) => {
  const relatorio = gerarRelatorioConsolidado();
  return res.status(200).json(relatorio);
});

// -----------------------------------------------------------------------
// Middleware de rota não encontrada
// -----------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada.' });
});

// -----------------------------------------------------------------------
// Inicialização do servidor
// -----------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;