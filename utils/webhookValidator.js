const crypto = require('crypto');
const logger = require('./logger');

class WebhookValidator {
  // Validar assinatura do webhook (implementação genérica)
  validateWebhook(req) {
    try {
      const secret = process.env.WEBHOOK_SECRET;
      if (!secret) {
        logger.warn('WEBHOOK_SECRET não configurado - pulando validação');
        return true;
      }

      // Verificar se existe header de assinatura
      const signature = req.headers['x-signature'] || 
                       req.headers['x-hub-signature-256'] ||
                       req.headers['signature'];

      if (!signature) {
        logger.error('Header de assinatura não encontrado');
        return false;
      }

      // Gerar hash esperado
      const payload = JSON.stringify(req.body);
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Comparar assinaturas
      const providedSignature = signature.replace('sha256=', '');
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      if (!isValid) {
        logger.error('Assinatura do webhook inválida');
      }

      return isValid;

    } catch (error) {
      logger.error('Erro na validação do webhook:', error);
      return false;
    }
  }

  // Validar estrutura básica do payload
  validatePayload(payload) {
    const requiredFields = ['id', 'status'];
    
    for (const field of requiredFields) {
      if (!payload[field]) {
        logger.error(`Campo obrigatório ausente: ${field}`);
        return false;
      }
    }

    return true;
  }
}

module.exports = new WebhookValidator();