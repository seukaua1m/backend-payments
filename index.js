// Endpoint simples para debug do webhook da NivoPay
app.post('/webhook/nivopay-debug', (req, res) => {
  logger.info('Payload recebido do webhook NivoPay:', req.body);
  res.status(200).json({ message: 'Payload recebido', payload: req.body });
});
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

// Webhook endpoint para receber status de pagamentos

app.post('/webhook/payment-status', async (req, res) => {
  try {
    logger.info('Webhook recebido:', req.body);

    // Validar webhook (opcional)
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

    // Verificar se o pagamento foi aprovado
    const isPaymentApproved = checkPaymentStatus(webhookData);

    // Salvar status do pagamento
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

    // Extrair dados do cliente e transação
    const customerData = extractCustomerData(webhookData);
    const transactionData = extractTransactionData(webhookData);

    if (!customerData || !transactionData) {
      logger.error('Dados insuficientes no webhook');
      return res.status(400).json({ error: 'Dados insuficientes' });
    }

    // Enviar evento de conversão para Meta Ads
    const conversionResult = await metaService.sendConversionEvent({
      customer: customerData,
      transaction: transactionData,
      eventSource: 'website'
    });

    // Enviar dados para Utmify
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
// Função para enviar dados para Utmify
async function sendToUtmify(webhookData) {
  // Montar o body conforme documentação Utmify, adaptando para estrutura NivoPay
  const body = {
    orderId: webhookData.id || webhookData.customId || webhookData.external_id,
    platform: 'NivoPay',
    paymentMethod: webhookData.method || 'pix',
    status: webhookData.status ? webhookData.status.toLowerCase() : 'paid',
    createdAt: webhookData.createdAt || webhookData.created_at || new Date().toISOString(),
    approvedDate: webhookData.updatedAt || webhookData.updated_at || null,
    refundedAt: webhookData.refundedAt || webhookData.refunded_at || null,
    customer: {
      name: webhookData.customer?.name || '',
      email: webhookData.customer?.email || '',
      document: webhookData.customer?.cpf || '',
      phone: webhookData.customer?.phone || ''
    },
    products: Array.isArray(webhookData.items) ? webhookData.items.map(item => ({
      id: item.id || '',
      name: item.title || '',
      planId: '',
      planName: '',
      quantity: item.quantity || 1,
      priceInCents: item.unitPrice || webhookData.amount || 0
    })) : [],
    trackingParameters: {
      utm_source: webhookData.utm_source || '',
      utm_medium: webhookData.utm_medium || '',
      utm_campaign: webhookData.utm_campaign || '',
      utm_content: webhookData.utm_content || '',
      utm_term: webhookData.utm_term || ''
    },
    commission: {
      totalPriceInCents: webhookData.amount || 0,
      gatewayFeeInCents: webhookData.gatewayFeeInCents || 0,
      userCommissionInCents: webhookData.userCommissionInCents || 0
    },
    isTest: webhookData.isTest || false
  };

  const utmifyUrl = 'https://api.utmify.com.br/api-credentials/orders';
  const utmifyToken = process.env.UTMIFY_TOKEN || 'xmnHbQedr1FctddxFvm7U0lLcZzNBApfHhr1'; // Troque pelo seu token real

  await axios.post(utmifyUrl, body, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-token': utmifyToken
    }
  });
}

// Funções auxiliares
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
    value: webhookData.amount / 100, // Converter centavos para reais
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
    // Substitua pela URL real da API externa
    const apiUrl = `https://pay.nivopayoficial.com.br/api/v1/transaction.getPayment?id=${transactionId}`;
    const response = await axios.get(apiUrl, {
      headers: {
        Authorization: process.env.SECRET_KEY
      }
    });
    const payment = response.data;
    // Retorne os dados relevantes para o frontend
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

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Modo de teste: ${process.env.TEST_MODE === 'true' ? 'Ativado' : 'Desativado'}`);
});

module.exports = app;

