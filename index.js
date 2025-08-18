// Endpoint simples para debug do webhook da NivoPay
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const metaService = require('./services/metaService');
const axios = require('axios');
const webhookValidator = require('./utils/webhookValidator');
const logger = require('./utils/logger');
const paymentStore = require('./services/paymentStore');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'Meta Webhook Backend'
  });
});

app.post('/webhook/nivopay-debug', (req, res) => {
  logger.info('Payload recebido do webhook NivoPay:', req.body);
  res.status(200).json({ message: 'Payload recebido', payload: req.body });
});

// Webhook endpoint para receber status de pagamentos
app.post('/webhook/payment-status', async (req, res) => {
  try {
    logger.info('Webhook recebido:', req.body);

    if (process.env.WEBHOOK_SECRET) {
      const isValid = webhookValidator.validateWebhook(req);
      if (!isValid) {
        logger.error('Webhook inválido - assinatura não confere');
        return res.status(401).json({ error: 'Webhook inválido' });
      }
    }

    const webhookData = req.body;
    const transactionId = webhookData.id || webhookData.external_id;
    if (!transactionId) {
      logger.error('ID da transação ausente no webhook');
      return res.status(400).json({ error: 'ID da transação ausente' });
    }

    const isPaymentApproved = checkPaymentStatus(webhookData);

    paymentStore.savePaymentStatus(transactionId, {
      status: isPaymentApproved ? 'COMPLETED' : (webhookData.status || 'PENDING'),
      amount: webhookData.amount,
      customer: webhookData.customer,
      items: webhookData.items || [],
    });

    if (!isPaymentApproved) {
      logger.info('Pagamento não aprovado, ignorando webhook');
      return res.status(200).json({ message: 'Webhook recebido - pagamento não aprovado' });
    }

    const customerData = extractCustomerData(webhookData);
    const transactionData = extractTransactionData(webhookData);

    if (!customerData || !transactionData) {
      logger.error('Dados insuficientes no webhook');
      return res.status(400).json({ error: 'Dados insuficientes' });
    }

    const conversionResult = await metaService.sendConversionEvent({
      customer: customerData,
      transaction: transactionData,
      eventSource: 'website'
    });

    try {
      await sendToUtmify(webhookData);
      logger.info('Dados enviados para Utmify com sucesso');
    } catch (utmifyError) {
      logger.error('Erro ao enviar dados para Utmify:', utmifyError.message);
    }

    if (conversionResult.success) {
      logger.info('Evento de conversão enviado com sucesso para Meta Ads');
      res.status(200).json({ 
        message: 'Webhook processado com sucesso',
        metaEventId: conversionResult.eventId
      });
    } else {
      logger.error('Erro ao enviar evento para Meta Ads:', conversionResult.error);
      res.status(500).json({ error: 'Erro ao processar conversão' });
    }

  } catch (error) {
    logger.error('Erro no processamento do webhook:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Função para enviar venda pendente manualmente para Utmify
async function sendPendingSaleToUtmify(pendingSale) {
  let utmParams = {
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: ''
  };
  if (pendingSale.utm) {
    const utmArr = pendingSale.utm.split('&');
    utmArr.forEach(pair => {
      const [key, value] = pair.replace('?', '').split('=');
      if (utmParams.hasOwnProperty(key)) utmParams[key] = value || '';
    });
  } else {
    utmParams.utm_source = pendingSale.utm_source || '';
    utmParams.utm_medium = pendingSale.utm_medium || '';
    utmParams.utm_campaign = pendingSale.utm_campaign || '';
    utmParams.utm_content = pendingSale.utm_content || '';
    utmParams.utm_term = pendingSale.utm_term || '';
    utmParams.src = pendingSale.src || null;
  utmParams.sck = pendingSale.sck || null;
  }

  let products = Array.isArray(pendingSale.items) ? pendingSale.items.map(item => ({
    id: item.id || '',
    name: item.name || item.title || '',
    planId: item.planId !== undefined ? item.planId : null,
    planName: item.planName !== undefined ? item.planName : null,
    quantity: item.quantity || 1,
    priceInCents: item.price || item.unitPrice || pendingSale.amount || 0
  })) : [];
  if (products.length === 0 && pendingSale.product) {
    products = [pendingSale.product];
  }

  // Formata data
  function formatDate(date) {
    if (!date) return null;
    const d = new Date(date);
    return d.toISOString().replace('T', ' ').substring(0, 19);
  }


  const body = {
    orderId: pendingSale.customId || pendingSale.id || pendingSale.externalId || pendingSale.external_id || '',
    platform: 'NivoPay',
    paymentMethod: (pendingSale.paymentMethod || pendingSale.method || 'pix').toLowerCase(),
    status: 'waiting_payment',
    createdAt: formatDate(pendingSale.createdAt || pendingSale.created_at || new Date()),
    approvedDate: null,
    refundedAt: null,
    customer: {
      name: pendingSale.customer?.name || '',
      email: pendingSale.customer?.email || '',
      phone: pendingSale.customer?.phone || '',
      document: pendingSale.customer?.cpf || pendingSale.customer?.document || '',
      country: pendingSale.customer?.country || 'BR',
      ip: pendingSale.customer?.ip || pendingSale.ip || null
    },
    products,
    trackingParameters: utmParams,
    commission: {
      totalPriceInCents: pendingSale.totalValue || pendingSale.amount || 0,
      gatewayFeeInCents: pendingSale.gatewayFeeInCents || 0,
      userCommissionInCents: pendingSale.netValue || pendingSale.userCommissionInCents || 0
    },
    isTest: pendingSale.isTest || false
  };

  const utmifyUrl = 'https://api.utmify.com.br/api-credentials/orders';
  const utmifyToken = process.env.UTMIFY_TOKEN || 'xmnHbQedr1FctddxFvm7U0lLcZzNBApfHhr1';

  await axios.post(utmifyUrl, body, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-token': utmifyToken
    }
  });
}

// Endpoint para disparar manualmente venda pendente para Utmify
app.post('/send-pending-sale', async (req, res) => {
  try {
    const pendingSale = req.body;
    await sendPendingSaleToUtmify(pendingSale);
    res.status(200).json({ message: 'Venda pendente enviada para Utmify com sucesso.' });
  } catch (error) {
    logger.error('Erro ao enviar venda pendente para Utmify:', error.message);
    res.status(500).json({ error: 'Erro ao enviar venda pendente para Utmify.' });
  }
});

// Função para enviar dados para Utmify
async function sendToUtmify(webhookData) {
  let utmParams = {
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_content: '',
    utm_term: ''
  };
  if (webhookData.utm) {
    const utmArr = webhookData.utm.split('&');
    utmArr.forEach(pair => {
      const [key, value] = pair.replace('?', '').split('=');
      if (utmParams.hasOwnProperty(key)) utmParams[key] = value || '';
    });
  } else {
    utmParams.utm_source = webhookData.utm_source || '';
    utmParams.utm_medium = webhookData.utm_medium || '';
    utmParams.utm_campaign = webhookData.utm_campaign || '';
    utmParams.utm_content = webhookData.utm_content || '';
    utmParams.utm_term = webhookData.utm_term || '';
  }

  let statusMap = {
    'APPROVED': 'paid',
    'PAID': 'paid',
    'WAITING_PAYMENT': 'waiting_payment',
    'REFUNDED': 'refunded',
    'REFUSED': 'refused',
    'CHARGEDBACK': 'chargedback'
  };
  let status = statusMap[(webhookData.status || '').toUpperCase()] || 'paid';

  let products = Array.isArray(webhookData.items) ? webhookData.items.map(item => ({
    id: item.id || '',
    name: item.name || item.title || '',
    planId: '',
    planName: '',
    quantity: item.quantity || 1,
    priceInCents: item.price || item.unitPrice || webhookData.amount || 0
  })) : [];
  if (products.length === 0 && webhookData.product) {
    products = [webhookData.product];
  }

  const totalPriceInCents = webhookData.totalValue || webhookData.amount || 0;
  const gatewayFeeInCents = webhookData.gatewayFeeInCents || 0;
  const userCommissionInCents = webhookData.netValue || webhookData.userCommissionInCents || 0;

  const createdAt = webhookData.createdAt || webhookData.created_at || new Date().toISOString();
  const approvedDate = webhookData.approvedAt || webhookData.updatedAt || webhookData.updated_at || createdAt;

  const body = {
    orderId: webhookData.customId || webhookData.id || webhookData.externalId || webhookData.external_id || '',
    platform: 'NivoPay',
    paymentMethod: (webhookData.paymentMethod || webhookData.method || 'pix').toLowerCase(),
    status,
    createdAt,
    approvedDate,
    refundedAt: webhookData.refundedAt || webhookData.refunded_at || null,
    customer: {
      name: webhookData.customer?.name || '',
      email: webhookData.customer?.email || '',
      document: webhookData.customer?.cpf || webhookData.customer?.document || '',
      phone: webhookData.customer?.phone || ''
    },
    products,
    trackingParameters: utmParams,
    commission: {
      totalPriceInCents,
      gatewayFeeInCents,
      userCommissionInCents
    },
    isTest: webhookData.isTest || false
  };

  const utmifyUrl = 'https://api.utmify.com.br/api-credentials/orders';
  const utmifyToken = process.env.UTMIFY_TOKEN || 'xmnHbQedr1FctddxFvm7U0lLcZzNBApfHhr1';
  console.log('Payload enviado para Utmify:', JSON.stringify(body, null, 2));
  await axios.post(utmifyUrl, body, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-token': utmifyToken
    }
  });
}

function checkPaymentStatus(webhookData) {
  const status = webhookData.status?.toLowerCase();
  return status === 'paid' || status === 'approved' || status === 'completed';
}

function extractCustomerData(webhookData) {
  const customer = webhookData.customer || webhookData;
  if (!customer.email || !customer.name) {
    return null;
  }
  return {
    email: customer.email,
    name: customer.name,
    phone: customer.phone || '',
    cpf: customer.cpf || customer.document || ''
  };
}

function extractTransactionData(webhookData) {
  if (!webhookData.amount) {
    return null;
  }
  return {
    transactionId: webhookData.id || webhookData.external_id,
    value: webhookData.amount / 100,
    currency: 'BRL',
    items: webhookData.items || [],
    timestamp: webhookData.created_at || new Date().toISOString()
  };
}

// Endpoint para consultar status do pagamento usando API externa
app.get('/payment/status', async (req, res) => {
  const transactionId = req.query.transaction;
  if (!transactionId) {
    return res.status(400).json({ error: 'Parâmetro transaction obrigatório.' });
  }
  try {
    const apiUrl = `https://pay.nivopayoficial.com.br/api/v1/transaction.getPayment?id=${transactionId}`;
    const response = await axios.get(apiUrl, {
      headers: { Authorization: process.env.SECRET_KEY }
    });
    const payment = response.data;
    return res.json({
      status: payment.status,
      amount: payment.amount,
      customer: payment.customer,
      items: payment.items,
      updatedAt: payment.updatedAt,
      method: payment.method,
      id: payment.id,
      customId: payment.customId
    });
  } catch (error) {
    logger.error('Erro ao consultar status externo:', error.message);
    return res.status(404).json({ error: 'Pagamento não encontrado ou erro na API externa.' });
  }
});

app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Modo de teste: ${process.env.TEST_MODE === 'true' ? 'Ativado' : 'Desativado'}`);
});

module.exports = app;
