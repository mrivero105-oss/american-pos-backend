const models = require('./database/models');

async function check() {
  try {
    console.log("Model names:", Object.keys(models));
    const { Setting, Sale, PaymentMethod } = models;
    if (Setting) {
      const s = await Setting.findAll();
      console.log("Settings:", s.map(x => x.toJSON()));
    }
    if (Sale) {
      const lastSale = await Sale.findOne({ order: [['createdAt', 'DESC']] });
      console.log("Last Sale:", lastSale ? lastSale.toJSON() : null);
    }
    if (PaymentMethod) {
      const pms = await PaymentMethod.findAll();
      console.log("PaymentMethods:", pms.map(x => x.toJSON()));
    }
  } catch (err) {
    console.error("ERROR:", err);
  } finally {
    process.exit(0);
  }
}

check();
