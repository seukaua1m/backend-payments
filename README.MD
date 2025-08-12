# Backend Meta Ads Webhook

Backend Node.js para receber webhooks de status de pagamento e enviar eventos de conversão para Meta Ads.

## Configuração

### 1. Variáveis de Ambiente

Copie o arquivo `.env.example` para `.env` e configure as seguintes variáveis:

```bash
# Meta Ads Configuration
META_PIXEL_ID=seu_pixel_id_aqui
META_ACCESS_TOKEN=seu_access_token_aqui

# Webhook Security (opcional)
WEBHOOK_SECRET=seu_webhook_secret_aqui

# Server Configuration
PORT=3000
NODE_ENV=development

# Test Mode (true para testes, false para produção)
TEST_MODE=true
```

### 2. Como obter o Meta Access Token

1. Acesse o [Meta Business Manager](https://business.facebook.com/)
2. Vá em **Configurações do Sistema** > **Tokens de Acesso**
3. Clique em **Gerar Token de Acesso**
4. Selecione seu app e as permissões necessárias:
   - `ads_management`
   - `business_management`
5. Copie o token gerado

### 3. Instalação

```bash
cd backend-meta
npm install
```

### 4. Execução

```bash
# Desenvolvimento
npm run dev

# Produção
npm start
```

## Endpoints

### POST /webhook/payment-status

Endpoint principal para receber webhooks de pagamento.

**Payload esperado:**
```json
{
  "id": "transaction_id",
  "status": "paid",
  "amount": 2830,
  "customer": {
    "name": "João Silva",
    "email": "joao@email.com",
    "phone": "11999999999",
    "cpf": "12345678901"
  },
  "items": [
    {
      "unitPrice": 2830,
      "title": "Frete Cartão Virtual",
      "quantity": 1,
      "tangible": false
    }
  ],
  "created_at": "2024-01-01T12:00:00Z"
}
```

### GET /health

Endpoint de health check.

### POST /test/webhook (apenas em desenvolvimento)

Endpoint para testar o envio de eventos para Meta Ads.

## Deploy no Railway

1. Conecte seu repositório ao Railway
2. Configure as variáveis de ambiente no dashboard do Railway
3. O deploy será automático

### Variáveis de Ambiente no Railway

```
META_PIXEL_ID=645623581293967
META_ACCESS_TOKEN=seu_token_real_aqui
WEBHOOK_SECRET=seu_secret_aqui
NODE_ENV=production
TEST_MODE=false
```

## Estrutura do Projeto

```
backend-meta/
├── index.js                 # Servidor principal
├── services/
│   └── metaService.js       # Serviço para Meta Ads API
├── utils/
│   ├── logger.js           # Sistema de logs
│   └── webhookValidator.js # Validação de webhooks
├── package.json
├── .env.example
├── .env
└── README.md
```

## Logs

O sistema gera logs estruturados em JSON para facilitar o monitoramento:

```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "level": "INFO",
  "message": "Webhook recebido",
  "data": { ... }
}
```

## Segurança

- Validação opcional de assinatura do webhook
- Hash de dados sensíveis (email, telefone, nome) antes de enviar para Meta
- Logs estruturados sem exposição de dados sensíveis
- Timeout configurado para requests externos

## Monitoramento

- Health check endpoint
- Logs estruturados
- Tratamento de erros robusto
- Modo de teste para desenvolvimento