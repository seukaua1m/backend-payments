const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class MetaService {
  constructor() {
    this.pixelId = process.env.META_PIXEL_ID;
    this.accessToken = process.env.META_ACCESS_TOKEN;
    this.apiVersion = 'v18.0';
    this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
  }

  // Hash de dados sensíveis conforme exigido pela Meta
  hashData(data) {
    if (!data) return null;
    return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
  }

  // Normalizar telefone para formato internacional
  normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove todos os caracteres não numéricos
    let cleanPhone = phone.replace(/\D/g, '');
    
    // Se começar com 0, remove
    if (cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }
    
    // Se não começar com 55 (código do Brasil), adiciona
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }
    
    return cleanPhone;
  }

  // Preparar dados do usuário para a Meta
  prepareUserData(customer) {
    logger.info('Dados recebidos para user_data:', customer);
    const userData = {};

    // Compatibilizar campos possíveis
    const email = customer.email || customer.em;
    const phone = customer.phone || customer.ph;
    const name = customer.name || customer.fn;

    if (email) {
      userData.em = [this.hashData(email)];
    }

    if (phone) {
      const normalizedPhone = this.normalizePhone(phone);
      if (normalizedPhone) {
        userData.ph = [this.hashData(normalizedPhone)];
      }
    }

    if (name) {
      const nameParts = name.trim().split(' ');
      if (nameParts.length > 0) {
        userData.fn = [this.hashData(nameParts[0])]; // Primeiro nome
      }
      if (nameParts.length > 1) {
        userData.ln = [this.hashData(nameParts[nameParts.length - 1])]; // Último nome
      }
    }

    // Adicionar país (Brasil)
    userData.country = ['br'];

    logger.info('user_data preparado para Meta:', userData);
    return userData;
  }

  // Preparar dados customizados da transação
  prepareCustomData(transaction) {
    logger.info('Dados recebidos para custom_data:', transaction);
    const customData = {
      currency: transaction.currency || 'BRL',
      value: transaction.value || transaction.amount / 100 || 0
    };

    // Adicionar IDs dos produtos se disponível
    if (transaction.items && transaction.items.length > 0) {
      customData.content_ids = transaction.items.map(item => 
        item.id || item.title || 'E-book'
      );
      customData.content_type = 'product';
      customData.num_items = transaction.items.reduce((sum, item) => 
        sum + (item.quantity || 1), 0
      );
    }

    logger.info('custom_data preparado para Meta:', customData);
    return customData;
  }

  // Enviar evento de conversão para Meta Ads
  async sendConversionEvent({ customer, transaction, eventSource = 'website' }) {
    try {
      if (!this.pixelId || !this.accessToken) {
        throw new Error('META_PIXEL_ID ou META_ACCESS_TOKEN não configurados');
      }

      const userData = this.prepareUserData(customer);
      const customData = this.prepareCustomData(transaction);

      const eventData = {
        data: [
          {
            event_name: 'Purchase',
            event_time: Math.floor(new Date(transaction.timestamp).getTime() / 1000),
            action_source: eventSource,
            user_data: userData,
            custom_data: customData,
            event_source_url: 'https://your-domain.com', // Substitua pelo seu domínio
            event_id: `purchase_${transaction.transactionId}_${Date.now()}`
          }
        ],
        test_event_code: process.env.TEST_MODE === 'true' ? 'TEST12345' : undefined
      };

      // Remover test_event_code se não estiver em modo de teste
      if (process.env.TEST_MODE !== 'true') {
        delete eventData.test_event_code;
      }

      logger.info('Enviando evento para Meta Ads:', {
        pixelId: this.pixelId,
        eventData: eventData
      });

      const response = await axios.post(
        `${this.baseUrl}/${this.pixelId}/events`,
        eventData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`
          },
          timeout: 10000 // 10 segundos de timeout
        }
      );

  logger.info('Resposta da Meta Ads:', response.data);

      return {
        success: true,
        eventId: eventData.data[0].event_id,
        response: response.data
      };

    } catch (error) {
      logger.error('Erro ao enviar evento para Meta Ads:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        stack: error.stack
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }

  // Testar conexão com Meta Ads
  async testConnection() {
    try {
      const response = await axios.get(
        `${this.baseUrl}/${this.pixelId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`
          },
          params: {
            fields: 'name,id'
          }
        }
      );

      return {
        success: true,
        pixelInfo: response.data
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  }
}

module.exports = new MetaService();
