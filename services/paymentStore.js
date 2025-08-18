// Estrutura: { [transactionId]: { status, amount, customer, items, updatedAt } }
module.exports = {
  payments: {},

  savePaymentStatus(transactionId, data) {
    this.payments[transactionId] = {
      ...data,
      updatedAt: new Date().toISOString()
    };
  },

  getPaymentStatus(transactionId) {
    // Busca direta
    if (this.payments[transactionId]) return this.payments[transactionId];
    // Busca por customId
    for (const key in this.payments) {
      if (this.payments[key]?.customId === transactionId) {
        return this.payments[key];
      }
    }
    return null;
  }
};
