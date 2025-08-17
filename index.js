const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const metaService = require('./services/metaService');
const webhookValidator = require('./utils/webhookValidator');
const logger = require('./utils/logger');

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
    
    // Verificar se o pagamento foi aprovado
    const isPaymentApproved = checkPaymentStatus(webhookData);
    
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

// Endpoint de teste para simular webhook
app.post('/test/webhook', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Endpoint não disponível em produção' });
  }

  try {
    const testData = {
      id: 'test_' + Date.now(),
      status: 'paid',
      amount: 2830, // R$ 28,30 em centavos
      customer: {
        name: 'João Silva',
        email: 'joao.silva@email.com',
        cpf: '12345678901',
        phone: '11999999999'
      },
      items: [
        {
          unitPrice: 2830,
          title: 'Frete Cartão Virtual',
          quantity: 1,
          tangible: false
        }
      ],
      created_at: new Date().toISOString()
    };

    // Simular processamento do webhook
    const customerData = extractCustomerData(testData);
    const transactionData = extractTransactionData(testData);

    const conversionResult = await metaService.sendConversionEvent({
      customer: customerData,
      transaction: transactionData,
      eventSource: 'website'
    });

    res.status(200).json({
      message: 'Teste executado com sucesso',
      testData,
      conversionResult
    });

  } catch (error) {
    logger.error('Erro no teste:', error);
    res.status(500).json({ error: 'Erro no teste' });
  }
});

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

// Iniciar servidor
app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Modo de teste: ${process.env.TEST_MODE === 'true' ? 'Ativado' : 'Desativado'}`);
});

module.exports = app;
