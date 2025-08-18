// Endpoint simples para debug do webhook da NivoPay
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const metaService = require("./services/metaService");
const axios = require("axios");
const webhookValidator = require("./utils/webhookValidator");
const logger = require("./utils/logger");
const paymentStore = require("./services/paymentStore");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "Meta Webhook Backend",
  });
});

app.post("/webhook/nivopay-debug", (req, res) => {
  logger.info("Payload recebido do webhook NivoPay:", req.body);
  res.status(200).json({ message: "Payload recebido", payload: req.body });
});

// Webhook endpoint para receber status de pagamentos
app.post("/webhook/payment-status", async (req, res) => {
  try {
    const webhookData = req.body;
    try {
      const utmifyPayload = formatWebhookForUtmify(webhookData);
      await sendToUtmify(utmifyPayload);
      logger.info("Venda enviada para Utmify");
    } catch (utmifyError) {
      logger.error("Erro ao enviar venda para Utmify:", utmifyError.message);
    }
    res.status(200).json({ message: "Webhook recebido e enviado para Utmify" });
  } catch (error) {
    logger.error("Erro no processamento do webhook:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

function formatWebhookForUtmify(webhook) {
  // Função para formatar datas
  function formatDate(date) {
    if (!date) return null;
    // Remove 'T' e 'Z' do ISO
    return new Date(date)
      .toISOString()
      .replace("T", " ")
      .replace("Z", "")
      .substring(0, 19);
  }

  // Status mapping
  const statusMap = {
    APPROVED: "paid",
    PAID: "paid",
    WAITING_PAYMENT: "waiting_payment",
    REFUNDED: "refunded",
    REFUSED: "refused",
    CHARGEDBACK: "chargedback",
  };

  return {
    orderId: webhook.paymentId || webhook.customId || webhook.id || "",
    platform: "NivoPay",
    paymentMethod: (webhook.paymentMethod || "").toLowerCase(),
    status:
      statusMap[(webhook.status || "").toUpperCase()] || "waiting_payment",
    createdAt: formatDate(webhook.createdAt),
    approvedDate: formatDate(webhook.approvedAt),
    refundedAt: formatDate(webhook.refundedAt),
    customer: {
      name: webhook.customer?.name || "",
      email: webhook.customer?.email || "",
      phone: webhook.customer?.phone
        ? webhook.customer.phone.replace("+", "")
        : null,
      document: webhook.customer?.cpf || null,
      country: "BR",
      ip: webhook.customer?.ip || null,
    },
    products: Array.isArray(webhook.items)
      ? webhook.items.map((item) => ({
          id: item.id || "",
          name: item.title || item.name || "",
          planId: null,
          planName: null,
          quantity: item.quantity || 1,
          priceInCents: item.unitPrice || 0,
        }))
      : [],
    trackingParameters: {
      src: null,
      sck: null,
      utm_source: null,
      utm_campaign: null,
      utm_medium: null,
      utm_content: null,
      utm_term: null,
    },
    commission: {
      totalPriceInCents: webhook.totalValue || 0,
      gatewayFeeInCents: webhook.gatewayFeeInCents || 0,
      userCommissionInCents: webhook.netValue || 0,
      currency: "BRL",
    },
    isTest: false,
  };
}

// Função para enviar dados para Utmify
async function sendToUtmify(utmifyPayload) {
  const utmifyUrl = "https://api.utmify.com.br/api-credentials/orders";
  const utmifyToken = process.env.UTMIFY_TOKEN || "xmnHbQedr1FctddxFvm7U0lLcZzNBApfHhr1";
  await axios.post(utmifyUrl, utmifyPayload, {
    headers: {
      "Content-Type": "application/json",
      "x-api-token": utmifyToken,
    },
  });
}

function checkPaymentStatus(webhookData) {
  const status = webhookData.status?.toLowerCase();
  return status === "paid" || status === "approved" || status === "completed";
}

function extractCustomerData(webhookData) {
  const customer = webhookData.customer || webhookData;
  if (!customer.email || !customer.name) {
    return null;
  }
  return {
    email: customer.email,
    name: customer.name,
    phone: customer.phone || "",
    cpf: customer.cpf || customer.document || "",
  };
}

function extractTransactionData(webhookData) {
  if (!webhookData.amount) {
    return null;
  }
  return {
    transactionId: webhookData.id || webhookData.external_id,
    value: webhookData.amount / 100,
    currency: "BRL",
    items: webhookData.items || [],
    timestamp: webhookData.created_at || new Date().toISOString(),
  };
}

// Endpoint para consultar status do pagamento usando API externa
app.get("/payment/status", async (req, res) => {
  const transactionId = req.query.transaction;
  if (!transactionId) {
    return res
      .status(400)
      .json({ error: "Parâmetro transaction obrigatório." });
  }
  try {
    const apiUrl = `https://pay.nivopayoficial.com.br/api/v1/transaction.getPayment?id=${transactionId}`;
    const response = await axios.get(apiUrl, {
      headers: { Authorization: process.env.SECRET_KEY },
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
      customId: payment.customId,
    });
  } catch (error) {
    logger.error("Erro ao consultar status externo:", error.message);
    return res
      .status(404)
      .json({ error: "Pagamento não encontrado ou erro na API externa." });
  }
});

app.listen(PORT, () => {
  logger.info(`Servidor rodando na porta ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || "development"}`);
  logger.info(
    `Modo de teste: ${
      process.env.TEST_MODE === "true" ? "Ativado" : "Desativado"
    }`
  );
});

module.exports = app;
