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
    return this.payments[transactionId] || null;
  }
};
